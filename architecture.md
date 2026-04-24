# Architecture Overview

```
+-------------------+        +----------------------+        +-------------------+
|   VK Bot (vk.io) | <----> |  lms.service (LM‑Studio) | <----> |  opencode.service |
+-------------------+        +----------------------+        +-------------------+
          ^                              ^                         ^
          |                              |                         |
          |   state.service (persisted JSON)                     |
          +-----------------------------------------------------+
```

- **vk.service.ts** – получает сообщения из VK, управляет меню, выбирает модель, читает/пишет файлы, отправляет запросы в LM‑Studio.
- **lms.service.ts** – thin HTTP wrapper над локальным LM‑Studio (`/v1/models`, `/v1/chat/completions`). Формирует системный промпт, учитывая текущий `fileContext`.
- **opencode.service.ts** – безопасный доступ к файлам внутри `PROJECTS_ROOT`; создает бэкапы, выдаёт список файлов.
- **state.service.ts** – единственный источник правды о состоянии бота; хранит глобальные данные и отдельные сессии (`userId:peerId`). Состояние сериализуется в `state.json` после каждой модификации.
- **main.ts** – инициализирует `state`, стартует обновления VK и обрабатывает корректное завершение (`SIGTERM`).

**Поток данных**
1. Пользователь → VK → `vk.service`.
2. При выборе файла → `opencode.readFile` → контент передаётся в `lms.service.setFileContext`.
3. Пользовательские запросы → `lms.service.chat` → ответ сохраняется в `state.session.lastAiResponse`.
4. `/write` → очистка markdown → `state.session.stagedContent`.
5. Подтверждение (`✅`) → `opencode.writeFile` → файл обновлён, `state.session` очищается.

**Persisted State** (`state.json`)
```json
{
  "global": { "activeModelId": null },
  "sessions": {
    "12345:67890": {
      "activeFilePath": "src/modules/vk/vk.service.ts",
      "stagedContent": "...",
      "lastAiResponse": "...",
      "pendingMessage": null,
      "lastMessageId": 42
    }
  }
}
```