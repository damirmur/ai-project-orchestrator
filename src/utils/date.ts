// src/utils/date.ts
// Утилиты для работы с датами

export function getToday(): string {
  const now = new Date();
  return now.toLocaleDateString('ru-RU', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });
}

export function getTodayShort(): string {
  const now = new Date();
  return now.toLocaleDateString('ru-RU');
}

export function getCurrentYear(): number {
  return new Date().getFullYear();
}

export function getCurrentMonth(): number {
  return new Date().getMonth() + 1;
}

export function getMonthName(month: number): string {
  const months = [
    'январь', 'февраль', 'март', 'апрель', 'май', 'июнь',
    'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'
  ];
  return months[month - 1] || '';
}

export function getWeekStart(): Date {
  const now = new Date();
  const day = now.getDay();
  const diff = now.getDate() - day + (day === 0 ? -6 : 1);
  return new Date(now.setDate(diff));
}

export function getWeekEnd(): Date {
  const start = getWeekStart();
  return new Date(start.getTime() + 6 * 24 * 60 * 60 * 1000);
}

const TIME_KEYWORDS: Record<string, (query: string) => string> = {
  'сегодня': () => getTodayShort(),
  'вчера': () => {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return d.toLocaleDateString('ru-RU');
  },
  'завтра': () => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return d.toLocaleDateString('ru-RU');
  },
  'на прошлой неделе': () => {
    const d = new Date();
    d.setDate(d.getDate() - 7);
    return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
  },
  'на этой неделе': () => {
    const start = getWeekStart();
    const end = getWeekEnd();
    return `${start.toLocaleDateString('ru-RU', { day: 'numeric', month: 'numeric' })} - ${end.toLocaleDateString('ru-RU', { day: 'numeric', month: 'numeric' })}`;
  },
  'на неделе': () => {
    const start = getWeekStart();
    const end = getWeekEnd();
    return `${start.toLocaleDateString('ru-RU', { day: 'numeric', month: 'numeric' })} - ${end.toLocaleDateString('ru-RU', { day: 'numeric', month: 'numeric' })}`;
  },
  'на неделю': () => {
    const start = getWeekStart();
    const end = getWeekEnd();
    return `${start.toLocaleDateString('ru-RU', { day: 'numeric', month: 'numeric' })} - ${end.toLocaleDateString('ru-RU', { day: 'numeric', month: 'numeric' })}`;
  },
  'в прошлом месяце': () => {
    const d = new Date();
    d.setMonth(d.getMonth() - 1);
    return `${getMonthName(d.getMonth() + 1)} ${d.getFullYear()} года`;
  },
  'в этом месяце': () => {
    const d = new Date();
    return `${getMonthName(d.getMonth() + 1)} ${d.getFullYear()} года`;
  },
  'в месяце': () => {
    const d = new Date();
    return `${getMonthName(d.getMonth() + 1)} ${d.getFullYear()} года`;
  },
  'на месяц': () => {
    const d = new Date();
    return `${getMonthName(d.getMonth() + 1)} ${d.getFullYear()} года`;
  },
  'на следующий месяц': () => {
    const d = new Date();
    d.setMonth(d.getMonth() + 1);
    return `${getMonthName(d.getMonth() + 1)} ${d.getFullYear()} года`;
  },
  'в следующем месяце': () => {
    const d = new Date();
    d.setMonth(d.getMonth() + 1);
    return `${getMonthName(d.getMonth() + 1)} ${d.getFullYear()} года`;
  },
  'в прошлом году': () => `${getCurrentYear() - 1} год`,
  'на этот год': () => `${getCurrentYear()} год`,
  'на год': () => `${getCurrentYear()} год`,
  'на следующий год': () => `${getCurrentYear() + 1} год`,
};

function getTodayForSearch(): string {
  return new Date().toLocaleDateString('ru-RU');
}

const TOPIC_DEFAULTS: Record<string, () => string> = {
  'гороскоп': () => `на ${getTodayForSearch()}`,
  'курс': () => `на ${getTodayForSearch()}`,
  'погода': () => `на ${getTodayForSearch()}`,
  'новости': () => `за ${getTodayForSearch()}`,
  'котировки': () => `на ${getTodayForSearch()}`,
  'акции': () => `на ${getTodayForSearch()}`,
  'биткоин': () => `на ${getTodayForSearch()}`,
  'доллар': () => `на ${getTodayForSearch()}`,
  'евро': () => `на ${getTodayForSearch()}`,
  'золото': () => `на ${getTodayForSearch()}`,
  'нефть': () => `на ${getTodayForSearch()}`,
};

export function adjustQueryWithDate(query: string): string {
  const lowerQuery = query.toLowerCase();
  
  // Проверяем временные ключевые слова и заменяем их на даты
  for (const [keyword, getDate] of Object.entries(TIME_KEYWORDS)) {
    if (lowerQuery.includes(keyword)) {
      return query.toLowerCase().replace(keyword, getDate());
    }
  }
  
  // Проверяем явные форматы дат (2025, март, 25 апреля, 26.04.2026, апрель 2026 и т.д.)
  const datePatterns = [
    /\d{4}\s*год/,
    /\d{1,2}\.\d{1,2}\.\d{2,4}/,          // 26.04.2026
    /\d{1,2}\s+\w+\s+\d{4}/i,            // 26 апреля 2026
    /\w+\s+\d{4}/i,                       // апрель 2026
    /\d{1,2}\s+\w+/i,                    // 26 апреля (без года)
  ];
  
  for (const pattern of datePatterns) {
    if (pattern.test(lowerQuery)) {
      return query;
    }
  }
  
  // Добавляем умолчальную дату по теме
  for (const [topic, getDefaultDate] of Object.entries(TOPIC_DEFAULTS)) {
    if (lowerQuery.includes(topic)) {
      return `${query} ${getDefaultDate()}`;
    }
  }
  
  // По умолчанию добавляем текущую дату
  return `${query} на ${getTodayForSearch()}`;
}

export function formatDateForSearch(date: Date): string {
  return date.toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  });
}