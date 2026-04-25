import 'dotenv/config';
import { state } from '../src/modules/state/state.service.ts';
import { initLogFile } from '../src/modules/logger/logger.service.ts';
import { ModelOrchestrator } from '../src/core/model-orchestrator.ts';

await state.init();
await initLogFile();

const orch = new ModelOrchestrator();
const models = await orch.getModels('lm-studio');
console.log('Models for lm-studio:', JSON.stringify(models, null, 2));