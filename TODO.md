План приведения проекта к рекомендациям Node 24 (native TypeScript, env‑file, watch‑mode, полные алиасы)

1️⃣ Удалить устаревшие зависимости и импорты
Убрать dotenv
Удалить все строки import 'dotenv/config' из кода (src/index.ts, src/main.ts, src/modules/vk/vk.service.ts, ...).
Удалить dotenv из package.json‑dependencies.
Удалить ts-node
Удалить ts-node из package.json‑dependencies.
Убедиться, что нигде в коде нет импортов/использования ts-node.
2️⃣ Добавить и настроить алиасы
2.1 package.json
{
  "type": "module",
  "imports": {
    "#utils/*": "./dist/utils/*",
    "#modules/*": "./dist/modules/*",
    "#src/*": "./dist/*"
  },
  ...
}
2.2 tsconfig.json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "baseUrl": ".",
    "paths": {
      "#utils/*": ["src/utils/*"],
      "#modules/*": ["src/modules/*"],
      "#src/*": ["src/*"]
    }
  },
  "include": ["src/**/*.ts", "scripts/**/*.ts"]
}
2.3 Применить алиасы во всех файлах
Заменить каждое относительное import … from '../modules/... на import … from '#modules/...
Заменить import … from '../utils/... на import … from '#utils/...
При необходимости использовать #src/... для файлов, которые находятся в корне src (например, src/index.ts).
3️⃣ Упорядочить точку входа
Оставить единственную точку входа – src/index.ts.
Удалить/отключить src/main.ts (можно оставить как пример, но исключить его из сборки).
В src/index.ts убрать import 'dotenv/config' (переменные уже подхватываются через --env-file).
4️⃣ Корректировать пути к файлам‑логам и состоянию
4.1 bot.log
В src/modules/logger/logger.service.ts изменить путь к журналу:
const LOG_PATH = new URL('../bot.log', import.meta.url).pathname;
// или
const LOG_PATH = path.resolve(process.cwd(), 'bot.log');
Убедиться, что initLogFile() очищает файл и вызывается в начале bootstrap() (в src/index.ts).
4.2 state.json
В src/modules/state/state.service.ts оставить stateFile = path.resolve('state.json') (корень проекта).
Убрать лишний fs.mkdir в save() – файл пишется в уже существующую директорию.
5️⃣ Переписать тестовые скрипты под алиасы
scripts/test-state.ts → import { state } from '#modules/state/state.service.ts';
scripts/test-log.ts → import { initLogFile, logIncoming, … } from '#utils/logger.ts';
Убедиться, что скрипты запускаются через node --env-file=.env --experimental-transform-types scripts/*.ts.
6️⃣ Обновить package.json‑скрипты
{
  "scripts": {
    "dev": "node --watch --env-file=.env --experimental-transform-types src/index.ts",
    "build": "tsc",
    "start": "node --env-file=.env dist/index.js"
  }
}
7️⃣ Обновить документацию (README)
Описать, что проект использует Node 24 + native TypeScript.
Привести пример запуска (npm run dev, npm run build && npm start).
Указать, что .env автоматически подхватывается, dotenv больше не нужен.
Добавить список алиасов (#utils/*, #modules/*, #src/*).