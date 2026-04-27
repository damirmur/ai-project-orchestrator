import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    env: {
      VK_TOKEN: 'test',
      USER_ID: '34240560',
      GROUP_ID: '237905452',
      CHAT_PEER_ID: '2000000003',
      LMS_URL: 'http://localhost:1234',
      OPENROUTER_KEY: 'test',
      PROJECTS_ROOT: './projects',
    },
  },
});