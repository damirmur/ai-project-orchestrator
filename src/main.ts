import 'dotenv/config';
import { startVkBot, vk } from './modules/vk/vk.service.ts';
import { state } from './modules/state/state.service.ts';

async function bootstrap() {
  await state.init();
  try {
    await startVkBot();
    console.log('🚀 AI Orchestrator полностью запущен');
  } catch (error) {
    console.error('💥 Ошибка при запуске:', error);
    process.exit(1);
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

