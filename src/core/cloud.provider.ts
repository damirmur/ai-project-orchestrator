// src/core/cloud.provider.ts//

export class CloudProvider {
  readonly name = 'cloud-openrouter';
  private baseUrl = 'https://openrouter.ai/api/v1';

  private getApiKey(): string {
    return process.env.OPENROUTER_KEY || '';
  }

  async getModels(): Promise<{ id: string; name?: string }[]> {
    const apiKey = this.getApiKey();
    if (!apiKey) return [];
    try {
      const res = await fetch(`${this.baseUrl}/models?output_modalities=text`, {
        headers: { 'Authorization': `Bearer ${apiKey}` }
      });
      const data = await res.json();

      const models = (data.data || []).map((m: any) => {
        const promptPrice = parseFloat(m.pricing?.prompt || '0');
        const completionPrice = parseFloat(m.pricing?.completion || '0');
        const idHasFree = m.id.toLowerCase().includes(':free') || m.id.toLowerCase().includes('/free');
        return {
          id: m.id,
          name: m.name || m.id,
          isFree: promptPrice === 0 && completionPrice === 0,
          idHasFree: idHasFree,
          provider: m.id.split('/')[0].toLowerCase()
        };
      });

      const popular = ['openai', 'anthropic', 'meta', 'google', 'mistral', 'xai', 'deepseek', 'qwen', 'microsoft'];

      return models
        .sort((a, b) => {
          if (a.idHasFree && !b.idHasFree) return -1;
          if (!a.idHasFree && b.idHasFree) return 1;
          if (a.isFree && !b.isFree) return -1;
          if (!a.isFree && b.isFree) return 1;
          const aPopular = popular.includes(a.provider);
          const bPopular = popular.includes(b.provider);
          if (aPopular && !bPopular) return -1;
          if (!aPopular && bPopular) return 1;
          return a.name.localeCompare(b.name);
        })
        .slice(0, 100)
        .map(m => ({ id: m.id, name: m.name }));
    } catch {
      return [];
    }
  }

  async chat(modelId: string, messages: any[], context?: string): Promise<string> {
    const apiKey = this.getApiKey();
    if (!apiKey) throw new Error('OPENROUTER_KEY не задан');

    const systemMessage = context
      ? `Ты — эксперт-программист. Контекст проекта:\n${context}\n\nТвоя задача: ${messages.find((m: any) => m.role === 'user')?.content || 'помощь с кодом'}`
      : "Ты — полезный ИИ-ассистент.";

    try {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: modelId,
          messages: [
            { role: 'system', content: systemMessage },
            ...messages.filter((m: any) => m.role !== 'system')
          ],
          temperature: 0.2
        })
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Cloud API Error: ${response.status} ${errText}`);
      }

      const data = await response.json();
      return data.choices?.[0]?.message?.content || 'Нет ответа от облачной модели.';
    } catch (error) {
      console.error('[CloudProvider Error]:', error);
      throw error;
    }
  }

  async checkStatus(): Promise<boolean> {
    const apiKey = this.getApiKey();
    if (!apiKey) return false;
    try {
      const res = await fetch(`${this.baseUrl}/models`, {
        headers: { 'Authorization': `Bearer ${apiKey}` }
      });
      return res.ok;
    } catch {
      return false;
    }
  }
}
