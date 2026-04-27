// src/modules/vk/commands/model.commands.ts
import { BotCommand, CommandContext } from './types.ts';
import { commandRegistry } from './registry.ts';
import { modelOrchestrator } from '../../core/model-orchestrator.ts';
import { sendModelsPicker, sendProvidersPicker } from '../vk.service.ts'; // Note: We'll need to export these from vk.service

const modelsCommand: BotCommand = {
  id: 'models',
  name: 'models',
  description: 'Выбор модели ИИ',
  execute: async ({ context }) => {
    await sendModelsPicker(context);
  }
};

const providersCommand: BotCommand = {
  id: 'providers',
  name: 'providers',
  description: 'Выбор провайдера и стратегии',
  execute: async ({ context }) => {
    await sendProvidersPicker(context);
  }
};

commandRegistry.register(modelsCommand);
commandRegistry.register(providersCommand);
