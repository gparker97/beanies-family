import { describe, it, expect } from 'vitest';
import type { FamilyActivity } from '@/types/models';
import {
  activityTimeRange,
  intervalsOverlap,
  computeClashes,
  externalBusyIntervals,
  clashKey,
  overlapAckKey,
  type ActivityOccurrence,
  type ConnectionBusy,
} from '../clashDetection';
import type { EventTime } from '@/services/calendar/CalendarClient';

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

/** Local wall-time ms for assertions (same tz the util uses). */
function localMs(ymd: string, hhmm: string): number {
  const [y, mo, d] = ymd.split('-').map(Number);
  const [h, mi] = hhmm.split(':').map(Number);
  return new Date(y!, mo! - 1, d!, h!, mi!, 0, 0).getTime();
}

describe('activityTimeRange', () => {
  it('returns null for an all-day activity (v1 skips all-day)', () => {
    expect(activityTimeRange(makeActivity({ isAllDay: true }), '2026-06-10')).toBeNull();
  });

  it('builds an absolute ms range for a timed occurrence', () => {
    const r = activityTimeRange(
      makeActivity({ startTime: '14:00', endTime: '15:00' }),
      '2026-06-10'
    );
    expect(r).toEqual({
      startMs: localMs('2026-06-10', '14:00'),
      endMs: localMs('2026-06-10', '15:00'),
    });
  });

  it('anchors the overnight roll to the OCCURRENCE date, not activity.date (recurring)', () => {
    // A weekly overnight activity; the occurrence is a week after activity.date.
    const act = makeActivity({
      date: '2026-06-10',
      startTime: '22:00',
      endTime: '02:00',
      recurrence: 'weekly',
    });
    const r = activityTimeRange(act, '2026-06-17');
    expect(r).toEqual({
      startMs: localMs('2026-06-17', '22:00'),
      endMs: localMs('2026-06-18', '02:00'),
    });
  });
});

describe('intervalsOverlap', () => {
  it('half-open: touching boundaries do NOT overlap', () => {
    expect(intervalsOverlap(0, 10, 10, 20)).toBe(false);
    expect(intervalsOverlap(10, 20, 0, 10)).toBe(false);
  });
  it('genuine overlap is detected', () => {
    expect(intervalsOverlap(0, 10, 5, 15)).toBe(true);
  });
});

describe('computeClashes', () => {
  const occ = (
    id: string,
    date: string,
    startTime: string,
    endTime: string
  ): ActivityOccurrence => ({
    activity: makeActivity({ id, date, startTime, endTime }),
    date,
  });

  it('flags an overlapping timed occurrence, keyed via clashKey, naming the connection', () => {
    const date = '2026-06-10';
    const occurrences = [occ('a1', date, '14:00', '15:00')];
    const busy: ConnectionBusy[] = [
      {
        connectionId: 'conn-1',
        calendarLabel: 'mum@example.com',
        intervals: [{ startMs: localMs(date, '14:30'), endMs: localMs(date, '16:00') }],
      },
    ];
    const clashes = computeClashes(occurrences, busy);
    expect(clashes.get(clashKey('a1', date))).toEqual({
      connectionId: 'conn-1',
      calendarLabel: 'mum@example.com',
      activityId: 'a1',
      occurrenceDate: date,
      fingerprint: `${localMs(date, '14:00')}-${localMs(date, '15:00')}`,
    });
  });

  it('compares in ABSOLUTE ms — intervals are already ms (offset-correct upstream)', () => {
    // Activity 14:00–15:00 local. Busy block expressed in absolute ms that covers
    // the SAME instant as the local 14:30, regardless of the host timezone.
    const date = '2026-06-10';
    const busy: ConnectionBusy[] = [
      {
        connectionId: 'conn-1',
        calendarLabel: 'work',
        intervals: [{ startMs: localMs(date, '14:30'), endMs: localMs(date, '16:00') }],
      },
    ];
    const clashes = computeClashes([occ('a1', date, '14:00', '15:00')], busy);
    expect(clashes.get(clashKey('a1', date))).toEqual({
      connectionId: 'conn-1',
      calendarLabel: 'work',
      activityId: 'a1',
      occurrenceDate: date,
      fingerprint: `${localMs(date, '14:00')}-${localMs(date, '15:00')}`,
    });
  });

  it('does not flag an adjacent-but-not-overlapping busy block', () => {
    const date = '2026-06-10';
    const busy: ConnectionBusy[] = [
      {
        connectionId: 'conn-1',
        calendarLabel: 'work',
        intervals: [{ startMs: localMs(date, '15:00'), endMs: localMs(date, '16:00') }],
      },
    ];
    const clashes = computeClashes([occ('a1', date, '14:00', '15:00')], busy);
    expect(clashes.size).toBe(0);
  });

  it('never flags an all-day occurrence', () => {
    const occurrences: ActivityOccurrence[] = [
      { activity: makeActivity({ id: 'a1', isAllDay: true }), date: '2026-06-10' },
    ];
    const busy: ConnectionBusy[] = [
      {
        connectionId: 'conn-1',
        calendarLabel: 'work',
        intervals: [
          { startMs: localMs('2026-06-10', '00:00'), endMs: localMs('2026-06-11', '00:00') },
        ],
      },
    ];
    expect(computeClashes(occurrences, busy).size).toBe(0);
  });
});

describe('externalBusyIntervals', () => {
  const ev = (over: Partial<EventTime>): EventTime => ({
    id: 'e1',
    startMs: 1000,
    endMs: 2000,
    transparent: false,
    ...over,
  });

  it('keeps an opaque external event (id not in the beanies set)', () => {
    const out = externalBusyIntervals([ev({ id: 'other' })], new Set(['bxxx']));
    expect(out).toEqual([{ startMs: 1000, endMs: 2000 }]);
  });

  it('drops a transparent (free-marked) event', () => {
    const out = externalBusyIntervals([ev({ id: 'other', transparent: true })], new Set());
    expect(out).toEqual([]);
  });

  it('drops a beanies one-off event matched by id', () => {
    const out = externalBusyIntervals([ev({ id: 'bself' })], new Set(['bself']));
    expect(out).toEqual([]);
  });

  it('drops a beanies recurring instance matched by recurringEventId', () => {
    const out = externalBusyIntervals(
      [ev({ id: 'bself_20260610T060000Z', recurringEventId: 'bself' })],
      new Set(['bself'])
    );
    expect(out).toEqual([]);
  });

  it('keeps an external recurring instance whose master is NOT a beanies id', () => {
    const out = externalBusyIntervals(
      [ev({ id: 'work_x', recurringEventId: 'workmaster' })],
      new Set(['bself'])
    );
    expect(out).toEqual([{ startMs: 1000, endMs: 2000 }]);
  });
});

describe('overlapAckKey', () => {
  it('emits the exact composite (guards positional argument order)', () => {
    // Exact string so a silent argument transposition fails CI rather than
    // corrupting acknowledge keys at runtime.
    expect(overlapAckKey('act', '2026-06-11', 'conn')).toBe('act:2026-06-11:conn');
  });
});
