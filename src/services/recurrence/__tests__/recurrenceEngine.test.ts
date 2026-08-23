import { describe, it, expect } from 'vitest';
import {
  previewNext,
  occurrencesInRange,
  nextDueAfter,
  firstDueOnOrAfter,
  isResetDue,
  isRuleComplete,
  occurrenceCount,
} from '../recurrenceEngine';
import type { RecurrenceRule, Cadence } from '@/types/recurrence';

// Anchor: Sunday 23 Aug 2026 — the 23rd, and the 4th Sunday of August.
const A = '2026-08-23';
const never = { kind: 'never' } as const;
const rule = (c: Cadence): RecurrenceRule => ({ ...c, end: never });

describe('recurrenceEngine — occurrence generation (golden table)', () => {
  it('daily', () => {
    expect(previewNext(rule({ unit: 'day', interval: 1 }), A, A, 3)).toEqual([
      '2026-08-23',
      '2026-08-24',
      '2026-08-25',
    ]);
  });

  it('every 3 days', () => {
    expect(previewNext(rule({ unit: 'day', interval: 3 }), A, A, 3)).toEqual([
      '2026-08-23',
      '2026-08-26',
      '2026-08-29',
    ]);
  });

  it('weekly, multiple weekdays (Mon + Wed)', () => {
    expect(previewNext(rule({ unit: 'week', interval: 1, weekdays: [1, 3] }), A, A, 4)).toEqual([
      '2026-08-24',
      '2026-08-26',
      '2026-08-31',
      '2026-09-02',
    ]);
  });

  it('every 2 weeks (biweekly), defaults to anchor weekday', () => {
    expect(previewNext(rule({ unit: 'week', interval: 2 }), A, A, 3)).toEqual([
      '2026-08-23',
      '2026-09-06',
      '2026-09-20',
    ]);
  });

  it('every 3 weeks on a chosen weekday (Mon)', () => {
    expect(previewNext(rule({ unit: 'week', interval: 3, weekdays: [1] }), A, A, 3)).toEqual([
      '2026-08-24',
      '2026-09-14',
      '2026-10-05',
    ]);
  });

  it('monthly on the date (23rd)', () => {
    expect(
      previewNext(
        rule({ unit: 'month', interval: 1, monthlyAnchor: 'date', monthlyDay: 23 }),
        A,
        A,
        3
      )
    ).toEqual(['2026-08-23', '2026-09-23', '2026-10-23']);
  });

  it('monthly on the last day', () => {
    expect(
      previewNext(
        rule({ unit: 'month', interval: 1, monthlyAnchor: 'date', monthlyDay: 'last' }),
        A,
        A,
        3
      )
    ).toEqual(['2026-08-31', '2026-09-30', '2026-10-31']);
  });

  it('monthly on the nth weekday (4th Sunday)', () => {
    expect(
      previewNext(rule({ unit: 'month', interval: 1, monthlyAnchor: 'weekday' }), A, A, 3)
    ).toEqual(['2026-08-23', '2026-09-27', '2026-10-25']);
  });

  it('every 2 months on the 15th (skips the passed 15th of the anchor month)', () => {
    expect(
      previewNext(
        rule({ unit: 'month', interval: 2, monthlyAnchor: 'date', monthlyDay: 15 }),
        A,
        A,
        3
      )
    ).toEqual(['2026-10-15', '2026-12-15', '2027-02-15']);
  });

  it('yearly', () => {
    expect(previewNext(rule({ unit: 'year', interval: 1 }), A, A, 3)).toEqual([
      '2026-08-23',
      '2027-08-23',
      '2028-08-23',
    ]);
  });
});

describe('recurrenceEngine — ends', () => {
  it('afterCount stops after N occurrences (counted from anchor)', () => {
    const r: RecurrenceRule = { unit: 'day', interval: 1, end: { kind: 'afterCount', count: 3 } };
    expect(previewNext(r, A, A, 10)).toEqual(['2026-08-23', '2026-08-24', '2026-08-25']);
    // range query still honors the count from the anchor
    expect(occurrencesInRange(r, A, A, '2026-12-31')).toHaveLength(3);
  });

  it('onDate stops at the inclusive end date', () => {
    const r: RecurrenceRule = {
      unit: 'day',
      interval: 1,
      end: { kind: 'onDate', date: '2026-08-25' },
    };
    expect(previewNext(r, A, A, 10)).toEqual(['2026-08-23', '2026-08-24', '2026-08-25']);
  });
});

describe('recurrenceEngine — cursors & ranges', () => {
  it('nextDueAfter returns the first occurrence strictly after the cursor', () => {
    expect(nextDueAfter(rule({ unit: 'week', interval: 2 }), A, '2026-08-23')).toBe('2026-09-06');
  });

  it('firstDueOnOrAfter includes the boundary', () => {
    expect(firstDueOnOrAfter(rule({ unit: 'week', interval: 2 }), A, '2026-09-06')).toBe(
      '2026-09-06'
    );
  });

  it('occurrencesInRange bounds to the window', () => {
    expect(
      occurrencesInRange(
        rule({ unit: 'month', interval: 1, monthlyAnchor: 'date', monthlyDay: 23 }),
        A,
        '2026-09-01',
        '2026-10-31'
      )
    ).toEqual(['2026-09-23', '2026-10-23']);
  });
});

describe('recurrenceEngine — list reset', () => {
  const weekly: Cadence = { unit: 'week', interval: 1, weekdays: [1] }; // Mondays
  it('a reset is due once today reaches the next scheduled occurrence', () => {
    expect(isResetDue(weekly, A, '2026-08-24', '2026-08-30')).toBe(false); // before next Mon (08-31)
    expect(isResetDue(weekly, A, '2026-08-24', '2026-08-31')).toBe(true); // on the next Mon
  });
});

describe('recurrenceEngine — validity', () => {
  it('accepts well-formed rules', () => {
    expect(isRuleComplete({ unit: 'week', interval: 2, weekdays: [1], end: never })).toBe(true);
    expect(
      isRuleComplete({
        unit: 'month',
        interval: 1,
        monthlyAnchor: 'date',
        monthlyDay: 28,
        end: never,
      })
    ).toBe(true);
  });
  it('rejects malformed rules', () => {
    expect(isRuleComplete(null)).toBe(false);
    expect(isRuleComplete({ unit: 'day', interval: 0, end: never })).toBe(false);
    // multi-day weekday with interval >= 2 is not supported
    expect(isRuleComplete({ unit: 'week', interval: 2, weekdays: [1, 3], end: never })).toBe(false);
    // month-on-date out of the 1..31 range (31 is valid — the engine skips
    // months lacking it; 32 is not)
    expect(
      isRuleComplete({
        unit: 'month',
        interval: 1,
        monthlyAnchor: 'date',
        monthlyDay: 31,
        end: never,
      })
    ).toBe(true);
    expect(
      isRuleComplete({
        unit: 'month',
        interval: 1,
        monthlyAnchor: 'date',
        monthlyDay: 32,
        end: never,
      })
    ).toBe(false);
    expect(
      isRuleComplete({ unit: 'day', interval: 1, end: { kind: 'afterCount', count: 0 } })
    ).toBe(false);
  });
});

describe('recurrenceEngine — month-end CLAMP (#70)', () => {
  // greg's decision: a month lacking the chosen day uses that month's LAST day.
  // Skipping is never what a user means by "monthly".
  const monthly = (day: number | 'last'): RecurrenceRule =>
    rule({ unit: 'month', interval: 1, monthlyAnchor: 'date', monthlyDay: day });

  it('the 31st clamps rather than skipping short months', () => {
    expect(previewNext(monthly(31), '2026-01-31', '2026-01-31', 6)).toEqual([
      '2026-01-31',
      '2026-02-28',
      '2026-03-31',
      '2026-04-30',
      '2026-05-31',
      '2026-06-30',
    ]);
  });

  it('the 30th clamps only where the month is shorter', () => {
    expect(previewNext(monthly(30), '2026-01-30', '2026-01-30', 4)).toEqual([
      '2026-01-30',
      '2026-02-28',
      '2026-03-30',
      '2026-04-30',
    ]);
  });

  it('the 29th lands on 29 Feb in a leap year and 28 Feb otherwise', () => {
    // 2028 is a leap year; 2026 is not.
    expect(previewNext(monthly(29), '2026-01-29', '2026-02-01', 1)).toEqual(['2026-02-28']);
    expect(previewNext(monthly(29), '2028-01-29', '2028-02-01', 1)).toEqual(['2028-02-29']);
  });

  it("monthlyDay 31 and 'last' are the same series across 14 months", () => {
    const from = '2026-01-31';
    expect(previewNext(monthly(31), from, from, 14)).toEqual(
      previewNext(monthly('last'), from, from, 14)
    );
  });

  it('clamping also applies with an interval >= 2', () => {
    expect(previewNext(monthly(31), '2026-01-31', '2026-01-31', 3)).not.toContain('2026-03-03');
    const everyTwo: RecurrenceRule = rule({
      unit: 'month',
      interval: 2,
      monthlyAnchor: 'date',
      monthlyDay: 31,
    });
    expect(previewNext(everyTwo, '2026-01-31', '2026-01-31', 3)).toEqual([
      '2026-01-31',
      '2026-03-31',
      '2026-05-31',
    ]);
  });

  it('a clamped month is never dropped from a range', () => {
    // The regression this exists to catch: February vanishing entirely.
    const feb = occurrencesInRange(monthly(31), '2026-01-31', '2026-02-01', '2026-02-28');
    expect(feb).toEqual(['2026-02-28']);
  });
});

describe('occurrenceCount — one place that knows how both ends terminate (#70)', () => {
  it('counts an afterCount series exactly', () => {
    expect(
      occurrenceCount(
        { unit: 'week', interval: 1, weekdays: [1], end: { kind: 'afterCount', count: 6 } },
        A
      )
    ).toBe(6);
  });

  it('counts an onDate series inclusively', () => {
    // Mondays from Mon 24 Aug 2026 through 21 Sep inclusive = 5.
    expect(
      occurrenceCount(
        { unit: 'week', interval: 1, weekdays: [1], end: { kind: 'onDate', date: '2026-09-21' } },
        A
      )
    ).toBe(5);
  });

  it('counts a multi-weekday series', () => {
    // Mon+Wed from Sun 23 Aug through Wed 2 Sep = 24, 26, 31 Aug + 2 Sep = 4.
    expect(
      occurrenceCount(
        {
          unit: 'week',
          interval: 1,
          weekdays: [1, 3],
          end: { kind: 'onDate', date: '2026-09-02' },
        },
        A
      )
    ).toBe(4);
  });

  it('returns null for a never-ending series rather than a guess', () => {
    expect(occurrenceCount(rule({ unit: 'day', interval: 1 }), A)).toBeNull();
  });
});
