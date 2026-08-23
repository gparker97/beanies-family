import { describe, it, expect } from 'vitest';
import { resolveRecurringItemRule, legacyShadowFromRule } from '../adapters';
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

describe('resolveRecurringItemRule — legacy adapter', () => {
  it('daily', () => {
    expect(resolveRecurringItemRule({ ...base, frequency: 'daily' })).toEqual({
      rule: { unit: 'day', interval: 1, end: { kind: 'never' } },
      anchor: '2026-08-23',
    });
  });

  it('monthly maps dayOfMonth to a date anchor', () => {
    expect(resolveRecurringItemRule({ ...base, frequency: 'monthly', dayOfMonth: 15 })).toEqual({
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
    const res = resolveRecurringItemRule({
      ...base,
      frequency: 'yearly',
      monthOfYear: 3,
      dayOfMonth: 10,
      startDate: '2026-08-23',
    });
    expect(res.rule).toEqual({ unit: 'year', interval: 1, end: { kind: 'never' } });
    expect(res.anchor).toBe('2026-03-10');
  });

  it('endDate becomes an onDate end', () => {
    const res = resolveRecurringItemRule({ ...base, frequency: 'daily', endDate: '2026-12-31' });
    expect(res.rule.end).toEqual({ kind: 'onDate', date: '2026-12-31' });
  });

  it('a rule-bearing item is authoritative (legacy fields ignored)', () => {
    const rule: RecurrenceRule = {
      unit: 'week',
      interval: 2,
      weekdays: [1],
      end: { kind: 'never' },
    };
    const res = resolveRecurringItemRule({ ...base, frequency: 'monthly', dayOfMonth: 5, rule });
    expect(res.rule).toBe(rule);
    expect(res.anchor).toBe('2026-08-23');
  });
});

describe('legacyShadowFromRule — inert schema shim', () => {
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
