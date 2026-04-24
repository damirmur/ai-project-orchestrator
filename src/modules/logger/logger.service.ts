// src/modules/logger/logger.service.ts
import { promises as fs } from 'fs';
import * as path from 'path';

import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const LOG_PATH = path.resolve(process.cwd(), 'bot.log');

/**
 * Ensure log file exists and is empty at startup.
 */
export async function initLogFile(): Promise<void> {
  await fs.writeFile(LOG_PATH, '', { flag: 'w' });
}

function truncate(str: string, maxLen = 500): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen) + '…[truncated]';
}


/**
 * Append a line to the log file with timestamp.
 */
export async function logLine(entry: string): Promise<void> {
  const line = `${new Date().toISOString()} | ${entry}\n`;
  await fs.appendFile(LOG_PATH, line);
}

/** Helpers for specific log types */
export async function logIncoming(userId: string, peerId: string, device: string, text: string) {
  await logLine(`IN | user=${userId} peer=${peerId} device=${device} text="${truncate(text)}"`);
}

export async function logOutgoing(peerId: string, text: string) {
  await logLine(`OUT | peer=${peerId} text="${truncate(text)}"`);
}

export async function logCommand(userId: string, peerId: string, command: string, payload?: string) {
  const pl = payload ? ` payload="${truncate(payload)}"` : '';
  await logLine(`CMD | user=${userId} peer=${peerId} command="${command}"${pl}`);
}

export async function logModelRequest(userId: string, peerId: string, msg: string, model: string, context?: string) {
  await logLine(`MODEL_REQ | user=${userId} peer=${peerId} model=${model} msg="${truncate(msg)}" ctx="${context ? truncate(context) : ''}"`);
}

export async function logModelResponse(userId: string, peerId: string, response: string) {
  await logLine(`MODEL_RES | user=${userId} peer=${peerId} response="${truncate(response)}"`);
}

export async function logFileOp(op: 'read' | 'write', filePath: string, success: boolean, errorMsg?: string) {
  const status = success ? 'success' : `error:${errorMsg ?? 'unknown'}`;
  await logLine(`FILE_${op.toUpperCase()} | path="${filePath}" result=${status}`);
}

export async function logSessionState(userId: string, peerId: string, state: any) {
  // shallow JSON, truncate large parts
  let txt = JSON.stringify(state);
  txt = truncate(txt, 300);
  await logLine(`SESSION | user=${userId} peer=${peerId} state=${txt}`);
}
