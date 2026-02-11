import type { ISODateString } from '@/types/models';

export function toISODateString(date: Date): ISODateString {
  return date.toISOString();
}

export function fromISODateString(isoString: ISODateString): Date {
  return new Date(isoString);
}

export function formatDate(isoString: ISODateString, locale: string = 'en-US'): string {
  const date = fromISODateString(isoString);
  return date.toLocaleDateString(locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export function formatDateShort(isoString: ISODateString, locale: string = 'en-US'): string {
  const date = fromISODateString(isoString);
  return date.toLocaleDateString(locale, {
    month: 'short',
    day: 'numeric',
  });
}

export function formatDateTime(isoString: ISODateString, locale: string = 'en-US'): string {
  const date = fromISODateString(isoString);
  return date.toLocaleString(locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function getStartOfDay(date: Date): Date {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);
  return result;
}

export function getEndOfDay(date: Date): Date {
  const result = new Date(date);
  result.setHours(23, 59, 59, 999);
  return result;
}

export function getStartOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

export function getEndOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59, 999);
}

export function getStartOfYear(date: Date): Date {
  return new Date(date.getFullYear(), 0, 1);
}

export function getEndOfYear(date: Date): Date {
  return new Date(date.getFullYear(), 11, 31, 23, 59, 59, 999);
}

export function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

export function addMonths(date: Date, months: number): Date {
  const result = new Date(date);
  result.setMonth(result.getMonth() + months);
  return result;
}

export function addYears(date: Date, years: number): Date {
  const result = new Date(date);
  result.setFullYear(result.getFullYear() + years);
  return result;
}

export function isDateBetween(
  date: ISODateString,
  start: ISODateString,
  end: ISODateString
): boolean {
  const d = new Date(date);
  const s = new Date(start);
  const e = new Date(end);
  return d >= s && d <= e;
}

export function daysBetween(start: Date, end: Date): number {
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.floor((end.getTime() - start.getTime()) / msPerDay);
}

export function getRelativeTimeString(isoString: ISODateString, locale: string = 'en-US'): string {
  const date = fromISODateString(isoString);
  const now = new Date();
  const diffInMs = now.getTime() - date.getTime();
  const diffInDays = Math.floor(diffInMs / (24 * 60 * 60 * 1000));

  if (diffInDays === 0) {
    return 'Today';
  } else if (diffInDays === 1) {
    return 'Yesterday';
  } else if (diffInDays < 7) {
    return `${diffInDays} days ago`;
  } else if (diffInDays < 30) {
    const weeks = Math.floor(diffInDays / 7);
    return `${weeks} week${weeks > 1 ? 's' : ''} ago`;
  } else {
    return formatDate(isoString, locale);
  }
}

/**
 * Get the start and end dates for the previous month
 */
export function getLastMonthRange(): { start: Date; end: Date } {
  const now = new Date();
  const lastMonth = addMonths(now, -1);
  return {
    start: getStartOfMonth(lastMonth),
    end: getEndOfMonth(lastMonth),
  };
}

/**
 * Get the start and end dates for the last N months (including current month)
 */
export function getLastNMonthsRange(months: number): { start: Date; end: Date } {
  const now = new Date();
  const startDate = addMonths(getStartOfMonth(now), -(months - 1));
  return {
    start: startDate,
    end: getEndOfMonth(now),
  };
}

/**
 * Format a date for HTML date input (YYYY-MM-DD)
 */
export function toDateInputValue(date: Date): string {
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const monthStr = month < 10 ? `0${month}` : `${month}`;
  const dayStr = day < 10 ? `0${day}` : `${day}`;
  return `${year}-${monthStr}-${dayStr}`;
}
