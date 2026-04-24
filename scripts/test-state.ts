// scripts/test-state.ts
import { state } from '../src/modules/state/state.service.ts';

(async () => {
  await state.init();
  await state.updateSession('test:1', s => {
    s.activeFilePath = 'example.ts';
    s.stagedContent = 'console.log("hello");';
  });
  console.log('session updated');
})();
