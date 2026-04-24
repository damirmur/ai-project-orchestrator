// src/core/lm-studio.provider.ts

import path from 'node:path';

export class LMStudioProvider {
  readonly name = 'lm-studio';
  private baseUrl: string;

  constructor(baseUrl?: string) {
    this.baseUrl = baseUrl || process.env.LMS_URL || 'http://localhost:1234';
  }

  async getModels(): Promise<{ id: string; name?: string }[]> {
    try {
      const res = await fetch(`${this.baseUrl}/v1/models`);
      const data = await res.json();
      return (data.data || []) as { id: string; name?: string }[];
    } catch {
      return [];
    }
  }

  async chat(modelId: string, messages: any[], context?: string): Promise<string> {
    const systemContent = context
      ? `Ты — эксперт-программист Node.js. Тебе предоставлен код файла для редактирования:\n\n` +
        `----------\nТекущий файл: ${messages.find((m: any) => m.role === 'user')?.content || 'не выбран'}.\n${context}\n----------\n\n` +
        `Твоя задача: проанализировать запрос пользователя и вывести ИСПРАВЛЕННЫЙ код целиком. ` +
        `Не пиши лишних объяснений, если тебя об этом не просят. ` +
        `Обязательно используй блоки кода Markdown (например, \`\`typescript ... \`\`).`
      : "Ты — полезный ИИ-ассистент.";

    try {
      const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: modelId,
          messages: [
            { role: 'system', content: systemContent },
            ...messages.filter((m: any) => m.role !== 'system')
          ],
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
