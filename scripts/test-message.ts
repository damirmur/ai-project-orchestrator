import 'dotenv/config';
import * as fs from 'fs';
import { state } from '../src/modules/state/state.service.ts';
import { handleIncomingMessage } from '../src/modules/vk/vk.service.ts';
import { initLogFile } from '../src/modules/logger/logger.service.ts';

const args = process.argv.slice(2);
let text = '';
let payload: any = null;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--text' && args[i + 1]) text = args[i + 1];
  if (args[i] === '--payload-file' && args[i + 1]) {
    const filePath = args[i + 1];
    if (fs.existsSync(filePath)) {
      payload = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    }
  }
}

if (!text && !payload) {
  console.error('Usage: node scripts/test-message.ts --text "/start"');
  console.error('       node scripts/test-message.ts --payload \'{"command":"ping"}\'');
  process.exit(1);
}

const USER_ID = parseInt(process.env.USER_ID || '0');
const CHAT_PEER_ID = parseInt(process.env.CHAT_PEER_ID || '0');

const mockContext = {
  text: text || '',
  senderId: USER_ID,
  peerId: CHAT_PEER_ID,
  id: Date.now(),
  messagePayload: payload,
  device: { type: 'test' },
  send: async (msg: any) => {
    console.log('[SEND]', typeof msg === 'string' ? msg : JSON.stringify(msg, null, 2));
    return true;
  }
};

async function main() {
  await state.init();
  await initLogFile();
  console.log(`Testing: text="${text}" payload=${JSON.stringify(payload)}`);
  await handleIncomingMessage(mockContext as any);

  await new Promise(r => setTimeout(r, 1000));

  const log = fs.readFileSync('bot.log', 'utf-8');
  const lines = log.trim().split('\n').slice(-15);
  console.log('\n--- Last 15 log lines ---');
  lines.forEach(l => console.log(l));
}

main().catch(console.error);