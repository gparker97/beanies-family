import { describe, it, expect } from 'vitest';
import type { FamilyActivity } from '@/types/models';
import { isRepeatingActivity, resolveActivityDays } from '../activityDays';

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
