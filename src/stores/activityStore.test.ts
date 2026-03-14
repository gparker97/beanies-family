import { setActivePinia, createPinia } from 'pinia';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useActivityStore } from './activityStore';
import { useFamilyStore } from './familyStore';
import { useMemberFilterStore } from './memberFilterStore';
import type { FamilyActivity, FamilyMember } from '@/types/models';

// Mock the activity repository
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

import * as activityRepo from '@/services/automerge/repositories/activityRepository';

const NOW = '2026-02-28T00:00:00.000Z';

function makeActivity(overrides?: Partial<FamilyActivity>): FamilyActivity {
  return {
    id: 'activity-1',
    title: 'Piano Lesson',
    date: '2026-03-04', // A Wednesday
    startTime: '15:00',
    endTime: '16:00',
    recurrence: 'weekly',
    daysOfWeek: [3], // Wednesday
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
        daysOfWeek: [1], // Monday
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
      expect(result!.daysOfWeek).toEqual([1]);
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
        makeActivity({ id: '1', date: '2026-03-04', recurrence: 'weekly', daysOfWeek: [3] })
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

    it('should expand a multi-day weekly activity on all specified days', () => {
      const store = useActivityStore();
      // Activity on Mon + Wed, starts March 2 (Monday)
      store.activities.push(
        makeActivity({ id: '1', date: '2026-03-02', recurrence: 'weekly', daysOfWeek: [1, 3] })
      );

      const occurrences = store.monthActivities(2026, 2); // March
      // March 2026: Mon 2,9,16,23,30 and Wed 4,11,18,25 = 9 total
      expect(occurrences).toHaveLength(9);
      const dates = occurrences.map((o) => o.date).sort();
      expect(dates).toEqual([
        '2026-03-02',
        '2026-03-04',
        '2026-03-09',
        '2026-03-11',
        '2026-03-16',
        '2026-03-18',
        '2026-03-23',
        '2026-03-25',
        '2026-03-30',
      ]);
    });

    it('should expand a three-day weekly activity (Mon/Wed/Fri)', () => {
      const store = useActivityStore();
      store.activities.push(
        makeActivity({
          id: '1',
          date: '2026-03-02',
          recurrence: 'weekly',
          daysOfWeek: [1, 3, 5],
        })
      );

      const occurrences = store.monthActivities(2026, 2); // March
      // Mon: 2,9,16,23,30 (5) + Wed: 4,11,18,25 (4) + Fri: 6,13,20,27 (4) = 13 total
      expect(occurrences).toHaveLength(13);
      // Verify all dates are Mon, Wed, or Fri
      for (const occ of occurrences) {
        const day = new Date(occ.date).getDay();
        expect([1, 3, 5]).toContain(day);
      }
    });

    it('should fall back to start date day when daysOfWeek is empty', () => {
      const store = useActivityStore();
      // March 4 is a Wednesday, daysOfWeek empty → should use day 3 (Wed)
      store.activities.push(
        makeActivity({ id: '1', date: '2026-03-04', recurrence: 'weekly', daysOfWeek: [] })
      );

      const occurrences = store.monthActivities(2026, 2);
      expect(occurrences).toHaveLength(4); // 4 Wednesdays in March
      expect(occurrences.map((o) => o.date)).toEqual([
        '2026-03-04',
        '2026-03-11',
        '2026-03-18',
        '2026-03-25',
      ]);
    });

    it('should fall back to start date day when daysOfWeek is undefined', () => {
      const store = useActivityStore();
      store.activities.push(
        makeActivity({
          id: '1',
          date: '2026-03-04',
          recurrence: 'weekly',
          daysOfWeek: undefined,
        })
      );

      const occurrences = store.monthActivities(2026, 2);
      expect(occurrences).toHaveLength(4);
    });

    it('should respect start date for multi-day recurrence', () => {
      const store = useActivityStore();
      // Starts March 10 (Tuesday), recurs Mon+Tue
      store.activities.push(
        makeActivity({ id: '1', date: '2026-03-10', recurrence: 'weekly', daysOfWeek: [1, 2] })
      );

      const occurrences = store.monthActivities(2026, 2);
      // Tue: 10,17,24,31 (4) + Mon: 16,23,30 (3, Mon 2 and 9 are before start date) = 7
      expect(occurrences).toHaveLength(7);
      // No dates before March 10
      for (const occ of occurrences) {
        expect(new Date(occ.date) >= new Date('2026-03-10')).toBe(true);
      }
    });

    it('should not expand a weekly activity before its start date', () => {
      const store = useActivityStore();
      // Activity starts Wed March 18
      store.activities.push(
        makeActivity({ id: '1', date: '2026-03-18', recurrence: 'weekly', daysOfWeek: [3] })
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

    // ── recurrenceEndDate ──

    it('should stop weekly expansion at recurrenceEndDate', () => {
      const store = useActivityStore();
      // Starts Wed March 4, ends March 18 (inclusive)
      store.activities.push(
        makeActivity({
          id: '1',
          date: '2026-03-04',
          recurrence: 'weekly',
          daysOfWeek: [3],
          recurrenceEndDate: '2026-03-18',
        })
      );

      const occurrences = store.monthActivities(2026, 2); // March
      // Wed 4, 11, 18 — not 25
      expect(occurrences).toHaveLength(3);
      expect(occurrences.map((o) => o.date)).toEqual(['2026-03-04', '2026-03-11', '2026-03-18']);
    });

    it('should stop daily expansion at recurrenceEndDate', () => {
      const store = useActivityStore();
      store.activities.push(
        makeActivity({
          id: '1',
          date: '2026-03-01',
          recurrence: 'daily',
          recurrenceEndDate: '2026-03-05',
        })
      );

      const occurrences = store.monthActivities(2026, 2);
      expect(occurrences).toHaveLength(5); // March 1-5
      expect(occurrences.map((o) => o.date)).toEqual([
        '2026-03-01',
        '2026-03-02',
        '2026-03-03',
        '2026-03-04',
        '2026-03-05',
      ]);
    });

    it('should stop monthly expansion at recurrenceEndDate', () => {
      const store = useActivityStore();
      // Monthly on the 10th, ends May 1 — should appear in March and April, not May
      store.activities.push(
        makeActivity({
          id: '1',
          date: '2026-03-10',
          recurrence: 'monthly',
          recurrenceEndDate: '2026-05-01',
        })
      );

      expect(store.monthActivities(2026, 2)).toHaveLength(1); // March 10
      expect(store.monthActivities(2026, 3)).toHaveLength(1); // April 10
      expect(store.monthActivities(2026, 4)).toHaveLength(0); // May 10 is after end date
    });

    it('should stop yearly expansion at recurrenceEndDate', () => {
      const store = useActivityStore();
      store.activities.push(
        makeActivity({
          id: '1',
          date: '2026-03-15',
          recurrence: 'yearly',
          recurrenceEndDate: '2027-01-01',
        })
      );

      expect(store.monthActivities(2026, 2)).toHaveLength(1); // March 2026
      expect(store.monthActivities(2027, 2)).toHaveLength(0); // March 2027 is after end date
    });

    it('should return nothing for a month entirely after recurrenceEndDate', () => {
      const store = useActivityStore();
      store.activities.push(
        makeActivity({
          id: '1',
          date: '2026-03-04',
          recurrence: 'weekly',
          daysOfWeek: [3],
          recurrenceEndDate: '2026-03-25',
        })
      );

      // April is entirely after end date
      expect(store.monthActivities(2026, 3)).toHaveLength(0);
    });

    it('should stop multi-day weekly expansion at recurrenceEndDate', () => {
      const store = useActivityStore();
      // Mon + Wed, starts March 2, ends March 12
      store.activities.push(
        makeActivity({
          id: '1',
          date: '2026-03-02',
          recurrence: 'weekly',
          daysOfWeek: [1, 3],
          recurrenceEndDate: '2026-03-12',
        })
      );

      const occurrences = store.monthActivities(2026, 2);
      const dates = occurrences.map((o) => o.date).sort();
      // Mon 2, Wed 4, Mon 9, Wed 11 — Mon 16, Wed 18 etc are after end date
      expect(dates).toEqual(['2026-03-02', '2026-03-04', '2026-03-09', '2026-03-11']);
    });

    it('should ignore recurrenceEndDate for one-time activities', () => {
      const store = useActivityStore();
      store.activities.push(
        makeActivity({
          id: '1',
          date: '2026-03-15',
          recurrence: 'none',
          recurrenceEndDate: '2026-03-10', // end date before the activity date
        })
      );

      // One-time activities ignore recurrenceEndDate
      const occurrences = store.monthActivities(2026, 2);
      expect(occurrences).toHaveLength(1);
    });

    it('should expand normally when recurrenceEndDate is undefined', () => {
      const store = useActivityStore();
      store.activities.push(
        makeActivity({
          id: '1',
          date: '2026-03-04',
          recurrence: 'weekly',
          daysOfWeek: [3],
          recurrenceEndDate: undefined,
        })
      );

      // All 4 Wednesdays in March
      expect(store.monthActivities(2026, 2)).toHaveLength(4);
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

  // ── filteredActivities (member filter integration) ──

  describe('filteredActivities', () => {
    function makeFamilyMember(overrides?: Partial<FamilyMember>): FamilyMember {
      return {
        id: 'member-1',
        name: 'Parent',
        email: 'parent@test.com',
        role: 'member',
        gender: 'male',
        ageGroup: 'adult',
        color: '#3b82f6',
        requiresPassword: false,
        createdAt: NOW,
        updatedAt: NOW,
        ...overrides,
      };
    }

    function setupFilterWithMembers() {
      const familyStore = useFamilyStore();
      familyStore.members.push(
        makeFamilyMember({ id: 'parent-1', name: 'Dad' }),
        makeFamilyMember({ id: 'parent-2', name: 'Mom', gender: 'female' }),
        makeFamilyMember({ id: 'child-1', name: 'Kid', ageGroup: 'child' })
      );
      const memberFilter = useMemberFilterStore();
      memberFilter.initialize();
      return { familyStore, memberFilter };
    }

    it('should return all active activities when filter is not initialized', () => {
      const store = useActivityStore();
      store.activities.push(
        makeActivity({ id: '1', assigneeId: 'parent-1' }),
        makeActivity({ id: '2', assigneeId: 'child-1' })
      );

      expect(store.filteredActivities).toHaveLength(2);
    });

    it('should return all active activities when all members are selected', () => {
      const store = useActivityStore();
      setupFilterWithMembers();

      store.activities.push(
        makeActivity({ id: '1', assigneeId: 'parent-1' }),
        makeActivity({ id: '2', assigneeId: 'parent-2' }),
        makeActivity({ id: '3', assigneeId: 'child-1' })
      );

      expect(store.filteredActivities).toHaveLength(3);
    });

    it('should filter activities by selected member', () => {
      const store = useActivityStore();
      const { memberFilter } = setupFilterWithMembers();

      store.activities.push(
        makeActivity({ id: '1', assigneeId: 'parent-1' }),
        makeActivity({ id: '2', assigneeId: 'parent-2' }),
        makeActivity({ id: '3', assigneeId: 'child-1' })
      );

      // Deselect parent-2 and child-1 → only parent-1 activities
      memberFilter.toggleMember('parent-2');
      memberFilter.toggleMember('child-1');

      expect(store.filteredActivities).toHaveLength(1);
      expect(store.filteredActivities[0]!.id).toBe('1');
    });

    it('should show unassigned activities regardless of filter', () => {
      const store = useActivityStore();
      const { memberFilter } = setupFilterWithMembers();

      store.activities.push(
        makeActivity({ id: '1', assigneeId: 'parent-1' }),
        makeActivity({ id: '2', assigneeId: undefined }),
        makeActivity({ id: '3', assigneeId: 'child-1' })
      );

      // Filter to only parent-1
      memberFilter.toggleMember('parent-2');
      memberFilter.toggleMember('child-1');

      // Should show parent-1's activity + unassigned activity
      expect(store.filteredActivities).toHaveLength(2);
      expect(store.filteredActivities.map((a) => a.id).sort()).toEqual(['1', '2']);
    });

    it('should exclude inactive activities even if member is selected', () => {
      const store = useActivityStore();
      setupFilterWithMembers();

      store.activities.push(
        makeActivity({ id: '1', assigneeId: 'parent-1', isActive: true }),
        makeActivity({ id: '2', assigneeId: 'parent-1', isActive: false })
      );

      expect(store.filteredActivities).toHaveLength(1);
      expect(store.filteredActivities[0]!.id).toBe('1');
    });

    it('should filter monthActivities by selected members', () => {
      const store = useActivityStore();
      const { memberFilter } = setupFilterWithMembers();

      store.activities.push(
        makeActivity({
          id: '1',
          assigneeId: 'parent-1',
          date: '2026-03-04',
          recurrence: 'weekly',
          daysOfWeek: [3],
        }),
        makeActivity({
          id: '2',
          assigneeId: 'child-1',
          date: '2026-03-04',
          recurrence: 'weekly',
          daysOfWeek: [3],
        })
      );

      // All selected → both activities expand across month
      const allOccurrences = store.monthActivities(2026, 2);
      expect(allOccurrences).toHaveLength(8); // 4 Wednesdays * 2 activities

      // Filter to only parent-1
      memberFilter.toggleMember('parent-2');
      memberFilter.toggleMember('child-1');

      const filtered = store.monthActivities(2026, 2);
      expect(filtered).toHaveLength(4); // 4 Wednesdays * 1 activity
      expect(filtered.every((o) => o.activity.assigneeId === 'parent-1')).toBe(true);
    });

    it('should include multi-assignee activity when any assignee is selected', () => {
      const store = useActivityStore();
      const { memberFilter } = setupFilterWithMembers();

      store.activities.push(
        makeActivity({ id: '1', assigneeIds: ['parent-1', 'child-1'], assigneeId: 'parent-1' }),
        makeActivity({ id: '2', assigneeId: 'parent-2' })
      );

      // Filter to only child-1
      memberFilter.toggleMember('parent-1');
      memberFilter.toggleMember('parent-2');

      // Activity 1 should still show because child-1 is one of its assignees
      expect(store.filteredActivities).toHaveLength(1);
      expect(store.filteredActivities[0]!.id).toBe('1');
    });

    it('should include multi-assignee activity when multiple assignees are selected', () => {
      const store = useActivityStore();
      const { memberFilter } = setupFilterWithMembers();

      store.activities.push(
        makeActivity({ id: '1', assigneeIds: ['parent-1', 'child-1'], assigneeId: 'parent-1' })
      );

      // All selected — activity should appear once
      expect(store.filteredActivities).toHaveLength(1);

      // Deselect parent-2 only — both parent-1 and child-1 are still selected
      memberFilter.toggleMember('parent-2');
      expect(store.filteredActivities).toHaveLength(1);
    });

    it('should exclude multi-assignee activity when none of its assignees are selected', () => {
      const store = useActivityStore();
      const { memberFilter } = setupFilterWithMembers();

      store.activities.push(
        makeActivity({ id: '1', assigneeIds: ['parent-1', 'child-1'], assigneeId: 'parent-1' })
      );

      // Deselect both parent-1 and child-1
      memberFilter.toggleMember('parent-1');
      memberFilter.toggleMember('child-1');

      expect(store.filteredActivities).toHaveLength(0);
    });
  });

  // ── Per-instance overrides ──

  describe('expandRecurring with overrides', () => {
    it('should skip dates that have materialized overrides', () => {
      const store = useActivityStore();
      // Weekly Wednesday template
      store.activities.push(
        makeActivity({
          id: 'template-1',
          date: '2026-03-04',
          recurrence: 'weekly',
          daysOfWeek: [3],
        })
      );
      // Override for March 11
      store.activities.push(
        makeActivity({
          id: 'override-1',
          date: '2026-03-11',
          recurrence: 'none',
          parentActivityId: 'template-1',
          title: 'Special Lesson',
        })
      );

      const occurrences = store.monthActivities(2026, 2);
      // 3 template occurrences (4, 18, 25) + 1 override (11) = 4 total
      expect(occurrences).toHaveLength(4);
      // Template should NOT generate March 11
      const templateOccs = occurrences.filter((o) => o.activity.id === 'template-1');
      expect(templateOccs.map((o) => o.date)).toEqual(['2026-03-04', '2026-03-18', '2026-03-25']);
      // Override appears as one-off
      const overrideOccs = occurrences.filter((o) => o.activity.id === 'override-1');
      expect(overrideOccs).toHaveLength(1);
      expect(overrideOccs[0]!.date).toBe('2026-03-11');
    });

    it('should include override as one-off in expansion', () => {
      const store = useActivityStore();
      store.activities.push(
        makeActivity({
          id: 'template-1',
          date: '2026-03-04',
          recurrence: 'weekly',
          daysOfWeek: [3],
        })
      );
      store.activities.push(
        makeActivity({
          id: 'override-1',
          date: '2026-03-11',
          recurrence: 'none',
          parentActivityId: 'template-1',
          title: 'Override Title',
        })
      );

      const occurrences = store.monthActivities(2026, 2);
      const override = occurrences.find((o) => o.activity.title === 'Override Title');
      expect(override).toBeDefined();
      expect(override!.activity.recurrence).toBe('none');
      expect(override!.activity.parentActivityId).toBe('template-1');
    });
  });

  describe('splitActivity', () => {
    it('should end-date original and create new template', async () => {
      const store = useActivityStore();
      const original = makeActivity({
        id: 'split-1',
        date: '2026-03-04',
        recurrence: 'weekly',
        daysOfWeek: [3],
      });
      store.activities.push(original);

      vi.mocked(activityRepo.updateActivity).mockResolvedValue({
        ...original,
        recurrenceEndDate: '2026-03-17',
      });
      vi.mocked(activityRepo.createActivity).mockResolvedValue({
        ...original,
        id: 'split-2',
        date: '2026-03-18',
        recurrenceEndDate: undefined,
      });

      const newTemplate = await store.splitActivity('split-1', '2026-03-18');

      expect(activityRepo.updateActivity).toHaveBeenCalledWith(
        'split-1',
        expect.objectContaining({ recurrenceEndDate: '2026-03-17' })
      );
      expect(activityRepo.createActivity).toHaveBeenCalledWith(
        expect.objectContaining({
          date: '2026-03-18',
          recurrence: 'weekly',
          daysOfWeek: [3],
        })
      );
      expect(newTemplate).toBeDefined();
      expect(newTemplate!.id).toBe('split-2');
    });

    it('should preserve original recurrenceEndDate on new template', async () => {
      const store = useActivityStore();
      const original = makeActivity({
        id: 'split-1',
        date: '2026-03-04',
        recurrence: 'weekly',
        recurrenceEndDate: '2026-06-30',
      });
      store.activities.push(original);

      vi.mocked(activityRepo.updateActivity).mockResolvedValue({
        ...original,
        recurrenceEndDate: '2026-03-17',
      });
      vi.mocked(activityRepo.createActivity).mockResolvedValue({
        ...original,
        id: 'split-2',
        date: '2026-03-18',
        recurrenceEndDate: '2026-06-30',
      });

      await store.splitActivity('split-1', '2026-03-18');

      expect(activityRepo.createActivity).toHaveBeenCalledWith(
        expect.objectContaining({ recurrenceEndDate: '2026-06-30' })
      );
    });
  });

  describe('splitActivity with multi-day recurrence', () => {
    it('should not generate overlapping occurrences after split', () => {
      const store = useActivityStore();
      // Original: Tue/Thu/Sat starting March 3 (a Tuesday), end-dated to March 16
      store.activities.push(
        makeActivity({
          id: 'original',
          date: '2026-03-03',
          recurrence: 'weekly',
          daysOfWeek: [2, 4, 6], // Tue, Thu, Sat
          recurrenceEndDate: '2026-03-16', // End before split point
        })
      );
      // New template: Tue/Fri/Sat starting March 17 (a Tuesday)
      store.activities.push(
        makeActivity({
          id: 'new-template',
          date: '2026-03-17',
          recurrence: 'weekly',
          daysOfWeek: [2, 5, 6], // Tue, Fri, Sat
        })
      );

      const occurrences = store.monthActivities(2026, 2); // March 2026

      // Original should only produce dates <= March 16
      const originalDates = occurrences
        .filter((o) => o.activity.id === 'original')
        .map((o) => o.date)
        .sort();
      // Tue 3, Thu 5, Sat 7, Tue 10, Thu 12, Sat 14 — all <= Mar 16
      expect(originalDates).toEqual([
        '2026-03-03',
        '2026-03-05',
        '2026-03-07',
        '2026-03-10',
        '2026-03-12',
        '2026-03-14',
      ]);

      // New template should only produce dates >= March 17
      const newDates = occurrences
        .filter((o) => o.activity.id === 'new-template')
        .map((o) => o.date)
        .sort();
      // Tue 17, Fri 20, Sat 21, Tue 24, Fri 27, Sat 28, Tue 31
      expect(newDates).toEqual([
        '2026-03-17',
        '2026-03-20',
        '2026-03-21',
        '2026-03-24',
        '2026-03-27',
        '2026-03-28',
        '2026-03-31',
      ]);

      // No date should appear in both
      const allDates = occurrences.map((o) => o.date);
      const uniqueDates = new Set(allDates);
      expect(uniqueDates.size).toBe(allDates.length);
    });

    it('should not generate new template occurrences before split date', () => {
      const store = useActivityStore();
      // New template starting March 17 should NOT generate any dates before that
      store.activities.push(
        makeActivity({
          id: 'new-template',
          date: '2026-03-17',
          recurrence: 'weekly',
          daysOfWeek: [2, 5, 6], // Tue, Fri, Sat
        })
      );

      const occurrences = store.monthActivities(2026, 2);
      const dates = occurrences.map((o) => o.date).sort();

      // All dates must be >= March 17
      for (const d of dates) {
        expect(d >= '2026-03-17').toBe(true);
      }
      // Specifically, no March 3, 6, 7, 10, 13, 14 etc.
      expect(dates).toEqual([
        '2026-03-17',
        '2026-03-20',
        '2026-03-21',
        '2026-03-24',
        '2026-03-27',
        '2026-03-28',
        '2026-03-31',
      ]);
    });

    it('should handle split exactly on a recurrence day boundary', () => {
      const store = useActivityStore();
      // Original ends March 16 (Monday - not a recurrence day)
      store.activities.push(
        makeActivity({
          id: 'original',
          date: '2026-03-03',
          recurrence: 'weekly',
          daysOfWeek: [2, 4, 6],
          recurrenceEndDate: '2026-03-16',
        })
      );
      // New template starts March 17 (Tuesday - IS a recurrence day)
      store.activities.push(
        makeActivity({
          id: 'new-template',
          date: '2026-03-17',
          recurrence: 'weekly',
          daysOfWeek: [2, 4, 6],
        })
      );

      const occurrences = store.monthActivities(2026, 2);
      // March 17 (Tue) should only appear once, from new-template
      const mar17 = occurrences.filter((o) => o.date === '2026-03-17');
      expect(mar17).toHaveLength(1);
      expect(mar17[0]!.activity.id).toBe('new-template');
    });

    it('should correctly handle daysOfWeek change at split boundary', () => {
      const store = useActivityStore();
      // Scenario: Tue/Thu/Sat changed to Tue/Fri/Sat from week 3
      // Original ends March 16 (Mon)
      store.activities.push(
        makeActivity({
          id: 'original',
          date: '2026-03-03',
          recurrence: 'weekly',
          daysOfWeek: [2, 4, 6], // Tue, Thu, Sat
          recurrenceEndDate: '2026-03-16',
        })
      );
      // New template starts March 17 with changed days
      store.activities.push(
        makeActivity({
          id: 'new-template',
          date: '2026-03-17',
          recurrence: 'weekly',
          daysOfWeek: [2, 5, 6], // Tue, Fri, Sat (Thu→Fri change)
        })
      );

      const occurrences = store.monthActivities(2026, 2);

      // Original should have Thu (day 4) but NOT Fri
      const originalDates = occurrences
        .filter((o) => o.activity.id === 'original')
        .map((o) => o.date);
      expect(originalDates).toContain('2026-03-05'); // Thu
      expect(originalDates).toContain('2026-03-12'); // Thu
      expect(originalDates).not.toContain('2026-03-06'); // No Fri in original
      expect(originalDates).not.toContain('2026-03-13'); // No Fri in original

      // New template should have Fri (day 5) but NOT Thu
      const newDates = occurrences
        .filter((o) => o.activity.id === 'new-template')
        .map((o) => o.date);
      expect(newDates).toContain('2026-03-20'); // Fri
      expect(newDates).toContain('2026-03-27'); // Fri
      expect(newDates).not.toContain('2026-03-19'); // No Thu in new
      expect(newDates).not.toContain('2026-03-26'); // No Thu in new
    });
  });

  describe('materializeOverride', () => {
    it('should create one-off with parentActivityId', async () => {
      const store = useActivityStore();
      const parent = makeActivity({
        id: 'parent-1',
        date: '2026-03-04',
        recurrence: 'weekly',
        daysOfWeek: [3],
      });
      store.activities.push(parent);

      vi.mocked(activityRepo.createActivity).mockResolvedValue({
        ...parent,
        id: 'override-1',
        date: '2026-03-11',
        recurrence: 'none',
        parentActivityId: 'parent-1',
        daysOfWeek: undefined,
      });

      const override = await store.materializeOverride('parent-1', '2026-03-11');

      expect(activityRepo.createActivity).toHaveBeenCalledWith(
        expect.objectContaining({
          date: '2026-03-11',
          recurrence: 'none',
          parentActivityId: 'parent-1',
        })
      );
      expect(override).toBeDefined();
      expect(override!.recurrence).toBe('none');
    });

    it('should apply overrides on top of parent fields', async () => {
      const store = useActivityStore();
      const parent = makeActivity({ id: 'parent-1', startTime: '15:00' });
      store.activities.push(parent);

      vi.mocked(activityRepo.createActivity).mockResolvedValue({
        ...parent,
        id: 'override-1',
        date: '2026-03-11',
        recurrence: 'none',
        parentActivityId: 'parent-1',
        startTime: '16:00',
      });

      await store.materializeOverride('parent-1', '2026-03-11', { startTime: '16:00' });

      expect(activityRepo.createActivity).toHaveBeenCalledWith(
        expect.objectContaining({ startTime: '16:00' })
      );
    });

    it('should strip recurrence fields from materialized activity', async () => {
      const store = useActivityStore();
      const parent = makeActivity({
        id: 'parent-1',
        recurrence: 'weekly',
        daysOfWeek: [1, 3],
        recurrenceEndDate: '2026-06-30',
      });
      store.activities.push(parent);

      vi.mocked(activityRepo.createActivity).mockImplementation(async (input) => ({
        ...input,
        id: 'override-1',
        createdAt: NOW,
        updatedAt: NOW,
      }));

      await store.materializeOverride('parent-1', '2026-03-11');

      const createCall = vi.mocked(activityRepo.createActivity).mock.calls[0]![0];
      expect(createCall.recurrence).toBe('none');
      expect(createCall.daysOfWeek).toBeUndefined();
      expect(createCall.recurrenceEndDate).toBeUndefined();
    });
  });

  // ── Reschedule (materializeOverride with date change) ──

  describe('reschedule via materializeOverride', () => {
    it('should create override with the new date when overrides.date is provided', async () => {
      const store = useActivityStore();
      const parent = makeActivity({
        id: 'parent-1',
        date: '2026-03-04',
        recurrence: 'weekly',
        daysOfWeek: [3],
        startTime: '15:00',
        endTime: '16:00',
      });
      store.activities.push(parent);

      vi.mocked(activityRepo.createActivity).mockImplementation(async (input) => ({
        ...input,
        id: 'override-1',
        createdAt: NOW,
        updatedAt: NOW,
      }));

      const override = await store.materializeOverride('parent-1', '2026-03-11', {
        date: '2026-03-14',
      });

      expect(override).toBeDefined();
      // Override should be on the NEW date, not the original occurrence date
      expect(override!.date).toBe('2026-03-14');
      expect(override!.recurrence).toBe('none');
      expect(override!.parentActivityId).toBe('parent-1');
    });

    it('should set originalOccurrenceDate when date differs from occurrenceDate', async () => {
      const store = useActivityStore();
      store.activities.push(
        makeActivity({ id: 'parent-1', recurrence: 'weekly', daysOfWeek: [3] })
      );

      vi.mocked(activityRepo.createActivity).mockImplementation(async (input) => ({
        ...input,
        id: 'override-1',
        createdAt: NOW,
        updatedAt: NOW,
      }));

      await store.materializeOverride('parent-1', '2026-03-11', { date: '2026-03-14' });

      const createCall = vi.mocked(activityRepo.createActivity).mock.calls[0]![0];
      expect(createCall.date).toBe('2026-03-14');
      expect(createCall.originalOccurrenceDate).toBe('2026-03-11');
    });

    it('should NOT set originalOccurrenceDate when date is same as occurrenceDate', async () => {
      const store = useActivityStore();
      store.activities.push(
        makeActivity({ id: 'parent-1', recurrence: 'weekly', daysOfWeek: [3] })
      );

      vi.mocked(activityRepo.createActivity).mockImplementation(async (input) => ({
        ...input,
        id: 'override-1',
        createdAt: NOW,
        updatedAt: NOW,
      }));

      await store.materializeOverride('parent-1', '2026-03-11', { startTime: '16:00' });

      const createCall = vi.mocked(activityRepo.createActivity).mock.calls[0]![0];
      expect(createCall.date).toBe('2026-03-11');
      expect(createCall.originalOccurrenceDate).toBeUndefined();
    });

    it('should use occurrenceDate as fallback when no date override provided', async () => {
      const store = useActivityStore();
      store.activities.push(
        makeActivity({ id: 'parent-1', recurrence: 'weekly', daysOfWeek: [3] })
      );

      vi.mocked(activityRepo.createActivity).mockImplementation(async (input) => ({
        ...input,
        id: 'override-1',
        createdAt: NOW,
        updatedAt: NOW,
      }));

      await store.materializeOverride('parent-1', '2026-03-11');

      const createCall = vi.mocked(activityRepo.createActivity).mock.calls[0]![0];
      expect(createCall.date).toBe('2026-03-11');
    });

    it('should include time overrides alongside date reschedule', async () => {
      const store = useActivityStore();
      store.activities.push(
        makeActivity({
          id: 'parent-1',
          recurrence: 'weekly',
          daysOfWeek: [3],
          startTime: '15:00',
          endTime: '16:00',
        })
      );

      vi.mocked(activityRepo.createActivity).mockImplementation(async (input) => ({
        ...input,
        id: 'override-1',
        createdAt: NOW,
        updatedAt: NOW,
      }));

      await store.materializeOverride('parent-1', '2026-03-11', {
        date: '2026-03-14',
        startTime: '10:00',
        endTime: '11:00',
      });

      const createCall = vi.mocked(activityRepo.createActivity).mock.calls[0]![0];
      expect(createCall.date).toBe('2026-03-14');
      expect(createCall.startTime).toBe('10:00');
      expect(createCall.endTime).toBe('11:00');
      expect(createCall.originalOccurrenceDate).toBe('2026-03-11');
    });
  });

  describe('overridesByParent with originalOccurrenceDate', () => {
    it('should exclude original occurrence date when override is rescheduled', () => {
      const store = useActivityStore();
      // Weekly Wednesday template
      store.activities.push(
        makeActivity({
          id: 'template-1',
          date: '2026-03-04',
          recurrence: 'weekly',
          daysOfWeek: [3],
        })
      );
      // Rescheduled override: March 11 moved to March 14
      store.activities.push(
        makeActivity({
          id: 'override-1',
          date: '2026-03-14', // new date (Saturday)
          recurrence: 'none',
          parentActivityId: 'template-1',
          originalOccurrenceDate: '2026-03-11', // original Wednesday
          title: 'Rescheduled Lesson',
        })
      );

      const occurrences = store.monthActivities(2026, 2);
      // Template Wednesdays: 4, 18, 25 (11 excluded) + override on 14 = 4 total
      expect(occurrences).toHaveLength(4);
      const templateDates = occurrences
        .filter((o) => o.activity.id === 'template-1')
        .map((o) => o.date);
      expect(templateDates).toEqual(['2026-03-04', '2026-03-18', '2026-03-25']);
      // Override appears on the new date
      const overrideOcc = occurrences.find((o) => o.activity.id === 'override-1');
      expect(overrideOcc).toBeDefined();
      expect(overrideOcc!.date).toBe('2026-03-14');
    });

    it('should fall back to date when originalOccurrenceDate is not set', () => {
      const store = useActivityStore();
      store.activities.push(
        makeActivity({
          id: 'template-1',
          date: '2026-03-04',
          recurrence: 'weekly',
          daysOfWeek: [3],
        })
      );
      // Same-date override (no reschedule) — no originalOccurrenceDate
      store.activities.push(
        makeActivity({
          id: 'override-1',
          date: '2026-03-11',
          recurrence: 'none',
          parentActivityId: 'template-1',
          title: 'Modified Lesson',
        })
      );

      const occurrences = store.monthActivities(2026, 2);
      // Template: 4, 18, 25 (11 excluded) + override on 11 = 4
      expect(occurrences).toHaveLength(4);
      const templateDates = occurrences
        .filter((o) => o.activity.id === 'template-1')
        .map((o) => o.date);
      expect(templateDates).toEqual(['2026-03-04', '2026-03-18', '2026-03-25']);
    });

    it('should restore original occurrence when rescheduled override is deleted', () => {
      const store = useActivityStore();
      store.activities.push(
        makeActivity({
          id: 'template-1',
          date: '2026-03-04',
          recurrence: 'weekly',
          daysOfWeek: [3],
        })
      );

      // Before override: all 4 Wednesdays
      let occurrences = store.monthActivities(2026, 2);
      expect(occurrences).toHaveLength(4);

      // Add rescheduled override
      const override = makeActivity({
        id: 'override-1',
        date: '2026-03-14',
        recurrence: 'none',
        parentActivityId: 'template-1',
        originalOccurrenceDate: '2026-03-11',
      });
      store.activities.push(override);

      occurrences = store.monthActivities(2026, 2);
      expect(occurrences).toHaveLength(4); // 3 template + 1 override

      // Remove override (simulates delete)
      store.activities.splice(store.activities.indexOf(override), 1);

      // Original occurrence should reappear
      occurrences = store.monthActivities(2026, 2);
      expect(occurrences).toHaveLength(4); // all 4 Wednesdays restored
      expect(occurrences.map((o) => o.date)).toEqual([
        '2026-03-04',
        '2026-03-11',
        '2026-03-18',
        '2026-03-25',
      ]);
    });
  });

  // ── activitiesForDate ──

  describe('activitiesForDate', () => {
    it('should return one-off activity matching the given date', () => {
      const store = useActivityStore();
      store.activities.push(makeActivity({ id: '1', date: '2026-03-04', recurrence: 'none' }));

      const result = store.activitiesForDate('2026-03-04');
      expect(result).toHaveLength(1);
      expect(result[0]!.activity.id).toBe('1');
      expect(result[0]!.date).toBe('2026-03-04');
    });

    it('should not return one-off activity on a different date', () => {
      const store = useActivityStore();
      store.activities.push(makeActivity({ id: '1', date: '2026-03-04', recurrence: 'none' }));

      const result = store.activitiesForDate('2026-03-05');
      expect(result).toHaveLength(0);
    });

    it('should expand weekly recurring activity to matching dates', () => {
      const store = useActivityStore();
      store.activities.push(
        makeActivity({
          id: '1',
          date: '2026-03-04', // Wednesday
          recurrence: 'weekly',
          daysOfWeek: [3], // Wednesday
        })
      );

      // March 11 is the next Wednesday
      const result = store.activitiesForDate('2026-03-11');
      expect(result).toHaveLength(1);
      expect(result[0]!.date).toBe('2026-03-11');
    });

    it('should exclude inactive activities', () => {
      const store = useActivityStore();
      store.activities.push(
        makeActivity({ id: '1', date: '2026-03-04', recurrence: 'none', isActive: false })
      );

      const result = store.activitiesForDate('2026-03-04');
      expect(result).toHaveLength(0);
    });

    it('should return activities regardless of member filter', () => {
      const store = useActivityStore();
      const memberFilter = useMemberFilterStore();
      const familyStore = useFamilyStore();

      // Set up a member filter that would normally exclude this activity
      familyStore.members.push({
        id: 'member-parent-1',
        name: 'Parent',
        role: 'owner',
      } as FamilyMember);
      familyStore.members.push({
        id: 'member-child-1',
        name: 'Child',
        role: 'member',
      } as FamilyMember);
      memberFilter.initialize();
      memberFilter.toggleMember('member-child-1'); // deselect child

      store.activities.push(
        makeActivity({
          id: '1',
          date: '2026-03-04',
          recurrence: 'none',
          assigneeId: 'member-child-1',
          pickupMemberId: 'member-parent-1',
        })
      );

      // activitiesForDate uses activeActivities (unfiltered) — should still find it
      const result = store.activitiesForDate('2026-03-04');
      expect(result).toHaveLength(1);
    });
  });
});
