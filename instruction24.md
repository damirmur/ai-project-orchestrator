Ниже представлена полная инструкция по созданию современного проекта на Node.js 24+. Главная особенность этой версии — нативная поддержка TypeScript, что позволяет минимизировать количество внешних зависимостей (прощайте, ts-node и dotenv).
1. Инициализация проекта
Создайте папку и инициализируйте проект:
bash
mkdir my-app && cd my-app
npm init -y
Используйте код с осторожностью.
2. Настройка package.json (Алиасы и ESM)
В Node.js 24+ для алиасов используем стандарт Subpath Imports. Символ # обязателен.
json
{
  "name": "node24-ts-app",
  "type": "module",
  "imports": {
    "#utils/*": "./dist/utils/*",
    "#src/*": "./dist/*"
  },
  "scripts": {
    "dev": "node --watch --env-file=.env --experimental-transform-types src/index.ts",
    "build": "tsc",
    "start": "node --env-file=.env dist/index.js"
  }
}
Используйте код с осторожностью.
Примечание: В imports указываем пути к dist, чтобы алиасы работали и после компиляции в чистый JS.
3. Строгий tsconfig.json (EsNext)
Настраиваем максимальную строгость и современный стандарт модулей.
json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "skipLibCheck": true,
    "paths": {
      "#utils/*": ["./src/utils/*"],
      "#src/*": ["./src/*"]
    }
  }
}
Используйте код с осторожностью.
4. Типизация process.env
Создайте файл src/types/env.d.ts, чтобы TypeScript знал о ваших переменных окружения.
typescript
declare global {
  namespace NodeJS {
    interface ProcessEnv {
      PORT: string;
      NODE_ENV: 'development' | 'production';
    }
  }
}
export {};
Используйте код с осторожностью.
5. Практический пример (src/index.ts)
Здесь объединим работу с путями, встроенными модулями и process.
typescript
// Используем префикс node: для встроенных модулей
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RealTimeUsage } from 'node:os'; // Пример импорта типов
import { logger } from '#utils/logger.js'; // Алиас

// 1. Работа с путями в ESM (замена __dirname)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 2. Использование process
const PORT = process.env.PORT || 3000;
const CWD = process.cwd(); // Текущая рабочая директория

console.log(`--- Node.js 24 Context ---`);
console.log(`Рабочая директория: ${CWD}`);
console.log(`Файл запущен из: ${__dirname}`);
console.log(`Запуск на порту: ${PORT}`);

// 3. Работа с аргументами (process.argv)
const args = process.argv.slice(2);
if (args.includes('--debug')) {
  console.log('Режим отладки включен');
}

// 4. Безопасное завершение
process.on('SIGINT', () => {
  console.log('\nЗавершение процесса...');
  process.exit(0);
});

logger('Приложение успешно запущено!');
Используйте код с осторожностью.
Главные фишки Node.js 24 для этой конфигурации:
Нативный TS: Вы запускаете node src/index.ts. Node.js сам убирает типы "на лету" (Type Stripping).
Без dotenv: Флаг --env-file=.env автоматически загружает переменные в process.env.
Watch Mode: Флаг --watch заменяет nodemon.
node: префиксы: Всегда используйте import ... from 'node:fs', это ускоряет поиск модуля и гарантирует использование встроенного API.
