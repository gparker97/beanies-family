import type { DateOfBirth, ISODateString } from '@/types/models';

// ── Shared month abbreviations (dd MMM yyyy standard) ──────────────────────
const MONTHS_SHORT = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];
const DAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function toISODateString(date: Date): ISODateString {
  return date.toISOString();
}

export function fromISODateString(isoString: ISODateString): Date {
  return new Date(isoString);
}

/**
 * Format: "8 Jan 2026" — unambiguous date with year.
 * Accepts ISO date strings or YYYY-MM-DD.
 */
export function formatDate(isoString: ISODateString): string {
  const date = fromISODateString(isoString);
  return `${date.getDate()} ${MONTHS_SHORT[date.getMonth()]} ${date.getFullYear()}`;
}

/**
 * Format: "8 Jan" — compact date without year.
 * Accepts ISO date strings or YYYY-MM-DD.
 */
export function formatDateShort(isoString: ISODateString): string {
  const date = fromISODateString(isoString);
  return `${date.getDate()} ${MONTHS_SHORT[date.getMonth()]}`;
}

/**
 * Standard date format for nook cards and similar compact displays.
 * Shows "Wed, 6 Mar" for current year, "Wed, 6 Mar 2027" for other years.
 * Accepts ISO date strings or YYYY-MM-DD.
 */
export function formatNookDate(dateStr: string): string {
  const date = parseLocalDate(dateStr);
  const now = new Date();
  const day = date.getDate();
  const mon = MONTHS_SHORT[date.getMonth()];
  const dow = DAYS_SHORT[date.getDay()];
  if (date.getFullYear() === now.getFullYear()) {
    return `${dow}, ${day} ${mon}`;
  }
  return `${dow}, ${day} ${mon} ${date.getFullYear()}`;
}

/**
 * Format: "Wed, 6 Mar 2026" — full date with day-of-week and year.
 */
export function formatDateFull(dateStr: string): string {
  const date = parseLocalDate(dateStr);
  const dow = DAYS_SHORT[date.getDay()];
  const day = date.getDate();
  const mon = MONTHS_SHORT[date.getMonth()];
  return `${dow}, ${day} ${mon} ${date.getFullYear()}`;
}

/**
 * Format: "Wed, 6 Mar" — date with day-of-week, no year.
 */
export function formatDateWithDay(dateStr: string): string {
  const date = parseLocalDate(dateStr);
  const dow = DAYS_SHORT[date.getDay()];
  return `${dow}, ${date.getDate()} ${MONTHS_SHORT[date.getMonth()]}`;
}

export function getStartOfDay(date: Date): Date {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);
  return result;
}

export function getStartOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

export function getEndOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59, 999);
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

/**
 * Check if a date falls between start and end (inclusive).
 * Compares using date-only strings (YYYY-MM-DD) to avoid timezone issues.
 * Transaction dates may be stored as "YYYY-MM-DD" or full ISO timestamps —
 * this function normalizes both to date-only for safe comparison.
 */
export function isDateBetween(
  date: ISODateString,
  start: ISODateString,
  end: ISODateString
): boolean {
  const d = extractDatePart(date);
  const s = extractDatePart(start);
  const e = extractDatePart(end);
  return d >= s && d <= e;
}

/**
 * Extract the YYYY-MM-DD portion from any date string.
 * For full ISO timestamps, converts to local date to avoid timezone shifts.
 * For date-only strings ("YYYY-MM-DD"), returns as-is.
 */
export function extractDatePart(dateStr: string): string {
  // If it's already a date-only string (YYYY-MM-DD), return as-is
  if (dateStr.length === 10) return dateStr;
  // For full ISO timestamps, parse and extract local date
  const d = new Date(dateStr);
  return toDateInputValue(d);
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
 * Human-friendly relative time (e.g. "2 hours ago", "just now").
 * Human-friendly relative time with minute/hour granularity.
 */
export function timeAgo(isoString: ISODateString): string {
  const date = fromISODateString(isoString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHr = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHr / 24);

  if (diffSec < 60) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHr < 24) return `${diffHr}h ago`;
  if (diffDay === 1) return 'yesterday';
  if (diffDay < 7) return `${diffDay}d ago`;
  return formatDate(isoString);
}

/**
 * Graduated timestamp format for log-entry rows (dose log, future food /
 * sleep / mood logs). Today reads as relative time; prior days surface
 * an absolute date + time so the day-separation between entries is
 * obvious at a glance — `timeAgo`'s "3d ago" loses that context.
 *
 * Output examples (assuming today is Wed, 27 Apr 2026 at 14:00):
 *   - 30 sec ago         → "just now"
 *   - 30 min ago         → "30m ago"
 *   - 6h ago (same day)  → "6h ago"
 *   - yesterday 8:30 AM  → "Yesterday at 8:30 AM"
 *   - 4 days ago, Sat    → "Sat at 8:30 AM"
 *   - 21 Apr (this year) → "Mon, 21 Apr at 8:30 AM"
 *   - 21 Apr 2025        → "Mon, 21 Apr 2025 at 8:30 AM"
 *
 * Day-of-week buckets (yesterday, "this week") are computed from local
 * calendar boundaries — NOT from raw ms-difference — so a dose at
 * 23:30 last night and one at 00:30 today never collide as "the same
 * day" or skip "Yesterday."
 */
export function formatLogEntryTime(isoString: ISODateString): string {
  const date = fromISODateString(isoString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHr = Math.floor(diffMin / 60);

  // Same calendar day → relative
  const todayStart = getStartOfDay(now);
  const dateStart = getStartOfDay(date);
  if (todayStart.getTime() === dateStart.getTime()) {
    if (diffSec < 60) return 'just now';
    if (diffMin < 60) return `${diffMin}m ago`;
    return `${diffHr}h ago`;
  }

  const time = formatTime12(toTimeInputValue(date));

  // Yesterday → "Yesterday at 8:30 AM"
  const yesterdayStart = addDays(todayStart, -1);
  if (dateStart.getTime() === yesterdayStart.getTime()) {
    return `Yesterday at ${time}`;
  }

  // Within last 7 days (excluding today + yesterday) → "Mon at 8:30 AM"
  const sixDaysAgoStart = addDays(todayStart, -6);
  if (dateStart.getTime() >= sixDaysAgoStart.getTime()) {
    return `${DAYS_SHORT[date.getDay()]} at ${time}`;
  }

  // Same year → "Mon, 21 Apr at 8:30 AM"
  if (date.getFullYear() === now.getFullYear()) {
    return `${DAYS_SHORT[date.getDay()]}, ${date.getDate()} ${MONTHS_SHORT[date.getMonth()]} at ${time}`;
  }

  // Earlier years → include year
  return `${DAYS_SHORT[date.getDay()]}, ${date.getDate()} ${MONTHS_SHORT[date.getMonth()]} ${date.getFullYear()} at ${time}`;
}

const DAYS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const MONTHS_LONG = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/**
 * Format: "Thursday, 10 April 2026" — full day name + date + long month + year.
 */
export function formatDayLong(dateStr: string): string {
  const date = parseLocalDate(dateStr);
  return `${DAYS_LONG[date.getDay()]}, ${date.getDate()} ${MONTHS_LONG[date.getMonth()]} ${date.getFullYear()}`;
}

/**
 * Format: "Tue, 28 April" — short day name + date + long month, no year.
 * Used for the conversational "today" caption on the Family Nook where
 * horizontal space is at a premium (mobile) and the year is implicit.
 */
export function formatTodayCaption(dateStr: string): string {
  const date = parseLocalDate(dateStr);
  return `${DAYS_SHORT[date.getDay()]}, ${date.getDate()} ${MONTHS_LONG[date.getMonth()]}`;
}

/**
 * Format: "14 May" — day + short month, no year.
 *
 * Used in compact list views (e.g. the setup wizard's member tiles, family
 * roster cards) where the birthday is decoration alongside other meta, not
 * a load-bearing value. Year is intentionally omitted for visual uniformity
 * across members regardless of whether year was captured.
 *
 * Returns an empty string when `dob` is missing, undefined, or has invalid
 * month/day values. The empty string is the documented fallback so callers
 * can render `${role}${birthdayShort ? ` · ${birthdayShort}` : ''}` cleanly
 * via a `<template v-if>` guard — graceful degradation, not a silent
 * failure (the empty string IS the contract, not a hidden error).
 */
export function formatBirthdayShort(dob: DateOfBirth | undefined | null): string {
  if (!dob || !dob.month || !dob.day) return '';
  const idx = dob.month - 1;
  if (idx < 0 || idx >= MONTHS_SHORT.length) return '';
  return `${dob.day} ${MONTHS_SHORT[idx]}`;
}

/**
 * Format a date as "January 2026"
 */
export function formatMonthYear(date: Date): string {
  return `${MONTHS_LONG[date.getMonth()]} ${date.getFullYear()}`;
}

/**
 * Format a date as "Jan 2026"
 */
export function formatMonthYearShort(date: Date): string {
  return `${MONTHS_SHORT[date.getMonth()]} ${date.getFullYear()}`;
}

/**
 * Format: "8 Jan 2026 9:25am" — full date + 12-hour time.
 */
export function formatDateTime(dateStr: string, time?: string): string {
  const datePart = formatDateFull(dateStr);
  if (!time) return datePart;
  return `${datePart} ${formatTime12(time)}`;
}

/**
 * Parse a YYYY-MM-DD date string as local midnight.
 * Unlike `new Date("2026-03-01")` which parses as UTC midnight,
 * this function ensures the date is interpreted in the local timezone.
 * Safe to call with any date string — full ISO timestamps are also handled.
 */
export function parseLocalDate(dateStr: string): Date {
  // YYYY-MM-DD format: parse as local date to avoid UTC timezone shift
  if (dateStr.length === 10) {
    const [year, month, day] = dateStr.split('-').map(Number);
    return new Date(year!, month! - 1, day!);
  }
  // Full ISO or other format: parse normally
  return new Date(dateStr);
}

/**
 * Add one hour to an HH:MM time string, capping at 23:xx.
 * Returns empty string if input is empty.
 */
export function addHourToTime(time: string): string {
  if (!time) return '';
  const [h, m] = time.split(':').map(Number);
  return `${String(Math.min((h ?? 0) + 1, 23)).padStart(2, '0')}:${String(m ?? 0).padStart(2, '0')}`;
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

/**
 * Today in the user's LOCAL timezone as a YYYY-MM-DD string.
 *
 * For one-shot reads only (timestamps, comparisons in pure helpers,
 * services). Reactive UI consumers should read `useToday().today` from
 * `@/composables/useToday` instead — that ref auto-advances at midnight
 * and on tab wake, so views, computeds, and Pinia getters that filter
 * by "today" stay correct without manual re-renders.
 */
export function localToday(): string {
  return toDateInputValue(new Date());
}

/**
 * Format a Date as `HH:mm` in LOCAL time — the value shape expected by
 * `<input type="time">`. Mirrors `toDateInputValue` for time inputs.
 */
export function toTimeInputValue(date: Date): string {
  const h = date.getHours();
  const m = date.getMinutes();
  return `${h < 10 ? '0' : ''}${h}:${m < 10 ? '0' : ''}${m}`;
}

/**
 * Detect if an HH:mm departure time is late-night (21:00–23:59) or early-morning (00:00–02:59).
 * Returns 'early-morning', 'late-night', or null.
 */
export function detectNightFlight(time?: string): 'early-morning' | 'late-night' | null {
  if (!time) return null;
  const hour = parseInt(time.split(':')[0] ?? '12', 10);
  if (hour < 3) return 'early-morning';
  if (hour >= 21) return 'late-night';
  return null;
}

/**
 * Format an HH:mm time string to 12-hour format (e.g. "4pm", "3:30pm").
 * Omits minutes when they are :00 for a cleaner display.
 */
/**
 * Number of days between two date strings (YYYY-MM-DD or ISO).
 * Always returns a non-negative integer.
 */
export function daysBetween(a: string, b: string): number {
  const dateA = parseLocalDate(extractDatePart(a));
  const dateB = parseLocalDate(extractDatePart(b));
  return Math.abs(Math.round((dateB.getTime() - dateA.getTime()) / (1000 * 60 * 60 * 24)));
}

export function formatTime12(time: string): string {
  if (!time) return '';
  const [h, m] = time.split(':').map(Number);
  const hour = h! % 12 || 12;
  const ampm = h! < 12 ? 'am' : 'pm';
  return m ? `${hour}:${String(m).padStart(2, '0')}${ampm}` : `${hour}${ampm}`;
}
