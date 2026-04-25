# TODO — План развития ai-project-orchestrator

## ✅ Выполнено

### ✅ Этап I. AI-провайдеры и стратегии

**Цель**: Разделить работу с LM Studio и облачными API, несколько моделей последовательно/параллельно.

**Выполнено**:
- ✅ `src/core/model-orchestrator.ts` — оркестратор с провайдерами и стратегиями (`sequential`, `parallel`, `fallback`)
- ✅ `src/core/lm-studio.provider.ts` — LM Studio
- ✅ `src/core/cloud.provider.ts` — OpenRouter
- ✅ `state.service.ts`: поля `providers`, `modelStrategy`
- ✅ Команды бота: `🤖 Провайдеры`, пагинация моделей

---

### ✅ Этап II. Расширение opencode и команды проекта

**Цель**: ИИ может выполнять тесты, линтеры, установку пакетов, создавать проекты.

**Выполнено**:
- ✅ `opencode.executeCommand(command)` — whitelist, таймаут 60с
- ✅ `opencode.getProjectMeta()` — scripts, deps, конфиги
- ✅ `opencode.mkProject(name)` — полная структура проекта
- ✅ `opencode.mkSeed(project, docs)` — seed-скрипт
- ✅ SYSTEM_PROMPT: /read, /write, /test, /lint, /install, /new, /seed, /deps
- ✅ Команды `/test`, `/lint`, `/install`, `/new`, `/seed`, `/deps`

**Whitelist команд**:
```
npm test, npm run, npm install, npm ci,
npm init, npm pkg add,
npx tsx, tsx, ts-node,
npx tsc --noEmit, npm run typecheck, npm run lint,
git status, git diff, git add, git commit, git push,
mkdir, rm, cp
```

---

### ✅ Этап III. RAG и эмбеддинги

**Цель**: ИИ создаёт RAG-проекты с эмбеддингами через LM Studio.

**Выполнено**:
- ✅ Проект `projects/rag-api/` — полная структура
- ✅ SQLite: chunks, docs, embeddings (BLOB вектора)
- ✅ `opencodeEmbedding.embedText(text)` → `{ vector: number[] }` через LM Studio `/v1/embeddings` (nomic-embed-text-v1.5)
- ✅ `opencodeEmbedding.vectorToBlob(vec)` — Float32Array → Uint8Array
- ✅ `opencodeEmbedding.blobToVector(blob)` — Uint8Array → number[]
- ✅ `opencodeEmbedding.cosine(vecA, vecB)` — cosine similarity (0..1)
- ✅ `opencodeEmbedding.getEmbedConfig()` — url и модель
- ✅ `opencodeEmbedding.createRagDb(dbPath)` — создать SQLite базу (chunks, docs, embeddings)
- ✅ `opencodeEmbedding.ingestRagText(dbPath, content, docId?, metadata?)` — индексировать текст
- ✅ `opencodeEmbedding.searchRag(dbPath, query, limit?)` — поиск по similarity
- ✅ Экспорт `opencodeEmbedding` как алиас на `opencode`
- ✅ SYSTEM_PROMPT с примерами RAG-функций

**RAG как инструмент бота** (без веб-сервера):
- RAG встроен в `opencode.service.ts`, не отдельный проект
- База внутри каждого проекта: `{PROJECT}/data/rag.db`
- ИИ создаёт RAG на лету через `createRagDb` + `ingestRagText`
- Пример использования:
```typescript
const dbPath = `${projectRoot}/data/rag.db`;
await opencodeEmbedding.createRagDb(dbPath);
await opencodeEmbedding.ingestRagText(dbPath, "документ...", "doc-1");
const { results } = await opencodeEmbedding.searchRag(dbPath, "запрос", 5);
```

---

## 📋 В работе

### 🔄 Этап IV-A. Веб-поиск для локальной модели

**Цель**: Локальная модель не знает свежих новостей → интеграция веб-поиска через облако.

**Задачи**:
- [ ] Провайдер `SearchProvider` — DuckDuckGo API
- [ ] Функция `opencode.webSearch(query)` → `{ title, snippet, url }[]`
- [ ] Автоматический fallback на поиск при вопросах о новостях/коде/библиотеках
- [ ] RAG для проекта — актуализация после успешного `npm test`

---

### 🔄 Этап IV-B. Мастер проектов (new / edit)

**Цель**: Полноценное управление проектами через бота.

**Задачи**:
- [ ] Диалоговый мастер `/new`:
  - Имя проекта (по умолчанию: `ai-project-{timestamp}`)
  - Стек: Node.js 24+, strict TS, ESNext ✓
  - Системный промпт (ИИ предлагает на основе назначения)
  - Промпт-задание (описание проекта)
  - Опции: temperature, max_tokens, top_p (по умолчанию разумные)
  - Git init, npm install
  - Seed RAG из system prompt + docs
- [ ] Мастер `/edit`:
  - Показать текущие настройки
  - Редактирование полей
  - Git operations (add, commit)
  - Актуализация RAG после изменений
- [ ] Хранение настроек в `bot-ai/config.json`
- [ ] Команды `/config` — показать, `/config set <key> <value>`

---

### 🔄 Этап V. Состояние и сессии

**Цель**: Привести хранение состояния в соответствие с архитектурой.

**Задачи**:
- [ ] Обновить StateService для нескольких провайдеров
- [ ] Добавить в SessionState: `activeProvider`, `lastCommand`
- [ ] Механизм очистки старых сессий (таймаут)
- [ ] Рефакторинг src/index.ts — инициализация адаптеров

---

### 🔄 Этап VI. Messenger Adapters

**Цель**: Вынести платформо-зависимую логику в адаптеры (VK, Telegram, Google Chat).

**Задачи**:
- [ ] Интерфейс `MessengerAdapter`
- [ ] Выделить `ConversationHandler` из vk.service.ts
- [ ] Рефакторинг vk.service.ts → VKAdapter
- [ ] Каркасы TelegramAdapter, GoogleChatAdapter (заглушки)
- [ ] Инициализация адаптеров в src/index.ts

---

### 🔄 Этап VII. Документация и тестирование

**Задачи**:
- [ ] Обновить AGENTS.md и README.md
- [ ] Примеры команд и выбора стратегий
- [ ] Как добавить новый мессенджер/провайдер
- [ ] Юнит-тесты для ModelOrchestrator, ConversationHandler, OpenCodeService

---

## 📊 Сводная таблица

| Этап | Задачи | Статус | Время |
|------|--------|--------|-------|
| I | AI-провайдеры | ✅ | 2-3 дня |
| II | opencode команды | ✅ | 2-3 дня |
| III | RAG/эмбеддинги | ✅ | 2-3 дня |
| IV-A | Веб-поиск | 🔄 | 2-3 дня |
| IV-B | Мастер проектов | 🔄 | 3-4 дня |
| V | Состояние и сессии | 🔄 | 1-2 дня |
| VI | Messenger Adapters | 🔄 | 3-4 дня |
| VII | Документация | 🔄 | 1 день |

---

## 🎯 Порядок выполнения

**Выполнено**: I → II → III

**Далее**: IV-A → IV-B → V → VI → VII