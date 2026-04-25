// src/modules/vk/vk.service.ts
import { VK, Keyboard } from 'vk-io';

import { modelOrchestrator } from '../../core/model-orchestrator.ts';
import { findModelCommand } from '../../core/model-commands.ts';
import { state } from '../state/state.service.ts';
import { logIncoming, logOutgoing, logCommand, logModelRequest, logModelResponse, logSessionState, logVkError, logLine } from '../logger/logger.service.ts';
import { opencode } from '../project/opencode.service.ts';
import { tryStartLMStudio } from '../../utils/lmstudio-autostart.ts';

export const vk = new VK({
  token: process.env.VK_TOKEN!,
  pollingGroupId: Number(process.env.GROUP_ID),
  apiVersion: '5.199'
});


const PAGE_SIZE = 5;

async function sendModelsPickerByProvider(context: any, providerName: string, page: number = 0) {
  const models = await modelOrchestrator.getModels(providerName);
  const totalPages = Math.ceil(models.length / PAGE_SIZE);
  const start = page * PAGE_SIZE;
  const pageModels = models.slice(start, start + PAGE_SIZE);

  const keyboard = Keyboard.builder();
  pageModels.forEach(m => {
    const modelName = (m.name || m.id.split(':').pop() || m.id).slice(0, 35);
    keyboard.textButton({
      label: modelName,
      payload: { command: 'select_model', modelId: m.id },
      color: 'primary'
    }).row();
  });

  // Кнопки навигации
  const navButtons: any[] = [];
  if (page > 0) {
    navButtons.push({ label: 'Назад', payload: { command: 'models_page', provider: providerName, page: page - 1 }, color: 'secondary' });
  }
  if (page < totalPages - 1) {
    navButtons.push({ label: 'Вперёд', payload: { command: 'models_page', provider: providerName, page: page + 1 }, color: 'secondary' });
  }
  if (navButtons.length > 0) {
    navButtons.forEach(btn => keyboard.textButton(btn));
    keyboard.row();
  }

  const msg = `🤖 Модели ${providerName} (стр. ${page + 1}/${totalPages}):`;
  return context.send({ message: msg, keyboard: keyboard.inline() }).catch(err => logVkError(String(context.peerId), err));
}

async function sendModelsPicker(context: any) {
  const models = await modelOrchestrator.getModels();
  const keyboard = Keyboard.builder();
  models.slice(0, 5).forEach(m => {
    const modelName = (m.name || m.id.split(':').pop() || m.id).slice(0, 35);
    keyboard.textButton({
      label: modelName,
      payload: { command: 'select_model', modelId: m.id },
      color: 'primary'
    }).row();
  });
  return context.send({ message: '🤖 Выберите модель:', keyboard: keyboard.inline() }).catch(err => logVkError(String(context.peerId), err));
}

async function sendProvidersPicker(context: any) {
  const providers = modelOrchestrator.getProviders();
  const status = await modelOrchestrator.checkStatus();
  const keyboard = Keyboard.builder();
  providers.forEach(p => {
    const online = status[p.name] ? '🟢' : '🔴';
    keyboard.textButton({
      label: `${p.name} ${online}`,
      payload: { command: 'select_provider', providerName: p.name },
      color: 'primary'
    }).row();
  });
  // Add strategy buttons
  keyboard.textButton({ label: 'Sequential', payload: { command: 'set_strategy', strategy: 'sequential' }, color: 'secondary' })
    .textButton({ label: 'Parallel', payload: { command: 'set_strategy', strategy: 'parallel' }, color: 'secondary' })
    .textButton({ label: 'Fallback', payload: { command: 'set_strategy', strategy: 'fallback' }, color: 'secondary' }).row();
  return context.send({ message: '🤖 Провайдеры и стратегия:', keyboard: keyboard.inline() }).catch(err => logVkError(String(context.peerId), err));
}

vk.updates.on('message_new', async (context) => {
  // Helper to split long messages
  function splitMessage(text: string, maxLength: number = 3800): string[] {
    if (text.length <= maxLength) return [text];
    const parts: string[] = [];
    const lines = text.split('\n');
    let currentPart = '';
    for (const line of lines) {
      if ((currentPart + '\n' + line).length > maxLength) {
        if (currentPart) parts.push(currentPart);
        currentPart = line;
      } else {
        currentPart += (currentPart ? '\n' : '') + line;
      }
    }
    if (currentPart) parts.push(currentPart);
    return parts;
  }

  // Helper to send a response and log it
  async function sendLog(msg: any) {
    // Если это объект с message и keyboard - отправляем как объект (для VK API)
    if (typeof msg === 'object' && msg !== null && 'message' in msg) {
      await logOutgoing(String(context.peerId), JSON.stringify(msg));
      await context.send(msg).catch(err => logVkError(String(context.peerId), err));
      return;
    }
    
    // Иначе - преобразуем в строку
    let text = typeof msg === 'string' ? msg : JSON.stringify(msg);
    await logOutgoing(String(context.peerId), text);
    const parts = splitMessage(text);
    for (let i = 0; i < parts.length; i++) {
      await context.send(parts[i]).catch(err => logVkError(String(context.peerId), err));
      if (parts.length > 1) await new Promise(r => setTimeout(r, 200));
    }
  }
  let { text, senderId, peerId, id, messagePayload } = context;
  // Log incoming message
  await logIncoming(String(senderId), String(peerId), context.device?.type ?? 'unknown', text ?? '');

  // 0. Сформировать ключ сессии (user + chat) и получить объект сессии
  const sessionKey = `${senderId}:${peerId}`;
  const session = state.getSession(sessionKey);

  // 1. Защита от дублей (используем per‑session lastMessageId)
  if (id && id === session.lastMessageId) return;
  if (id) session.lastMessageId = id;

  // 2. Очистка текста от упоминаний бота
  if (text) {
    text = text.replace(/^\[club\d+\|.+?\]\s*/, '').trim();
  }

  const adminId = parseInt(String(process.env.USER_ID).replace(/\D/g, ''), 10);
  const targetPeerId = parseInt(String(process.env.CHAT_PEER_ID).replace(/\D/g, ''), 10);
  if (senderId !== adminId || peerId !== targetPeerId) return;

  const normalizedText = text || '';
  const cmdPayload = messagePayload?.command;

  // Установить источник - это сообщение от ПОЛЬЗОВАТЕЛЯ
  await state.setGlobal('lastSource', 'user');

  // --- БЛОК А: ОБРАБОТКА ВЫБОРА МОДЕЛИ + ВОССТАНОВЛЕНИЕ ЗАПРОСА ---
  if (cmdPayload === 'select_model') {
    if (messagePayload.modelId.startsWith('lm-studio:')) {
      const allStatus = await modelOrchestrator.checkStatus();
      if (!allStatus['lm-studio']) {
        const startResult = await tryStartLMStudio();
        await logLine(`LMStudio on model select: ${startResult.message}`);
        if (!startResult.success) {
          return context.send(`⚠️ LM Studio не запущен. Запустите вручную: lms server start --cors`).catch(err => logVkError(String(peerId), err));
        }
      }
    }
    const response = await modelOrchestrator.setActiveModel(messagePayload.modelId);
    await context.send(response).catch(err => logVkError(String(peerId), err));

    const pending = state.getGlobal('pendingMessage');
    if (pending) {
      await context.send(`🔄 Возвращаюсь к запросу: "${pending}"`).catch(err => logVkError(String(peerId), err));
      await state.setGlobal('pendingMessage', null);

      // Выполняем отложенный запрос напрямую
      await vk.api.messages.setActivity({ peer_id: peerId, type: 'typing' }).catch(() => { });
      await state.setGlobal('lastSource', 'model');
      const aiResponse = await modelOrchestrator.chat(pending, sessionKey, session.fileContext);
      session.lastAiResponse = aiResponse;
      await logModelResponse(String(senderId), String(peerId), aiResponse);
      return sendLog(aiResponse);
    }
    return;
  }
  // --- ОБРАБОТКА ПОДТВЕРЖДЕНИЯ ---
  if (cmdPayload === 'confirm_write') {
    const fileName = session.activeFilePath;
    const content = session.stagedContent;

    if (!fileName || !content) {
      return sendLog('❌ Ошибка: черновик пуст или файл не выбран.');
    }

    const success = await opencode.writeFile(fileName, content);
    if (success) {
      // Очистить staged‑данные в сессии
      await state.updateSession(sessionKey, s => { s.stagedContent = null; s.activeFilePath = null; });
      await logSessionState(String(senderId), String(peerId), state.getSession(sessionKey));
      return sendLog(`✅ Файл "${fileName}" успешно обновлен.`);
    } else {
      return sendLog('❌ Ошибка при записи файла.');
    }
  }

  if (cmdPayload === 'cancel_write') {
    await state.updateSession(sessionKey, s => { s.stagedContent = null; s.activeFilePath = null; });
    await logSessionState(String(senderId), String(peerId), state.getSession(sessionKey));
    return sendLog('🚫 Изменения отклонены.');
  }

  // --- БЛОК Б: СИСТЕМНЫЕ КОМАНДЫ (Инфо, Меню, Статус, Файлы) ---

  if (normalizedText === '/start' || cmdPayload === 'start') {
    await context.send({ message: ' ', keyboard: { buttons: [] } }).catch(err => logVkError(String(peerId), err));
    const keyboard = Keyboard.builder()
      .textButton({ label: 'ℹ️ Инфо', payload: { command: 'info' } })
      .textButton({ label: '📱 Меню', payload: { command: 'menu' } }).row();
    return context.send({ message: '🚀 Бот готов к работе!', keyboard }).catch(err => logVkError(String(peerId), err));
  }

  if (normalizedText === 'ℹ️ Инфо' || normalizedText === '/info' || cmdPayload === 'info') {
    const stats = await modelOrchestrator.getSystemStats();
    const providerInfo = stats.providers.map(p => `${p.name}: ${p.activeModel || 'не выбрана'} (${p.online ? '🟢' : '🔴'})`).join('\n');
    await sendLog(`🛡 [System Info]\nСтратегия: ${stats.strategy}\n${providerInfo}\n📁 Проект: ${stats.projectRoot}`);
    return;
  }

  if (normalizedText === '📱 Меню' || normalizedText === 'Меню' || cmdPayload === 'menu') {
    // Определяем commandsKeyboard (или используйте импортированную)
    const keyboard = Keyboard.builder()
      .textButton({ label: '🤖 Модели', payload: { command: 'models' } })
      .textButton({ label: '📂 Файлы', payload: { command: 'list' } }).row()
      .textButton({ label: '📊 Статус', payload: { command: 'status' } })
      .textButton({ label: '🏓 Пинг', payload: { command: 'ping' } }).row()
      .textButton({ label: '🤖 Провайдеры', payload: { command: 'providers' } }).inline();

    await context.send({ message: '🛠 Инструменты управления:', keyboard }).catch(err => logVkError(String(peerId), err));
    return;
  }

  if (cmdPayload === 'providers') {
    return sendProvidersPicker(context);
  }

  if (cmdPayload === 'select_provider') {
    const providerName = messagePayload.providerName;
    await sendLog(`Провайдер ${providerName} выбран. Выберите модель:`);
    return sendModelsPickerByProvider(context, providerName, 0);
  }

  if (cmdPayload === 'models_page') {
    const provider = messagePayload.provider;
    const page = messagePayload.page;
    return sendModelsPickerByProvider(context, provider, page);
  }

  if (cmdPayload === 'set_strategy') {
    const strategy = messagePayload.strategy;
    if (strategy === 'sequential' || strategy === 'parallel' || strategy === 'fallback') {
      await modelOrchestrator.setStrategy(strategy);
      return sendLog(`✅ Стратегия изменена на: ${strategy}`);
    }
    return sendLog('❌ Неверная стратегия.');
  }

  // --- ПИНГ ---
  if (cmdPayload === 'ping') {
    return sendLog('🏓 Понг! Бот в сети.');
  }

  if (normalizedText === '/status' || cmdPayload === 'status') {
    const status = await modelOrchestrator.checkStatus();
    const statusText = Object.entries(status).map(([name, online]) => `${name}: ${online ? '🟢 Online' : '🔴 Offline'}`).join('\n');
    await sendLog(`📊 Статус провайдеров:\n${statusText}`);
    return;
  }

  if (normalizedText === '📂 файлы' || normalizedText === '/list' || cmdPayload === 'list') {
    const files = await opencode.getFilesList();
    if (files.length === 0) return sendLog('📂 Файлы не найдены.');

    // Показываем текстовый список файлов (без кнопок)
    const list = files.slice(0, 20).map((file, i) => `${i + 1}. ${file}`).join('\n');
    return sendLog(`📂 Файлы проекта (введите номер или путь):\n${list}`);
  }

  if (normalizedText === '🤖 Модели' || normalizedText === '/models' || cmdPayload === 'models') {
    return sendModelsPicker(context);
  }

  // --- БЛОК В: ОБРАБОТКА /read И /write (только для ПОЛЬЗОВАТЕЛЯ) ---
  const isUserSource = (await state.getGlobal('lastSource')) !== 'model';

  if (isUserSource && normalizedText.startsWith('/read ')) {
    const fileName = normalizedText.replace('/read ', '').trim();
    const content = await opencode.readFile(fileName);
    if (content) {
      await state.updateSession(sessionKey, s => { s.activeFilePath = fileName; s.fileContext = content; });
      await sendLog(`📄 Код "${fileName}" загружен в ИИ.`);
    } else {
      await sendLog(`❌ Ошибка чтения "${fileName}".`);
    }
    return;
  }

  if (isUserSource && normalizedText === '/tree') {
    const tree = opencode.getProjectTree();
    return sendLog(`📁\n\`\`\`\n${tree}\n\`\`\``);
  }

  // --- ОБРАБОТКА AUTO_READ (из кнопки списка) ---
  if (cmdPayload === 'auto_read') {
    const fileName = messagePayload.fileName;
    const content = await opencode.readFile(fileName);

    if (content) {
      await state.updateSession(sessionKey, s => { s.activeFilePath = fileName; s.fileContext = content; });
      await logSessionState(String(senderId), String(peerId), state.getSession(sessionKey));
      // Показываем содержимое файла сразу
      await sendLog(`📄 ${fileName}:\n\`\`\`\n${content.slice(0, 3000)}\n\`\`\``);
      return;
    } else {
      await sendLog(`❌ Не удалось прочитать ${fileName}`);
      return;
    }
  }

  // --- БЛОК /write (только для ПОЛЬЗОВАТЕЛЯ) ---
  if (isUserSource && (normalizedText === '/write' || normalizedText.startsWith('/write '))) {
    let fileName = normalizedText.replace('/write', '').trim() || session.activeFilePath;

    if (!fileName) return sendLog('❌ Активный файл не выбран.');
    if (!session.lastAiResponse) return sendLog('❌ ИИ еще не предложил код.');

    // Очистка от Markdown
    const cleanCode = session.lastAiResponse?.replace(/```[\s\S]*?\n/g, '').replace(/```/g, '').trim();

    // СОХРАНЯЕМ В СЕРВИС
    await state.updateSession(sessionKey, s => { s.activeFilePath = fileName; });
    await logSessionState(String(senderId), String(peerId), state.getSession(sessionKey));
    await state.updateSession(sessionKey, s => { s.stagedContent = cleanCode; });
    await logSessionState(String(senderId), String(peerId), state.getSession(sessionKey));

    const keyboard = Keyboard.builder()
      .textButton({ label: '✅ Принять', payload: { command: 'confirm_write' }, color: 'positive' })
      .textButton({ label: '❌ Отклонить', payload: { command: 'cancel_write' }, color: 'negative' })
      .inline();

    return context.send({ message: `📝 Записать изменения в "${fileName}"?`, keyboard }).catch(err => logVkError(String(peerId), err));
  }

  // --- БЛОК Г: ДИАЛОГ С ИИ + ПРОВЕРКА НАЛИЧИЯ МОДЕЛИ ---
  if (normalizedText && !normalizedText.startsWith('/')) {

    // Если модель не выбрана — запоминаем и предлагаем выбрать
    if (!modelOrchestrator.hasActiveModel()) {
      await state.setGlobal('pendingMessage', normalizedText);
      await sendLog('⚠️ Модель не выбрана. Выберите «мозг», чтобы я ответил на ваш запрос:');
      return sendModelsPicker(context); // Используем нашу функцию вместо handleStatus
    }

    try {
      await vk.api.messages.setActivity({ peer_id: peerId, type: 'typing' }).catch(() => { });
      const lastModel = state.getGlobal<string>('lastSelectedModelId') || modelOrchestrator.getActiveModel() || 'unknown';
      await logModelRequest(String(senderId), String(peerId), normalizedText, lastModel, undefined);
      
      const typingInterval = setInterval(async () => {
        await vk.api.messages.setActivity({ peer_id: peerId, type: 'typing' }).catch(() => { });
      }, 10000);

      await state.setGlobal('lastSource', 'model');
      const aiResponse = await modelOrchestrator.chat(normalizedText, sessionKey, session.fileContext);
      clearInterval(typingInterval);
      
      session.lastAiResponse = aiResponse;
      await logModelResponse(String(senderId), String(peerId), aiResponse);

      const isFromModel = await state.getGlobal('lastSource') === 'model';
      if (isFromModel) {
        const cmd = findModelCommand(aiResponse);
        if (cmd) {
          try {
            switch (cmd.command) {
              case 'readFile': {
                let filePath = cmd.args;
                const prefix = session.projectPrefix || 'rag-api';
                const content = await opencode.readFile(filePath);
                if (!content) {
                  const content2 = await opencode.readFile(prefix + '/' + filePath);
                  if (content2) filePath = prefix + '/' + filePath;
                  else return sendLog(`❌ Файл не найден: ${filePath} или ${prefix}/${filePath}`);
                  return sendLog(`📄 ${filePath}:\n\`\`\`\n${content2.slice(0, 3000)}\n\`\`\``);
                }
                return sendLog(`📄 ${filePath}:\n\`\`\`\n${content.slice(0, 3000)}\n\`\`\``);
              }
              case 'test': {
                const result = await opencode.executeCommand('npm test');
                const out = result.stdout + (result.stderr ? '\n' + result.stderr : '');
                return sendLog(result.success ? `✅ Тесты.\n\`\`\`\n${out.slice(-3000)}\n\`\`\`` : `❌ Ошибка.\n\`\`\`\n${out.slice(-3000)}\n\`\`\``);
              }
              case 'lint': {
                const result = await opencode.executeCommand('npm run typecheck');
                const out = result.stdout + (result.stderr ? '\n' + result.stderr : '');
                return sendLog(result.success ? `✅ OK.\n\`\`\`\n${out.slice(-3000)}\n\`\`\`` : `⚠️.\n\`\`\`\n${out.slice(-3000)}\n\`\`\``);
              }
              case 'tree': {
                const tree = opencode.getProjectTree();
                return sendLog(`📁\n\`\`\`\n${tree}\n\`\`\``);
              }
              default:
                return sendLog(aiResponse);
            }
          } catch (e) {
            return sendLog(`❌ ${(e as any).message}`);
          }
        }
      }

      return sendLog(aiResponse);
    } catch (error: any) {
      const errorMsg = error?.message || 'Неизвестная ошибка';
      await logLine(`CHAT_ERROR | user=${senderId} peer=${peerId} error="${errorMsg}"`);
      return context.send(`⚠️ Ошибка: ${errorMsg}`).catch(err => logVkError(String(peerId), err));
    }
  }
});

export async function handleIncomingMessage(context: any) {
  function splitMessage(text: string, maxLength: number = 3800): string[] {
    if (text.length <= maxLength) return [text];
    const parts: string[] = [];
    const lines = text.split('\n');
    let currentPart = '';
    for (const line of lines) {
      if ((currentPart + '\n' + line).length > maxLength) {
        if (currentPart) parts.push(currentPart);
        currentPart = line;
      } else {
        currentPart += (currentPart ? '\n' : '') + line;
      }
    }
    if (currentPart) parts.push(currentPart);
    return parts;
  }

  const sendLog = async (msg: any) => {
    let text = typeof msg === 'string' ? msg : JSON.stringify(msg);
    await logOutgoing(String(context.peerId), text);
    const parts = splitMessage(text);
    for (let i = 0; i < parts.length; i++) {
      await context.send(parts[i]).catch(err => logVkError(String(context.peerId), err));
      if (parts.length > 1) await new Promise(r => setTimeout(r, 200));
    }
  };

  let { text, senderId, peerId, id, messagePayload } = context;
  await logIncoming(String(senderId), String(peerId), context.device?.type ?? 'unknown', text ?? '');

  const sessionKey = `${senderId}:${peerId}`;
  const session = state.getSession(sessionKey);

  if (id && id === session.lastMessageId) return;
  if (id) session.lastMessageId = id;

  if (text) {
    text = text.replace(/^\[club\d+\|.+?\]\s*/, '').trim();
  }

  const adminId = parseInt(String(process.env.USER_ID).replace(/\D/g, ''), 10);
  const targetPeerId = parseInt(String(process.env.CHAT_PEER_ID).replace(/\D/g, ''), 10);
  if (senderId !== adminId || peerId !== targetPeerId) return;

  const normalizedText = text || '';
  const cmdPayload = messagePayload?.command;

  if (cmdPayload === 'select_model') {
    const response = await modelOrchestrator.setActiveModel(messagePayload.modelId);
    await context.send(response).catch(err => logVkError(String(peerId), err));
    const pending = state.getGlobal('pendingMessage');
    if (pending) {
      await context.send(`🔄 Возвращаюсь к запросу: "${pending}"`).catch(err => logVkError(String(peerId), err));
      await state.setGlobal('pendingMessage', null);
      await vk.api.messages.setActivity({ peer_id: peerId, type: 'typing' }).catch(() => { });
      const aiResponse = await modelOrchestrator.chat(pending, sessionKey, session.fileContext);
      session.lastAiResponse = aiResponse;
      await logModelResponse(String(senderId), String(peerId), aiResponse);
      return sendLog(aiResponse);
    }
    return;
  }

  if (cmdPayload === 'confirm_write') {
    const fileName = session.activeFilePath;
    const content = session.stagedContent;
    if (!fileName || !content) return sendLog('❌ Ошибка: черновик пуст или файл не выбран.');
    const success = await opencode.writeFile(fileName, content);
    if (success) {
      await state.updateSession(sessionKey, s => { s.stagedContent = null; s.activeFilePath = null; });
      await logSessionState(String(senderId), String(peerId), state.getSession(sessionKey));
      return sendLog(`✅ Файл "${fileName}" успешно обновлен.`);
    } else {
      return sendLog('❌ Ошибка при записи файла.');
    }
  }

  if (cmdPayload === 'cancel_write') {
    await state.updateSession(sessionKey, s => { s.stagedContent = null; s.activeFilePath = null; });
    await logSessionState(String(senderId), String(peerId), state.getSession(sessionKey));
    return sendLog('🚫 Изменения отклонены.');
  }

  if (normalizedText === '/start' || cmdPayload === 'start') {
    await context.send({ message: ' ', keyboard: { buttons: [] } }).catch(err => logVkError(String(peerId), err));
    const keyboard = Keyboard.builder()
      .textButton({ label: 'ℹ️ Инфо', payload: { command: 'info' } })
      .textButton({ label: '📱 Меню', payload: { command: 'menu' } }).row();
    return context.send({ message: '🚀 Бот готов к работе!', keyboard }).catch(err => logVkError(String(peerId), err));
  }

  if (normalizedText === 'ℹ️ Инфо' || normalizedText === '/info' || cmdPayload === 'info') {
    const stats = await modelOrchestrator.getSystemStats();
    const providerInfo = stats.providers.map(p => `${p.name}: ${p.activeModel || 'не выбрана'} (${p.online ? '🟢' : '🔴'})`).join('\n');
    await sendLog(`🛡 [System Info]\nСтратегия: ${stats.strategy}\n${providerInfo}\n📁 Проект: ${stats.projectRoot}`);
    return;
  }

  if (normalizedText === '📱 Меню' || normalizedText === 'Меню' || cmdPayload === 'menu') {
    const keyboard = Keyboard.builder()
      .textButton({ label: '🤖 Модели', payload: { command: 'models' } })
      .textButton({ label: '📂 Файлы', payload: { command: 'list' } }).row()
      .textButton({ label: '📊 Статус', payload: { command: 'status' } })
      .textButton({ label: '🏓 Пинг', payload: { command: 'ping' } }).row()
      .textButton({ label: '🤖 Провайдеры', payload: { command: 'providers' } }).inline();
    await context.send({ message: '🛠 Инструменты управления:', keyboard }).catch(err => logVkError(String(peerId), err));
    return;
  }

  if (cmdPayload === 'providers') return sendProvidersPicker(context);

  if (cmdPayload === 'select_provider') {
    const providerName = messagePayload.providerName;
    await sendLog(`Провайдер ${providerName} выбран. Выберите модель:`);
    return sendModelsPickerByProvider(context, providerName, 0);
  }

  if (cmdPayload === 'models_page') {
    const provider = messagePayload.provider;
    const page = messagePayload.page;
    return sendModelsPickerByProvider(context, provider, page);
  }

  if (cmdPayload === 'set_strategy') {
    const strategy = messagePayload.strategy;
    if (strategy === 'sequential' || strategy === 'parallel' || strategy === 'fallback') {
      await modelOrchestrator.setStrategy(strategy);
      return sendLog(`✅ Стратегия изменена на: ${strategy}`);
    }
    return sendLog('❌ Неверная стратегия.');
  }

  if (cmdPayload === 'ping') return sendLog('🏓 Понг! Бот в сети.');

  if (normalizedText === '/status' || cmdPayload === 'status') {
    const status = await modelOrchestrator.checkStatus();
    const statusText = Object.entries(status).map(([name, online]) => `${name}: ${online ? '🟢 Online' : '🔴 Offline'}`).join('\n');
    await sendLog(`📊 Статус провайдеров:\n${statusText}`);
    return;
  }

  if (normalizedText === '📂 файлы' || normalizedText === '/list' || cmdPayload === 'list') {
    const files = await opencode.getFilesList();
    if (files.length === 0) return sendLog('📂 Файлы не найдены.');
    // Показываем текстовый список файлов (без кнопок)
    const list = files.slice(0, 20).map((file, i) => `${i + 1}. ${file}`).join('\n');
    return sendLog(`📂 Файлы проекта (введите номер или путь):\n${list}`);
  }

  if (normalizedText === '🤖 Модели' || normalizedText === '/models' || cmdPayload === 'models') return sendModelsPicker(context);

  if (isUserSource && normalizedText.startsWith('/read ')) {
    const fileName = normalizedText.replace('/read ', '').trim();
    const content = await opencode.readFile(fileName);
    if (content) {
      await state.updateSession(sessionKey, s => { s.activeFilePath = fileName; s.fileContext = content; });
      await sendLog(`📄 Код "${fileName}" загружен в ИИ.`);
    } else {
      await sendLog(`❌ Ошибка чтения "${fileName}".`);
    }
    return;
  }

  if (isUserSource && normalizedText === '/tree') {
    const tree = opencode.getProjectTree();
    return sendLog(`📁\n\`\`\`\n${tree}\n\`\`\``);
  }

  if (cmdPayload === 'auto_read') {
    const fileName = messagePayload.fileName;
    const content = await opencode.readFile(fileName);
    if (content) {
      await state.updateSession(sessionKey, s => { s.activeFilePath = fileName; s.fileContext = content; });
      await logSessionState(String(senderId), String(peerId), state.getSession(sessionKey));
      await sendLog(`📄 ${fileName}:\n\`\`\`\n${content.slice(0, 3000)}\n\`\`\``);
    } else {
      await sendLog(`❌ Не удалось прочитать ${fileName}`);
    }
    return;
  }

  if (isUserSource && (normalizedText === '/write' || normalizedText.startsWith('/write '))) {
    let fileName = normalizedText.replace('/write', '').trim() || session.activeFilePath;
    if (!fileName) return sendLog('❌ Активный файл не выбран.');
    if (!session.lastAiResponse) return sendLog('❌ ИИ еще не предложил код.');
    const cleanCode = session.lastAiResponse?.replace(/```[\s\S]*?\n/g, '').replace(/```/g, '').trim();
    await state.updateSession(sessionKey, s => { s.activeFilePath = fileName; });
    await logSessionState(String(senderId), String(peerId), state.getSession(sessionKey));
    await state.updateSession(sessionKey, s => { s.stagedContent = cleanCode; });
    await logSessionState(String(senderId), String(peerId), state.getSession(sessionKey));
    const keyboard = Keyboard.builder()
      .textButton({ label: '✅ Принять', payload: { command: 'confirm_write' }, color: 'positive' })
      .textButton({ label: '❌ Отклонить', payload: { command: 'cancel_write' }, color: 'negative' })
      .inline();
    return context.send({ message: `📝 Записать изменения в "${fileName}"?`, keyboard }).catch(err => logVkError(String(peerId), err));
  }

  if (normalizedText && !normalizedText.startsWith('/')) {
    if (!modelOrchestrator.hasActiveModel()) {
      await state.setGlobal('pendingMessage', normalizedText);
      await sendLog('⚠️ Модель не выбрана. Выберите «мозг», чтобы я ответил на ваш запрос:');
      return sendModelsPicker(context);
    }
    try {
      await vk.api.messages.setActivity({ peer_id: peerId, type: 'typing' }).catch(() => { });
      const lastModel = state.getGlobal<string>('lastSelectedModelId') || modelOrchestrator.getActiveModel() || 'unknown';
      await logModelRequest(String(senderId), String(peerId), normalizedText, lastModel, undefined);
      
      const typingInterval = setInterval(async () => {
        await vk.api.messages.setActivity({ peer_id: peerId, type: 'typing' }).catch(() => { });
      }, 10000);

      const aiResponse = await modelOrchestrator.chat(normalizedText, sessionKey, session.fileContext);
      clearInterval(typingInterval);
      
      session.lastAiResponse = aiResponse;
      await logModelResponse(String(senderId), String(peerId), aiResponse);

      const cmd = findModelCommand(aiResponse);
      if (cmd) {
        try {
          switch (cmd.command) {
            case 'readFile': {
              let filePath = cmd.args;
              const prefix = session.projectPrefix || 'rag-api';
              const content = await opencode.readFile(filePath);
              if (!content) {
                const content2 = await opencode.readFile(prefix + '/' + filePath);
                if (content2) filePath = prefix + '/' + filePath;
                else return sendLog(`❌ Файл не найден: ${filePath} или ${prefix}/${filePath}`);
                return sendLog(`📄 ${filePath}:\n\`\`\`\n${content2.slice(0, 3000)}\n\`\`\``);
              }
              return sendLog(`📄 ${filePath}:\n\`\`\`\n${content.slice(0, 3000)}\n\`\`\``);
            }
            case 'test': {
              const result = await opencode.executeCommand('npm test');
              const out = result.stdout + (result.stderr ? '\n' + result.stderr : '');
              return sendLog(result.success ? `✅ Тесты.\n\`\`\`\n${out.slice(-3000)}\n\`\`\`` : `❌ Ошибка.\n\`\`\`\n${out.slice(-3000)}\n\`\`\``);
            }
            case 'lint': {
              const result = await opencode.executeCommand('npm run typecheck');
              const out = result.stdout + (result.stderr ? '\n' + result.stderr : '');
              return sendLog(result.success ? `✅ OK.\n\`\`\`\n${out.slice(-3000)}\n\`\`\`` : `⚠️.\n\`\`\`\n${out.slice(-3000)}\n\`\`\``);
            }
            case 'tree': {
              const tree = opencode.getProjectTree();
              return sendLog(`📁\n\`\`\`\n${tree}\n\`\`\``);
            }
            default:
              return sendLog(aiResponse);
          }
        } catch (e) {
          return sendLog(`❌ ${(e as any).message}`);
        }
      }

      return sendLog(aiResponse);
    } catch (error: any) {
      const errorMsg = error?.message || 'Неизвестная ошибка';
      await logLine(`CHAT_ERROR | user=${senderId} peer=${peerId} error="${errorMsg}"`);
      return context.send(`⚠️ Ошибка: ${errorMsg}`).catch(err => logVkError(String(peerId), err));
    }
  }
}

export const startVkBot = async () => {
  await vk.updates.start();
  console.log(`✅ Бот активен в чате: ${process.env.CHAT_PEER_ID}`);
};
