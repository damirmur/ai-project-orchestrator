// src/core/model-orchestrator.ts

import { state } from '../modules/state/state.service.ts';
import { LMStudioProvider } from './lm-studio.provider.ts';
import { CloudProvider } from './cloud.provider.ts';
import { tryStartLMStudio } from '../utils/lmstudio-autostart.ts';
import { logLine } from '../modules/logger/logger.service.ts';
import { getToday } from '../utils/date.ts';

const TODAY = getToday();
const SYSTEM_PROMPT = `Сегодня: ${TODAY}
Ты — эксперт-программист Node.js. У тебя есть доступ к проекту через команды:
- /tree — показать структуру проектов.
- /files [path] — список файлов проекта.
- /read <file> — прочитать файл и показать содержимое.
- /write [file] — записать изменения.
- /test — npm test.
- /lint — tsc --noEmit.
- /install <package> — npm install.
- /new <name> — создать проект.
- /seed <project> [title] — создать seed.
- /deps <project> — показать зависимости.

ПРАВИЛА:
1. Когда пользователь просит "покажи файл" или "что в файле" — используй /read <file> и покажи содержимое.
2. Когда пользователь просит "структуру" или "дерево" — используй /tree.
3. Не пиши код или JSON в ответе.
4. /read работает с путями: "src/index.ts" или "rag-api/src/index.ts".

ЕСЛИ НУЖЕН ВЕБ-ПОИСК (курс валют, погода, гороскоп, новости):
Верни ТОЛЬКО JSON (без объяснений, без текста). 
В поле "args" напиши максимально точный и развернутый запрос, сохранив ВСЕ детали (валюты, даты, города, временные маркеры) из сообщения пользователя. 
КАТЕГОРИЧЕСКИ ЗАПРЕЩЕНО удалять или сокращать фразы типа "на сегодня", "сейчас", "на текущий момент", "за неделю".
Пример: "курс доллара к рублю на сегодня" -> {"command": "/web-search", "args": "курс доллара к рублю на сегодня"}
{"command": "/web-search", "args": "точный поисковый запрос со всеми деталями"}

ЕСЛИ НУЖНА ОЧИСТКА РЕЗУЛЬТАТОВ ПОИСКА:
Верни ТОЛЬКО JSON:
{"command": "/web-clean", "loadModel": true}

При создании RAG-проекта:
- opencodeEmbedding.createRagDb(dbPath) — создать SQLite базу.
- opencodeEmbedding.ingestRagText(dbPath, text, docId?) — индексировать текст.
- opencodeEmbedding.searchRag(dbPath, query, limit?) — поиск по similarity.

ИИ предлагает код, бот записывает в файл.`;

export class ModelOrchestrator {
  private providers: Map<string, any> = new Map();
  private strategy: 'sequential' | 'parallel' | 'fallback' = 'sequential';

  constructor() {
    this.registerProvider(new LMStudioProvider());
    if (process.env['OPENROUTER_KEY']) {
      this.registerProvider(new CloudProvider());
    }
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
      if (!provider) return [];
      const models = await provider.getModels();
      return models.map((m: any) => ({ ...m, id: `${providerName}:${m.id}` }));
    }
    const allModels: any[] = [];
    for (const provider of this.providers.values()) {
      const models = await provider.getModels();
      allModels.push(...models.map((m: any) => ({ ...m, id: `${provider.name}:${m.id}` })));
    }
    return allModels;
  }

  async setActiveModel(fullModelId: string): Promise<string> {
    const firstColon = fullModelId.indexOf(':');
    if (firstColon === -1) throw new Error(`Неверный формат ID модели: ${fullModelId}`);
    const providerName = fullModelId.substring(0, firstColon);
    const modelId = fullModelId.substring(firstColon + 1);
    if (!this.providers.has(providerName)) {
      throw new Error(`Неизвестный провайдер: ${providerName}`);
    }
    const provider = this.providers.get(providerName)!;
    if (providerName === 'lm-studio') {
      try { await provider.unloadCurrentModel?.(); } catch {}
    }
    const providersState = state.getGlobal<Record<string, any>>('providers') || {};
    if (!providersState[providerName]) providersState[providerName] = {};
    providersState[providerName].activeModelId = fullModelId;
    return state.setGlobal('providers', providersState).then(async () => {
      if (providerName === 'lm-studio') {
        await state.setGlobal('activeModelId', fullModelId);
      }
      await state.setGlobal('lastSelectedModelId', fullModelId);
      return `✅ Модель выбрана для ${providerName}: ${modelId.split('/').pop()}`;
    });
  }

  getActiveModel(providerName?: string): string | null {
    const providersState = state.getGlobal<Record<string, any>>('providers') || {};
    if (providerName) {
      return providersState[providerName]?.activeModelId || null;
    }
    return state.getGlobal('activeModelId') || null;
  }

  hasActiveModel(providerName?: string): boolean {
    const providersState = state.getGlobal<Record<string, any>>('providers') || {};
    if (providerName) {
      return !!providersState[providerName]?.activeModelId;
    }
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
    const lastModelId = state.getGlobal<string>('lastSelectedModelId');
    if (!lastModelId) throw new Error('Нет активной модели');
    const colonIdx = lastModelId.indexOf(':');
    if (colonIdx <= 0) throw new Error('Неверный формат модели');
    const providerName = lastModelId.substring(0, colonIdx);
    const provider = this.providers.get(providerName);
    if (!provider) throw new Error(`Неизвестный провайдер: ${providerName}`);
    const modelId = lastModelId.substring(colonIdx + 1);
    const systemContent = SYSTEM_PROMPT + (context ? `\n\nКонтекст проекта:\n${context}` : '');
    const msgLen = userMessage.length;
    try {
      await logLine(`📤 MODEL_REQ | →${providerName}:${modelId} | msgLen=${msgLen}`);
      const result = await provider.chat(modelId, [
        { role: 'system', content: systemContent },
        { role: 'user', content: userMessage }
      ]);
      await logLine(`📥 MODEL_RES | ←${providerName}:${modelId} | resultLen=${result.length}`);
      return result;
    } catch (error: any) {
      await logLine(`❌ MODEL_ERR | ${providerName}:${modelId} | error="${error.message}"`);
      throw new Error(`Модель недоступна: ${error.message}`);
    }
  }

  async checkStatus(): Promise<Record<string, boolean>> {
    const status: Record<string, boolean> = {};
    for (const [name, provider] of this.providers) {
      if (name === 'lm-studio') {
        let isOnline = await provider.checkStatus();
        if (!isOnline) {
          const startResult = await tryStartLMStudio();
          if (startResult.success) {
            isOnline = await provider.checkStatus();
          }
          await logLine(`LMStudio checkStatus: ${startResult.message}`);
        }
        status[name] = isOnline;
      } else {
        status[name] = await provider.checkStatus();
      }
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
      projectRoot: process.env['PROJECTS_ROOT'] || './projects'
    };
  }
}

export const modelOrchestrator = new ModelOrchestrator();