import 'dotenv/config';
import { CloudProvider } from '../src/core/cloud.provider.ts';

const provider = new CloudProvider();
const models = await provider.getModels();

// Показать первые 10 моделей
console.log('First 10 models:');
models.slice(0, 10).forEach((m, i) => console.log(`${i+1}. ${m.id}`));

// Показать модели с :free
console.log('\nModels with :free:');
models.filter(m => m.id.toLowerCase().includes(':free')).forEach(m => console.log(m.id));