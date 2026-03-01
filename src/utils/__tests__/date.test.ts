import { describe, it, expect } from 'vitest';
import { isDateBetween, toDateInputValue, parseLocalDate } from '../date';

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
