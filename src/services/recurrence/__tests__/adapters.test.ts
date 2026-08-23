import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  resolveTransactionRule,
  resolveActivityRule,
  legacyShadowFromRule,
  activityShadowFromRule,
} from '../adapters';
import { logEvent } from '@/services/telemetry/logEvent';
import type { Cadence } from '@/types/recurrence';
import { monthlyFactor } from '../recurrenceEngine';

vi.mock('@/services/telemetry/logEvent', () => ({ logEvent: vi.fn() }));
import { describeRule } from '../describe';
import type { RecurringItem } from '@/types/models';
import type { RecurrenceRule } from '@/types/recurrence';
import type { UIStringKey } from '@/services/translation/uiStrings';

const EN: Partial<Record<string, string>> = {
  'recurrence.desc.daily': 'every day',
  'recurrence.desc.everyNDays': 'every {n} days',
  'recurrence.desc.weeklyOn': 'weekly on {days}',
  'recurrence.desc.everyNWeeksOn': 'every {n} weeks on {days}',
  'recurrence.desc.monthlyOnDate': 'monthly on the {date}',
  'recurrence.desc.everyNMonthsOnDate': 'every {n} months on the {date}',
  'recurrence.desc.monthlyOnDay': 'monthly on the {ordinal} {day}',
  'recurrence.desc.everyNMonthsOnDay': 'every {n} months on the {ordinal} {day}',
  'recurrence.desc.yearlyOn': 'every year on {date}',
  'recurrence.desc.everyNYearsOn': 'every {n} years on {date}',
  'recurrence.desc.lastDay': 'last day',
  'recurrence.desc.untilDate': 'until {date}',
  'recurrence.desc.timesN': '{n} times',
  'planner.weekday.short.sun': 'Sun',
  'planner.weekday.short.mon': 'Mon',
  'planner.weekday.short.tue': 'Tue',
  'planner.weekday.short.wed': 'Wed',
  'planner.weekday.short.thu': 'Thu',
  'planner.weekday.short.fri': 'Fri',
  'planner.weekday.short.sat': 'Sat',
};
const t = (k: UIStringKey): string => EN[k] ?? k;

const base: RecurringItem = {
  id: 'r1',
  accountId: 'a1',
  type: 'income',
  amount: 100,
  currency: 'USD',
  category: 'salary',
  description: 'Pay',
  frequency: 'daily',
  dayOfMonth: 1,
  startDate: '2026-08-23',
  isActive: true,
  createdAt: '2026-08-23',
  updatedAt: '2026-08-23',
};

describe('resolveTransactionRule — legacy adapter', () => {
  it('daily', () => {
    expect(resolveTransactionRule({ ...base, frequency: 'daily' })).toEqual({
      rule: { unit: 'day', interval: 1, end: { kind: 'never' } },
      anchor: '2026-08-23',
    });
  });

  it('monthly maps dayOfMonth to a date anchor', () => {
    expect(resolveTransactionRule({ ...base, frequency: 'monthly', dayOfMonth: 15 })).toEqual({
      rule: {
        unit: 'month',
        interval: 1,
        monthlyAnchor: 'date',
        monthlyDay: 15,
        end: { kind: 'never' },
      },
      anchor: '2026-08-23',
    });
  });

  it('yearly rebuilds the anchor from monthOfYear + dayOfMonth', () => {
    const res = resolveTransactionRule({
      ...base,
      frequency: 'yearly',
      monthOfYear: 3,
      dayOfMonth: 10,
      startDate: '2026-08-23',
    });
    expect(res!.rule).toEqual({ unit: 'year', interval: 1, end: { kind: 'never' } });
    expect(res!.anchor).toBe('2026-03-10');
  });

  it('endDate becomes an onDate end', () => {
    const res = resolveTransactionRule({ ...base, frequency: 'daily', endDate: '2026-12-31' });
    expect(res!.rule.end).toEqual({ kind: 'onDate', date: '2026-12-31' });
  });

  it('a rule-bearing item is authoritative (legacy fields ignored)', () => {
    const rule: RecurrenceRule = {
      unit: 'week',
      interval: 2,
      weekdays: [1],
      end: { kind: 'never' },
    };
    const res = resolveTransactionRule({ ...base, frequency: 'monthly', dayOfMonth: 5, rule });
    expect(res!.rule).toBe(rule);
    expect(res!.anchor).toBe('2026-08-23');
  });
});

describe('legacyShadowFromRule — inert schema shim', () => {
  it("normalizes 'last' to day 31 rather than falling through to the placeholder", () => {
    // `'last'` is a label variant of day 31 (see RecurrenceRule.monthlyDay). Before
    // #70's clamp it failed the `typeof === 'number'` gate and shadowed as
    // dayOfMonth: min(anchorDay, 28) — a wrong shadow for a monthly rule.
    expect(
      legacyShadowFromRule(
        {
          unit: 'month',
          interval: 1,
          monthlyAnchor: 'date',
          monthlyDay: 'last',
          end: { kind: 'never' },
        },
        '2026-08-23'
      )
    ).toEqual({ frequency: 'monthly', dayOfMonth: 31 });
  });

  it('representable rules map accurately', () => {
    expect(
      legacyShadowFromRule({ unit: 'day', interval: 1, end: { kind: 'never' } }, '2026-08-23')
    ).toEqual({
      frequency: 'daily',
      dayOfMonth: 23,
    });
    expect(
      legacyShadowFromRule(
        {
          unit: 'month',
          interval: 1,
          monthlyAnchor: 'date',
          monthlyDay: 15,
          end: { kind: 'never' },
        },
        '2026-08-23'
      )
    ).toEqual({ frequency: 'monthly', dayOfMonth: 15 });
  });
});

describe('describeRule — canonical summary', () => {
  const A = '2026-08-23'; // Sunday, 23rd, 4th Sunday
  const d = (rule: RecurrenceRule) => describeRule(rule, A, t);

  it('daily / every N days', () => {
    expect(d({ unit: 'day', interval: 1, end: { kind: 'never' } })).toBe('every day');
    expect(d({ unit: 'day', interval: 3, end: { kind: 'never' } })).toBe('every 3 days');
  });
  it('weekly multi-day', () => {
    expect(d({ unit: 'week', interval: 1, weekdays: [1, 3], end: { kind: 'never' } })).toBe(
      'weekly on Mon, Wed'
    );
  });
  it('biweekly defaults to the anchor weekday', () => {
    expect(d({ unit: 'week', interval: 2, end: { kind: 'never' } })).toBe('every 2 weeks on Sun');
  });
  it('monthly on date / last / nth weekday', () => {
    expect(
      d({
        unit: 'month',
        interval: 1,
        monthlyAnchor: 'date',
        monthlyDay: 23,
        end: { kind: 'never' },
      })
    ).toBe('monthly on the 23rd');
    expect(
      d({
        unit: 'month',
        interval: 1,
        monthlyAnchor: 'date',
        monthlyDay: 'last',
        end: { kind: 'never' },
      })
    ).toBe('monthly on the last day');
    expect(
      d({ unit: 'month', interval: 1, monthlyAnchor: 'weekday', end: { kind: 'never' } })
    ).toBe('monthly on the 4th Sun');
  });
  it('yearly', () => {
    expect(d({ unit: 'year', interval: 1, end: { kind: 'never' } })).toBe('every year on 23 Aug');
  });
  it('appends the end clause', () => {
    expect(d({ unit: 'day', interval: 1, end: { kind: 'afterCount', count: 12 } })).toBe(
      'every day · 12 times'
    );
    expect(d({ unit: 'day', interval: 1, end: { kind: 'onDate', date: '2026-12-31' } })).toBe(
      'every day · until 31 Dec 2026'
    );
  });
});

describe('resolver contract — one shape across all surfaces (#70)', () => {
  beforeEach(() => vi.mocked(logEvent).mockClear());

  const activity = {
    recurrence: 'weekly' as const,
    date: '2026-08-23',
    daysOfWeek: [1, 3],
    recurrenceEndDate: undefined,
    rule: undefined,
  };

  it('every resolver returns { rule, anchor } for a recurring entity', () => {
    const tx = resolveTransactionRule({ ...base, frequency: 'daily' });
    const act = resolveActivityRule(activity);
    for (const r of [tx, act]) {
      expect(r).not.toBeNull();
      expect(r!.rule).toBeDefined();
      expect(r!.anchor).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it('returns null — never undefined — for a one-time activity', () => {
    const r = resolveActivityRule({ ...activity, recurrence: 'none' });
    expect(r).toBeNull();
    // A one-time activity is not an error: nothing is logged.
    expect(logEvent).not.toHaveBeenCalled();
  });

  it('an unmappable stored recurrence logs rule-adapter-fallback and returns null', () => {
    // Simulates legacy/corrupt `.beanpod` data. Before #70 this fell off the end
    // of the switch and returned `undefined` while the signature promised
    // `ResolvedRule | null` — callers degraded silently with no trace.
    const r = resolveActivityRule({
      ...activity,
      recurrence: 'fortnightly-ish' as unknown as typeof activity.recurrence,
    });
    expect(r).toBeNull();
    expect(logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'warn',
        surface: 'recurrence',
        message: 'rule-adapter-fallback',
        context: { recur_surface: 'activity', recur_reason: 'unknown-recurrence' },
      })
    );
  });

  it('an unmappable transaction frequency reports instead of silently defaulting', () => {
    // It used to resolve to DAILY here while recurringStore defaulted the same
    // input to MONTHLY — a silent 30x disagreement on one item.
    const r = resolveTransactionRule({
      ...base,
      frequency: 'fortnightly' as unknown as typeof base.frequency,
    });
    expect(r).toBeNull();
    expect(logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'rule-adapter-fallback',
        context: { recur_surface: 'transaction', recur_reason: 'unknown-frequency' },
      })
    );
  });
});

describe('shadow fidelity contract (#70)', () => {
  // The contract in adapters.ts fixes WHICH shadow fields a not-yet-converted
  // reader may trust. A reader must become rule-aware iff it depends on a LOSSY
  // field — that is what justifies leaving `reconcilePlan.activityInWindow`
  // alone. If this matrix changes, that justification changes with it.
  const rules = [
    { name: 'weekly multi-day', rule: { unit: 'week', interval: 1, weekdays: [1, 3] } },
    { name: 'every 3 weeks', rule: { unit: 'week', interval: 3, weekdays: [2] } },
    {
      name: 'monthly by date',
      rule: { unit: 'month', interval: 1, monthlyAnchor: 'date', monthlyDay: 15 },
    },
    { name: 'monthly by weekday', rule: { unit: 'month', interval: 1, monthlyAnchor: 'weekday' } },
    { name: 'yearly', rule: { unit: 'year', interval: 1 } },
  ] satisfies { name: string; rule: Cadence }[];

  describe.each(rules)('$name', ({ rule }) => {
    it("FAITHFUL: recurrence is never 'none' for a real rule", () => {
      const shadow = activityShadowFromRule({ ...rule, end: { kind: 'never' } });
      expect(shadow.recurrence).not.toBe('none');
    });

    it('FAITHFUL: recurrenceEndDate is written iff the end is a date', () => {
      expect(
        activityShadowFromRule({ ...rule, end: { kind: 'never' } }).recurrenceEndDate
      ).toBeUndefined();
      expect(
        activityShadowFromRule({ ...rule, end: { kind: 'afterCount', count: 5 } }).recurrenceEndDate
      ).toBeUndefined();
      expect(
        activityShadowFromRule({ ...rule, end: { kind: 'onDate', date: '2026-12-31' } })
          .recurrenceEndDate
      ).toBe('2026-12-31');
    });

    it("FAITHFUL: frequency is 'yearly' iff the unit is year", () => {
      const shadow = legacyShadowFromRule({ ...rule, end: { kind: 'never' } }, '2026-08-23');
      expect(shadow.frequency === 'yearly').toBe(rule.unit === 'year');
    });
  });

  it('LOSSY: an every-3-weeks rule shadows as biweekly, NOT weekly', () => {
    // The bug this pins: `interval !== 2` used to fall through to 'weekly' WITH
    // weekdays, so an every-3-weeks activity displayed, linked and billed as
    // weekly wherever the shadow was read.
    const shadow = activityShadowFromRule({
      unit: 'week',
      interval: 3,
      weekdays: [2],
      end: { kind: 'never' },
    });
    expect(shadow.recurrence).toBe('biweekly');
    expect(shadow.daysOfWeek).toBeUndefined();
  });
});

describe('shadow regressions caught in review (#70)', () => {
  it('ALWAYS assigns daysOfWeek so a diff can clear a stale weekday set', () => {
    // `diffPayload` iterates Object.keys(next) — an ABSENT key means "leave
    // untouched". Omitting it stranded `[1,3]` on an activity edited from weekly
    // to monthly, which then permanently refused a series-scope move.
    for (const rule of [
      { unit: 'day', interval: 1 },
      { unit: 'month', interval: 1, monthlyAnchor: 'date', monthlyDay: 12 },
      { unit: 'year', interval: 1 },
      { unit: 'week', interval: 3, weekdays: [2] },
    ] satisfies Cadence[]) {
      const shadow = activityShadowFromRule({ ...rule, end: { kind: 'never' } });
      expect('daysOfWeek' in shadow).toBe(true);
      expect(shadow.daysOfWeek).toBeUndefined();
    }
  });

  it("an every-N-years rule does not claim the FAITHFUL 'yearly' frequency", () => {
    // The contract promises `frequency === 'yearly'` iff `unit === 'year'` AND
    // `interval === 1`. Readers are allowed to trust that one, so an every-2-years
    // rule must not satisfy it.
    expect(
      legacyShadowFromRule({ unit: 'year', interval: 2, end: { kind: 'never' } }, '2026-08-15')
        .frequency
    ).not.toBe('yearly');
  });

  it('an every-N-months rule is protected by the RULE winning, not by its shadow', () => {
    // There is no faithful three-value shadow for "every 3 months" — the enum
    // cannot express it, which is exactly why the contract marks the frequency
    // KIND lossy. What protects the user is that every in-app reader resolves
    // the rule first, so the quarterly cadence survives regardless of the
    // shadow it carries for pre-#70 clients.
    const rule = {
      unit: 'month',
      interval: 3,
      monthlyAnchor: 'date',
      monthlyDay: 15,
      end: { kind: 'never' },
    } as const;
    const shadow = legacyShadowFromRule(rule, '2026-08-15');
    const resolved = resolveTransactionRule({
      ...base,
      frequency: shadow.frequency,
      dayOfMonth: shadow.dayOfMonth,
      rule,
    });
    expect(resolved!.rule.interval).toBe(3);
    // And the monthly-equivalent normalization follows the rule, not the shadow.
    expect(monthlyFactor(resolved!.rule)).toBeCloseTo(1 / 3, 5);
  });
});
