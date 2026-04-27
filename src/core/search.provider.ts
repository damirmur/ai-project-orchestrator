// Search Provider — SearXNG primary, Tavily fallback

import { tavily } from '@tavily/core';
import { logLine } from '../modules/logger/logger.service.ts';

export type SearchResult = {
  title: string;
  url: string;
  content: string;
};

export type SearchResponse = {
  results: SearchResult[];
  provider: 'searxng' | 'tavily';
};

let tvly: any = null;

function getTavilyClient(): any {
  if (!tvly) {
    const apiKey = process.env.TAVILY_API_KEY;
    if (!apiKey) {
      throw new Error('TAVILY_API_KEY not set in .env');
    }
    tvly = tavily({ apiKey });
  }
  return tvly;
}

function cleanContent(text: string, maxLength: number = 500): string {
  if (!text) return '';
  
  // Убираем HTML теги
  let cleaned = text.replace(/<[^>]+>/g, '');
  
  // Убираем повторяющиеся символы и паттерны
  cleaned = cleaned.replace(/[\u0000-\u001F\u007F-\u009F]/g, '');
  
  // Убираем лишние пробелы
  cleaned = cleaned.replace(/\s+/g, ' ').trim();
  
  // Ограничиваем длину
  if (cleaned.length > maxLength) {
    cleaned = cleaned.slice(0, maxLength).lastIndexOf(' ') > 0 
      ? cleaned.slice(0, cleaned.lastIndexOf(' ', maxLength)) + '...'
      : cleaned.slice(0, maxLength) + '...';
  }
  return cleaned;
}

async function searchSearXNG(query: string): Promise<SearchResult[]> {
  const searxUrl = process.env.SEARXNG_URL;
  if (!searxUrl) {
    throw new Error('SEARXNG_URL not set');
  }

  const url = new URL(`${searxUrl.replace(/\/$/, '')}/search`);
  url.searchParams.set('q', query);
  url.searchParams.set('format', 'json');
  url.searchParams.set('language', 'ru-RU');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const response = await fetch(url.toString(), {
      signal: controller.signal,
      headers: { 'Accept': 'application/json' }
    });
    clearTimeout(timeout);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json() as {
      results?: Array<{ title?: string; url?: string; content?: string; snippet?: string }>;
    };

    const results = (data.results || []).map((r: any) => ({
      title: cleanContent(r.title || '', 100),
      url: r.url || '',
      content: cleanContent(r.content || r.snippet || '', 600)
    }));

    return results;
  } catch (e) {
    clearTimeout(timeout);
    throw e;
  }
}

async function searchTavily(query: string, pageSize: number): Promise<SearchResult[]> {
  const client = getTavilyClient();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  
  try {
    const response = await client.search(query, { 
      maxResults: pageSize,
      searchDepth: 'advanced',
      signal: controller.signal
    });
    clearTimeout(timeout);
    
    return (response.results || []).map((r: any) => ({
      title: cleanContent(r.title || '', 100),
      url: r.url || '',
      content: cleanContent(r.content || '', 600)
    }));
  } catch (e) {
    clearTimeout(timeout);
    throw e;
  }
}

export class SearchProvider {
  private readonly pageSize = 3;

  async search(query: string): Promise<SearchResponse> {
    const startTime = Date.now();
    
    // 1. Пробуем SearXNG (primary)
    if (process.env.SEARXNG_URL) {
      try {
        const results = await searchSearXNG(query);
        const elapsed = Date.now() - startTime;
        await logLine(`🌐 SEARXNG | query="${query}" | results=${results.length} | time=${elapsed}ms`);
        if (results.length > 0) {
          return { results, provider: 'searxng' };
        }
        await logLine(`⚠️ SEARXNG | empty results, trying fallback`);
      } catch (e: any) {
        const elapsed = Date.now() - startTime;
        await logLine(`❌ SEARXNG | query="${query}" | time=${elapsed}ms | error="${e.message}"`);
        await logLine(`🔄 FALLBACK | → Tavily`);
      }
    }

    // 2. Fallback на Tavily
    try {
      const results = await searchTavily(query, this.pageSize);
      const elapsed = Date.now() - startTime;
      await logLine(`🌐 TAVILY | query="${query}" | results=${results.length} | time=${elapsed}ms`);
      return { results, provider: 'tavily' };
    } catch (e: any) {
      const elapsed = Date.now() - startTime;
      await logLine(`❌ TAVILY | query="${query}" | time=${elapsed}ms | error="${e.message}"`);
      return { results: [], provider: 'tavily' };
    }
  }
}
