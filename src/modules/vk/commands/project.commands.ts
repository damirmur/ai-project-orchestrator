// src/modules/vk/commands/project.commands.ts
import { BotCommand, CommandContext } from './types.ts';
import { commandRegistry } from './registry.ts';
import { opencode } from '../project/opencode.service.ts';
import { state } from '../state/state.service.ts';
import { Keyboard } from 'vk-io';

const treeCommand: BotCommand = {
  id: 'tree',
  name: '/tree',
  description: 'Структура проектов',
  execute: async ({ sendLog }) => {
    const tree = opencode.getProjectTree();
    await sendLog(`📁\n\`\`\`\n${tree}\n\`\`\``);
  }
};

const listCommand: BotCommand = {
  id: 'list',
  name: 'list',
  description: 'Список файлов проекта',
  execute: async ({ sendLog }) => {
    const files = await opencode.getFilesList();
    if (files.length === 0) {
      await sendLog('📂 Файлы не найдены.');
      return;
    }
    const list = files.slice(0, 20).map((file, i) => `${i + 1}. ${file}`).join('\n');
    await sendLog(`📂 Файлы проекта (введите номер или путь):\n${list}`);
  }
};

const readCommand: BotCommand = {
  id: 'read',
  name: '/read',
  description: 'Чтение файла',
  execute: async ({ context, sessionKey, session, sendLog }, args) => {
    if (!args) {
      await sendLog('❌ Ошибка: укажите путь к файлу. Пример: /read src/index.ts');
      return;
    }
    const fileName = args.trim();
    const content = await opencode.readFile(fileName);
    if (content) {
      await state.updateSession(sessionKey, s => { s.activeFilePath = fileName; s.fileContext = content; });
      await sendLog(`📄 Код "${fileName}" загружен в ИИ.`);
    } else {
      await sendLog(`❌ Ошибка чтения "${fileName}".`);
    }
  }
};

const writeCommand: BotCommand = {
  id: 'write',
  name: '/write',
  description: 'Запись сгенерированного кода',
  execute: async ({ context, sessionKey, session, sendLog }, args) => {
    let fileName = args?.trim() || session.activeFilePath;
    if (!fileName) {
      await sendLog('❌ Активный файл не выбран.');
      return;
    }
    if (!session.lastAiResponse) {
      await sendLog('❌ ИИ еще не предложил код.');
      return;
    }
    const cleanCode = session.lastAiResponse?.replace(/```[\s\S]*?\n/g, '').replace(/```/g, '').trim();
    await state.updateSession(sessionKey, s => { s.activeFilePath = fileName; });
    await state.updateSession(sessionKey, s => { s.stagedContent = cleanCode; });
    
    const keyboard = Keyboard.builder()
      .textButton({ label: '✅ Принять', payload: { command: 'confirm_write' }, color: 'positive' })
      .textButton({ label: '❌ Отклонить', payload: { command: 'cancel_write' }, color: 'negative' })
      .inline();
    await context.send({ message: `📝 Записать изменения в "${fileName}"?`, keyboard }).catch(() => {});
  }
};

commandRegistry.register(treeCommand);
commandRegistry.register(listCommand);
commandRegistry.register(readCommand);
commandRegistry.register(writeCommand);
