// src/modules/vk/commands/dev.commands.ts
import { BotCommand, CommandContext } from './types.ts';
import { commandRegistry } from './registry.ts';
import { opencode } from '../project/opencode.service.ts';

const testCommand: BotCommand = {
  id: 'test',
  name: '/test',
  description: 'Запуск тестов',
  execute: async ({ sendLog }) => {
    const result = await opencode.executeCommand('npm test');
    const out = result.stdout + (result.stderr ? '\\n' + result.stderr : '');
    await sendLog(result.success ? `✅ Тесты.\\n\`\`\`\\n${out.slice(-3000)}\\n\`\`\`` : `❌ Ошибка.\\n\`\`\`\\n${out.slice(-3000)}\\n\`\`\``);
  }
};

const lintCommand: BotCommand = {
  id: 'lint',
  name: '/lint',
  description: 'Проверка типов',
  execute: async ({ sendLog }) => {
    const result = await opencode.executeCommand('npm run typecheck');
    const out = result.stdout + (result.stderr ? '\\n' + result.stderr : '');
    await sendLog(result.success ? `✅ OK.\\n\`\`\`\\n${out.slice(-3000)}\\n\`\`\`` : `⚠️.\\n\`\`\`\\n${out.slice(-3000)}\\n\`\`\``);
  }
};

const installCommand: BotCommand = {
  id: 'install',
  name: '/install',
  description: 'Установка пакета',
  execute: async ({ sendLog }, args) => {
    if (!args) {
      await sendLog('❌ Ошибка: укажите имя пакета.');
      return;
    }
    const result = await opencode.executeCommand(`npm install ${args}`);
    await sendLog(`📦 Результат установки ${args}:\\n\`\`\`\\n${result.stdout.slice(-3000)}\\n\`\`\``);
  }
};

const newProjectCommand: BotCommand = {
  id: 'new',
  name: '/new',
  description: 'Создание проекта',
  execute: async ({ sendLog }, args) => {
    if (!args) {
      await sendLog('❌ Ошибка: укажите название проекта.');
      return;
    }
    const result = await opencode.mkProject(args);
    if (result.success) {
      await sendLog(`✅ Проект "${args}" создан в ${result.path}`);
    } else {
      await sendLog(`❌ Ошибка: ${result.error}`);
    }
  }
};

const seedCommand: BotCommand = {
  id: 'seed',
  name: '/seed',
  description: 'Создание seed-скрипта',
  execute: async ({ sendLog }, args) => {
    const parts = args?.split(' ') || [];
    const project = parts[0];
    const title = parts.slice(1).join(' ');
    if (!project) {
      await sendLog('❌ Ошибка: укажите название проекта.');
      return;
    }
    const result = await opencode.mkSeed(project, []); // simplified for now
    if (result.success) {
      await sendLog(`✅ Seed-скрипт для ${project} создан.`);
    } else {
      await sendLog(`❌ Ошибка: ${result.error}`);
    }
  }
};

const depsCommand: BotCommand = {
  id: 'deps',
  name: '/deps',
  description: 'Зависимости проекта',
  execute: async ({ sendLog }, args) => {
    if (!args) {
      await sendLog('❌ Ошибка: укажите название проекта.');
      return;
    }
    const meta = await opencode.getProjectMeta(); // Simplified, should probably take project name
    if (!meta) {
      await sendLog('❌ Не удалось получить метаданные проекта.');
      return;
    }
    await sendLog(`📦 Зависимости проекта ${args}:\\n${meta.deps.join(', ')}`);
  }
};

commandRegistry.register(testCommand);
commandRegistry.register(lintCommand);
commandRegistry.register(installCommand);
commandRegistry.register(newProjectCommand);
commandRegistry.register(seedCommand);
commandRegistry.register(depsCommand);
