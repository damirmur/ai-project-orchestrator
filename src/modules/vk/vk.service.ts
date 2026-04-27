// src/modules/vk/vk.service.ts
import { VK, Keyboard } from 'vk-io';

import { modelOrchestrator } from '../../core/model-orchestrator.ts';
import { LMStudioProvider } from '../../core/lm-studio.provider.ts';
import { findModelCommand } from '../../core/model-commands.ts';
import { SearchProvider } from '../../core/search.provider.ts';
import { CloudProvider } from '../../core/cloud.provider.ts';
import { adjustQueryWithDate } from '../../utils/date.ts';
import { state } from '../state/state.service.ts';
import { logIncoming, logOutgoing, logCommand, logModelRequest, logModelResponse, logSessionState, logVkError, logLine } from '../logger/logger.service.ts';
import { opencode } from '../project/opencode.service.ts';
import { tryStartLMStudio, getCurrentModel, switchModel } from '../../utils/lmstudio-autostart.ts';

export const vk = new VK({
  token: process.env.VK_TOKEN!,
  pollingGroupId: Number(process.env.GROUP_ID),
  apiVersion: '5.199'
});

const cloudProvider = new CloudProvider();
const lmStudioProvider = new LMStudioProvider();

async function testModelWebSearchCapability(modelId: string, provider: string): Promise<boolean> {
  const testPrompt = 'курс золота на текущую дату. Ответь только да или нет';
  try {
    let response: string;
    if (provider === 'lm-studio') {
      response = await modelOrchestrator.chat(testPrompt, 'capability-test', '');
    } else {
      response = await cloudProvider.chat(modelId, [{ role: 'user', content: testPrompt }]);
    }
    const hasSearch = response.trim().toLowerCase().includes('да');
    const capabilities = state.getGlobal<Record<string, { hasWebSearch?: boolean; lastChecked?: string }>>('modelCapabilities') || {};
    capabilities[modelId] = { hasWebSearch: hasSearch, lastChecked: new Date().toISOString() };
    await state.setGlobal('modelCapabilities', capabilities);
    await logLine(`🔬 CAPABILITY_TEST | model=${modelId} | hasWebSearch=${hasSearch}`);
    return hasSearch;
  } catch (e) {
    await logLine(`❌ CAPABILITY_TEST | model=${modelId} | error="${(e as any).message}"`);
    return false;
  }
}

async function tryLmStudioFallback(originalQuery: string, sessionKey: string): Promise<string | null> {
  await logLine(`🔄 FALLBACK | → LM Studio`);
  try {
    const lmStatus = await tryStartLMStudio();
    if (!lmStatus.success) {
      await logLine(`❌ FALLBACK | LM Studio not available: ${lmStatus.message}`);
      return null;
    }
    await logLine(`✅ FALLBACK | LM Studio ready: ${lmStatus.message}`);
    const queryWithDate = adjustQueryWithDate(originalQuery);
    const searchProvider = new SearchProvider();
    const t0 = Date.now();
    const searchResponse = await searchProvider.search(queryWithDate);
    const { results, provider } = searchResponse;
    const t1 = Date.now();
    if (results.length === 0) {
      await logLine(`🔍 FALLBACK | ${provider.toUpperCase()} | empty | time=${t1-t0}ms`);
      return null;
    }
    const searchContext = results.map(r => `[${r.title}](${r.url}): ${r.content}`).join('\n\n');
    await logLine(`🔍 FALLBACK | ${provider.toUpperCase()} | results=${results.length} | time=${t1-t0}ms`);
    const cleaningPrompt = `Очисти от дубликатов. Оформи с ссылками [текст](URL). Сохрани факты. Краткий ответ.

${searchContext}

Ответ:`;
    const cleaned = await modelOrchestrator.chat(cleaningPrompt, sessionKey, '');
    await logLine(`🔍 FALLBACK | CLEANED | resultLen=${cleaned.length}`);
    return cleaned;
  } catch (e) {
    await logLine(`❌ FALLBACK | error="${(e as any).message}"`);
    return null;
  }
}

const CLEAN_MODEL_ID = 'qwen2.5-1.5b';

async function ensureCleanModel(): Promise<boolean> {
  const lmStatus = await tryStartLMStudio();
  if (!lmStatus.success) {
    await logLine(`❌ CLEAN_MODEL | LM Studio unavailable`);
    return false;
  }
  // Since "load on demand" is enabled in LM Studio, we don't need to manually
  // switch/load the model. The server will handle it on the first request.
  await logLine(`✅ CLEAN_MODEL | LM Studio online (load-on-demand enabled)`);
  return true;
}

async function executeLocalCommand(cmd: { command: string; args?: string }, sessionKey: string): Promise<string | null> {
  const session = state.getSession(sessionKey);
  const senderId = 0;
  const peerId = 0;

  switch (cmd.command) {
    case 'readFile': {
      const filePath = cmd.args || '';
      const prefix = session.projectPrefix || 'rag-api';
      const content = await opencode.readFile(filePath);
      if (!content) {
        const content2 = await opencode.readFile(prefix + '/' + filePath);
        if (content2) return `📄 ${prefix}/${filePath}:\n\`\`\`\n${content2.slice(0, 3000)}\n\`\`\``;
        return `❌ Файл не найден: ${filePath}`;
      }
      return `📄 ${filePath}:\n\`\`\`\n${content.slice(0, 3000)}\n\`\`\``;
    }
    case 'tree': {
      return `📁\n\`\`\`\n${opencode.getProjectTree()}\n\`\`\``;
    }
    case 'files': {
      const path = cmd.args || '';
      return opencode.getFileList(path);
    }
    case 'webSearch': {
      const rawQuery = cmd.args || '';
      if (!rawQuery) return '❌ Укажите поисковый запрос';
      const query = adjustQueryWithDate(rawQuery);
      await logLine(`🔍 WEB-SEARCH | START | query="${query}"`);
      try {
        const search = new SearchProvider();
        const { results, provider } = await search.search(query);
        if (results.length === 0) {
          await logLine(`🔍 WEB-SEARCH | ${provider.toUpperCase()} | result=empty`);
          return '🔍 Ничего не найдено.';
        }
        const searchContext = results.map(r => `[${r.title}](${r.url}): ${r.content}`).join('\n\n').slice(0, 4000);
        await logLine(`🔍 WEB-SEARCH | ${provider.toUpperCase()} | results=${results.length} | contextLen=${searchContext.length}`);
        return `🔍 Результат поиска (${provider}):\n\n${searchContext}`;
      } catch (e) {
        await logLine(`❌ WEB-SEARCH | error="${(e as any).message}"`);
        return `❌ Ошибка поиска: ${(e as any).message}`;
      }
    }
    default:
      await logLine(`❌ LOCAL_CMD | unknown command: ${cmd.command}`);
      return null;
  }
}

async function tryParseJSONCommands(response: string, sessionKey: string): Promise<{ done: boolean; result?: string }> {
  const jsonMatch = response.match(/\{[\s\S]*"command"[\s\S]*\}/);
  if (!jsonMatch) {
    return { done: false };
  }
  try {
    const commands = JSON.parse(jsonMatch[0]);
    await logLine(`📋 JSON_CMD | commands=${JSON.stringify(commands)}`);

    // Handle /web-search command - redirect to executeLocalCommand as 'webSearch'
    if (commands.command === '/web-search' || commands.command === 'webSearch') {
      const searchQuery = commands.args || commands.query || '';
      if (!searchQuery) {
        return { done: true, result: '❌ Укажите поисковый запрос' };
      }
      const cmdResult = await executeLocalCommand({ command: 'webSearch', args: searchQuery }, sessionKey);
      if (cmdResult) {
        return { done: true, result: cmdResult };
      }
      return { done: true, result: '❌ Ошибка выполнения поиска' };
    }

    // Generic command handling for local tools
    if (commands.command && !commands.command.startsWith('/')) {
      const cmdResult = await executeLocalCommand({ command: commands.command, args: commands.args }, sessionKey);
      if (cmdResult) {
        return { done: true, result: cmdResult };
      }
    }

    return { done: false };
  } catch (e) {
    await logLine(`❌ JSON_CMD | parse error: ${(e as any).message}`);
    return { done: false };
  }
}

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
  keyboard.textButton({ label: 'Sequential', payload: { command: 'set_strategy', strategy: 'sequential' }, color: 'secondary' })
    .textButton({ label: 'Parallel', payload: { command: 'set_strategy', strategy: 'parallel' }, color: 'secondary' })
    .textButton({ label: 'Fallback', payload: { command: 'set_strategy', strategy: 'fallback' }, color: 'secondary' }).row();
  return context.send({ message: '🤖 Провайдеры и стратегия:', keyboard: keyboard.inline() }).catch(err => logVkError(String(context.peerId), err));
}

vk.updates.on('message_new', async (context) => { await handleIncomingMessage(context); });

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
    const colonIdx = messagePayload.modelId.indexOf(':');
    const providerName = messagePayload.modelId.substring(0, colonIdx);
    const modelIdShort = messagePayload.modelId.substring(colonIdx + 1);
    await testModelWebSearchCapability(modelIdShort, providerName);
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
      .textButton({ label: '📱 Меню', payload: { command: 'menu' } }).row()
      .textButton({ label: '❓ Помощь', payload: { command: 'help' } }).row();
    return context.send({ message: '🚀 Бот готов к работе!', keyboard }).catch(err => logVkError(String(peerId), err));
  }

  if (normalizedText === '❓ Помощь' || normalizedText === '/help' || cmdPayload === 'help') {
    await sendLog(`❓ Доступные команды:

📋 Основные:
/start - Меню бота
ℹ️ Инфо - Системная информация
📱 Меню - Меню управления
❓ Помощь - Этот список

📁 Файлы:
📂 Файлы - Список файлов
/tree - Структура проекта
/read <файл> - Прочитать файл
/write <файл> - Сохранить код ИИ

🔍 Поиск:
/web-search <запрос> - Веб-поиск в интернете

🔧 Инструменты:
🏓 Пинг - Проверить бота
📊 Статус - Статус провайдеров
🤖 Провайдеры - Выбрать провайдера
🤖 Модели - Выбрать модель`);
    return;
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
      .textButton({ label: '🤖 Провайдеры', payload: { command: 'providers' } })
      .textButton({ label: '❓ Помощь', payload: { command: 'help' } }).inline();
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
    const list = files.slice(0, 20).map((file, i) => `${i + 1}. ${file}`).join('\n');
    return sendLog(`📂 Файлы проекта (введите номер или путь):\n${list}`);
  }

  if (normalizedText === '🤖 Модели' || normalizedText === '/models' || cmdPayload === 'models') return sendModelsPicker(context);

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

      // Try to parse JSON commands from model response
      const jsonResult = await tryParseJSONCommands(aiResponse, sessionKey);
      if (jsonResult.done && jsonResult.result) {
        return sendLog(jsonResult.result);
      }

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
            case 'webSearch': {
              const startTime = Date.now();
              const rawQuery = cmd.args;
              const query = adjustQueryWithDate(rawQuery);
              await logLine(`🔍 WEB-SEARCH | START | query="${query}"`);
              try {
                const search = new SearchProvider();
                const t0 = Date.now();
                const { results, provider } = await search.search(query);
                const t1 = Date.now();
                if (results.length === 0) {
                  await logLine(`🔍 WEB-SEARCH | ${provider.toUpperCase()} | result=empty | time=${t1-t0}ms`);
                  return sendLog('🔍 Ничего не найдено.');
                }
                const searchContext = results.map(r => `[${r.title}](${r.url}): ${r.content}`).join('\n\n').slice(0, 4000);
                await logLine(`🔍 WEB-SEARCH | ${provider.toUpperCase()} | results=${results.length} | contextLen=${searchContext.length} | time=${t1-t0}ms`);
                const cleaningPrompt = `Найди ответ на вопрос в тексте. 
Ответ: Значение -> Ссылка.
Если ответа нет, напиши "Не найдено".

Текст:
${searchContext}

Ответ:`;
                let cleanedResponse: string;
                let cleanedBy = '';
                let cleanTime = 0;
                
                try {
                  // 1. Пытаемся использовать локальную модель qwen2.5-1.5b
                  const t2 = Date.now();
                  const loaded = await ensureCleanModel();
                  if (!loaded) throw new Error('Local clean model not loaded');
                  
                  // Вызываем напрямую провайдера, чтобы не зависеть от выбранной моделью пользователя
                  cleanedResponse = await lmStudioProvider.chat('qwen2.5-1.5b', [
                    { role: 'system', content: 'Ты — помощник по очистке данных.' },
                    { role: 'user', content: cleaningPrompt }
                  ]);
                  const t3 = Date.now();
                  cleanedBy = 'lm-studio';
                  cleanTime = t3 - t2;
                } catch (lmErr) {
                  // 2. Fallback на Cloud (Gemma)
                  try {
                    const t2 = Date.now();
                    cleanedResponse = await cloudProvider.chat('google/gemma-4-26b-a4b-it:free', [
                      { role: 'user', content: cleaningPrompt }
                    ]);
                    const t3 = Date.now();
                    cleanedBy = 'cloud';
                    cleanTime = t3 - t2;
                  } catch (cloudErr) {
                    // 3. Крайний случай: возвращаем сырые данные
                    await logLine(`❌ WEB-SEARCH | CLEAN | both failed | error="${(cloudErr as any).message}"`);
                    cleanedResponse = searchContext;
                    cleanedBy = 'raw';
                    cleanTime = 0;
                  }
                }
                await logLine(`🔍 WEB-SEARCH | CLEAN | provider=${cleanedBy} | promptLen=${cleaningPrompt.length} | resultLen=${cleanedResponse.length} | time=${cleanTime}ms`);
                const totalTime = Date.now() - startTime;
                await logLine(`🔍 WEB-SEARCH | DONE | by=${cleanedBy} | totalTime=${totalTime}ms`);
                return sendLog(`🔍 Результат поиска (${provider}):\n\n${cleanedResponse}`);
              } catch (e) {
                const totalTime = Date.now() - startTime;
                await logLine(`🔍 WEB-SEARCH | ERROR | error="${(e as any).message}" | time=${totalTime}ms`);
                return sendLog(`❌ Ошибка поиска: ${(e as any).message}`);
              }
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
