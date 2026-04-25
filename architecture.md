# Architecture Overview

## Components Diagram

```
+-------------------+        +----------------------+        +-------------------+
|   VK Bot (vk.io)  | <----> |  ModelOrchestrator  | <----> | LMStudioProvider  |
|                   |        |  (src/core/model-   |        | (src/core/lm-     |
|                   |        |   orchestrator.ts) |        |   studio.provider)|
+-------------------+        +----------------------+        +-------------------+
          |                              |                        |
          v                              v                        v
+-------------------+        +----------------------+        +-------------------+
| opencode.service  |<----> |  CloudProvider      |        |  LMStudioEmbed    |
| (file ops, RAG)  |        |  (OpenRouter)     |        |  (embeddings)    |
+-------------------+        +----------------------+        +-------------------+
          ^                                                            |
          |                                                            v
+-------------------+                           +-------------------+
| state.service     | <-------------------> | SQLite (rag.db)   |
| (持久化 JSON)    |                       | (BLOB vectors)    |
+-------------------+                     +-------------------+
```

## Основные компоненты

### 1. ModelOrchestrator (`src/core/model-orchestrator.ts`)
- **Центральный оркестратор**, управляющий несколькими провайдерами ИИ.
- Хранит список провайдеров (`Map<string, any>`).
- Поддерживает стратегии:
  - `sequential` — опрос провайдеров по порядку.
  - `parallel` — отправка запросов всем активным провайдерам, возврат первого успешного ответа.
  - `fallback` — при ошибке переход к следующему провайдеру.
- Методы:
  - `registerProvider(provider)` — регистрация провайдера.
  - `getModels(providerName?)` — получение списка моделей с пагинацией (по 5).
  - `setActiveModel(fullModelId)` — сохранение выбранной модели (формат `"providerName:modelId"`).
  - `getActiveModel(providerName?)` — получение активной модели.
  - `hasActiveModel(providerName?)` — проверка наличия активной модели.
  - `chat(userMessage, sessionKey, context?)` — отправка запроса с учётом стратегии.
  - `checkStatus()` — проверка статуса всех провайдеров.
  - `getSystemStats()` — получение статистики (стратегия, провайдеры, проект).
- **SYSTEM_PROMPT**: содержит команды `/read`, `/write`, `/test`, `/lint`, `/install`, `/new`, `/seed`, `/deps` и примеры RAG-функций.

### 2. Провайдеры

#### LMStudioProvider (`src/core/lm-studio.provider.ts`)
- Работа с локальным LM Studio (`LMS_URL` из `.env`).
- API: `/v1/models`, `/v1/chat/completions`.
- Формирует системный промпт с `context` (содержимое файла).
- Имеет вспомогательный метод `unloadCurrentModel()` для выгрузки модели.

#### CloudProvider (`src/core/cloud.provider.ts`)
- Работа с облачным API (OpenRouter, `OPENROUTER_KEY` из `.env`).
- API: `https://openrouter.ai/api/v1/chat/completions`.
- Поддерживает модели с двоеточиями в ID.

### 3. Состояние (`src/modules/state/state.service.ts`)
- **GlobalState:**
  ```typescript
  interface GlobalState {
    activeModelId?: string | null;
    lastMessageId?: number | null;
    pendingMessage?: string | null;
    modelStrategy?: 'sequential' | 'parallel' | 'fallback';
    providers?: Record<string, { activeModelId?: string }>;
    lastSelectedModelId?: string;
  }
  ```
- **SessionState** (ключ — `userId:peerId`):
  ```typescript
  interface SessionState {
    activeFilePath?: string | null;
    stagedContent?: string | null;
    lastAiResponse?: string | null;
    lastMessageId?: number | null;
    fileContext?: string | null;
  }
  ```

### 4. VK Adapter (`src/modules/vk/vk.service.ts`)
- Работа с VK API.
- Использует `ModelOrchestrator` для генерации ответов.
- Команды: `/start`, `ℹ️ Инфо`, `📱 Меню`, `🤖 Провайдеры`, `🤖 Модели`, `📂 Файлы`, `📊 Статус`, `/write`, `✅`, `❌`, `🏓 Пинг`.

### 5. OpenCodeService (`src/modules/project/opencode.service.ts`)

#### Файловые операции
- `readFile(filePath)` — чтение файла.
- `writeFile(filePath, content)` — запись с `.bak` бэкапом.
- `getFilesList()` — список файлов проекта.
- `getProjectTree()` — дерево проекта.

#### Проектные операции
- `executeCommand(command)` — безопасное выполнение команд (whitelist).
- `getProjectMeta()` — scripts, deps, конфиги.
- `mkProject(name)` — создание структуры проекта.
- `mkSeed(project, docs)` — генерация seed-скрипта.

#### RAG / Эмбеддинги (`opencodeEmbedding`)
- `embedText(text)` — эмбеддинг через LM Studio `/v1/embeddings` (модель: `nomic-embed-text-v1.5`). Возвращает `{ vector: number[] }`.
- `vectorToBlob(vec)` — Float32Array → Uint8Array (SQLite BLOB).
- `blobToVector(blob)` — Uint8Array → number[].
- `cosine(vecA, vecB)` — cosine similarity (0..1).
- `getEmbedConfig()` — `{ url, model }`.

#### Экспорт
```typescript
import { opencode, opencodeEmbedding } from './opencode.service.ts';
// opencodeEmbedding — алиас на opencode
```

### 6. RAG-проект (`projects/rag-api/`)

#### Структура
```
projects/rag-api/
├── src/
│   ├── index.ts      # Hono сервер, GET /query?q=
│   ├── db.ts       # SQLite: chunks, docs, embeddings
│   ├── ingest.ts   # embedText + save to DB
│   └── search.ts   # embedText + cosine search
├── scripts/
│   └── seed.ts    # 18 чанков документации
└── data/
    └── rag.db     # SQLite с BLOB векторами
```

#### API
```typescript
// Ingest
const { vector } = await opencodeEmbedding.embedText(text);
const blob = opencodeEmbedding.vectorToBlob(vector);
// INSERT INTO chunks(text), embeddings(blob)

// Search
const { vector: qVec } = await opencodeEmbedding.embedText(query);
const rows = db.query('SELECT text, vector FROM embeddings');
let best = { text: '', score: 0 };
for (const row of rows) {
  const chunkVec = opencodeEmbedding.blobToVector(row.vector);
  const score = opencodeEmbedding.cosine(qVec, chunkVec);
  if (score > best.score) best = { text: row.text, score };
}
```

## Поток данных

1. Пользователь → VK → `vk.service`.
2. При выборе файла → `opencode.readFile` → контент в `session.fileContext`.
3. Запрос → `ModelOrchestrator.chat()` → провайдер → ответ.
4. При RAG-запросе → `opencodeEmbedding.embedText()` → LM Studio → вектор.
5. Вектор → SQLite (BLOB) или cosine search.

## Persisted State (`state.json`)

```json
{
  "global": {
    "modelStrategy": "sequential",
    "providers": {
      "lm-studio": { "activeModelId": "lm-studio:gemma" },
      "cloud-openrouter": { "activeModelId": null }
    },
    "pendingMessage": null
  },
  "sessions": {
    "34240560:2000000004": {
      "activeFilePath": "src/1.txt",
      "fileContext": "import ...",
      "lastAiResponse": "Здравствуйте! ...",
      "stagedContent": null
    }
  }
}
```

*Обновлено: 2026-04-25.*