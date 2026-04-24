// src/types/env.d.ts
declare global {
  namespace NodeJS {
    interface ProcessEnv {
      VK_TOKEN: string;
      GROUP_ID: string;
      USER_ID: string;
      CHAT_PEER_ID: string;
      PROJECTS_ROOT?: string;
      PORT?: string;
      NODE_ENV?: 'development' | 'production';
    }
  }
}
export {};
