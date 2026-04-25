// src/modules/project/opencode.service.ts
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import { logFileOp, logLine } from '../logger/logger.service.ts';
import path from 'node:path';
import { spawn } from 'node:child_process';

const EMBED_URL = process.env['LMS_URL'] ?? 'http://localhost:1234';
const EMBED_MODEL = process.env['EMBED_MODEL'] ?? 'nomic-embed-text-v1.5';

export const opencode = {
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
      const errMsg = (error as any).message || '';
      if (!errMsg.includes('ENOENT')) {
        console.error('[Opencode Error]:', error);
        await logFileOp('read', filePath, false, errMsg);
      }
      return null;
    }
  },

  async getFilesList(): Promise<string[]> {
    try {
      const root = path.resolve(process.env.PROJECTS_ROOT || './projects');
      const entries = await fs.readdir(root, { recursive: true, withFileTypes: true });

      return entries
        .filter(e => e.isFile())
        .filter(e => !e.name.includes('node_modules') && !e.name.startsWith('.'))
        .map(e => {
          const relativePath = path.relative(root, path.join(e.parentPath, e.name));
          return relativePath.replace(/\\/g, '/');
        });
    } catch (error) {
      return [];
    }
  },

  getProjectTree(): string {
    try {
      const root = path.resolve(process.env.PROJECTS_ROOT || './projects');
      const files = fsSync.readdirSync(root, { recursive: true }) as string[];
      const filtered = files.filter(f => !f.includes('node_modules') && !f.includes('.git'));
      const tree: Map<string, string[]> = new Map();
      for (const f of filtered) {
        const parts = f.split(/[/\\]/);
        const projectName = parts[0];
        if (!tree.has(projectName)) tree.set(projectName, []);
        const relativePath = parts.slice(1).join('/');
        if (relativePath) tree.get(projectName)!.push(relativePath);
      }
      let result = '';
      for (const [project, filesList] of tree) {
        result += `${project}/\n`;
        for (const file of filesList.slice(0, 50)) {
          result += `  ${file}\n`;
        }
        if (filesList.length > 50) result += `  ... и ещё ${filesList.length - 50} файлов\n`;
      }
      return result || 'Нет проектов';
    } catch (e) {
      return 'Ошибка чтения';
    }
  },

  async executeCommand(command: string): Promise<{ stdout: string; stderr: string; success: boolean }> {
    const ALLOWED = [
      'npm test', 'npm run', 'npm install', 'npm ci',
      'npm init', 'npm pkg add',
      'npx tsx', 'tsx', 'ts-node',
      'npx tsc --noEmit', 'npm run typecheck', 'npm run lint', 'npm run build', 'npm run dev', 'npm run start',
      'git status', 'git diff', 'git add', 'git commit', 'git push',
      'mkdir', 'rm', 'cp'
    ];
    const allowedCmd = ALLOWED.find(c => command === c || command.startsWith(c + ' '));
    if (!allowedCmd) {
      return { stdout: '', stderr: `Недопустимая команда: ${command}`, success: false };
    }

    const cwd = path.resolve(process.env.PROJECTS_ROOT || './projects');
    return new Promise(resolve => {
      const parts = command.split(' ');
      const cmd = parts[0];
      const args = parts.slice(1);
      const child = spawn(cmd, args, { cwd, shell: true });
      let stdout = '';
      let stderr = '';

      child.stdout.on('data', d => { stdout += d; });
      child.stderr.on('data', d => { stderr += d; });
      child.on('close', code => {
        logLine(`CMD | ${command} | exit=${code}`);
        resolve({ stdout, stderr, success: code === 0 });
      });
      child.on('error', err => {
        logLine(`CMD_ERR | ${command} | ${err.message}`);
        resolve({ stdout: '', stderr: err.message, success: false });
      });
      setTimeout(() => {
        child.kill();
        resolve({ stdout, stderr: 'Таймаут 60с', success: false });
      }, 60000);
    });
  },

  async getProjectMeta(): Promise<{
    scripts: Record<string, string>;
    deps: string[];
    devDeps: string[];
    hasConfigs: string[];
    hasLockfile: string | null;
  } | null> {
    const root = path.resolve(process.env.PROJECTS_ROOT || './projects');
    const pkgPath = path.join(root, 'package.json');
    const configs = ['tsconfig.json', '.eslintrc', '.prettierrc', 'jest.config.js', 'vitest.config.ts'];
    const lockfiles = ['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml'];

    try {
      const pkg: any = JSON.parse(await fs.readFile(pkgPath, 'utf-8'));
      const hasConfigs: string[] = [];
      for (const c of configs) {
        try { await fs.access(path.join(root, c)); hasConfigs.push(c); } catch {}
      }
      let hasLockfile: string | null = null;
      for (const l of lockfiles) {
        try { await fs.access(path.join(root, l)); hasLockfile = l; break; } catch {}
      }
      return {
        scripts: pkg.scripts || {},
        deps: Object.keys(pkg.dependencies || {}),
        devDeps: Object.keys(pkg.devDependencies || {}),
        hasConfigs,
        hasLockfile
      };
    } catch {
      return null;
    }
  },

  async mkProject(name: string): Promise<{ success: boolean; path: string; error?: string }> {
    try {
      const root = path.resolve(process.env.PROJECTS_ROOT || './projects');
      const projectPath = path.resolve(root, name);
      if (!projectPath.startsWith(root)) return { success: false, path: '', error: 'Path traversal' };

      await fs.mkdir(projectPath, { recursive: true });
      await fs.mkdir(path.join(projectPath, 'src', 'routes'), { recursive: true });
      await fs.mkdir(path.join(projectPath, 'src', 'db'), { recursive: true });
      await fs.mkdir(path.join(projectPath, 'src', 'rag'), { recursive: true });
      await fs.mkdir(path.join(projectPath, 'scripts'), { recursive: true });
      await fs.mkdir(path.join(projectPath, 'data'), { recursive: true });

      const pkg = {
        name,
        version: '0.1.0',
        type: 'module',
        engines: { node: '>=24.0.0' },
        scripts: {
          dev: 'tsx --watch src/index.ts',
          start: 'tsx src/index.ts',
          test: 'node --test',
          typecheck: 'npx tsc --noEmit',
          lint: 'npx tsc --noEmit',
          build: 'npx tsc --noEmit'
        },
        dependencies: {},
        devDependencies: {
          '@types/node': '^24.0.0',
          'tsx': '^4.0.0',
          'typescript': '^5.9.0'
        }
      };

      const tsconfig = {
        compilerOptions: {
          target: 'ES2024',
          module: 'ESNext',
          moduleResolution: 'bundler',
          lib: ['ES2024'],
          strict: true,
          skipLibCheck: true,
          noUncheckedIndexedAccess: true,
          noImplicitOverride: true,
          noPropertyAccessFromIndexSignature: true,
          esModuleInterop: true,
          verbatimModuleSyntax: true,
          outDir: './dist',
          rootDir: './src'
        },
        include: ['src/**/*']
      };

      await fs.writeFile(path.join(projectPath, 'package.json'), JSON.stringify(pkg, null, 2), 'utf-8');
      await fs.writeFile(path.join(projectPath, 'tsconfig.json'), JSON.stringify(tsconfig, null, 2), 'utf-8');
      await fs.writeFile(path.join(projectPath, 'src', 'index.ts'), `import { Hono } from 'hono';\n\nconst app = new Hono();\n\napp.get('/', c => c.json({ status: 'ok' }));\n\nconst PORT = Number(process.env.PORT ?? 3000);\nconsole.log(\`Listening on :\${PORT}\`);\napp.listen(PORT);\n`, 'utf-8');

      await logFileOp('write', `${name}/package.json`, true);
      await logFileOp('write', `${name}/tsconfig.json`, true);
      await logFileOp('write', `${name}/src/index.ts`, true);

      return { success: true, path: name };
    } catch (error) {
      return { success: false, path: '', error: (error as any).message };
    }
  },

  async mkSeed(projectName: string, docs: Array<{ id: string; title: string; content: string }>): Promise<{ success: boolean; error?: string }> {
    try {
      const root = path.resolve(process.env.PROJECTS_ROOT || './projects');
      const scriptPath = path.join(root, projectName, 'scripts', 'seed.ts');

      const lines = docs.map(d => {
        const sentences = d.content
          .replace(/(?<=[.!?])\s+/g, "'|'")
          .split("'|'")
          .map(s => s.trim())
          .filter(s => s.length > 20);
        return `  { id: '${d.id}', title: '${d.title}', content: \`${sentences.join('. ')}.\` }`;
      }).join(',\n');

      const content = `// Generated seed script\nconst docs = [\n${lines}\n];\n\nfor (const doc of docs) {\n  console.log(\`Seed: \${doc.title}\`);\n}\n`;

      await fs.writeFile(scriptPath, content, 'utf-8');
      await logFileOp('write', `${projectName}/scripts/seed.ts`, true);
      return { success: true };
    } catch (error) {
      return { success: false, error: (error as any).message };
    }
  },

  async embedText(text: string): Promise<{ vector: number[]; error?: string }> {
    try {
      const response = await fetch(`${EMBED_URL}/v1/embeddings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: EMBED_MODEL, input: text })
      });

      if (!response.ok) {
        return { vector: [], error: `LM Studio error: ${response.status}` };
      }

      const data = await response.json() as { data: Array<{ embedding: number[] }> };
      const vector = data.data[0]?.embedding ?? [];
      return { vector };
    } catch (error) {
      return { vector: [], error: (error as any).message };
    }
  },

  vectorToBlob(vector: number[]): Uint8Array {
    return new Uint8Array(new Float32Array(vector).buffer);
  },

  blobToVector(blob: Uint8Array): number[] {
    return Array.from(new Float32Array(blob.buffer));
  },

  cosine(vecA: number[], vecB: number[]): number {
    let dot = 0, na = 0, nb = 0;
    const len = Math.min(vecA.length, vecB.length);
    for (let i = 0; i < len; i++) {
      dot += vecA[i]! * vecB[i]!;
      na += vecA[i]! * vecA[i]!;
      nb += vecB[i]! * vecB[i]!;
    }
    const norm = Math.sqrt(na) * Math.sqrt(nb);
    return norm > 0 ? dot / norm : 0;
  },

  getEmbedConfig(): { url: string; model: string } {
    return { url: EMBED_URL, model: EMBED_MODEL };
  },

  async createRagDb(dbPath: string): Promise<{ success: boolean; error?: string }> {
    try {
      const { DatabaseSync } = await import('node:sqlite');
      const { mkdirSync } = await import('node:fs');
      const { dirname } = await import('node:path');
      mkdirSync(dirname(dbPath), { recursive: true });
      const db = new DatabaseSync(dbPath);
      db.exec(`
        CREATE TABLE IF NOT EXISTS rag_chunks (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          doc_id TEXT,
          content TEXT NOT NULL,
          metadata TEXT,
          created_at INTEGER DEFAULT (strftime('%s', 'now'))
        ) STRICT;
        CREATE TABLE IF NOT EXISTS rag_docs (
          id TEXT PRIMARY KEY,
          title TEXT,
          source TEXT,
          created_at INTEGER DEFAULT (strftime('%s', 'now'))
        ) STRICT;
        CREATE TABLE IF NOT EXISTS rag_embeddings (
          chunk_id INTEGER PRIMARY KEY,
          vector BLOB NOT NULL,
          FOREIGN KEY (chunk_id) REFERENCES rag_chunks(id) ON DELETE CASCADE
        ) STRICT;
      `);
      db.close();
      return { success: true };
    } catch (error) {
      return { success: false, error: (error as any).message };
    }
  },

  async ingestRagText(
    dbPath: string,
    content: string,
    docId?: string,
    metadata?: Record<string, unknown>
  ): Promise<{ success: boolean; chunkId?: number; error?: string }> {
    try {
      const { DatabaseSync } = await import('node:sqlite');
      const db = new DatabaseSync(dbPath);
      const result = await this.embedText(content);
      if (result.error || result.vector.length === 0) {
        db.close();
        return { success: false, error: result.error || 'Empty embedding' };
      }
      db.prepare('INSERT INTO rag_chunks (doc_id, content, metadata) VALUES (?, ?, ?)').run(
        docId ?? null,
        content,
        metadata ? JSON.stringify(metadata) : null
      );
      const row = db.prepare('SELECT last_insert_rowid() as id').get() as { id: number };
      const chunkId = row.id;
      const blob = this.vectorToBlob(result.vector);
      db.prepare('INSERT INTO rag_embeddings (chunk_id, vector) VALUES (?, ?)').run(chunkId, blob);
      db.close();
      return { success: true, chunkId };
    } catch (error) {
      return { success: false, error: (error as any).message };
    }
  },

  async searchRag(
    dbPath: string,
    query: string,
    limit = 5
  ): Promise<{ success: boolean; results?: Array<{ content: string; doc_id: string | null; score: number }>; error?: string }> {
    try {
      const { DatabaseSync } = await import('node:sqlite');
      const db = new DatabaseSync(dbPath);
      const qResult = await this.embedText(query);
      if (qResult.error || qResult.vector.length === 0) {
        db.close();
        return { success: false, error: qResult.error || 'Empty query embedding' };
      }
      const chunks = db.prepare(
        'SELECT id, doc_id, content FROM rag_chunks ORDER BY id LIMIT ?'
      ).all(limit * 2) as Array<{ id: number; doc_id: string | null; content: string }>;
      if (chunks.length === 0) {
        db.close();
        return { success: true, results: [] };
      }
      const embRows = db.prepare(
        `SELECT chunk_id, vector FROM rag_embeddings WHERE chunk_id IN (${chunks.map(() => '?').join(',')})`
      ).all(...chunks.map(c => c.id)) as Array<{ chunk_id: number; vector: Uint8Array }>;
      const embMap = new Map(embRows.map(r => [r.chunk_id, this.blobToVector(r.vector)]));
      const results: Array<{ content: string; doc_id: string | null; score: number }> = [];
      for (const chunk of chunks) {
        const vec = embMap.get(chunk.id);
        if (!vec) continue;
        const score = this.cosine(qResult.vector, vec);
        results.push({ content: chunk.content, doc_id: chunk.doc_id, score });
      }
      results.sort((a, b) => b.score - a.score);
      db.close();
      return { success: true, results: results.slice(0, limit) };
    } catch (error) {
      return { success: false, error: (error as any).message };
    }
  }
};

export const opencodeEmbedding = opencode;