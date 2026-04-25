// src/core/lm-studio.provider.ts

import { spawn } from 'node:child_process';

export class LMStudioProvider {
  readonly name = 'lm-studio';
  private baseUrl: string;

  constructor(baseUrl?: string) {
    this.baseUrl = baseUrl || process.env.LMS_URL || 'http://localhost:1234';
  }

  async getModels(): Promise<{ id: string; name?: string }[]> {
    try {
      const proc = spawn('cmd', ['/c', 'lms', 'ls'], {
        stdio: ['pipe', 'pipe', 'pipe']
      });

      return new Promise((resolve) => {
        let output = '';
        proc.stdout.on('data', (data) => { output += data.toString(); });
        proc.on('close', () => {
          const lines = output.split('\n');
          const models: { id: string; name?: string }[] = [];
          let inLLMSection = false;

          for (const line of lines) {
            if (line.startsWith('LLM')) {
              inLLMSection = true;
              continue;
            }
            if (line.startsWith('EMBEDDING') || line.startsWith('---')) {
              break;
            }

            if (inLLMSection && line.trim() && !line.includes('PARAMS') && !line.includes('ARCH')) {
              const match = line.trim().match(/^([^\s(]+)/);
              if (match) {
                const id = match[1].trim();
                models.push({ id, name: id.split('/').pop() });
              }
            }
          }
          resolve(models);
        });
        proc.on('error', () => resolve([]));
      });
    } catch {
      return [];
    }
  }

  async chat(modelId: string, messages: any[]): Promise<string> {
    try {
      const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: modelId,
          messages,
          temperature: 0.2
        })
      });

      if (!response.ok) throw new Error('LM Studio API Error');
      const data = await response.json();
      return data.choices[0].message.content;
    } catch (error) {
      console.error('[LMStudioProvider Error]:', error);
      throw error; // прокидываем ошибку для стратегии fallback
    }
  }

  async checkStatus(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/v1/models`);
      return res.ok;
    } catch {
      return false;
    }
  }

  // Вспомогательный метод для выгрузки текущей модели (специфично для LM Studio)
  async unloadCurrentModel(): Promise<void> {
    await fetch(`${this.baseUrl}/v1/plugins/model-loader/unload`, { method: 'POST' }).catch(() => {});
  }
}
