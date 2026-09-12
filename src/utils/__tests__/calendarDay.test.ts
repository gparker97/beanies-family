import { describe, it, expect } from 'vitest';
import { sleepsUntil, sortDayExtras, dayExtrasByDate, type DayExtra } from '../calendarDay';

const extra = (over: Partial<DayExtra> = {}): DayExtra => ({
  kind: 'holiday',
  id: 'x',
  ymd: '2026-09-15',
  label: 'X',
  ...over,
});

describe('sleepsUntil', () => {
  it('counts forward', () => {
    expect(sleepsUntil('2026-09-12', '2026-09-19')).toBe(7);
  });

  it('is 0 today and 1 tomorrow', () => {
    expect(sleepsUntil('2026-09-12', '2026-09-12')).toBe(0);
    expect(sleepsUntil('2026-09-12', '2026-09-13')).toBe(1);
  });

  it('goes negative for a past date rather than clamping', () => {
    expect(sleepsUntil('2026-09-19', '2026-09-12')).toBe(-7);
  });

  it('survives a DST boundary, because it does no local-time arithmetic', () => {
    // Northern-hemisphere clocks change on 2026-10-25; a naive (t2-t1)/86400000
    // on local Dates yields 6.958 and rounds inconsistently across engines.
    expect(sleepsUntil('2026-10-24', '2026-10-31')).toBe(7);
    expect(sleepsUntil('2026-03-28', '2026-04-04')).toBe(7);
  });

  it('crosses a year boundary', () => {
    expect(sleepsUntil('2026-12-28', '2027-01-04')).toBe(7);
  });
});

describe('sortDayExtras — one order, shared by both calendars', () => {
  it('puts a birthday before a holiday on the same day', () => {
    const sorted = sortDayExtras([
      extra({ kind: 'holiday', id: 'h', label: 'Christmas' }),
      extra({ kind: 'birthday', id: 'b', label: "Joey's birthday" }),
    ]);
    expect(sorted.map((e) => e.kind)).toEqual(['birthday', 'holiday']);
  });

  it('orders by date first', () => {
    const sorted = sortDayExtras([
      extra({ id: 'late', ymd: '2026-09-16' }),
      extra({ id: 'early', ymd: '2026-09-15' }),
    ]);
    expect(sorted.map((e) => e.id)).toEqual(['early', 'late']);
  });

  it('is stable for two of the same kind, by label then id', () => {
    const sorted = sortDayExtras([
      extra({ kind: 'birthday', id: 'z', label: 'Zoe' }),
      extra({ kind: 'birthday', id: 'a', label: 'Amy' }),
    ]);
    expect(sorted.map((e) => e.label)).toEqual(['Amy', 'Zoe']);
  });
});

describe('dayExtrasByDate', () => {
  it('buckets several onto one day', () => {
    const map = dayExtrasByDate([
      extra({ id: 'a' }),
      extra({ id: 'b' }),
      extra({ id: 'c', ymd: '2026-09-16' }),
    ]);
    expect(map.get('2026-09-15')).toHaveLength(2);
    expect(map.get('2026-09-16')).toHaveLength(1);
  });
});
