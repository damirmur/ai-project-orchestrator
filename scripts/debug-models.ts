import 'dotenv/config';
import { LMStudioProvider } from '../src/core/lm-studio.provider.ts';

const provider = new LMStudioProvider();
const models = await provider.getModels();
console.log('Models:', JSON.stringify(models, null, 2));