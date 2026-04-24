✅ Этап I. Абстракция AI-провайдеров и поддержка облачных моделей (выполнено)

Цель: Разделить работу с LM Studio и облачными API (OpenRouter и др.), дать возможность использовать несколько моделей последовательно или параллельно.

### Итоги Этапа I (выполнено)
- Создан `src/core/model-orchestrator.ts` — оркестратор, управляющий провайдерами и стратегиями (`sequential`, `parallel`, `fallback`).
- Реализованы провайдеры: `src/core/lm-studio.provider.ts` (LM Studio), `src/core/cloud.provider.ts` (OpenRouter).
- `src/core/model-provider.interface.ts` удалён (не нужен в рантайме Node.js 24).
- Обновлён `src/modules/state/state.service.ts`: добавлены поля `providers` (активные модели для каждого провайдера) и `modelStrategy`.
- Переработан `src/modules/vk/vk.service.ts`: удалены ссылки на старый `lms.service.ts`, используется `modelOrchestrator`.
- Добавлены команды бота: `🤖 Провайдеры`, `select_provider`, `set_strategy`.
- `state.json` теперь хранит выбранные модели в разрезе провайдеров.
- Бот успешно запускается (`npm run dev`).

### 1.1 Создание интерфейса ModelProvider
(Интерфейс удалён, реализация через `any` в рантайме)

### 1.2 Реализация конкретных провайдеров
LMStudioProvider (перенос логики из lms.service.ts)
Использует LMS_URL из .env.
Метод chat формирует системный промпт с context.
CloudProvider (например, OpenRouter)
Использует OPENROUTER_KEY из .env. 
API endpoint: https://openrouter.ai/api/v1/chat/completions. 
Поддержка выбора модели из списка (например, google/palm-2-chat-bison, meta/llama-3-70b-instruct). 

### 1.3 Настройка стратегии использования моделей (в state.global)
interface GlobalState {
  activeModelId?: string | null;
  pendingMessage?: string | null;
  modelStrategy?: 'sequential' | 'parallel' | 'fallback'; 
  providers?: Record<string, { activeModelId?: string }>; 
}
Команда бота 🤖 Провайдеры → меню выбора стратегии и конкретного провайдера.

### 1.4 Изменение lms.service.ts → создание ModelOrchestrator
Создать src/core/model-orchestrator.ts, который:
Хранит список провайдеров. 
Метод chat(userMessage, sessionKey):
Если modelStrategy === 'parallel': отправляет запросы во все активные провайдеры (через Promise.all или Promise.race), возвращает первый успешный ответ. 
Если sequential или fallback: сначала локальную модель, при ошибке/таймауте — облачную. 
Для обратной совместимости сделать экспорт lmsService как инстанса ModelOrchestrator с одним провайдером LMStudioProvider. 

### 1.5 Обновление команд бота (vk.service.ts)
Добавить обработку:
cmdPayload === 'select_provider' — выбор провайдера (LM Studio / OpenRouter). 
cmdPayload === 'set_strategy' — выбор стратегии. 
В sendModelsPicker учитывать выбранного провайдера. 

---

## Этап II. Абстрагирование общения с ботом (Messenger Adapters)
Цель: Вынести платформо-зависимую логику (VK) в адаптеры, подготовить базу для Telegram, Google Chat и др.

### 2.1 Интерфейс MessengerAdapter
// src/core/messenger-adapter.interface.ts
export interface IncomingMessage {
  text: string;
  senderId: string;
  peerId: string;
  messageId?: number;
  payload?: any;
}
export interface MessengerAdapter {
  readonly name: string; 
  start(): Promise<void>;
  stop(): Promise<void>;
  sendMessage(peerId: string, text: string, keyboard?: any): Promise<void>;
  setTyping(peerId: string): Promise<void>;
  onMessage(handler: (msg: IncomingMessage) => void | Promise<void>): void;
}

### 2.2 Выделение бизнес-логики в ConversationHandler
Создать src/core/conversation-handler.ts:
Принимает IncomingMessage, использует ModelOrchestrator и OpenCodeService. 
Содержит всю логику обработки команд (/read, /write, выбор модели, работа с состоянием сессии). 
Возвращает ответ (или действие) для адаптера. 
Постепенно перенести код из vk.service.ts в ConversationHandler, оставляя в адаптере только взаимодействие с API VK.

### 2.3 Рефакторинг vk.service.ts → VKAdapter
Оставить в нём:
Создание экземпляра VK. 
Подписку на message_new. 
Преобразование события VK в IncomingMessage. 
Вызов conversationHandler.handle(msg). 
Отправку ответа через context.send или adapter.sendMessage. 
Удалить из него прямые вызовы lmsService, opencode, state (заменить на вызовы conversationHandler).

### 2.4 Подготовка к новым адаптерам
Создать каркасы TelegramAdapter, GoogleChatAdapter (пока заглушки). 
В src/index.ts предусмотреть инициализацию нужных адаптеров (конфигурируется через .env или аргументы). 

---

## Этап III. Расширение команд opencode и обучение моделей
Цель: Дать модели (ИИ) возможность не только редактировать файлы, но и выполнять команды проекта (тесты, линтеры, установка зависимостей).

### 3.1 Расширение OpenCodeService (opencode.service.ts)
Добавить методы:
async executeCommand(command: string, cwd?: string): Promise<{ stdout: string, stderr: string, success: boolean }>
Выполняет shell-команды (например, npm test, npx tsc --noEmit) внутри PROJECTS_ROOT. 
Важно: ограничить список разрешённых команд (whitelist) для безопасности. 
getProjectMeta(): Promise<ProjectMeta> — возвращает:
Список файлов и папок (уже есть getProjectTree). 
Содержимое package.json (зависимости, скрипты). 
Наличие конфигов (tsconfig.json, .eslintrc, и т.д.). 
Добавить методы резервного копирования (уже есть .bak), но расширить (git commit при желании).

### 3.2 Обновление системного промпта и обучение модели
В ModelOrchestrator (или lms.service.ts) расширить systemContent:
Ты — эксперт-программист. У тебя есть доступ к проекту через команды:
- /read <file> — прочитать файл. 
- /write — записать изменения. 
- /test [file] — запустить тесты. 
- /lint — проверить код линтером. 
- /install <pkg> — установить зависимость. 
...
Если пользователь просит что-то сделать, ты можешь предложить код и, при необходимости, команды для выполнения. 

При получении запроса от пользователя, если модель возвращает не только код, но и команды, бот (через ConversationHandler) должен:
1. Применить код (как сейчас чрез /write). 
2. Спросить подтверждение на выполнение команды (или выполнить автоматически, если безопасно). 
3. Выполнить команду чрез opencode.executeCommand. 

### 3.3 Новые команды бота и их обработка
/test [file] — запуск тестов для файла или всего проекта. 
Если тесты упали, отправить ошибки модели для исправления. 
/lint — запуск линтера, сообщить о найденных проблемах. 
/install <package> — добавление зависимости в package.json и запуск npm install. 
Добавить соответствующие кнопки в меню бота (или автоматическое определение намерения модели). 

---

## Этап IV. Улучшение состояния и сессий
Цель: Привести хранение состояния в соответствие с новой архитектурой.

### 4.1 Обновление StateService
Добавить методы для работы с несколькими провайдерами (как указано в Этапе I). 
В SessionState добавить:
activeProvider?: string. 
lastCommand?: string (для восстановления после перезапуска). 
Продумать механизм очистки старых сессий (например, по таймауту). 

### 4.2 Изменение src/index.ts
Инициализация ModelOrchestrator с провайдерами. 
Инициализация ConversationHandler. 
Запуск выбранных MessengerAdapter (VK, Telegram и др.). 

---

## Этап V. Документация и тестирование
### 5.1 Обновление AGENTS.md и README.md
Описать новую архитектуру (провайдеры, адаптеры, оркестратор). 
Привести примеры команд и выбора стратегий. 
Указать, как добавить новый мессенджер или провайдер. 

### 5.2 Тестирование (если будут добавлены юнит-тесты)
Тесты для ModelOrchestrator (мок Providers). 
Тесты для ConversationHandler (изолированная логика). 
Тесты для OpenCodeService (выполнение команд в безопасной среде). 

---

## Краткая сводная таблица приоритетов
| Этап | Задачи | Ожидаемый результат | Примерное время |
|-------|---------|-------------------|-------------------|
| I | Абстракция AI-провайдеров | Возможность работы с облачными моделями, выбор стратегии | 2‑3 дня |
| II | Абстракция мессенджеров | Легкое добавление Telegram/Google Chat | 3‑4 дня |
| III | Расширение opencode | Модель может инициировать тесты, линтинг, установку пакетов | 2‑3 дня |
| IV | Состояние и сессии | Настройка под новую архитектуру | 1‑2 дня |
| V | Документация | Актуальные инструкции для разработчиков | 1 день |

---

## Рекомендация порядка выполнения:
I → III → II → IV → V (сначала расширить возможности ИИ, затем абстрагировать ввод-вывод, оставляя состояние на финальном этапе). 
