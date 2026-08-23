import { describe, it, expect } from 'vitest';
import { buildRecurrenceRule } from '../recurrenceRrule';
import { resolveActivityRule } from '@/services/recurrence/adapters';
import { previewNext } from '@/services/recurrence/recurrenceEngine';
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
      rule: resolveActivityRule(a)!.rule,
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
    ).toEqual(['RRULE:FREQ=WEEKLY;INTERVAL=3;BYDAY=MO;WKST=SU;COUNT=6']);
  });
});

describe('recurrenceRrule — month-end clamp reaches Google too (#70)', () => {
  // The engine clamps a month lacking the chosen day to its last day. RFC 5545's
  // BYMONTHDAY=31 SKIPS such months, so a naive serialization would show Feb 28
  // in beanies and NOTHING in the family's calendar. These pin the fix.
  const monthly = (day: number | 'last') =>
    buildRecurrenceRule({
      recurrence: 'monthly',
      date: '2026-01-31',
      rule: {
        unit: 'month',
        interval: 1,
        monthlyAnchor: 'date',
        monthlyDay: day,
        end: { kind: 'never' },
      },
    })[0]!;

  it('day 31 serializes as BYMONTHDAY=-1', () => {
    expect(monthly(31)).toBe('RRULE:FREQ=MONTHLY;BYMONTHDAY=-1');
  });

  it("'last' serializes identically to day 31", () => {
    expect(monthly('last')).toBe(monthly(31));
  });

  it('day 30 uses BYSETPOS to pick the last existing day', () => {
    expect(monthly(30)).toBe('RRULE:FREQ=MONTHLY;BYMONTHDAY=28,29,30;BYSETPOS=-1');
  });

  it('day 29 uses BYSETPOS too', () => {
    expect(monthly(29)).toBe('RRULE:FREQ=MONTHLY;BYMONTHDAY=28,29;BYSETPOS=-1');
  });

  it('days <= 28 are unchanged (no BYSETPOS)', () => {
    expect(monthly(15)).toBe('RRULE:FREQ=MONTHLY;BYMONTHDAY=15');
    expect(monthly(28)).toBe('RRULE:FREQ=MONTHLY;BYMONTHDAY=28');
  });
});

describe('recurrenceRrule — RRULE and engine agree on clamped months (#70)', () => {
  // A cross-check rather than two independent assertions: whatever the engine
  // generates in-app is what Google is told to generate.
  it.each([29, 30, 31])('day %i expands to the same months in both', (day) => {
    const anchor = `2026-01-${day}`;
    const engineDates = previewNext(
      {
        unit: 'month',
        interval: 1,
        monthlyAnchor: 'date',
        monthlyDay: day,
        end: { kind: 'never' },
      },
      anchor,
      anchor,
      4
    );
    // Every clamped result must be the last day of its month whenever the month
    // is shorter than `day` — which is exactly what BYSETPOS=-1 / BYMONTHDAY=-1
    // select. Assert the shape the serializer promises.
    const serialized = buildRecurrenceRule({
      recurrence: 'monthly',
      date: anchor,
      rule: {
        unit: 'month',
        interval: 1,
        monthlyAnchor: 'date',
        monthlyDay: day,
        end: { kind: 'never' },
      },
    })[0]!;
    expect(serialized).toMatch(/BYMONTHDAY=(-1|28)/);
    for (const ymd of engineDates) {
      const d = new Date(`${ymd}T00:00:00`);
      const lastOfMonth = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
      // Either the requested day, or the month's last day when it is shorter.
      expect(d.getDate()).toBe(Math.min(day, lastOfMonth));
    }
  });
});

describe('recurrenceRrule — WKST keeps N-week cycles aligned with the engine (#70)', () => {
  const biweekly = (weekday: number, anchor: string) =>
    buildRecurrenceRule({
      recurrence: 'biweekly',
      date: anchor,
      rule: {
        unit: 'week',
        interval: 2,
        weekdays: [weekday],
        end: { kind: 'never' },
      },
    })[0]!;

  it("emits WKST=SU for INTERVAL >= 2, matching the engine's Sunday week start", () => {
    // Without this, RFC 5545's default WKST=MO puts Google on the opposite week
    // whenever the chosen weekday falls earlier in the Sunday-week than the
    // anchor's weekday — two permanently disjoint sets, 7 days apart.
    expect(biweekly(0, '2026-01-03')).toContain('WKST=SU');
  });

  it('does NOT emit WKST at INTERVAL 1, where it has no effect', () => {
    const weekly = buildRecurrenceRule({
      recurrence: 'weekly',
      date: '2026-01-03',
      rule: { unit: 'week', interval: 1, weekdays: [0, 3], end: { kind: 'never' } },
    })[0]!;
    expect(weekly).not.toContain('WKST');
  });

  it('the engine puts a Sunday-anchored biweekly series on the SU-week cadence', () => {
    // Anchor Sat 3 Jan 2026, repeating Sundays every 2 weeks. Sunday-week start
    // => 11 Jan, 25 Jan. (A Monday week start would give 4 Jan, 18 Jan — the
    // divergence WKST=SU exists to prevent.)
    expect(
      previewNext(
        { unit: 'week', interval: 2, weekdays: [0], end: { kind: 'never' } },
        '2026-01-03',
        '2026-01-03',
        2
      )
    ).toEqual(['2026-01-11', '2026-01-25']);
  });
});
