import { describe, it, expect } from 'vitest';
import { cadenceOf, cadenceToRule, cadenceKey, ruleKey, isOccurrence } from '../cadence';
import type { Cadence, RecurrenceRule } from '@/types/recurrence';

const never = { kind: 'never' } as const;

describe('cadenceOf / cadenceToRule', () => {
  it('strips the end and round-trips through a never-ending rule', () => {
    const rule: RecurrenceRule = {
      unit: 'month',
      interval: 2,
      monthlyAnchor: 'date',
      monthlyDay: 'last',
      end: { kind: 'afterCount', count: 4 },
    };
    const cadence = cadenceOf(rule);
    expect(cadence).toEqual({
      unit: 'month',
      interval: 2,
      monthlyAnchor: 'date',
      monthlyDay: 'last',
    });
    expect('end' in cadence).toBe(false);
    expect(cadenceToRule(cadence)).toEqual({ ...cadence, end: never });
  });

  it('does not mutate the source rule', () => {
    const rule: RecurrenceRule = { unit: 'week', interval: 1, weekdays: [3], end: never };
    cadenceOf(rule);
    expect(rule.end).toEqual(never);
  });
});

describe('cadenceKey', () => {
  it('is independent of object key order and weekday order', () => {
    const a: Cadence = { unit: 'week', interval: 1, weekdays: [5, 1, 3] };
    const b: Cadence = { weekdays: [1, 3, 5], interval: 1, unit: 'week' };
    expect(cadenceKey(a)).toBe(cadenceKey(b));
  });

  it('treats a missing weekday list like an empty one, and differs on any field', () => {
    expect(cadenceKey({ unit: 'week', interval: 1 })).toBe(
      cadenceKey({ unit: 'week', interval: 1, weekdays: [] })
    );
    const base: Cadence = { unit: 'month', interval: 1, monthlyAnchor: 'date', monthlyDay: 1 };
    expect(cadenceKey(base)).not.toBe(cadenceKey({ ...base, interval: 2 }));
    expect(cadenceKey(base)).not.toBe(cadenceKey({ ...base, monthlyDay: 2 }));
    expect(cadenceKey(base)).not.toBe(cadenceKey({ ...base, monthlyAnchor: 'weekday' }));
  });

  it('does not sort the caller weekday array in place', () => {
    const weekdays = [5, 1];
    cadenceKey({ unit: 'week', interval: 1, weekdays });
    expect(weekdays).toEqual([5, 1]);
  });
});

describe('ruleKey', () => {
  const cadence: Cadence = { unit: 'day', interval: 1 };
  it('distinguishes ends', () => {
    const keys = new Set([
      ruleKey({ ...cadence, end: never }),
      ruleKey({ ...cadence, end: { kind: 'onDate', date: '2026-12-31' } }),
      ruleKey({ ...cadence, end: { kind: 'onDate', date: '2027-01-31' } }),
      ruleKey({ ...cadence, end: { kind: 'afterCount', count: 3 } }),
      ruleKey({ ...cadence, end: { kind: 'afterCount', count: 4 } }),
    ]);
    expect(keys.size).toBe(5);
  });

  it('is order-independent like cadenceKey', () => {
    expect(ruleKey({ unit: 'week', interval: 1, weekdays: [3, 1], end: never })).toBe(
      ruleKey({ end: never, weekdays: [1, 3], interval: 1, unit: 'week' })
    );
  });
});

describe('isOccurrence', () => {
  // 2026-10-07 is a Wednesday.
  const weeklyWed: RecurrenceRule = { unit: 'week', interval: 1, weekdays: [3], end: never };

  it('is true on rule dates and false off them', () => {
    expect(isOccurrence(weeklyWed, '2026-10-07', '2026-10-07')).toBe(true);
    expect(isOccurrence(weeklyWed, '2026-10-07', '2026-10-21')).toBe(true);
    expect(isOccurrence(weeklyWed, '2026-10-07', '2026-10-08')).toBe(false);
  });

  it('honours every-N-weeks parity from the anchor', () => {
    const fortnightly: RecurrenceRule = { ...weeklyWed, interval: 2 };
    expect(isOccurrence(fortnightly, '2026-10-07', '2026-10-21')).toBe(true);
    expect(isOccurrence(fortnightly, '2026-10-07', '2026-10-14')).toBe(false);
  });

  it('honours the rule end', () => {
    const twice: RecurrenceRule = { ...weeklyWed, end: { kind: 'afterCount', count: 2 } };
    expect(isOccurrence(twice, '2026-10-07', '2026-10-14')).toBe(true);
    expect(isOccurrence(twice, '2026-10-07', '2026-10-21')).toBe(false);
  });
});
