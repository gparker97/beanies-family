import { describe, it, expect } from 'vitest';
import { buildRecurrenceRule } from '../recurrenceRrule';
import { activityRuleAdapter } from '@/services/recurrence/adapters';
import type { FamilyActivity } from '@/types/models';

/**
 * #70 Phase B: the canonical rule → RRULE serializer must byte-match the legacy
 * per-kind switch for every kind the legacy enum can express. Monthly-on-date is
 * tested at day <= 28 (the picker's cap); 29-31 legacy items intentionally map to
 * "last day" on migration and are covered by the dual-path (legacy items keep
 * their own switch), so they are out of scope for this parity check.
 */

type A = Pick<FamilyActivity, 'recurrence' | 'date' | 'daysOfWeek' | 'recurrenceEndDate'>;

// The date is a Sunday (2026-08-23, the 23rd, 4th Sunday).
const cases: A[] = [
  { recurrence: 'daily', date: '2026-08-23' },
  { recurrence: 'weekly', date: '2026-08-23', daysOfWeek: [1, 3, 5] },
  { recurrence: 'weekly', date: '2026-08-23' }, // defaults to the anchor weekday
  { recurrence: 'biweekly', date: '2026-08-23' },
  { recurrence: 'monthly', date: '2026-08-23' },
  { recurrence: 'monthly-by-day', date: '2026-08-23' },
  { recurrence: 'yearly', date: '2026-08-23' },
  { recurrence: 'weekly', date: '2026-08-23', daysOfWeek: [2], recurrenceEndDate: '2026-12-31' },
];

describe('recurrenceRrule — canonical rule matches the legacy switch', () => {
  it.each(cases)('%o', (a) => {
    const legacy = buildRecurrenceRule({
      recurrence: a.recurrence,
      date: a.date,
      daysOfWeek: a.daysOfWeek,
      recurrenceEndDate: a.recurrenceEndDate,
    });
    const viaRule = buildRecurrenceRule({
      recurrence: 'none', // ignored when a rule is present
      date: a.date,
      isAllDay: false,
      rule: activityRuleAdapter(a)!,
    });
    expect(viaRule).toEqual(legacy);
  });

  it('serializes every-N-weeks (new capability, no legacy equivalent)', () => {
    expect(
      buildRecurrenceRule({
        recurrence: 'none',
        date: '2026-08-23',
        rule: { unit: 'week', interval: 3, weekdays: [1], end: { kind: 'afterCount', count: 6 } },
      })
    ).toEqual(['RRULE:FREQ=WEEKLY;INTERVAL=3;BYDAY=MO;COUNT=6']);
  });
});
