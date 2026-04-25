export const MODEL_COMMANDS = [
  { prefix: '/read ', execute: 'readFile', description: 'читать файл' },
  { prefix: '/write ', execute: 'writeFile', description: 'записать файл' },
  { prefix: '/test', execute: 'test', description: 'npm test' },
  { prefix: '/lint', execute: 'lint', description: 'tsc --noEmit' },
  { prefix: '/install ', execute: 'install', description: 'npm install' },
  { prefix: '/new ', execute: 'newProject', description: 'создать проект' },
  { prefix: '/seed ', execute: 'seed', description: 'создать seed' },
  { prefix: '/deps ', execute: 'deps', description: 'зависимости проекта' },
  { prefix: '/tree', execute: 'tree', description: 'структура проектов' },
  { prefix: '/files ', execute: 'files', description: 'список файлов' },
  { prefix: '/rag create', execute: 'ragCreate', description: 'создать RAG базу' },
  { prefix: '/rag add ', execute: 'ragAdd', description: 'добавить в RAG' },
  { prefix: '/rag search ', execute: 'ragSearch', description: 'поиск в RAG' },
  { prefix: '/rag ', execute: 'ragSearch', description: 'RAG (поиск по умолчанию)' },
];

export function findModelCommand(text: string): { command: string; args: string } | null {
  const firstLine = text.trim().split('\n')[0];
  for (const cmd of MODEL_COMMANDS) {
    if (firstLine.includes(cmd.prefix)) {
      const idx = firstLine.indexOf(cmd.prefix);
      return {
        command: cmd.execute,
        args: firstLine.slice(idx + cmd.prefix.length).trim()
      };
    }
  }
  return null;
}

export function isModelCommand(text: string): boolean {
  return findModelCommand(text) !== null;
}