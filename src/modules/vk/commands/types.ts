// src/modules/vk/commands/types.ts
import { Context } from 'vk-io';

export interface CommandContext {
  context: any; // Using any for now to match vk-io context, will refine later
  sessionKey: string;
  session: any;
  sendLog: (msg: any) => Promise<void>;
}

export interface BotCommand {
  id: string;
  name: string; // The text or payload command (e.g., '/start' or 'start')
  description: string;
  execute: (ctx: CommandContext, args?: string) => Promise<void>;
}