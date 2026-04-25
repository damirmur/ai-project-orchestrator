import { spawn } from 'node:child_process';
import { logLine } from '../modules/logger/logger.service.ts';

const LMS_URL = process.env.LMS_URL || 'http://localhost:1234';

async function checkLMStudioStatus(): Promise<boolean> {
  try {
    const res = await fetch(`${LMS_URL}/v1/models`, { method: 'GET' });
    return res.ok;
  } catch {
    return false;
  }
}

export async function tryStartLMStudio(): Promise<{ success: boolean; message: string }> {
  const isOnline = await checkLMStudioStatus();
  if (isOnline) {
    return { success: true, message: 'already running' };
  }

  await logLine('LMStudio autostart: attempting to start...');

  try {
    const proc = spawn('cmd', ['/c', 'lms', 'server', 'start', '--cors'], {
      detached: true,
      stdio: 'ignore',
      shell: false
    });
    proc.unref();
  } catch (e) {
    const msg = 'failed to start - lms command not found';
    await logLine(`LMStudio autostart: ${msg}`);
    return { success: false, message: msg };
  }

  for (let i = 0; i < 5; i++) {
    await new Promise(r => setTimeout(r, 1000));
    const status = await checkLMStudioStatus();
    if (status) {
      const msg = 'started successfully';
      await logLine(`LMStudio autostart: ${msg}`);
      return { success: true, message: msg };
    }
  }

  const msg = 'failed to start - timeout';
  await logLine(`LMStudio autostart: ${msg}`);
  return { success: false, message: msg };
}