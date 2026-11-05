import { describe, it, expect } from 'vitest';
import { retargetRuleForAnchor } from '@/services/recurrence/retargetRule';
import type { RecurrenceRule } from '@/types/recurrence';

// 2026-11-04 is a Wednesday; 2026-11-05 a Thursday.
const WED = '2026-11-04';
const THU = '2026-11-05';

describe('retargetRuleForAnchor', () => {
  it('moves an untouched single weekly weekday with the anchor (Wed → Thu)', () => {
    const rule: RecurrenceRule = {
      unit: 'week',
      interval: 1,
      weekdays: [3],
      end: { kind: 'never' },
    };
    expect(retargetRuleForAnchor(rule, WED, THU).weekdays).toEqual([4]);
  });

  it('moves a fortnightly single weekday too', () => {
    const rule: RecurrenceRule = {
      unit: 'week',
      interval: 2,
      weekdays: [3],
      end: { kind: 'never' },
    };
    expect(retargetRuleForAnchor(rule, WED, THU)).toEqual({ ...rule, weekdays: [4] });
  });

  it('leaves a single weekday that is not the old anchor weekday alone', () => {
    const rule: RecurrenceRule = {
      unit: 'week',
      interval: 1,
      weekdays: [1],
      end: { kind: 'never' },
    };
    expect(retargetRuleForAnchor(rule, WED, THU).weekdays).toEqual([1]);
  });

  it('leaves a multi-weekday set alone', () => {
    const rule: RecurrenceRule = {
      unit: 'week',
      interval: 1,
      weekdays: [1, 3],
      end: { kind: 'never' },
    };
    expect(retargetRuleForAnchor(rule, WED, THU)).toEqual(rule);
  });

  it('leaves a weekly rule with no stored weekdays alone (the engine uses the anchor)', () => {
    const rule: RecurrenceRule = { unit: 'week', interval: 1, end: { kind: 'never' } };
    expect(retargetRuleForAnchor(rule, WED, THU)).toEqual(rule);
  });

  it('moves a by-date monthlyDay to the new anchor day', () => {
    const rule: RecurrenceRule = {
      unit: 'month',
      interval: 1,
      monthlyAnchor: 'date',
      monthlyDay: 4,
      end: { kind: 'never' },
    };
    expect(retargetRuleForAnchor(rule, WED, '2026-11-19').monthlyDay).toBe(19);
  });

  it("re-derives a 'last' monthly day from the new anchor", () => {
    const rule: RecurrenceRule = {
      unit: 'month',
      interval: 1,
      monthlyAnchor: 'date',
      monthlyDay: 'last',
      end: { kind: 'never' },
    };
    expect(retargetRuleForAnchor(rule, '2026-01-31', '2026-01-30').monthlyDay).toBe(30);
  });

  it('leaves an nth-weekday monthly rule alone (the ordinal is derived from the anchor)', () => {
    const rule: RecurrenceRule = {
      unit: 'month',
      interval: 1,
      monthlyAnchor: 'weekday',
      end: { kind: 'never' },
    };
    expect(retargetRuleForAnchor(rule, WED, '2026-11-11')).toEqual(rule);
  });

  it('never touches unit, interval or end', () => {
    const rule: RecurrenceRule = {
      unit: 'week',
      interval: 3,
      weekdays: [3],
      end: { kind: 'onDate', date: '2027-01-01' },
    };
    const out = retargetRuleForAnchor(rule, WED, THU);
    expect(out.unit).toBe('week');
    expect(out.interval).toBe(3);
    expect(out.end).toEqual({ kind: 'onDate', date: '2027-01-01' });
    const counted: RecurrenceRule = {
      unit: 'month',
      interval: 2,
      monthlyAnchor: 'date',
      monthlyDay: 4,
      end: { kind: 'afterCount', count: 6 },
    };
    expect(retargetRuleForAnchor(counted, WED, THU)).toEqual({ ...counted, monthlyDay: 5 });
  });

  it('returns the rule unchanged for an unchanged or unreadable anchor', () => {
    const rule: RecurrenceRule = {
      unit: 'week',
      interval: 1,
      weekdays: [3],
      end: { kind: 'never' },
    };
    expect(retargetRuleForAnchor(rule, WED, WED)).toBe(rule);
    expect(retargetRuleForAnchor(rule, '', THU)).toBe(rule);
    expect(retargetRuleForAnchor(rule, WED, 'not-a-date')).toBe(rule);
  });

  it('does not mutate its input', () => {
    const rule: RecurrenceRule = {
      unit: 'week',
      interval: 1,
      weekdays: [3],
      end: { kind: 'never' },
    };
    retargetRuleForAnchor(rule, WED, THU);
    expect(rule.weekdays).toEqual([3]);
  });

  it('accepts full ISO anchors (date part only)', () => {
    const rule: RecurrenceRule = {
      unit: 'week',
      interval: 1,
      weekdays: [3],
      end: { kind: 'never' },
    };
    expect(retargetRuleForAnchor(rule, `${WED}T00:00:00`, `${THU}T00:00:00`).weekdays).toEqual([4]);
  });
});
