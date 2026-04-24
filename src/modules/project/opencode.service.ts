// src/modules/project/opencode.service.ts
import fs from 'node:fs/promises';
import { logFileOp } from '../logger/logger.service.ts';
import path from 'node:path';

let activeFilePath: string | null = null;
let stagedContent: string | null = null; // Здесь будем хранить код до подтверждения


export const opencode = {
  setActiveFile(path: string) { activeFilePath = path; },
  getActiveFile() { return activeFilePath; },

  setStagedContent(content: string) { stagedContent = content; },
  getStagedContent() { return stagedContent; },
  clearStage() { stagedContent = null; },

  async writeFile(filePath: string, content: string): Promise<boolean> {
    try {
      const root = path.resolve(process.env.PROJECTS_ROOT || './projects');
      const fullPath = path.resolve(root, filePath);
      if (!fullPath.startsWith(root)) return false;

      const dirPath = path.dirname(fullPath);
      await fs.mkdir(dirPath, { recursive: true });

      try { await fs.copyFile(fullPath, `${fullPath}.bak`); } catch {}

      await fs.writeFile(fullPath, content, 'utf-8');
      await logFileOp('write', filePath, true);
      return true;
    } catch (error) {
console.error('[Opencode Error]:', error);
       await logFileOp('write', filePath, false, (error as any).message);
       return false;
    }
  },

  async readFile(filePath: string): Promise<string | null> {
    try {
      const root = path.resolve(process.env.PROJECTS_ROOT || './projects');
      const fullPath = path.resolve(root, filePath);

      if (!fullPath.startsWith(root)) {
        console.error('Попытка выхода за пределы папки проектов');
        return null;
      }

      const data = await fs.readFile(fullPath, 'utf-8');
        await logFileOp('read', filePath, true);
        return data;
    } catch (error) {
console.error('[Opencode Error]:', error);
       await logFileOp('read', filePath, false, (error as any).message);
       return null;
    }
  },

// src/modules/project/opencode.service.ts

async getFilesList(): Promise<string[]> {
  try {
    const root = path.resolve(process.env.PROJECTS_ROOT || './projects');
    // recursive: true позволяет зайти во все вложенные папки
    const entries = await fs.readdir(root, { recursive: true, withFileTypes: true });
    
    return entries
      .filter(e => e.isFile()) // Оставляем ТОЛЬКО файлы
      .filter(e => !e.name.includes('node_modules') && !e.name.startsWith('.'))
      .map(e => {
        const relativePath = path.relative(root, path.join(e.parentPath, e.name));
        return relativePath.replace(/\\/g, '/');
      });
  } catch (error) {
    return [];
  }
},
async getProjectTree(): Promise<string[]> {
    try {
      const root = process.env.PROJECTS_ROOT || './projects';
      const files = await fs.readdir(root, { recursive: true });
      // Фильтруем мусор
      return files.filter(f => !f.includes('node_modules') && !f.includes('.git'));
    } catch (e) {
      return [];
    }
  }
};

