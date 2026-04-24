// src/modules/state/state.service.ts
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { logLine } from '../logger/logger.service.ts';

interface SessionState {
  activeFilePath?: string | null;
  stagedContent?: string | null;
  lastAiResponse?: string | null;
  pendingMessage?: string | null;
  lastMessageId?: number | null;
  fileContext?: string | null;
}

interface GlobalState {
  activeModelId?: string | null;
  lastMessageId?: number | null;
}

interface BotState {
  global: GlobalState;
  sessions: Record<string, SessionState>;
}

class StateService {
  private stateFile = path.resolve('state.json');
  private state: BotState = { global: {}, sessions: {} };

  async init(): Promise<void> {
    try {
      const data = await fs.readFile(this.stateFile, 'utf-8');
      this.state = JSON.parse(data) as BotState;
    } catch (e) {
      // Если файла нет – начинаем с пустого состояния
      this.state = { global: {}, sessions: {} };
await this.save();
      await logLine('STATE | init completed');
    }
  }

  private async save(): Promise<void> {
    const dir = path.dirname(this.stateFile);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(this.stateFile, JSON.stringify(this.state, null, 2), 'utf-8');
      await logLine('STATE | saved');
  }

  getSession(key: string): SessionState {
    if (!this.state.sessions[key]) {
      this.state.sessions[key] = {};
    }
    return this.state.sessions[key];
  }

  async updateSession(key: string, updater: (s: SessionState) => void): Promise<void> {
    const sess = this.getSession(key);
    updater(sess);
    await this.save();
    await logLine(`STATE | session ${key} updated`);
  }

  async clearSession(key: string): Promise<void> {
    delete this.state.sessions[key];
    await this.save();
  }

  // Global helpers
  getGlobal<T>(prop: keyof GlobalState): T | undefined {
    return this.state.global[prop] as T | undefined;
  }

  async setGlobal(prop: keyof GlobalState, value: any): Promise<void> {
    this.state.global[prop] = value;
    await this.save();
  }
}

export const state = new StateService();
