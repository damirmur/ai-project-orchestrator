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

export async function getCurrentModel(): Promise<string | null> {
  try {
    const res = await fetch(`${LMS_URL}/v1/models`, { method: 'GET' });
    if (!res.ok) return null;
    const data = await res.json();
    return data.data?.[0]?.id || null;
  } catch {
    return null;
  }
}

export async function unloadModel(): Promise<boolean> {
  try {
    await logLine('LMStudio: unloading model...');
    await fetch(`${LMS_URL}/v1/plugins/model-loader/unload`, { method: 'POST' });
    await new Promise(r => setTimeout(r, 2000));
    await logLine('LMStudio: model unloaded');
    return true;
  } catch (e) {
    await logLine(`LMStudio: unload failed ${(e as any).message}`);
    return false;
  }
}

export async function loadModel(modelId: string): Promise<{ success: boolean; message: string }> {
  const current = await getCurrentModel();
  if (current === modelId) {
    return { success: true, message: `already loaded: ${modelId}` };
  }

  await logLine(`LMStudio: loading ${modelId}...`);
  try {
    await fetch(`${LMS_URL}/v1/plugins/model-loader/load`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: modelId })
    });

    for (let i = 0; i < 120; i++) {
      await new Promise(r => setTimeout(r, 1000));
      const nowLoaded = await getCurrentModel();
      if (nowLoaded === modelId) {
        await logLine(`LMStudio: ${modelId} loaded successfully`);
        return { success: true, message: `loaded: ${modelId}` };
      }
    }

    await logLine(`LMStudio: load timeout for ${modelId}`);
    return { success: false, message: 'timeout' };
  } catch (e) {
    const msg = `load failed: ${(e as any).message}`;
    await logLine(`LMStudio: ${msg}`);
    return { success: false, message: msg };
  }
}

export async function switchModel(newModelId: string): Promise<{ success: boolean; message: string }> {
  await logLine(`🔄 MODEL_SWITCH | to=${newModelId}`);
  const unload = await unloadModel();
  if (!unload) {
    await logLine(`🔄 MODEL_SWITCH | unload failed`);
  }
  const load = await loadModel(newModelId);
  return load;
}