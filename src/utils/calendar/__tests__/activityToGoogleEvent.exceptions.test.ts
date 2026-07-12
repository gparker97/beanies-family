import { describe, it, expect } from 'vitest';
import type { FamilyActivity } from '@/types/models';
import {
  startEndForDate,
  masterOccurrenceBody,
  computeExceptionHash,
} from '../activityToGoogleEvent';

const ctx = {
  memberName: (id: string) => ({ m1: 'Mia' })[id],
  appOrigin: 'https://app.beanies.family',
  timeZone: 'Asia/Singapore',
};

function makeActivity(overrides: Partial<FamilyActivity> = {}): FamilyActivity {
  return {
    id: 'master',
    title: 'Piano',
    date: '2026-06-03',
    recurrence: 'weekly',
    daysOfWeek: [3],
    category: 'music',
    feeSchedule: 'none',
    reminderMinutes: 0,
    isActive: true,
    createdBy: 'm0',
    startTime: '15:00',
    endTime: '16:00',
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
    ...overrides,
  } as FamilyActivity;
}

describe('startEndForDate', () => {
  it('re-anchors a timed activity to a given date (keeps its time + duration)', () => {
    const { start, end } = startEndForDate(makeActivity(), '2026-06-17', 'Asia/Singapore');
    expect(start).toEqual({ dateTime: '2026-06-17T15:00:00', timeZone: 'Asia/Singapore' });
    expect(end).toEqual({ dateTime: '2026-06-17T16:00:00', timeZone: 'Asia/Singapore' });
  });

  it('re-anchors an all-day activity (exclusive Google end.date = day + 1)', () => {
    const allDay = makeActivity({ isAllDay: true, startTime: undefined, endTime: undefined });
    const { start, end } = startEndForDate(allDay, '2026-06-17', 'Asia/Singapore');
    expect(start).toEqual({ date: '2026-06-17' });
    expect(end).toEqual({ date: '2026-06-18' });
  });

  it('preserves an overnight duration via endDayOffset', () => {
    const overnight = makeActivity({ startTime: '22:00', endTime: '02:00' }); // rolls to next day
    const { start, end } = startEndForDate(overnight, '2026-06-17', 'Asia/Singapore');
    expect(start).toEqual({ dateTime: '2026-06-17T22:00:00', timeZone: 'Asia/Singapore' });
    expect(end).toEqual({ dateTime: '2026-06-18T02:00:00', timeZone: 'Asia/Singapore' });
  });
});

describe('masterOccurrenceBody', () => {
  it('produces a single-instance body (recurrence:[], confirmed) anchored to the occurrence', () => {
    const body = masterOccurrenceBody(makeActivity(), '2026-06-17', ctx);
    expect(body.recurrence).toEqual([]); // NEVER an RRULE on an instance
    expect(body.status).toBe('confirmed');
    expect(body.summary).toBe('Piano');
    expect(body.start).toEqual({ dateTime: '2026-06-17T15:00:00', timeZone: 'Asia/Singapore' });
  });
});

describe('computeExceptionHash', () => {
  it('changes across mode (modify ↔ cancel) for the same child + occurrence', () => {
    const child = makeActivity({ id: 'child', recurrence: 'none', parentActivityId: 'master' });
    const modify = computeExceptionHash(child, '2026-06-17', 'modify');
    const cancel = computeExceptionHash(child, '2026-06-17', 'cancel');
    expect(modify).not.toBe(cancel);
  });

  it('changes across occurrence date', () => {
    const child = makeActivity({ id: 'child', recurrence: 'none', parentActivityId: 'master' });
    expect(computeExceptionHash(child, '2026-06-17', 'modify')).not.toBe(
      computeExceptionHash(child, '2026-06-24', 'modify')
    );
  });

  it('is stable for identical inputs', () => {
    const child = makeActivity({ id: 'child', recurrence: 'none', parentActivityId: 'master' });
    expect(computeExceptionHash(child, '2026-06-17', 'modify')).toBe(
      computeExceptionHash(child, '2026-06-17', 'modify')
    );
  });
});
