// src/core/model-orchestrator.ts//

import { state } from '../modules/state/state.service.ts';
import { LMStudioProvider } from './lm-studio.provider.ts';
import { CloudProvider } from './cloud.provider.ts';

export class ModelOrchestrator {
  private providers: Map<string, any> = new Map();
  private strategy: 'sequential' | 'parallel' | 'fallback' = 'sequential';

  constructor() {
    // Инициализируем провайдеры по умолчанию
    this.registerProvider(new LMStudioProvider());
    if (process.env.OPENROUTER_KEY) {
      this.registerProvider(new CloudProvider());
    }

    // Восстанавливаем стратегию из состояния
    const savedStrategy = state.getGlobal<string>('modelStrategy');
    if (savedStrategy === 'sequential' || savedStrategy === 'parallel' || savedStrategy === 'fallback') {
      this.strategy = savedStrategy;
    }
  }

  registerProvider(provider: any): void {
    this.providers.set(provider.name, provider);
  }

  getProvider(name: string): any {
    return this.providers.get(name);
  }

  getProviders(): any[] {
    return Array.from(this.providers.values());
  }

  async getModels(providerName?: string): Promise<any[]> {
    if (providerName) {
      const provider = this.providers.get(providerName);
      return provider ? provider.getModels() : [];
    }
    // Собираем модели от всех провайдеров
    const allModels: any[] = [];
    for (const provider of this.providers.values()) {
      const models = await provider.getModels();
      allModels.push(...models.map((m: any) => ({ ...m, id: `${provider.name}:${m.id}` })));
    }
    return allModels;
  }

  async setActiveModel(fullModelId: string): Promise<string> {
    // fullModelId формат: "provider-name:model-id" (может содержать несколько двоеточий)
    const firstColon = fullModelId.indexOf(':');
    if (firstColon === -1) throw new Error(`Неверный формат ID модели: ${fullModelId}`);
    const providerName = fullModelId.substring(0, firstColon);
    const modelId = fullModelId.substring(firstColon + 1);
    
    if (!this.providers.has(providerName)) {
      throw new Error(`Неизвестный провайдер: ${providerName}`);
    }

    // Для LM Studio выгружаем предыдущую модель
    const provider = this.providers.get(providerName)!;
    if (providerName === 'lm-studio') {
      try {
        await provider.unloadCurrentModel?.();
      } catch {}
    }

    // Сохраняем ВСЮДУ fullModelId (чтобы при отображении было понятно, какой провайдер)
    const providersState = state.getGlobal<Record<string, any>>('providers') || {};
    if (!providersState[providerName]) providersState[providerName] = {};
    providersState[providerName].activeModelId = fullModelId; // <-- сохраняем полный ID
    
    return state.setGlobal('providers', providersState).then(() => {
      // Для совместимости обновляем и старое поле
      if (providerName === 'lm-studio') {
        state.setGlobal('activeModelId', fullModelId);
      }
      return `✅ Модель выбрана для ${providerName}: ${modelId.split('/').pop()}`;
    });
  }

  getActiveModel(providerName?: string): string | null {
    const providersState = state.getGlobal<Record<string, any>>('providers') || {};
    if (providerName) {
      return providersState[providerName]?.activeModelId || null;
    }
    // Для совместимости (старое поле)
    return state.getGlobal('activeModelId') || null;
  }

  hasActiveModel(providerName?: string): boolean {
    const providersState = state.getGlobal<Record<string, any>>('providers') || {};
    if (providerName) {
      return !!providersState[providerName]?.activeModelId;
    }
    // Проверяем, есть ли активная модель хотя бы у одного провайдера
    return Object.values(providersState).some((p: any) => !!p.activeModelId);
  }

  setStrategy(strategy: 'sequential' | 'parallel' | 'fallback'): Promise<void> {
    this.strategy = strategy;
    return state.setGlobal('modelStrategy', strategy);
  }

  getStrategy(): string {
    return this.strategy;
  }

  async chat(userMessage: string, sessionKey: string, context?: string): Promise<string> {
    const messages: any[] = [{ role: 'user', content: userMessage }];

    // Если стратегия parallel — отправляем всем активным провайдерам
    if (this.strategy === 'parallel') {
      return this.chatParallel(messages, context);
    }

    // Sequential или fallback — идем по порядку
    const providers = this.getProviders();
    let lastError: any = null;

    for (const provider of providers) {
      const fullModelId = this.getActiveModel(provider.name);
      if (!fullModelId) continue;

      // Извлекаем чистый ID модели (убираем префикс провайдера)
      const firstColon = fullModelId.indexOf(':');
      const cleanModelId = firstColon >= 0 ? fullModelId.substring(firstColon + 1) : fullModelId;

      try {
        const response = await provider.chat(cleanModelId, messages, context);
        return response;
      } catch (error) {
        lastError = error;
        if (this.strategy === 'fallback') {
          continue; // Пробуем следующий провайдер
        }
        break; // При sequential останавливаемся на первой ошибке
      }
    }

    throw lastError || new Error('Нет активных моделей или провайдеров');
  }

  private async chatParallel(messages: any[], context?: string): Promise<string> {
    const providers = this.getProviders();
    const promises = providers
      .filter((p: any) => this.getActiveModel(p.name))
      .map(async (provider: any) => {
        const fullModelId = this.getActiveModel(provider.name)!;
        const firstColon = fullModelId.indexOf(':');
        const cleanModelId = firstColon >= 0 ? fullModelId.substring(firstColon + 1) : fullModelId;
        return provider.chat(cleanModelId, messages, context);
      });

    try {
      const results = await Promise.allSettled(promises);
      const firstFulfilled = results.find((r: any) => r.status === 'fulfilled');
      if (firstFulfilled && firstFulfilled.status === 'fulfilled') {
        return firstFulfilled.value;
      }
      throw new Error('Все параллельные запросы завершились ошибкой');
    } catch (error) {
      throw error;
    }
  }

  async checkStatus(): Promise<Record<string, boolean>> {
    const status: Record<string, boolean> = {};
    for (const [name, provider] of this.providers) {
      status[name] = await provider.checkStatus();
    }
    return status;
  }

  async getSystemStats() {
    const allStatus = await this.checkStatus();
    const activeModels = state.getGlobal<Record<string, any>>('providers') || {};
    
    return {
      strategy: this.strategy,
      providers: Object.entries(activeModels).map(([name, data]) => {
        const fullId = data?.activeModelId || '';
        const display = fullId.includes(':') 
          ? fullId.split(':').slice(1).join(':').split('/').pop()
          : fullId.split('/').pop();
        return {
          name,
          online: allStatus[name] || false,
          activeModel: fullId ? `${name}: ${display}` : 'не выбрана'
        };
      }),
      projectRoot: process.env.PROJECTS_ROOT || './projects'
    };
  }
}

// Экспортируем экземпляр по умолчанию (для обратной совместимости)
export const modelOrchestrator = new ModelOrchestrator();
