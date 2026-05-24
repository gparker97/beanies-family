import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  isDateBetween,
  toDateInputValue,
  parseLocalDate,
  formatTime12,
  formatDayLong,
  formatLogEntryTime,
  formatBirthdayShort,
  formatNookDate,
  formatCreatedAt,
  relativeDayLabel,
  getWeekdayOrdinalInMonth,
  nthWeekdayOfMonth,
} from '../date';
import type { UIStringKey } from '@/services/translation/uiStrings';

describe('toDateInputValue', () => {
  it('returns YYYY-MM-DD format', () => {
    const date = new Date(2026, 2, 1); // March 1, 2026
    expect(toDateInputValue(date)).toBe('2026-03-01');
  });

  it('zero-pads single-digit months', () => {
    const date = new Date(2026, 0, 15); // January 15
    expect(toDateInputValue(date)).toBe('2026-01-15');
  });

  it('zero-pads single-digit days', () => {
    const date = new Date(2026, 11, 5); // December 5
    expect(toDateInputValue(date)).toBe('2026-12-05');
  });

  it('handles double-digit months and days', () => {
    const date = new Date(2026, 10, 28); // November 28
    expect(toDateInputValue(date)).toBe('2026-11-28');
  });
});

describe('parseLocalDate', () => {
  it('parses YYYY-MM-DD as local midnight', () => {
    const date = parseLocalDate('2026-03-15');
    expect(date.getFullYear()).toBe(2026);
    expect(date.getMonth()).toBe(2); // March = 2
    expect(date.getDate()).toBe(15);
    expect(date.getHours()).toBe(0);
    expect(date.getMinutes()).toBe(0);
    expect(date.getSeconds()).toBe(0);
  });

  it('handles full ISO timestamp strings', () => {
    const date = parseLocalDate('2026-03-15T14:30:00.000Z');
    expect(date.getFullYear()).toBe(2026);
    // Month/date may shift by timezone, but it should parse without error
    expect(date instanceof Date).toBe(true);
    expect(isNaN(date.getTime())).toBe(false);
  });

  it('roundtrips with toDateInputValue for YYYY-MM-DD', () => {
    const original = '2026-06-20';
    const date = parseLocalDate(original);
    expect(toDateInputValue(date)).toBe(original);
  });
});

describe('isDateBetween', () => {
  it('returns true for date within range (YYYY-MM-DD inputs)', () => {
    expect(isDateBetween('2026-03-15', '2026-03-01', '2026-03-31')).toBe(true);
  });

  it('returns true for date on start boundary', () => {
    expect(isDateBetween('2026-03-01', '2026-03-01', '2026-03-31')).toBe(true);
  });

  it('returns true for date on end boundary', () => {
    expect(isDateBetween('2026-03-31', '2026-03-01', '2026-03-31')).toBe(true);
  });

  it('returns false for date before range', () => {
    expect(isDateBetween('2026-02-28', '2026-03-01', '2026-03-31')).toBe(false);
  });

  it('returns false for date after range', () => {
    expect(isDateBetween('2026-04-01', '2026-03-01', '2026-03-31')).toBe(false);
  });

  it('handles full ISO timestamp as date input', () => {
    // A full ISO timestamp should be normalized to local date
    const isoDate = '2026-03-15T23:59:59.999Z';
    // The local date depends on timezone, but it should not throw
    const result = isDateBetween(isoDate, '2026-03-01', '2026-03-31');
    expect(typeof result).toBe('boolean');
  });

  it('handles mixed formats (ISO date with YYYY-MM-DD range)', () => {
    // Create an ISO string that's definitely mid-month in any timezone
    const isoDate = '2026-03-15T12:00:00.000Z';
    expect(isDateBetween(isoDate, '2026-03-01', '2026-03-31')).toBe(true);
  });

  it('correctly excludes cross-month dates', () => {
    // February date should not be in March range
    expect(isDateBetween('2026-02-15', '2026-03-01', '2026-03-31')).toBe(false);
    // April date should not be in March range
    expect(isDateBetween('2026-04-15', '2026-03-01', '2026-03-31')).toBe(false);
  });

  it('works with single-day range', () => {
    expect(isDateBetween('2026-03-15', '2026-03-15', '2026-03-15')).toBe(true);
    expect(isDateBetween('2026-03-14', '2026-03-15', '2026-03-15')).toBe(false);
    expect(isDateBetween('2026-03-16', '2026-03-15', '2026-03-15')).toBe(false);
  });
});

describe('formatTime12', () => {
  it('returns empty string for empty input', () => {
    expect(formatTime12('')).toBe('');
  });

  it('formats morning time with minutes', () => {
    expect(formatTime12('09:30')).toBe('9:30am');
  });

  it('formats afternoon time with minutes', () => {
    expect(formatTime12('14:15')).toBe('2:15pm');
  });

  it('omits minutes when they are :00', () => {
    expect(formatTime12('15:00')).toBe('3pm');
    expect(formatTime12('09:00')).toBe('9am');
  });

  it('formats noon correctly', () => {
    expect(formatTime12('12:00')).toBe('12pm');
    expect(formatTime12('12:30')).toBe('12:30pm');
  });

  it('formats midnight correctly', () => {
    expect(formatTime12('00:00')).toBe('12am');
    expect(formatTime12('00:15')).toBe('12:15am');
  });
});

describe('formatDayLong', () => {
  it('formats as "DayName, D MonthName Year"', () => {
    // 2026-04-10 is a Friday
    expect(formatDayLong('2026-04-10')).toBe('Friday, 10 April 2026');
  });

  it('handles single-digit days', () => {
    // 2026-03-01 is a Sunday
    expect(formatDayLong('2026-03-01')).toBe('Sunday, 1 March 2026');
  });

  it('handles year boundaries', () => {
    // 2026-01-01 is a Thursday
    expect(formatDayLong('2026-01-01')).toBe('Thursday, 1 January 2026');
  });
});

describe('formatLogEntryTime', () => {
  // Anchor "now" to a known moment so all branches are deterministic.
  // Wed, 27 Apr 2026 at 14:00:00 local. Use a local-time string (no Z)
  // so the test isn't sensitive to the runner's timezone — matches the
  // pattern used in useCriticalItems.test.ts.
  const NOW = new Date(2026, 3, 27, 14, 0, 0); // April = month 3 (0-indexed)

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // Build a local-time ISO-like string from y/m/d/h/min(/sec) so each
  // test's intent is unambiguous regardless of the runner's timezone.
  function localISO(
    y: number,
    m: number,
    d: number,
    h: number,
    min: number,
    sec: number = 0
  ): string {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${y}-${pad(m)}-${pad(d)}T${pad(h)}:${pad(min)}:${pad(sec)}.000`;
  }

  // ── Today branch (relative) ──
  it('returns "just now" for sub-minute differences', () => {
    // 30 seconds ago — fakeTimer is anchored at 14:00:00 sharp.
    expect(formatLogEntryTime(localISO(2026, 4, 27, 13, 59, 30))).toBe('just now');
  });

  it('returns "Xm ago" for sub-hour differences', () => {
    expect(formatLogEntryTime(localISO(2026, 4, 27, 13, 30))).toBe('30m ago');
    expect(formatLogEntryTime(localISO(2026, 4, 27, 13, 1))).toBe('59m ago');
  });

  it('returns "Xh ago" for sub-day differences when same calendar day', () => {
    expect(formatLogEntryTime(localISO(2026, 4, 27, 8, 0))).toBe('6h ago');
    expect(formatLogEntryTime(localISO(2026, 4, 27, 0, 0))).toBe('14h ago');
  });

  // ── Yesterday branch ──
  it('returns "Yesterday at <time>" for prior calendar day', () => {
    expect(formatLogEntryTime(localISO(2026, 4, 26, 20, 30))).toBe('Yesterday at 8:30pm');
    expect(formatLogEntryTime(localISO(2026, 4, 26, 8, 30))).toBe('Yesterday at 8:30am');
  });

  it('puts a 23:30 timestamp from yesterday in "Yesterday" not "Xh ago"', () => {
    // 14.5h ago — but on a prior calendar day → should say Yesterday.
    expect(formatLogEntryTime(localISO(2026, 4, 26, 23, 30))).toBe('Yesterday at 11:30pm');
  });

  // ── This week branch ──
  it('returns "DOW at <time>" for entries 2-6 days ago', () => {
    // April 2026: Apr 21 was Tuesday, Apr 22 Wed, Apr 23 Thu, Apr 24 Fri, Apr 25 Sat, Apr 26 Sun
    expect(formatLogEntryTime(localISO(2026, 4, 25, 20, 30))).toBe('Sat at 8:30pm');
    expect(formatLogEntryTime(localISO(2026, 4, 22, 8, 30))).toBe('Wed at 8:30am');
    // 6 days ago (Tue Apr 21) — boundary
    expect(formatLogEntryTime(localISO(2026, 4, 21, 8, 30))).toBe('Tue at 8:30am');
  });

  // ── Same-year branch ──
  it('returns "DOW, D Mon at <time>" for older entries in same year', () => {
    // 7+ days ago, same year — Apr 20, 2026 is a Monday
    expect(formatLogEntryTime(localISO(2026, 4, 20, 8, 30))).toBe('Mon, 20 Apr at 8:30am');
    // Earlier in the year. formatTime12 elides ":00" for whole hours.
    expect(formatLogEntryTime(localISO(2026, 1, 15, 14, 0))).toBe('Thu, 15 Jan at 2pm');
  });

  // ── Prior-year branch ──
  it('returns "DOW, D Mon YYYY at <time>" for entries in prior years', () => {
    expect(formatLogEntryTime(localISO(2025, 4, 21, 8, 30))).toBe('Mon, 21 Apr 2025 at 8:30am');
    expect(formatLogEntryTime(localISO(2024, 12, 25, 14, 0))).toBe('Wed, 25 Dec 2024 at 2pm');
  });
});

describe('formatBirthdayShort', () => {
  it('returns "D Mon" for a valid DateOfBirth (year present)', () => {
    expect(formatBirthdayShort({ month: 5, day: 14, year: 1985 })).toBe('14 May');
  });

  it('returns "D Mon" for a valid DateOfBirth (year absent)', () => {
    expect(formatBirthdayShort({ month: 12, day: 1 })).toBe('1 Dec');
  });

  it('returns empty string when input is undefined or null', () => {
    expect(formatBirthdayShort(undefined)).toBe('');
    expect(formatBirthdayShort(null)).toBe('');
  });

  it('returns empty string when month or day is missing or out of range', () => {
    expect(formatBirthdayShort({ month: 0, day: 5 })).toBe('');
    expect(formatBirthdayShort({ month: 13, day: 5 })).toBe('');
    expect(formatBirthdayShort({ month: 5 } as unknown as { month: number; day: number })).toBe('');
  });
});

describe('getWeekdayOrdinalInMonth', () => {
  // May 2026: Fridays fall on 1, 8, 15, 22, 29 (5 of them).
  // Wednesdays fall on 6, 13, 20, 27 (4 of them).
  it('returns 1..4 for the first four occurrences of the weekday', () => {
    expect(getWeekdayOrdinalInMonth(new Date(2026, 4, 1))).toBe(1); // 1st Friday
    expect(getWeekdayOrdinalInMonth(new Date(2026, 4, 8))).toBe(2); // 2nd Friday
    expect(getWeekdayOrdinalInMonth(new Date(2026, 4, 15))).toBe(3); // 3rd Friday
    expect(getWeekdayOrdinalInMonth(new Date(2026, 4, 22))).toBe(4); // 4th Friday

    expect(getWeekdayOrdinalInMonth(new Date(2026, 4, 6))).toBe(1); // 1st Wednesday
    expect(getWeekdayOrdinalInMonth(new Date(2026, 4, 13))).toBe(2); // 2nd Wednesday
    expect(getWeekdayOrdinalInMonth(new Date(2026, 4, 20))).toBe(3); // 3rd Wednesday
    expect(getWeekdayOrdinalInMonth(new Date(2026, 4, 27))).toBe(4); // 4th Wednesday
  });

  it('coerces the 5th occurrence to -1 ("last")', () => {
    // May 29 2026 is the 5th Friday — should round-trip as -1.
    expect(getWeekdayOrdinalInMonth(new Date(2026, 4, 29))).toBe(-1);

    // Also: July 31 2026 is the 5th Friday.
    expect(getWeekdayOrdinalInMonth(new Date(2026, 6, 31))).toBe(-1);
  });

  it('throws on invalid date', () => {
    expect(() => getWeekdayOrdinalInMonth(new Date('not a date'))).toThrow();
  });
});

describe('nthWeekdayOfMonth', () => {
  it('returns the Nth weekday for a given ordinal', () => {
    // 2nd Wednesday of June 2026 is June 10.
    expect(nthWeekdayOfMonth(new Date(2026, 5, 1), 2, 3).getDate()).toBe(10);
    // 1st Friday of June 2026 is June 5.
    expect(nthWeekdayOfMonth(new Date(2026, 5, 1), 1, 5).getDate()).toBe(5);
    // 4th Monday of June 2026 is June 22.
    expect(nthWeekdayOfMonth(new Date(2026, 5, 15), 4, 1).getDate()).toBe(22);
  });

  it('returns the LAST weekday of the month for ordinal -1', () => {
    // Last Wednesday of June 2026 is June 24.
    expect(nthWeekdayOfMonth(new Date(2026, 5, 1), -1, 3).getDate()).toBe(24);
    // Last Saturday of June 2026 is June 27.
    expect(nthWeekdayOfMonth(new Date(2026, 5, 1), -1, 6).getDate()).toBe(27);
    // Last Friday of June 2026 is June 26.
    expect(nthWeekdayOfMonth(new Date(2026, 5, 1), -1, 5).getDate()).toBe(26);
  });

  it('handles 28-day February (non-leap) correctly', () => {
    // Feb 2026 is non-leap (28 days). Last Saturday is Feb 28.
    expect(nthWeekdayOfMonth(new Date(2026, 1, 1), -1, 6).getDate()).toBe(28);
    // 4th Wednesday of Feb 2026 is Feb 25.
    expect(nthWeekdayOfMonth(new Date(2026, 1, 1), 4, 3).getDate()).toBe(25);
  });

  it('handles 29-day February (leap year) correctly', () => {
    // Feb 2028 is a leap year (29 days). Last Tuesday is Feb 29.
    expect(nthWeekdayOfMonth(new Date(2028, 1, 1), -1, 2).getDate()).toBe(29);
  });

  it('handles months with 5 occurrences of a weekday', () => {
    // May 2026 has 5 Fridays — last is May 29.
    expect(nthWeekdayOfMonth(new Date(2026, 4, 1), -1, 5).getDate()).toBe(29);
  });

  it('throws on invalid inputs', () => {
    expect(() => nthWeekdayOfMonth(new Date('bad'), 1, 0)).toThrow();
    expect(() => nthWeekdayOfMonth(new Date(2026, 5, 1), 1, 7)).toThrow();
    expect(() => nthWeekdayOfMonth(new Date(2026, 5, 1), 1, -1)).toThrow();
    expect(() => nthWeekdayOfMonth(new Date(2026, 5, 1), 0 as 1, 3)).toThrow();
  });
});

describe('formatCreatedAt', () => {
  it('formats an ISO timestamp as "D Mon YYYY at h:mm(am|pm)" in local time', () => {
    // Constructed via the local Date ctor + read back via local getters, so
    // the assertion is independent of the runner's timezone.
    const iso = new Date(2026, 3, 21, 8, 30).toISOString(); // 21 Apr 2026, 08:30 local
    expect(formatCreatedAt(iso)).toBe('21 Apr 2026 at 8:30am');
  });

  it('omits minutes when the time is on the hour', () => {
    const iso = new Date(2026, 0, 5, 15, 0).toISOString(); // 5 Jan 2026, 15:00 local
    expect(formatCreatedAt(iso)).toBe('5 Jan 2026 at 3pm');
  });

  it('returns an empty string for an unparseable input', () => {
    expect(formatCreatedAt('not-a-date')).toBe('');
  });
});

describe('relativeDayLabel', () => {
  // Stub translator: returns the relative-day words, passes anything else through.
  const t = (key: UIStringKey): string =>
    (
      ({
        'date.today': 'Today',
        'date.tomorrow': 'Tomorrow',
        'date.yesterday': 'Yesterday',
      }) as Record<string, string>
    )[key] ?? key;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 3, 21, 12, 0, 0)); // Tue 21 Apr 2026, local noon
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('labels today / tomorrow / yesterday relative to the system clock', () => {
    expect(relativeDayLabel('2026-04-21', t)).toBe('Today');
    expect(relativeDayLabel('2026-04-22', t)).toBe('Tomorrow');
    expect(relativeDayLabel('2026-04-20', t)).toBe('Yesterday');
  });

  it('falls back to formatNookDate for any other day', () => {
    expect(relativeDayLabel('2026-04-10', t)).toBe(formatNookDate('2026-04-10'));
  });

  it('derives "today" one-shot from the clock at call time (non-reactive)', () => {
    // 2026-04-21 is "today" right now…
    expect(relativeDayLabel('2026-04-21', t)).toBe('Today');
    // …advance the clock a day; the SAME date must now read as "Yesterday",
    // proving the helper re-reads the system clock on each call rather than
    // capturing a fixed or reactive "today".
    vi.setSystemTime(new Date(2026, 3, 22, 12, 0, 0));
    expect(relativeDayLabel('2026-04-21', t)).toBe('Yesterday');
  });
});
