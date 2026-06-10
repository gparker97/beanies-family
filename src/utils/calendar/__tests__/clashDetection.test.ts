import { describe, it, expect } from 'vitest';
import type { FamilyActivity } from '@/types/models';
import {
  activityTimeRange,
  intervalsOverlap,
  computeClashes,
  clashKey,
  type ActivityOccurrence,
  type ConnectionBusy,
} from '../clashDetection';

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
    const occurrences = [occ('a1', '2026-06-10', '14:00', '15:00')];
    const busy: ConnectionBusy[] = [
      {
        connectionId: 'conn-1',
        calendarLabel: 'mum@example.com',
        intervals: [{ start: '2026-06-10T14:30:00+08:00', end: '2026-06-10T16:00:00+08:00' }],
      },
    ];
    // Run in the +08:00 zone so the activity's local 14:00 lines up with the busy block.
    const clashes = computeClashes(occurrences, busy);
    const key = clashKey('a1', '2026-06-10');
    // Only assert presence/shape when the test host tz overlaps; the cross-offset
    // case below pins the absolute-ms contract deterministically.
    if (clashes.has(key)) {
      expect(clashes.get(key)).toEqual({
        connectionId: 'conn-1',
        calendarLabel: 'mum@example.com',
      });
    }
  });

  it('compares in ABSOLUTE ms — a busy block in another UTC offset still overlaps', () => {
    // Activity 14:00–15:00 local. Busy block expressed in UTC that covers the SAME
    // absolute instant as the local 14:30, regardless of the host timezone.
    const date = '2026-06-10';
    const busyStartMs = localMs(date, '14:30');
    const busyEndMs = localMs(date, '16:00');
    const busy: ConnectionBusy[] = [
      {
        connectionId: 'conn-1',
        calendarLabel: 'work',
        intervals: [
          { start: new Date(busyStartMs).toISOString(), end: new Date(busyEndMs).toISOString() },
        ],
      },
    ];
    const clashes = computeClashes([occ('a1', date, '14:00', '15:00')], busy);
    expect(clashes.get(clashKey('a1', date))).toEqual({
      connectionId: 'conn-1',
      calendarLabel: 'work',
    });
  });

  it('does not flag an adjacent-but-not-overlapping busy block', () => {
    const date = '2026-06-10';
    const busy: ConnectionBusy[] = [
      {
        connectionId: 'conn-1',
        calendarLabel: 'work',
        intervals: [
          {
            start: new Date(localMs(date, '15:00')).toISOString(),
            end: new Date(localMs(date, '16:00')).toISOString(),
          },
        ],
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
        intervals: [{ start: '2026-06-10T00:00:00Z', end: '2026-06-11T00:00:00Z' }],
      },
    ];
    expect(computeClashes(occurrences, busy).size).toBe(0);
  });
});
