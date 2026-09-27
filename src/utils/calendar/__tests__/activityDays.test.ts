import { describe, it, expect } from 'vitest';
import type { FamilyActivity } from '@/types/models';
import {
  drawnOffsetDays,
  isOvernightTimed,
  isRepeatingActivity,
  minRepeatGapDays,
  resolveActivityDays,
  shiftSpan,
  spanOffsetDays,
  withRebasedEndDate,
} from '../activityDays';
import { daysBetweenYmd } from '@/utils/date';

function makeActivity(overrides: Partial<FamilyActivity> = {}): FamilyActivity {
  return {
    id: 'a1',
    title: 'Soccer',
    date: '2026-06-10',
    recurrence: 'none',
    category: 'sports',
    feeSchedule: 'none',
    reminderMinutes: 0,
    isActive: true,
    createdBy: 'm0',
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
    ...overrides,
  } as FamilyActivity;
}

describe('resolveActivityDays', () => {
  it('all-day single day: inclusive end = start, offset 0', () => {
    expect(resolveActivityDays(makeActivity({ isAllDay: true }))).toEqual({
      allDay: true,
      startYmd: '2026-06-10',
      endYmd: '2026-06-10',
      endDayOffset: 0,
    });
  });

  it('all-day multi-day: inclusive last day', () => {
    expect(resolveActivityDays(makeActivity({ isAllDay: true, endDate: '2026-06-12' }))).toEqual({
      allDay: true,
      startYmd: '2026-06-10',
      endYmd: '2026-06-12',
      endDayOffset: 2,
    });
  });

  it('timed same-day: endTime defaults to startTime, offset 0', () => {
    expect(resolveActivityDays(makeActivity({ startTime: '14:30' }))).toEqual({
      allDay: false,
      startYmd: '2026-06-10',
      endYmd: '2026-06-10',
      endDayOffset: 0,
      startTime: '14:30',
      endTime: '14:30',
    });
  });

  it('timed overnight (endTime < startTime, no endDate): rolls end +1', () => {
    const days = resolveActivityDays(makeActivity({ startTime: '22:00', endTime: '02:00' }));
    expect(days.endYmd).toBe('2026-06-11');
    expect(days.endDayOffset).toBe(1);
  });

  it('timed multi-day endDate wins over the overnight roll', () => {
    const days = resolveActivityDays(
      makeActivity({ startTime: '09:00', endTime: '17:00', endDate: '2026-06-12' })
    );
    expect(days.endYmd).toBe('2026-06-12');
    expect(days.endDayOffset).toBe(2);
  });
});

describe('isRepeatingActivity', () => {
  it('counts the legacy enum or a canonical rule', () => {
    expect(isRepeatingActivity(makeActivity())).toBe(false);
    expect(isRepeatingActivity(makeActivity({ recurrence: 'weekly' }))).toBe(true);
    expect(
      isRepeatingActivity(
        makeActivity({ rule: { unit: 'week', interval: 1, end: { kind: 'never' } } } as never)
      )
    ).toBe(true);
  });
});

describe('a repeating activity with a real multi-day endDate', () => {
  it('⭐ keeps its day length for Google export and clash detection', () => {
    // A Google import of a weekly Fri-Sun event carries `endDate` alongside `rule`
    // (planImport spreads googleTimesToActivityFields). It is NOT stale data:
    // ignoring it here would re-push the series to Google shortened.
    const a = makeActivity({
      isAllDay: true,
      recurrence: 'weekly',
      daysOfWeek: [5],
      date: '2026-06-12',
      endDate: '2026-06-14',
    });
    expect(resolveActivityDays(a)).toMatchObject({ endYmd: '2026-06-14', endDayOffset: 2 });
  });
});

describe('multi-day span helpers', () => {
  const span = (date: string, endDate?: string) => ({ isAllDay: true as const, date, endDate });

  it('daysBetweenYmd is signed and unaffected by a DST change in the range', () => {
    expect(daysBetweenYmd('2026-05-01', '2026-05-04')).toBe(3);
    expect(daysBetweenYmd('2026-05-04', '2026-05-01')).toBe(-3);
    // US DST starts 2026-03-08, EU 2026-03-29.
    expect(daysBetweenYmd('2026-03-06', '2026-03-09')).toBe(3);
    expect(daysBetweenYmd('2026-03-27', '2026-03-30')).toBe(3);
  });

  it('spanOffsetDays counts days after the start, 0 for a single day or a bad end', () => {
    expect(spanOffsetDays(span('2026-05-01', '2026-05-03'))).toBe(2);
    expect(spanOffsetDays(span('2026-05-01'))).toBe(0);
    expect(spanOffsetDays(span('2026-05-01', '2026-04-29'))).toBe(0);
    // Only an explicitly all-day record spans days (matches the store's rule).
    expect(spanOffsetDays({ date: '2026-05-01', endDate: '2026-05-03' })).toBe(0);
  });

  it('shiftSpan keeps the length when the start moves, across DST too', () => {
    expect(shiftSpan(span('2026-05-01', '2026-05-03'), '2026-05-08')).toBe('2026-05-10');
    expect(shiftSpan(span('2026-03-06', '2026-03-08'), '2026-03-27')).toBe('2026-03-29');
    expect(shiftSpan(span('2026-05-01'), '2026-05-08')).toBeUndefined();
  });

  it('withRebasedEndDate carries the span unless the patch sets endDate itself', () => {
    const existing = span('2026-05-01', '2026-05-03');
    expect(withRebasedEndDate(existing, { date: '2026-05-08' })).toEqual({
      date: '2026-05-08',
      endDate: '2026-05-10',
    });
    // A present `undefined` is a deliberate clear (Lasts back to 1 day).
    expect(withRebasedEndDate(existing, { date: '2026-05-08', endDate: undefined })).toEqual({
      date: '2026-05-08',
      endDate: undefined,
    });
    const noMove = { title: 'x' } as { date?: string; endDate?: string; title: string };
    expect(withRebasedEndDate(existing, noMove)).toBe(noMove);
  });

  it('minRepeatGapDays is the tightest gap between starts', () => {
    const never = { kind: 'never' as const };
    expect(minRepeatGapDays({ unit: 'day', interval: 1, end: never })).toBe(1);
    expect(minRepeatGapDays({ unit: 'week', interval: 1, weekdays: [5], end: never })).toBe(7);
    expect(minRepeatGapDays({ unit: 'week', interval: 1, weekdays: [1, 3], end: never })).toBe(2);
    expect(minRepeatGapDays({ unit: 'week', interval: 2, weekdays: [1, 3], end: never })).toBe(2);
    expect(minRepeatGapDays({ unit: 'week', interval: 3, end: never })).toBe(21);
    expect(minRepeatGapDays({ unit: 'week', interval: 1, weekdays: [0, 6], end: never })).toBe(1);
    expect(minRepeatGapDays({ unit: 'month', interval: 1, end: never })).toBe(28);
  });
});

describe('overnight timed activities', () => {
  const timed = (startTime: string, endTime: string, over: Partial<FamilyActivity> = {}) =>
    makeActivity({ startTime, endTime, ...over });

  it("⭐ covers both shapes: the implicit roll and sync's explicit next-day endDate", () => {
    expect(isOvernightTimed(timed('22:00', '01:00'))).toBe(true);
    expect(isOvernightTimed(timed('22:00', '01:00', { endDate: '2026-06-11' }))).toBe(true);
    expect(drawnOffsetDays(timed('22:00', '01:00'))).toBe(1);
  });

  it('draws no tail for an event ending exactly at midnight, or a same-day one', () => {
    expect(isOvernightTimed(timed('22:00', '00:00'))).toBe(false);
    expect(isOvernightTimed(timed('09:00', '10:00'))).toBe(false);
  });

  it('leaves 24h-plus timed events (an explicit endDate two days on) out of scope', () => {
    expect(isOvernightTimed(timed('22:00', '01:00', { endDate: '2026-06-12' }))).toBe(false);
    expect(isOvernightTimed(timed('18:00', '20:00', { endDate: '2026-06-11' }))).toBe(false);
  });

  it('never treats an all-day activity as overnight', () => {
    expect(
      isOvernightTimed(makeActivity({ isAllDay: true, startTime: '22:00', endTime: '01:00' }))
    ).toBe(false);
  });
});
