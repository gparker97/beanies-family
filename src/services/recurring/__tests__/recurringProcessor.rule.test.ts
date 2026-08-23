import { describe, it, expect } from 'vitest';
import { getDueDatesInRange } from '../recurringProcessor';
import type { RecurringItem } from '@/types/models';
import { toDateInputValue } from '@/utils/date';

// Verifies the #70 dual-path: a rule-bearing RecurringItem projects through the
// canonical engine via the real processor entry point (not the legacy switch).
const base: RecurringItem = {
  id: 'r1',
  accountId: 'a1',
  type: 'income',
  amount: 100,
  currency: 'USD',
  category: 'salary',
  description: 'Paycheck',
  frequency: 'monthly', // legacy shadow — must be ignored when rule is present
  dayOfMonth: 1,
  startDate: '2026-08-23',
  isActive: true,
  createdAt: '2026-08-23',
  updatedAt: '2026-08-23',
};

const ymd = (d: Date) => toDateInputValue(d);

describe('recurringProcessor — rule dual-path', () => {
  it('projects a biweekly rule (anna’s every-2-weeks paycheck), ignoring the legacy shadow', () => {
    const item: RecurringItem = {
      ...base,
      rule: { unit: 'week', interval: 2, weekdays: [0], end: { kind: 'never' } },
    };
    const dates = getDueDatesInRange(item, new Date(2026, 7, 1), new Date(2026, 9, 1)).map(ymd);
    expect(dates).toEqual(['2026-08-23', '2026-09-06', '2026-09-20']);
  });

  it('honors an afterCount end (the series stops)', () => {
    const item: RecurringItem = {
      ...base,
      rule: { unit: 'week', interval: 2, weekdays: [0], end: { kind: 'afterCount', count: 2 } },
    };
    const dates = getDueDatesInRange(item, new Date(2026, 7, 1), new Date(2026, 11, 31)).map(ymd);
    expect(dates).toEqual(['2026-08-23', '2026-09-06']);
  });
});
