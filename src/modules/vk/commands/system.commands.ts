// src/modules/vk/commands/system.commands.ts
import { BotCommand, CommandContext } from './types.ts';
import { commandRegistry } from './registry.ts';
import { modelOrchestrator } from '../../core/model-orchestrator.ts';
import { Keyboard } from 'vk-io';

const startCommand: BotCommand = {
  id: 'start',
  name: '/start',
  description: 'Перезапуск бота и показ меню',
  execute: async ({ context, sendLog }) => {
    await context.send({ message: ' ', keyboard: { buttons: [] } }).catch(() => {});
    const keyboard = Keyboard.builder()
      .textButton({ label: 'ℹ️ Инфо', payload: { command: 'info' } })
      .textButton({ label: '📱 Меню', payload: { command: 'menu' } }).row();
    await context.send({ message: '🚀 Бот готов к работе!', keyboard }).catch(() => {});
  }
};

const infoCommand: BotCommand = {
  id: 'info',
  name: 'info',
  description: 'Системная информация',
  execute: async ({ sendLog }) => {
    const stats = await modelOrchestrator.getSystemStats();
    const providerInfo = stats.providers.map(p => `${p.name}: ${p.activeModel || 'не выбрана'} (${p.online ? '🟢' : '🔴'})`).join('\n');
    await sendLog(`🛡 [System Info]\nСтратегия: ${stats.strategy}\n${providerInfo}\n📁 Проект: ${stats.projectRoot}`);
  }
};

const menuCommand: BotCommand = {
  id: 'menu',
  name: 'menu',
  description: 'Инструменты управления',
  execute: async ({ context }) => {
    const keyboard = Keyboard.builder()
      .textButton({ label: '🤖 Модели', payload: { command: 'models' } })
      .textButton({ label: '📂 Файлы', payload: { command: 'list' } }).row()
      .textButton({ label: '📊 Статус', payload: { command: 'status' } })
      .textButton({ label: '🏓 Пинг', payload: { command: 'ping' } }).row()
      .textButton({ label: '🤖 Провайдеры', payload: { command: 'providers' } }).inline();
    await context.send({ message: '🛠 Инструменты управления:', keyboard }).catch(() => {});
  }
};

const statusCommand: BotCommand = {
  id: 'status',
  name: 'status',
  description: 'Статус провайдеров',
  execute: async ({ sendLog }) => {
    const status = await modelOrchestrator.checkStatus();
    const statusText = Object.entries(status).map(([name, online]) => `${name}: ${online ? '🟢 Online' : '🔴 Offline'}`).join('\n');
    await sendLog(`📊 Статус провайдеров:\n${statusText}`);
  }
};

const pingCommand: BotCommand = {
  id: 'ping',
  name: 'ping',
  description: 'Проверка связи',
  execute: async ({ sendLog }) => {
    await sendLog('🏓 Понг! Бот в сети.');
  }
};

commandRegistry.register(startCommand);
commandRegistry.register(infoCommand);
commandRegistry.register(menuCommand);
commandRegistry.register(statusCommand);
commandRegistry.register(pingCommand);
