import { initLogFile, logIncoming, logOutgoing, logCommand, logModelRequest, logModelResponse, logFileOp, logSessionState } from '../src/modules/logger/logger.service.ts';

async function main() {
  await initLogFile();
  await logIncoming('111', '200000002', 'web', 'Привет бот');
  await logCommand('111', '200000002', 'models');
  await logOutgoing('200000002', '🤖 Выберите модель');
  await logModelRequest('111', '200000002', 'Как исправить ошибку?', 'gpt-4-mini');
  await logModelResponse('111', '200000002', 'Вот решение ...');
  await logFileOp('read', 'src/modules/vk/vk.service.ts', true);
  await logSessionState('111', '200000002', { activeFilePath: 'vk.service.ts', stagedContent: null, lastAiResponse: null });
}

main();
