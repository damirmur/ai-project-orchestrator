import 'dotenv/config';
import path from 'node:path';
import { opencode } from '../project/opencode.service.ts';

const LMS_URL = process.env.LMS_URL || 'http://localhost:1234';
let activeModelId: string | null = null;
let pendingMessage: string | null = null;
let currentFileContext: string = ''; // Храним код здесь

export const lmsService = {

    setFileContext(content: string) {
        currentFileContext = content;
    },

    async checkStatus() {
        try { return (await fetch(`${LMS_URL}/v1/models`)).ok; } catch { return false; }
    },

    async getModels() {
        try {
            const res = await fetch(`${LMS_URL}/v1/models`);
            const data = await res.json();
            return data.data;
        } catch { return []; }
    },
    async setActiveModel(modelId: string): Promise<string> {
        try {
            // 1. Выгружаем всё лишнее для освобождения VRAM (по умолчанию)
            await fetch(`${LMS_URL}/v1/plugins/model-loader/unload`, { method: 'POST' }).catch(() => { });

            activeModelId = modelId;

            // 2. Получаем инфо о модели из списка доступных для статуса
            const models = await this.getModels();
            const modelInfo = models.find(m => m.id === modelId);

            return `✅ Модель выбрана: ${modelId.split('/').pop()}\n` +
                `📊 Статус: Ожидание первого запроса (JIT)\n` +
                `💾 VRAM: Очищено для загрузки.`;
        } catch (e) {
            activeModelId = modelId;
            return `✅ Модель выбрана (без очистки VRAM): ${modelId}`;
        }
    },
    // Методы для работы с отложенным сообщением
    setPending(text: string) { pendingMessage = text; },
    getPending() { return pendingMessage; },
    clearPending() { pendingMessage = null; },

    hasActiveModel() { return activeModelId !== null; },

    // src/modules/ai/lms.service.ts
    async chat(userMessage: string): Promise<string> {
        if (!activeModelId) return "⚠️ Сначала выберите модель.";
        const activeFile = opencode.getActiveFile();
        // Формируем продвинутую системную инструкцию (Smart Patching)
        const systemContent = currentFileContext
            ? `Ты — эксперт-программист Node.js. Тебе предоставлен код файла для редактирования:\n\n` +
            `----------\n. Текущий файл: ${activeFile || 'не выбран'}.\n${currentFileContext}\n----------\n\n` +
            `Твоя задача: проанализировать запрос пользователя и вывести ИСПРАВЛЕННЫЙ код целиком. ` +
            `Не пиши лишних объяснений, если тебя об этом не просят. ` +
            `Обязательно используй блоки кода Markdown (например, \`\`\`typescript ... \`\`\`).`
            : "Ты — полезный ИИ-ассистент.";

        try {
            const response = await fetch(`${LMS_URL}/v1/chat/completions`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: activeModelId,
                    messages: [
                        { role: 'system', content: systemContent },
                        { role: 'user', content: userMessage }
                    ],
                    temperature: 0.2 // Низкая температура для стабильного кода
                })
            });

            if (!response.ok) throw new Error('LMS API Error');

            const data = await response.json();
            return data.choices[0].message.content; // В некоторых версиях API это массив choices[0]
        } catch (error) {
            console.error('[LMS Chat Error]:', error);
            return "💥 Ошибка при генерации ответа. Проверьте LM Studio.";
        }
    }
    ,
    getActiveModel() {
        return activeModelId || 'Не выбрана';
    },

    async getSystemStats() {
        const isLmsOnline = await this.checkStatus();
        return {
            provider: 'LM Studio (Local)',
            status: isLmsOnline ? '🟢 Online' : '🔴 Offline',
            activeModel: this.getActiveModel(),
            projectRoot: path.resolve(process.env.PROJECTS_ROOT || './projects')
        };
    }
};
