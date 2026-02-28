import { setActivePinia, createPinia } from 'pinia';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useActivityStore } from './activityStore';
import type { FamilyActivity } from '@/types/models';

// Mock the activity repository
vi.mock('@/services/indexeddb/repositories/activityRepository', () => ({
  getAllActivities: vi.fn(),
  getActivityById: vi.fn(),
  getActivitiesByDate: vi.fn(),
  getActivitiesByAssignee: vi.fn(),
  getActivitiesByCategory: vi.fn(),
  createActivity: vi.fn(),
  updateActivity: vi.fn(),
  deleteActivity: vi.fn(),
}));

import * as activityRepo from '@/services/indexeddb/repositories/activityRepository';

const NOW = '2026-02-28T00:00:00.000Z';

function makeActivity(overrides?: Partial<FamilyActivity>): FamilyActivity {
  return {
    id: 'activity-1',
    title: 'Piano Lesson',
    date: '2026-03-04', // A Wednesday
    startTime: '15:00',
    endTime: '16:00',
    recurrence: 'weekly',
    dayOfWeek: 3, // Wednesday
    category: 'lesson',
    assigneeId: 'member-child-1',
    dropoffMemberId: 'member-parent-1',
    pickupMemberId: 'member-parent-2',
    location: 'Music School',
    feeSchedule: 'monthly',
    feeAmount: 200,
    feeCurrency: 'USD',
    feePayerId: 'member-parent-1',
    instructorName: 'Mrs. Smith',
    instructorContact: 'smith@music.com',
    reminderMinutes: 30,
    notes: 'Bring sheet music',
    isActive: true,
    createdBy: 'member-parent-1',
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

describe('activityStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  // ── Load ──

  describe('loadActivities', () => {
    it('should load all activities from repository', async () => {
      const store = useActivityStore();
      const activities = [makeActivity(), makeActivity({ id: 'activity-2', title: 'Soccer' })];
      vi.mocked(activityRepo.getAllActivities).mockResolvedValue(activities);

      await store.loadActivities();

      expect(store.activities).toHaveLength(2);
      expect(activityRepo.getAllActivities).toHaveBeenCalledOnce();
      expect(store.isLoading).toBe(false);
      expect(store.error).toBeNull();
    });

    it('should set error on failure', async () => {
      const store = useActivityStore();
      vi.mocked(activityRepo.getAllActivities).mockRejectedValue(new Error('DB error'));

      await store.loadActivities();

      expect(store.activities).toHaveLength(0);
      expect(store.error).toBe('DB error');
    });
  });

  // ── Create ──

  describe('createActivity', () => {
    it('should create a one-time activity', async () => {
      const store = useActivityStore();
      const input = {
        title: 'Doctor Visit',
        date: '2026-03-15',
        recurrence: 'none' as const,
        category: 'appointment' as const,
        feeSchedule: 'none' as const,
        reminderMinutes: 60 as const,
        isActive: true,
        createdBy: 'member-parent-1',
      };
      const created = makeActivity({ ...input, id: 'new-1' });
      vi.mocked(activityRepo.createActivity).mockResolvedValue(created);

      const result = await store.createActivity(input);

      expect(result).not.toBeNull();
      expect(result!.title).toBe('Doctor Visit');
      expect(result!.recurrence).toBe('none');
      expect(store.activities).toHaveLength(1);
      expect(activityRepo.createActivity).toHaveBeenCalledWith(input);
    });

    it('should create a weekly recurring activity', async () => {
      const store = useActivityStore();
      const input = {
        title: 'Soccer Practice',
        date: '2026-03-02',
        startTime: '09:00',
        endTime: '10:30',
        recurrence: 'weekly' as const,
        dayOfWeek: 1, // Monday
        category: 'sport' as const,
        assigneeId: 'member-child-1',
        feeSchedule: 'per_session' as const,
        feeAmount: 25,
        feeCurrency: 'USD',
        reminderMinutes: 15 as const,
        isActive: true,
        createdBy: 'member-parent-1',
      };
      const created = makeActivity({ ...input, id: 'new-2' });
      vi.mocked(activityRepo.createActivity).mockResolvedValue(created);

      const result = await store.createActivity(input);

      expect(result).not.toBeNull();
      expect(result!.recurrence).toBe('weekly');
      expect(result!.dayOfWeek).toBe(1);
      expect(store.activities).toHaveLength(1);
    });

    it('should return null and set error on failure', async () => {
      const store = useActivityStore();
      vi.mocked(activityRepo.createActivity).mockRejectedValue(new Error('Create failed'));

      const result = await store.createActivity({
        title: 'Fail',
        date: '2026-03-01',
        recurrence: 'none',
        category: 'other',
        feeSchedule: 'none',
        reminderMinutes: 0,
        isActive: true,
        createdBy: 'member-1',
      });

      expect(result).toBeNull();
      expect(store.error).toBe('Create failed');
    });
  });

  // ── Update ──

  describe('updateActivity', () => {
    it('should update an activity title', async () => {
      const store = useActivityStore();
      const existing = makeActivity();
      store.activities.push(existing);

      const updated = { ...existing, title: 'Advanced Piano' };
      vi.mocked(activityRepo.updateActivity).mockResolvedValue(updated);

      const result = await store.updateActivity('activity-1', { title: 'Advanced Piano' });

      expect(result).not.toBeNull();
      expect(result!.title).toBe('Advanced Piano');
      expect(store.activities[0]!.title).toBe('Advanced Piano');
      expect(activityRepo.updateActivity).toHaveBeenCalledWith('activity-1', {
        title: 'Advanced Piano',
      });
    });

    it('should update recurrence from weekly to daily', async () => {
      const store = useActivityStore();
      const existing = makeActivity();
      store.activities.push(existing);

      const updated = { ...existing, recurrence: 'daily' as const };
      vi.mocked(activityRepo.updateActivity).mockResolvedValue(updated);

      const result = await store.updateActivity('activity-1', { recurrence: 'daily' });

      expect(result!.recurrence).toBe('daily');
    });

    it('should return null if activity not found in repo', async () => {
      const store = useActivityStore();
      vi.mocked(activityRepo.updateActivity).mockResolvedValue(undefined);

      const result = await store.updateActivity('nonexistent', { title: 'Nope' });

      expect(result).toBeNull();
    });
  });

  // ── Delete ──

  describe('deleteActivity', () => {
    it('should delete an activity and record tombstone', async () => {
      const store = useActivityStore();
      store.activities.push(makeActivity());
      vi.mocked(activityRepo.deleteActivity).mockResolvedValue(true);

      const result = await store.deleteActivity('activity-1');

      expect(result).toBe(true);
      expect(store.activities).toHaveLength(0);
    });

    it('should return false if activity not found', async () => {
      const store = useActivityStore();
      vi.mocked(activityRepo.deleteActivity).mockResolvedValue(false);

      const result = await store.deleteActivity('nonexistent');

      expect(result).toBe(false);
    });
  });

  // ── Getters ──

  describe('activeActivities', () => {
    it('should only return active activities', () => {
      const store = useActivityStore();
      store.activities.push(makeActivity({ id: '1', isActive: true }));
      store.activities.push(makeActivity({ id: '2', isActive: false }));
      store.activities.push(makeActivity({ id: '3', isActive: true }));

      expect(store.activeActivities).toHaveLength(2);
      expect(store.activeActivities.map((a) => a.id)).toEqual(['1', '3']);
    });
  });

  // ── Recurring Expansion ──

  describe('monthActivities (recurring expansion)', () => {
    it('should expand a weekly activity across the month', () => {
      const store = useActivityStore();
      // Activity starts Wed March 4, repeats weekly
      store.activities.push(
        makeActivity({ id: '1', date: '2026-03-04', recurrence: 'weekly', dayOfWeek: 3 })
      );

      const occurrences = store.monthActivities(2026, 2); // March (0-indexed)
      // March 2026 Wednesdays: 4, 11, 18, 25
      expect(occurrences).toHaveLength(4);
      expect(occurrences.map((o) => o.date)).toEqual([
        '2026-03-04',
        '2026-03-11',
        '2026-03-18',
        '2026-03-25',
      ]);
    });

    it('should not expand a weekly activity before its start date', () => {
      const store = useActivityStore();
      // Activity starts Wed March 18
      store.activities.push(
        makeActivity({ id: '1', date: '2026-03-18', recurrence: 'weekly', dayOfWeek: 3 })
      );

      const occurrences = store.monthActivities(2026, 2); // March
      // Only Wed March 18 and 25
      expect(occurrences).toHaveLength(2);
      expect(occurrences.map((o) => o.date)).toEqual(['2026-03-18', '2026-03-25']);
    });

    it('should show a one-time activity only on its date', () => {
      const store = useActivityStore();
      store.activities.push(makeActivity({ id: '1', date: '2026-03-15', recurrence: 'none' }));

      const march = store.monthActivities(2026, 2);
      expect(march).toHaveLength(1);
      expect(march[0]!.date).toBe('2026-03-15');

      // Not in April
      const april = store.monthActivities(2026, 3);
      expect(april).toHaveLength(0);
    });

    it('should expand a daily activity for every day of the month', () => {
      const store = useActivityStore();
      store.activities.push(makeActivity({ id: '1', date: '2026-03-01', recurrence: 'daily' }));

      const occurrences = store.monthActivities(2026, 2); // March has 31 days
      expect(occurrences).toHaveLength(31);
    });

    it('should expand a monthly activity once per month', () => {
      const store = useActivityStore();
      // Starts on March 10
      store.activities.push(makeActivity({ id: '1', date: '2026-03-10', recurrence: 'monthly' }));

      const march = store.monthActivities(2026, 2);
      expect(march).toHaveLength(1);
      expect(march[0]!.date).toBe('2026-03-10');

      const april = store.monthActivities(2026, 3);
      expect(april).toHaveLength(1);
      expect(april[0]!.date).toBe('2026-04-10');
    });

    it('should expand a yearly activity only in its birth month', () => {
      const store = useActivityStore();
      // Yearly on March 15
      store.activities.push(makeActivity({ id: '1', date: '2026-03-15', recurrence: 'yearly' }));

      const march = store.monthActivities(2026, 2);
      expect(march).toHaveLength(1);

      const april = store.monthActivities(2026, 3);
      expect(april).toHaveLength(0);
    });

    it('should handle inactive activities by excluding them', () => {
      const store = useActivityStore();
      store.activities.push(
        makeActivity({ id: '1', date: '2026-03-04', recurrence: 'weekly', isActive: false })
      );

      const occurrences = store.monthActivities(2026, 2);
      expect(occurrences).toHaveLength(0);
    });
  });

  // ── Reset ──

  describe('resetState', () => {
    it('should clear all state', () => {
      const store = useActivityStore();
      store.activities.push(makeActivity());
      store.resetState();

      expect(store.activities).toHaveLength(0);
      expect(store.isLoading).toBe(false);
      expect(store.error).toBeNull();
    });
  });
});
