# Architecture Overview (обновлено)

```
+-------------------+        +----------------------+        +-------------------+
|   VK Bot (vk.io) | <----> |  ModelOrchestrator  | <----> | LMStudioProvider |
|                   |        |  (src/core/model-orchestrator.ts) |        | (src/core/lm-studio.provider.ts) |
+-------------------+        +----------------------+        +-------------------+
          |                              |                       
          v                              v                       
|   ConversationHandler (planned)    |        | CloudProvider      |
|   (src/core/conversation-handler.ts) |        | (src/core/cloud.provider.ts) |
+-------------------+        +----------------------+        +-------------------+
          |
          v
|   opencode.service.ts |
+-------------------+

          ^
          |
+-------------------+
|   state.service (persisted JSON) |
|   (src/modules/state/state.service.ts) |
+-------------------+
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
- **Выбор модели:** Используется `lastSelectedModelId` — последняя выбранная пользователем модель. Приоритет: lastSelectedModelId → активная модель провайдера. Если нет — ошибка.
- **Сохранение состояния:** Активные модели хранятся в `state.global.providers` (объект, ключ — имя провайдера, значение — `{ activeModelId }`). Стратегия — в `state.global.modelStrategy`. `lastSelectedModelId` — в глобальном состоянии.

### 2. Провайдеры
#### LMStudioProvider (`src/core/lm-studio.provider.ts`)
- Работа с локальным LM Studio (`LMS_URL` из `.env`).
- API: `/v1/models`, `/v1/chat/completions`.
- Формирует системный промпт с `context` (содержимое файла).
- Имеет вспомогательный метод `unloadCurrentModel()` для выгрузки модели.

#### CloudProvider (`src/core/cloud.provider.ts`)
- Работа с облачным API (например, OpenRouter, `OPENROUTER_KEY` из `.env`).
- API: `https://openrouter.ai/api/v1/chat/completions`.
- Поддерживает модели с двоеточиями в ID (например, `google/palm-2-chat-bison`).

### 3. Состояние (`src/modules/state/state.service.ts`)
- Единственный источник правды о состоянии бота.
- **GlobalState:**
  ```typescript
  interface GlobalState {
    activeModelId?: string | null; // для обратной совместимости
    lastMessageId?: number | null;
    pendingMessage?: string | null;
    modelStrategy?: 'sequential' | 'parallel' | 'fallback';
    providers?: Record<string, { activeModelId?: string }>; // провайдер -> его активная модель
  }
  ```
- **SessionState** (ключ — `userId:peerId`):
  ```typescript
  interface SessionState {
    activeFilePath?: string | null;
    stagedContent?: string | null;
    lastAiResponse?: string | null;
    lastMessageId?: number | null;
    fileContext?: string | null; // контекст текущего файла
  }
  ```
- Состояние сериализуется в `state.json` после каждого изменения.

### 4. VK Adapter (`src/modules/vk/vk.service.ts`)
- Работа с VK API (VK, Keyboard).
- Использует `ModelOrchestrator` для выбора моделей и генерации ответов.
- Команды бота:
  - `/start` — показать закреплённую клавиатуру (ℹ️ Инфо | 📱 Меню).
  - `ℹ️ Инфо` — вывод системной информации (стратегия, провайдеры, проект).
  - 📱 Меню — inline меню с провайдерами и инструментами.
  - `🤖 Провайдеры` — выбор провайдера и стратегии (`sequential`, `parallel`, `fallback`).
  - `🤖 Модели` — выбор модели с пагинацией (по 5).
  - `📂 Файлы` — список файлов проекта.
  - `📊 Статус` — проверка доступности провайдеров и моделей.
  - `/write` — запись сгенерированного кода.
  - ✅ / ❌ — подтверждение или отклонение записи.
  - 🏓 Пинг — проверка работы бота.
- Использует `opencode.service` для работы с файлами.
- Использует `state` для управления сессиями.

### 5. OpenCodeService (`src/modules/project/opencode.service.ts`)
- Безопасный доступ к файлам внутри `PROJECTS_ROOT`.
- Методы:
  - `readFile(filePath)` — чтение файла.
  - `writeFile(filePath, content)` — запись, создание бэкапа (`.bak`).
  - `getFilesList()` — получение списка файлов.
  - `getProjectTree()` — получение дерева проекта.
- (Планируется) `executeCommand(command)` — выполнение shell-команд (тесты, линтеры, установка зависимостей).

## Поток данных

1. Пользователь → VK → `vk.service`.
2. При выборе файла → `opencode.readFile` → контент сохраняется в `session.fileContext`.
3. Пользовательские запросы → `ModelOrchestrator.chat(userMessage, sessionKey, fileContext)` → 
   - Определяется активная модель (с учётом стратегии).
   - Запрос отправляется провайдеру (LM Studio или Cloud).
   - Ответ сохраняется в `session.lastAiResponse`.
4. `/write` → очистка markdown → `session.stagedContent`.
5. Подтверждение (`✅`) → `opencode.writeFile` → файл обновлён, `session` очищается.

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

*Обновлено: 2026‑04‑25.*
