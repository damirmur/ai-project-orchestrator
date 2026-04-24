// src/modules/vk/vk.service.ts
import { VK, Keyboard } from 'vk-io';
import 'dotenv/config';
import { lmsService } from '../ai/lms.service.ts';
import { state } from '../state/state.service.ts';
import { logIncoming, logOutgoing, logCommand, logModelRequest, logModelResponse, logSessionState } from '../logger/logger.service.ts';
import { opencode } from '../project/opencode.service.ts';

export const vk = new VK({
    token: process.env.VK_TOKEN!,
    pollingGroupId: Number(process.env.GROUP_ID),
    apiVersion: '5.199'
});

// Session handling is now delegated to the persisted state service.
// We'll retrieve a per‑user session object using the composite key `${senderId}:${peerId}`.


async function sendModelsPicker(context: any) {
  // Helper to send and log from inside this function
  async function innerSend(msg: any) {
    await logOutgoing(String(context.peerId), typeof msg === 'string' ? msg : JSON.stringify(msg));
    return context.send(msg);
  }
    const models = await lmsService.getModels();
    const keyboard = Keyboard.builder();
    models.slice(0, 5).forEach(m => {
        keyboard.textButton({
            label: m.id.split('/').pop()?.slice(0, 35) || m.id,
            payload: { command: 'select_model', modelId: m.id },
            color: 'primary'
        }).row();
    });
    return innerSend({ message: '🤖 Выберите модель:', keyboard: keyboard.inline() });
}

vk.updates.on('message_new', async (context) => {
  // Helper to send a response and log it
  async function sendLog(msg: any) {
    await logOutgoing(String(context.peerId), typeof msg === 'string' ? msg : JSON.stringify(msg));
    return context.send(msg);
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
  // Используем одно имя переменной для payload
  const cmdPayload = messagePayload?.command;

    // --- БЛОК А: ОБРАБОТКА ВЫБОРА МОДЕЛИ + ВОССТАНОВЛЕНИЕ ЗАПРОСА ---
    if (cmdPayload === 'select_model') {
        const response = await lmsService.setActiveModel(messagePayload.modelId);
        await context.send(response);

        const pending = lmsService.getPending();
        if (pending) {
            await context.send(`🔄 Возвращаюсь к запросу: "${pending}"`);
            lmsService.clearPending();

            // Выполняем отложенный запрос напрямую
            await vk.api.messages.setActivity({ peer_id: peerId, type: 'typing' }).catch(() => { });
            const aiResponse = await lmsService.chat(pending);
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

    if (normalizedText === 'ℹ️ Инфо' || normalizedText === '/info' || cmdPayload === 'info') {
        const stats = await lmsService.getSystemStats();
        await sendLog(`🛡 [System Info]\n🌐 Провайдер: ${stats.provider}\n🧠 Модель: ${stats.activeModel.split('/').pop()}\n📁 Проект: ${stats.projectRoot}`);
        return;
    }

    if (normalizedText === '📱 Меню' || normalizedText === 'Меню' || cmdPayload === 'menu') {
        // Определяем commandsKeyboard (или используйте импортированную)
        const keyboard = Keyboard.builder()
            .textButton({ label: '🤖 Модели', payload: { command: 'models' } })
            .textButton({ label: '📂 Файлы', payload: { command: 'list' } }).row()
            .textButton({ label: '📊 Статус', payload: { command: 'status' } })
            .textButton({ label: '🏓 Пинг', payload: { command: 'ping' } }).inline();

        await context.send({ message: '🛠 Инструменты управления:', keyboard });
        return;
    }

    // --- ПИНГ ---
    if (cmdPayload === 'ping') {
        return sendLog('🏓 Понг! Бот в сети.');
    }

    if (normalizedText === '/status' || cmdPayload === 'status') {
        const isOnline = await lmsService.checkStatus();
        await sendLog(`📊 LMS Server: ${isOnline ? '🟢 Online' : '🔴 Offline'}`);
        return;
    }

if (normalizedText === '📂 файлы' || normalizedText === '/list' || cmdPayload === 'list') {
  const files = await opencode.getFilesList();
  if (files.length === 0) return sendLog('📂 Файлы не найдены.');

  const keyboard = Keyboard.builder();
  // Выводим максимум 10 файлов для удобства
  files.slice(0, 10).forEach(file => {
    keyboard.textButton({
      label: file.length > 35 ? `...${file.slice(-32)}` : file,
      payload: { command: 'auto_read', fileName: file },
      color: 'secondary'
    }).row();
  });

  return sendLog({ message: '📂 Выберите файл для анализа:', keyboard: keyboard.inline() });
}

    if (normalizedText === '🤖 Модели' || normalizedText === '/models' || cmdPayload === 'models') {
        return sendModelsPicker(context);
        const models = await lmsService.getModels();
        const keyboard = Keyboard.builder();
        models.slice(0, 5).forEach(m => {
            keyboard.textButton({
                label: m.id.split('/').pop()?.slice(0, 35) || m.id,
                payload: { command: 'select_model', modelId: m.id },
                color: 'primary'
            }).row();
        });
        await context.send({ message: '🤖 Выберите модель:', keyboard: keyboard.inline() });
        return;
    }

    // --- БЛОК В: ОБРАБОТКА /read И /write ---

    if (normalizedText.startsWith('/read ')) {
        const fileName = normalizedText.replace('/read ', '').trim();
        const content = await opencode.readFile(fileName);
        if (content) {
            lmsService.setFileContext(content);
            await sendLog(`📄 Код "${fileName}" загружен в ИИ.`);
        } else {
            await sendLog(`❌ Ошибка чтения "${fileName}".`);
        }
        return;
    }
    // --- ОБРАБОТКА AUTO_READ (из кнопки списка) ---
if (cmdPayload === 'auto_read') {
  const fileName = messagePayload.fileName;
  const content = await opencode.readFile(fileName);
  
  if (content) {
    await state.updateSession(sessionKey, s => { s.activeFilePath = fileName; }); // Запоминаем путь
              await logSessionState(String(senderId), String(peerId), state.getSession(sessionKey));
    lmsService.setFileContext(content); // Отправляем в ИИ
    await sendLog(`🎯 Активный файл выбран: ${fileName}. Теперь вы можете отправить запрос к ИИ.`);
    return; // Обязательно выходим!
  } else {
    await sendLog(`❌ Не удалось прочитать ${fileName}`);
    return;
  }
}

// --- БЛОК /write ---
if (normalizedText === '/write' || normalizedText.startsWith('/write ')) {
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

  return context.send({ message: `📝 Записать изменения в "${fileName}"?`, keyboard });
}

    // --- БЛОК Г: ДИАЛОГ С ИИ + ПРОВЕРКА НАЛИЧИЯ МОДЕЛИ ---
    if (normalizedText && !normalizedText.startsWith('/')) {

        // Если модель не выбрана — запоминаем и предлагаем выбрать
        if (!lmsService.hasActiveModel()) {
            lmsService.setPending(normalizedText);
            await sendLog('⚠️ Модель не выбрана. Выберите «мозг», чтобы я ответил на ваш запрос:');
            return sendModelsPicker(context); // Используем нашу функцию вместо handleStatus
        }

        try {
            await vk.api.messages.setActivity({ peer_id: peerId, type: 'typing' }).catch(() => { });
            await logModelRequest(String(senderId), String(peerId), normalizedText, lmsService.getActiveModelId?.() || 'unknown', undefined);
const aiResponse = await lmsService.chat(normalizedText);
                    session.lastAiResponse = aiResponse;
                    await logModelResponse(String(senderId), String(peerId), aiResponse);
                    return sendLog(aiResponse);
        } catch (error) {
            return context.send('💥 Ошибка генерации.');
        }
    }
});
    export const startVkBot = async () => {
    await vk.updates.start();
    console.log(`✅ Бот активен в чате: ${process.env.CHAT_PEER_ID}`);
};
