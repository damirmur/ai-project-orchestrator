// src/modules/vk/commands/registry.ts
import { BotCommand } from './types.ts';

class CommandRegistry {
  private commands: Map<string, BotCommand> = new Map();

  register(command: BotCommand) {
    this.commands.set(command.name, command);
  }

  getCommand(name: string): BotCommand | undefined {
    return this.commands.get(name);
  }

  getAllCommands(): BotCommand[] {
    return Array.from(this.commands.values());
  }

  // Find command by text (e.g., for /start) or payload
  findCommand(text: string): BotCommand | undefined {
    if (this.commands.has(text)) return this.commands.get(text);
    
    // Handle cases where text might start with /
    const normalized = text.startsWith('/') ? text : `/${text}`;
    if (this.commands.has(normalized)) return this.commands.get(normalized);
    
    return undefined;
  }
}

export const commandRegistry = new CommandRegistry();