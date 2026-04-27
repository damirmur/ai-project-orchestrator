**AGENTS MD – Быстрый справочник для ai-project-orchestrator**

*Все пункты написаны на русском, так как это требование проекта.*

- **Установка и запуск**
  - `npm ci` – установить зависимости точно из `package-lock.json`.
  - Скопировать переменные окружения: `cp .env.example .env` и заполнить обязательные: `VK_TOKEN`, `GROUP_ID`, `USER_ID`, `CHAT_PEER_ID`.
  - **Разработка** (автоперезапуск):
    `npm run dev` → `node --watch --env-file=.env --experimental-transform-types src/index.ts`
  - **Продакшн**: `npx tsc && node --env-file=.env dist/index.js` (нет npm‑скрипта, нужно выполнить вручную).

- **Команды бота в VK**
  - `/start` – удалить старую клавиатуру, показать закреплённое меню (ℹ️ Инфо | 📱 Меню).
  - ℹ️ Инфо – показать системную информацию (стратегия, провайдеры, модель).
  - 📱 Меню – показать inline меню: 📁 Структура | 📂 Файлы | 📊 Статус | 🏓 Пинг | 🤖 Провайдеры.
  - 📁 Структура – показать дерево проектов (/tree).
  - 📂 Файлы – получить список файлов проекта (текстовый список).
  - 📊 Статус – проверить доступность провайдеров и моделей.
  - 🤖 Провайдеры – выбрать провайдера и стратегию.
  - 🤖 Модели – выбрать активную модель (пагинация по 5).
  - 🏓 Пинг – проверить, что бот работает.
  - /write – сохранить сгенерированный ИИ код (после подтверждения).
  - ✅ / ❌ – подтвердить или отклонить запись.
  - /tree – показать структуру проектов.
  - /files [path] – список файлов проекта.
  - /read <file> – прочитать файл.
  - /test – npm test.
  - /lint – tsc --noEmit.
  - /install <package> – npm install.
  - /new <name> – создать проект.
  - /seed <project> [title] – создать seed-скрипт.
  - /deps <project> – показать зависимости.
  - /rag create – создать RAG базу для проекта.
  - /rag add <текст> – добавить текст в RAG.
  - /rag search <запрос> – искать в RAG.
- /search <запрос> – веб-поиск актуальной информации (Tavily).
  - Для актуальной информации (курс валют, погода, гороскоп, новости) модель **ОБЯЗАТЕЛЬНО** использует `/web-search <запрос>`.

- **Веб-поиск (/web-search)**
  - Команда `/web-search` работает **только от модели**, не от пользователя.
  - Flow: LM Studio → /web-search → Tavily → LM Studio (очистка) → Пользователь.
  - Fallback: если LM Studio недоступна → Cloud (gemma-4-26b-a4b-it:free).
  - Timeout: LM Studio 60сек, Cloud 30сек, Tavily 15сек.
  - Модель очищает результаты от дубликатов и оформляет ссылки [описание](URL).

- **RAG / Эмбеддинги**
  - RAG — инструмент внутри бота, без веб-сервера. База внутри каждого проекта.
  - Функции доступны через `opencodeEmbedding` (экспорт `opencode`):
    - `opencodeEmbedding.embedText(text)` → `{ vector: number[] }` — эмбеддинг через LM Studio `/v1/embeddings` (`nomic-embed-text-v1.5`).
    - `opencodeEmbedding.vectorToBlob(vec)` → `Uint8Array` — Float32Array → SQLite BLOB.
    - `opencodeEmbedding.blobToVector(blob)` → `number[]` — BLOB → Float32Array.
    - `opencodeEmbedding.cosine(vecA, vecB)` → `number` — cosine similarity (0..1).
    - `opencodeEmbedding.createRagDb(dbPath)` — создать SQLite базу с таблицами `rag_chunks`, `rag_docs`, `rag_embeddings`.
    - `opencodeEmbedding.ingestRagText(dbPath, content, docId?, metadata?)` — индексировать текст, вернуть `chunkId`.
    - `opencodeEmbedding.searchRag(dbPath, query, limit?)` → `{ content, doc_id, score }[]` — поиск по similarity.
  - Каждая RAG-база — отдельный SQLite файл внутри проекта (`data/rag.db`).
  - ИИ создаёт RAG на лету через `createRagDb` + `ingestRagText`.

- **Хранение состояния**
  - При старте `state.service` читает `state.json`; если файл отсутствует – создаёт пустой.
  - Состояние изолировано по паре `USER_ID:CHAT_PEER_ID` и содержит:
    - `activeFilePath`
    - `stagedContent`
    - `lastAiResponse`
    - `pendingMessage`
    - `lastMessageId`
    - `fileContext` (необязательно)
    - `projectPrefix` — текущий проект для работы с файлами
  - Глобальное состояние: `lastSource` — источник последнего сообщения (`'user'` или `'model'`)
  - После **каждого** изменения состояние сохраняется, поэтому после перезапуска бот восстанавливает контекст.

- **Ограничения доступа к файловой системе**
  - Бот **не работает** с каталогами и файлами:
    - `.git`
    - `node_modules`
    - `analiz.md`, `architecture.md`, `todo.md`
    - любые тестовые файлы внутри `projects/`
  - По‑умолчанию доступ только к подкаталогу `./projects`; изменить путь можно переменной `PROJECTS_ROOT`.

- **Типизация**
  - Строгая типизация уже включена (`"strict": true` в `tsconfig.json`).

- **Добавление новых команд**
  - При внедрении новых VK‑команд следует **обновлять** этот `AGENTS.md`, указав точный текст команды и любые изменения состояния, которые она влечёт.

*Эти сведения — единственные специфические нюансы репозитория, без которых агент OpenCode мог бы ошибочно предположить поведение.*