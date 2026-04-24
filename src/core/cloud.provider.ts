// src/core/cloud.provider.ts//

export class CloudProvider {
  readonly name = 'cloud-openrouter';
  private apiKey: string;
  private baseUrl = 'https://openrouter.ai/api/v1';

  constructor(apiKey?: string) {
    this.apiKey = apiKey || process.env.OPENROUTER_KEY || '';
    if (!this.apiKey) {
      console.warn('⚠️ OPENROUTER_KEY не задан. CloudProvider будет недоступен.');
    }
  }

  async getModels(): Promise<{ id: string; name?: string }[]> {
    try {
      const res = await fetch(`${this.baseUrl}/models`, {
        headers: { 'Authorization': `Bearer ${this.apiKey}` }
      });
      const data = await res.json();
      return (data.data || []).map((m: any) => ({
        id: m.id,
        name: m.name || m.id
      }));
    } catch {
      return [];
    }
  }

  async chat(modelId: string, messages: any[], context?: string): Promise<string> {
    if (!this.apiKey) throw new Error('OPENROUTER_KEY не задан');

    const systemMessage = context
      ? `Ты — эксперт-программист. Контекст проекта:\n${context}\n\nТвоя задача: ${messages.find((m: any) => m.role === 'user')?.content || 'помощь с кодом'}`
      : "Ты — полезный ИИ-ассистент.";

    try {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`
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
    try {
      const res = await fetch(`${this.baseUrl}/models`, {
        headers: { 'Authorization': `Bearer ${this.apiKey}` }
      });
      return res.ok;
    } catch {
      return false;
    }
  }
}
