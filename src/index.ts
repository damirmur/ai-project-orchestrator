// src/index.ts
import { state } from './modules/state/state.service.ts';
import { startVkBot, vk } from './modules/vk/vk.service.ts';
import { initLogFile, logLine } from './utils/logger.ts';
import { tryStartLMStudio } from './utils/lmstudio-autostart.ts';
async function bootstrap() {
  await state.init();
  await initLogFile();
  const lmResult = await tryStartLMStudio();
  await logLine(`LMStudio: ${lmResult.message}`);
  if (!lmResult.success) {
    console.warn(`⚠️ LM Studio: ${lmResult.message}`);
  }
  try {
    if (process.env.VK_TOKEN && process.env.GROUP_ID) {
      await startVkBot();
    } else {
      console.warn('⚠️ VK токен или GROUP_ID не заданы – бот не запускается, но лог работает.');
    }
    console.log('🚀 AI Orchestrator полностью запущен');
  } catch (error) {
    console.error('⚠️ Ошибка при запуске VK‑бота (пропускаем):', error);
    await import('./utils/logger.ts').then(m => m.logLine(`ERROR | VK | ${error?.code ?? 'unknown'} ${error?.message ?? ''}`));
  }
}

bootstrap();

process.on('SIGTERM', async () => {
  console.log('⚡️ Получен SIGTERM – останавливаем бот');
  try {
    await vk.updates.stop();
  } catch (_) {}
  process.exit(0);
});
