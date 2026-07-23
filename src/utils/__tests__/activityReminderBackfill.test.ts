import { describe, it, expect } from 'vitest';
import { selectActivitiesToBackfill } from '@/utils/activityReminderBackfill';
import type { FamilyActivity, UUID } from '@/types/models';

function activity(over: Partial<FamilyActivity> = {}): FamilyActivity {
  return {
    id: 'a-1' as UUID,
    title: 'Football',
    date: '2026-05-22',
    reminderMinutes: 0,
    ...over,
  } as FamilyActivity;
}

describe('selectActivitiesToBackfill', () => {
  it('selects activities still on the old default of 0', () => {
    expect(selectActivitiesToBackfill([activity()])).toHaveLength(1);
  });

  it('leaves any explicit non-zero lead alone', () => {
    const explicit = [15, 30, 60, 1440].map((m) =>
      activity({ id: `a-${m}` as UUID, reminderMinutes: m as FamilyActivity['reminderMinutes'] })
    );
    expect(selectActivitiesToBackfill(explicit)).toHaveLength(0);
  });

  it('EXCLUDES multi-day all-day spans — they would buzz once per trip day', () => {
    // `expandOneOff` yields one occurrence per day of the span and an all-day
    // occurrence fires at the 09:00 anchor, so back-filling a 10-day trip would
    // mean ten consecutive morning notifications.
    const trip = activity({ isAllDay: true, date: '2026-06-01', endDate: '2026-06-10' });
    expect(selectActivitiesToBackfill([trip])).toHaveLength(0);
  });

  it('still selects a SINGLE-day all-day activity', () => {
    const sportsDay = activity({ isAllDay: true, date: '2026-06-01', endDate: '2026-06-01' });
    expect(selectActivitiesToBackfill([sportsDay])).toHaveLength(1);
  });

  it('EXCLUDES vacation-linked activities — their 0 is deliberate, not the stale default', () => {
    const leg = activity({ vacationId: 'vac-1' as UUID });
    expect(selectActivitiesToBackfill([leg])).toHaveLength(0);
  });

  it('is stable on a second pass — a re-run selects nothing once migrated', () => {
    const before = [activity(), activity({ id: 'a-2' as UUID })];
    const migrated = selectActivitiesToBackfill(before).map((a) => ({
      ...a,
      reminderMinutes: 30 as FamilyActivity['reminderMinutes'],
    }));
    expect(selectActivitiesToBackfill(migrated)).toHaveLength(0);
  });
});
