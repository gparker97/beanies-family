/**
 * The parser's job is not to accept as much as possible. It is to accept only what
 * beanies can express FAITHFULLY, and to refuse everything else out loud, because
 * the alternative is importing a confidently wrong series that the family then
 * plans their week around.
 */
import { describe, it, expect } from 'vitest';

import { parseRecurrence } from '../parseRrule';
import { buildRecurrenceRule } from '../recurrenceRrule';
import type { RecurrenceRule } from '@/types/recurrence';

/** 2026-09-15 is a TUESDAY, and the THIRD Tuesday of September 2026. */
const TUE_3RD = '2026-09-15';
/** 2026-09-30 is the last day of its month. */
const MONTH_END = '2026-09-30';

const ok = (p: ReturnType<typeof parseRecurrence>): RecurrenceRule => {
  if (!p.ok) throw new Error(`expected a parse, got refusal: ${p.reason}`);
  return p.rule;
};

describe('round-trips against the writer', () => {
  // The oracle that matters: anything beanies emits and CAN re-read must come back
  // byte-identical, or an adopted beanies event would change shape on import.
  const cases: Array<{ name: string; rule: RecurrenceRule; start: string }> = [
    { name: 'daily', rule: { unit: 'day', interval: 1, end: { kind: 'never' } }, start: TUE_3RD },
    {
      name: 'every 3 days, counted',
      rule: { unit: 'day', interval: 3, end: { kind: 'afterCount', count: 10 } },
      start: TUE_3RD,
    },
    {
      name: 'weekly on the anchor weekday',
      rule: { unit: 'week', interval: 1, weekdays: [2], end: { kind: 'never' } },
      start: TUE_3RD,
    },
    {
      name: 'fortnightly',
      rule: { unit: 'week', interval: 2, weekdays: [2], end: { kind: 'never' } },
      start: TUE_3RD,
    },
    {
      name: 'weekly until a date',
      rule: {
        unit: 'week',
        interval: 1,
        weekdays: [2],
        end: { kind: 'onDate', date: '2026-12-09' },
      },
      start: TUE_3RD,
    },
    {
      name: 'monthly on the nth weekday',
      rule: { unit: 'month', interval: 1, monthlyAnchor: 'weekday', end: { kind: 'never' } },
      start: TUE_3RD,
    },
    {
      name: 'monthly on a low date',
      rule: {
        unit: 'month',
        interval: 1,
        monthlyAnchor: 'date',
        monthlyDay: 15,
        end: { kind: 'never' },
      },
      start: TUE_3RD,
    },
    { name: 'yearly', rule: { unit: 'year', interval: 1, end: { kind: 'never' } }, start: TUE_3RD },
  ];

  for (const c of cases) {
    it(c.name, () => {
      const lines = buildRecurrenceRule({ recurrence: 'none', date: c.start, rule: c.rule });
      expect(ok(parseRecurrence(lines, c.start))).toEqual(c.rule);
    });
  }
});

describe('beanies own clamp forms are refused, not silently reinterpreted', () => {
  // These are emitted by the writer and are NOT round-trippable, because the clamp
  // semantics live in BYSETPOS rather than in anything the model can hold. Asserting
  // the refusal documents the asymmetry instead of pretending it does not exist.
  it('refuses the clamped month-end form (BYMONTHDAY=28,29,30;BYSETPOS=-1)', () => {
    const lines = buildRecurrenceRule({
      recurrence: 'none',
      date: '2026-09-30',
      rule: {
        unit: 'month',
        interval: 1,
        monthlyAnchor: 'date',
        monthlyDay: 30,
        end: { kind: 'never' },
      },
    });
    const parsed = parseRecurrence(lines, '2026-09-30');
    expect(parsed.ok).toBe(false);
  });

  it('refuses the 29 February yearly form (BYMONTH=2;BYSETPOS=-1)', () => {
    const lines = buildRecurrenceRule({
      recurrence: 'none',
      date: '2028-02-29',
      rule: { unit: 'year', interval: 1, end: { kind: 'never' } },
    });
    const parsed = parseRecurrence(lines, '2028-02-29');
    expect(parsed.ok).toBe(false);
  });
});

describe('monthlyDay last', () => {
  it('reads BYMONTHDAY=-1 when the start really is the month end', () => {
    const rule = ok(parseRecurrence(['RRULE:FREQ=MONTHLY;BYMONTHDAY=-1'], MONTH_END));
    expect(rule).toEqual({
      unit: 'month',
      interval: 1,
      monthlyAnchor: 'date',
      monthlyDay: 'last',
      end: { kind: 'never' },
    });
  });
});

describe('ANCHOR AGREEMENT: the refusals that stop a wrong series', () => {
  it('refuses BYDAY=2WE when the start is the THIRD Wednesday', () => {
    // 2026-09-16 is the third Wednesday. Accepting "2WE" here would produce the
    // second-Wednesday series in Google and the third in beanies, forever.
    const p = parseRecurrence(['RRULE:FREQ=MONTHLY;BYDAY=2WE'], '2026-09-16');
    expect(p).toEqual({ ok: false, reason: 'anchor-mismatch' });
  });

  it('accepts BYDAY=3WE on that same third Wednesday', () => {
    const rule = ok(parseRecurrence(['RRULE:FREQ=MONTHLY;BYDAY=3WE'], '2026-09-16'));
    expect(rule.monthlyAnchor).toBe('weekday');
  });

  it('refuses a monthly BYDAY whose weekday is not the start weekday', () => {
    const p = parseRecurrence(['RRULE:FREQ=MONTHLY;BYDAY=3MO'], '2026-09-16');
    expect(p).toEqual({ ok: false, reason: 'anchor-mismatch' });
  });

  it('refuses BYMONTHDAY=15 when the start is not the 15th', () => {
    const p = parseRecurrence(['RRULE:FREQ=MONTHLY;BYMONTHDAY=15'], '2026-09-16');
    expect(p).toEqual({ ok: false, reason: 'anchor-mismatch' });
  });

  it('refuses BYMONTHDAY=-1 when the start is not the last day', () => {
    const p = parseRecurrence(['RRULE:FREQ=MONTHLY;BYMONTHDAY=-1'], TUE_3RD);
    expect(p).toEqual({ ok: false, reason: 'anchor-mismatch' });
  });

  it('refuses a weekly BYDAY set that excludes the start weekday', () => {
    const p = parseRecurrence(['RRULE:FREQ=WEEKLY;BYDAY=MO,FR'], TUE_3RD);
    expect(p).toEqual({ ok: false, reason: 'anchor-mismatch' });
  });

  it('accepts a multi-day weekly set that includes the start weekday', () => {
    const rule = ok(parseRecurrence(['RRULE:FREQ=WEEKLY;BYDAY=TU,TH'], TUE_3RD));
    expect(rule.weekdays).toEqual([2, 4]);
  });
});

describe('parts the model cannot hold', () => {
  it.each([
    ['BYSETPOS', 'RRULE:FREQ=MONTHLY;BYMONTHDAY=28,29,30;BYSETPOS=-1'],
    ['BYMONTH', 'RRULE:FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=29'],
    ['BYWEEKNO', 'RRULE:FREQ=YEARLY;BYWEEKNO=20'],
    ['BYYEARDAY', 'RRULE:FREQ=YEARLY;BYYEARDAY=100'],
    ['multi BYMONTHDAY', 'RRULE:FREQ=MONTHLY;BYMONTHDAY=1,15'],
    ['a negative ordinal day', 'RRULE:FREQ=MONTHLY;BYMONTHDAY=-2'],
    ['an ordinal on a weekly rule', 'RRULE:FREQ=WEEKLY;BYDAY=2TU'],
    ['a bare monthly BYDAY with no ordinal', 'RRULE:FREQ=MONTHLY;BYDAY=TU'],
  ])('refuses %s', (_label, line) => {
    const p = parseRecurrence([line], TUE_3RD);
    expect(p.ok).toBe(false);
  });

  it('refuses multi-weekday at interval > 1, which the model forbids', () => {
    const p = parseRecurrence(['RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=TU,TH'], TUE_3RD);
    expect(p).toEqual({ ok: false, reason: 'unsupported-parts' });
  });

  it('refuses an unknown FREQ', () => {
    expect(parseRecurrence(['RRULE:FREQ=HOURLY'], TUE_3RD)).toEqual({
      ok: false,
      reason: 'unsupported-freq',
    });
  });
});

describe('lines that are not a single plain RRULE', () => {
  it('refuses EXDATE, because the family deliberately removed those occurrences', () => {
    const p = parseRecurrence(
      ['RRULE:FREQ=WEEKLY;BYDAY=TU', 'EXDATE;TZID=Asia/Singapore:20260922T160000'],
      TUE_3RD
    );
    expect(p).toEqual({ ok: false, reason: 'extra-date-lines' });
  });

  it('refuses RDATE', () => {
    const p = parseRecurrence(['RRULE:FREQ=WEEKLY;BYDAY=TU', 'RDATE:20261001T160000Z'], TUE_3RD);
    expect(p).toEqual({ ok: false, reason: 'extra-date-lines' });
  });

  it('refuses two RRULEs', () => {
    const p = parseRecurrence(['RRULE:FREQ=WEEKLY;BYDAY=TU', 'RRULE:FREQ=DAILY'], TUE_3RD);
    expect(p).toEqual({ ok: false, reason: 'multi-rule' });
  });

  it('refuses an empty or absent array', () => {
    expect(parseRecurrence([], TUE_3RD)).toEqual({ ok: false, reason: 'no-rrule' });
    expect(parseRecurrence(undefined, TUE_3RD)).toEqual({ ok: false, reason: 'no-rrule' });
  });
});

describe('malformed input never throws', () => {
  // This runs against whatever Google returns, so it must be total.
  it.each([
    ['RRULE:'],
    ['RRULE:FREQ'],
    ['RRULE:FREQ=WEEKLY;INTERVAL=0'],
    ['RRULE:FREQ=WEEKLY;INTERVAL=abc'],
    ['RRULE:FREQ=WEEKLY;BYDAY=XX'],
    ['RRULE:FREQ=WEEKLY;COUNT=0'],
    ['RRULE:FREQ=WEEKLY;UNTIL=nonsense'],
    ['not an rrule at all'],
  ])('refuses %s without throwing', (line) => {
    expect(() => parseRecurrence([line], TUE_3RD)).not.toThrow();
    expect(parseRecurrence([line], TUE_3RD).ok).toBe(false);
  });

  it('refuses a malformed start date', () => {
    expect(parseRecurrence(['RRULE:FREQ=DAILY'], 'not-a-date').ok).toBe(false);
  });
});

describe('end conditions', () => {
  it('reads COUNT', () => {
    expect(ok(parseRecurrence(['RRULE:FREQ=DAILY;COUNT=5'], TUE_3RD)).end).toEqual({
      kind: 'afterCount',
      count: 5,
    });
  });

  it('reads an all-day UNTIL', () => {
    expect(ok(parseRecurrence(['RRULE:FREQ=DAILY;UNTIL=20261209'], TUE_3RD)).end).toEqual({
      kind: 'onDate',
      date: '2026-12-09',
    });
  });

  it('reads a timed UTC UNTIL as its calendar date', () => {
    expect(ok(parseRecurrence(['RRULE:FREQ=DAILY;UNTIL=20261209T235959Z'], TUE_3RD)).end).toEqual({
      kind: 'onDate',
      date: '2026-12-09',
    });
  });

  it('defaults to never', () => {
    expect(ok(parseRecurrence(['RRULE:FREQ=DAILY'], TUE_3RD)).end).toEqual({ kind: 'never' });
  });
});

describe('clamp vs skip: the two engines disagree past the 28th', () => {
  // RFC 5545 SKIPs a month that lacks the day; the beanies engine CLAMPs to that
  // month's last day. Accepting these would put beanies and Google on different
  // schedules, and for an ADOPTED event the first ordinary edit would rewrite the
  // user's real Google rule from "the 31st" to "the last day of the month".
  it.each([29, 30, 31])('refuses an explicit BYMONTHDAY=%i', (day) => {
    const start = `2026-01-${day}`;
    expect(parseRecurrence([`RRULE:FREQ=MONTHLY;BYMONTHDAY=${day}`], start).ok).toBe(false);
  });

  it('refuses a BARE FREQ=MONTHLY anchored past the 28th', () => {
    // This one has no BYMONTHDAY at all: the day is inherited from DTSTART, so the
    // divergence is just as real and far easier to miss.
    expect(parseRecurrence(['RRULE:FREQ=MONTHLY'], '2026-01-31').ok).toBe(false);
  });

  it('still accepts a day every month actually has', () => {
    expect(parseRecurrence(['RRULE:FREQ=MONTHLY;BYMONTHDAY=28'], '2026-01-28').ok).toBe(true);
    expect(parseRecurrence(['RRULE:FREQ=MONTHLY'], '2026-01-15').ok).toBe(true);
  });

  it('refuses a bare FREQ=YEARLY anchored on 29 February', () => {
    expect(parseRecurrence(['RRULE:FREQ=YEARLY'], '2028-02-29').ok).toBe(false);
  });

  it('still accepts an ordinary yearly anchor', () => {
    expect(parseRecurrence(['RRULE:FREQ=YEARLY'], '2026-06-10').ok).toBe(true);
  });
});
