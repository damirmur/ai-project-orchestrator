// clear-log.ts
import { initLogFile } from './src/modules/logger/logger.service.ts';
await initLogFile();

console.log('log cleared');
