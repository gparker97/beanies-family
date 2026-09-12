/**
 * The predicate that decides an activity can NEVER be accepted by Google.
 *
 * A family sat in this loop for days: "Invalid start time", re-sent every five
 * minutes from every device, re-paging Slack once per app session, because nothing
 * asked whether the body could possibly be valid before sending it.
 *
 * ⚠️ Most of these tests assert `null` — that an activity is NOT blocked. That is
 * deliberate and it is the harder half. A false positive here is a SILENT
 * regression: the event simply stops reaching Google, with no error anywhere. The
 * predicate has to mirror what `resolveActivityDays` actually serializes, not what
 * the activity happens to hold, and each `null` case below is a shape the obvious
 * implementation gets wrong.
 */
import { describe, it, expect } from 'vitest';
import { pushBlockReason } from '../activityDays';
import type { FamilyActivity } from '@/types/models';

function activity(over: Partial<FamilyActivity> = {}): FamilyActivity {
  return {
    id: 'a1',
    title: 'Swimming',
    date: '2026-09-15',
    category: 'other',
    assigneeIds: [],
    recurrence: 'none',
    isActive: true,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    ...over,
  } as FamilyActivity;
}

describe('pushBlockReason — what it must NOT block', () => {
  it('a well-formed timed activity', () => {
    expect(pushBlockReason(activity({ startTime: '09:00', endTime: '10:30' }))).toBeNull();
  });

  it('an activity with no startTime at all — that is an all-day event, not a fault', () => {
    expect(pushBlockReason(activity())).toBeNull();
  });

  it('🔴 an isAllDay activity carrying a JUNK startTime', () => {
    // The sharpest false positive. `resolveActivityDays` takes the all-day branch
    // on `isAllDay === true` and never reads `startTime`, so this event syncs
    // perfectly today. Blocking it would break something that works.
    expect(pushBlockReason(activity({ isAllDay: true, startTime: '9am' }))).toBeNull();
    expect(pushBlockReason(activity({ isAllDay: true, startTime: '25:99' }))).toBeNull();
  });

  it('🔴 a date carrying a time component', () => {
    // Every consumer slices to 10 chars, so this is legal throughout the app.
    expect(pushBlockReason(activity({ date: '2026-09-15T00:00:00.000Z' }))).toBeNull();
  });

  it('an absent endTime or endDate — both have defaults', () => {
    expect(pushBlockReason(activity({ startTime: '09:00' }))).toBeNull();
    expect(pushBlockReason(activity({ startTime: '09:00', endTime: '10:00' }))).toBeNull();
  });

  it('🔴 a junk recurrenceEndDate on a NON-repeating activity', () => {
    // `untilClause` is only reached when the activity actually repeats, so a stale
    // value on a one-off never ships.
    expect(
      pushBlockReason(activity({ recurrence: 'none', recurrenceEndDate: 'nextJune' }))
    ).toBeNull();
  });

  it('midnight and one-minute-to-midnight, which regex-only checks get wrong', () => {
    expect(pushBlockReason(activity({ startTime: '00:00', endTime: '23:59' }))).toBeNull();
  });
});

describe('pushBlockReason — what it must block', () => {
  it('a human-written start time', () => {
    // The production shape: an LLM answered "9am" and it reached the pod.
    expect(pushBlockReason(activity({ startTime: '9am' }))).toBe('bad_start_time');
    expect(pushBlockReason(activity({ startTime: '9:00' }))).toBe('bad_start_time');
    expect(pushBlockReason(activity({ startTime: '16:00-17:00' }))).toBe('bad_start_time');
  });

  it('an out-of-range time that matches the shape', () => {
    expect(pushBlockReason(activity({ startTime: '24:00' }))).toBe('bad_start_time');
    expect(pushBlockReason(activity({ startTime: '09:60' }))).toBe('bad_start_time');
  });

  it('a malformed endTime', () => {
    expect(pushBlockReason(activity({ startTime: '09:00', endTime: '5pm' }))).toBe('bad_end_time');
  });

  it('a malformed date', () => {
    expect(pushBlockReason(activity({ date: 'next Tuesday' }))).toBe('bad_date');
    expect(pushBlockReason(activity({ date: '2026-13-45' }))).toBe('bad_date');
  });

  it('🔴 a malformed endDate on an ALL-DAY activity', () => {
    // All-day events are not immune: `dayOffset` runs on that branch too, so the
    // NaN reaches the wire through `addDaysYmd` either way.
    expect(pushBlockReason(activity({ isAllDay: true, endDate: 'soon' }))).toBe('bad_date');
  });

  it('a malformed recurrenceEndDate on a REPEATING activity', () => {
    // Ships as `UNTIL=` behind only a `.trim()` guard — the same certain 400,
    // arriving with a different Google message.
    expect(pushBlockReason(activity({ recurrence: 'weekly', recurrenceEndDate: 'nextJune' }))).toBe(
      'bad_date'
    );
  });

  it('reports the DATE before the time, so the first cause is the one named', () => {
    expect(pushBlockReason(activity({ date: 'bad', startTime: 'alsoBad' }))).toBe('bad_date');
  });
});
