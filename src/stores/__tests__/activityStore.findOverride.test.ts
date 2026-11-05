/**
 * `findOverride`: the public lookup of a series' override child by occurrence key, used by
 * the calendar drag's Undo (#142) to capture a child a 'this only' save will reuse.
 */
import { setActivePinia, createPinia } from 'pinia';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useActivityStore } from '../activityStore';
import type { FamilyActivity } from '@/types/models';

vi.mock('@/services/automerge/repositories/activityRepository', () => ({
  getAllActivities: vi.fn(),
  getActivityById: vi.fn(),
  getActivitiesByDate: vi.fn(),
  getActivitiesByAssignee: vi.fn(),
  getActivitiesByCategory: vi.fn(),
  createActivity: vi.fn(),
  updateActivity: vi.fn(),
  deleteActivity: vi.fn(),
}));

const activity = (over: Partial<FamilyActivity>): FamilyActivity =>
  ({
    title: 'Piano',
    category: 'other',
    recurrence: 'none',
    isActive: true,
    ...over,
  }) as FamilyActivity;

describe('activityStore.findOverride', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('finds a child by its pinned occurrence key, not where it was moved to', () => {
    const store = useActivityStore();
    const moved = activity({
      id: 'child',
      parentActivityId: 'series',
      date: '2026-04-02',
      originalOccurrenceDate: '2026-04-01',
    });
    store.activities = [
      activity({ id: 'series', date: '2026-03-04', recurrence: 'weekly', daysOfWeek: [3] }),
      moved,
    ];

    expect(store.findOverride('series', '2026-04-01')).toStrictEqual(moved);
    expect(store.findOverride('series', '2026-04-02')).toBeUndefined();
    expect(store.findOverride('other', '2026-04-01')).toBeUndefined();
  });
});
