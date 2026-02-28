import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { useMemberFilterStore } from './memberFilterStore';
import { useTombstoneStore } from './tombstoneStore';
import * as activityRepo from '@/services/indexeddb/repositories/activityRepository';
import type {
  FamilyActivity,
  CreateFamilyActivityInput,
  UpdateFamilyActivityInput,
  ActivityCategory,
} from '@/types/models';

/** Default highlight color per activity category. */
export const CATEGORY_COLORS: Record<ActivityCategory, string> = {
  lesson: '#AED6F1',
  sport: '#27AE60',
  appointment: '#F15D22',
  social: '#9B59B6',
  pickup: '#E67E22',
  other: '#95A5A6',
};

/** Returns the activity's custom color or falls back to category default. */
export function getActivityColor(activity: FamilyActivity): string {
  return activity.color ?? CATEGORY_COLORS[activity.category];
}

export const useActivityStore = defineStore('activities', () => {
  // State
  const activities = ref<FamilyActivity[]>([]);
  const isLoading = ref(false);
  const error = ref<string | null>(null);

  // Getters
  const activeActivities = computed(() => activities.value.filter((a) => a.isActive));
  const inactiveActivities = computed(() => activities.value.filter((a) => !a.isActive));

  // Filtered getters (by global member filter)
  const filteredActivities = computed(() => {
    const memberFilter = useMemberFilterStore();
    if (!memberFilter.isInitialized || memberFilter.isAllSelected) {
      return activeActivities.value;
    }
    return activeActivities.value.filter((a) => {
      if (!a.assigneeId) return true;
      return memberFilter.isMemberSelected(a.assigneeId);
    });
  });

  /**
   * Expand a single recurring activity into occurrences for a given month.
   */
  /**
   * Parse a YYYY-MM-DD string as local midnight (not UTC).
   * new Date('2026-03-04') parses as UTC; new Date(y, m, d) is local.
   * Mixing the two causes off-by-one bugs in non-UTC timezones.
   */
  function parseLocalDate(dateStr: string): Date {
    const parts = dateStr.split('-').map(Number);
    return new Date(parts[0]!, parts[1]! - 1, parts[2]!);
  }

  function expandRecurring(
    activity: FamilyActivity,
    year: number,
    month: number
  ): { activity: FamilyActivity; date: string }[] {
    const results: { activity: FamilyActivity; date: string }[] = [];
    const startDate = parseLocalDate(activity.date);
    const monthStart = new Date(year, month, 1);
    const monthEnd = new Date(year, month + 1, 0);

    if (activity.recurrence === 'none') {
      // One-off: only include if it falls in this month
      if (startDate >= monthStart && startDate <= monthEnd) {
        results.push({ activity, date: activity.date });
      }
      return results;
    }

    if (activity.recurrence === 'daily') {
      // Generate each day of the month from the start date
      const cursor = new Date(Math.max(startDate.getTime(), monthStart.getTime()));
      while (cursor <= monthEnd) {
        results.push({ activity, date: formatDate(cursor) });
        cursor.setDate(cursor.getDate() + 1);
      }
      return results;
    }

    if (activity.recurrence === 'weekly') {
      // Multi-day support: use daysOfWeek array, fall back to single day from start date
      const targetDays = activity.daysOfWeek?.length ? activity.daysOfWeek : [startDate.getDay()];

      for (const targetDay of targetDays) {
        // Find first occurrence of targetDay in the month
        const cursor = new Date(monthStart);
        while (cursor.getDay() !== targetDay) {
          cursor.setDate(cursor.getDate() + 1);
        }
        // Only include if activity has started by this date
        while (cursor <= monthEnd) {
          if (cursor >= startDate) {
            results.push({ activity, date: formatDate(cursor) });
          }
          cursor.setDate(cursor.getDate() + 7);
        }
      }
      return results;
    }

    if (activity.recurrence === 'monthly') {
      const dayOfMonth = startDate.getDate();
      const candidate = new Date(year, month, Math.min(dayOfMonth, monthEnd.getDate()));
      if (candidate >= startDate && candidate >= monthStart && candidate <= monthEnd) {
        results.push({ activity, date: formatDate(candidate) });
      }
      return results;
    }

    if (activity.recurrence === 'yearly') {
      if (startDate.getMonth() === month) {
        const candidate = new Date(year, month, startDate.getDate());
        if (candidate >= startDate) {
          results.push({ activity, date: formatDate(candidate) });
        }
      }
      return results;
    }

    return results;
  }

  function formatDate(d: Date): string {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  /**
   * Get all occurrences (direct + recurring expanded) for a given month.
   */
  function monthActivities(year: number, month: number) {
    const all: { activity: FamilyActivity; date: string }[] = [];
    for (const a of filteredActivities.value) {
      all.push(...expandRecurring(a, year, month));
    }
    return all;
  }

  /**
   * Get upcoming activities from today, limited to `limit` items.
   */
  const upcomingActivities = computed(() => {
    const today = new Date();
    const results: { activity: FamilyActivity; date: string }[] = [];

    // Look ahead 90 days
    for (const a of filteredActivities.value) {
      for (let i = 0; i < 3; i++) {
        const y = today.getFullYear();
        const m = today.getMonth() + i;
        const expanded = expandRecurring(a, y, m);
        for (const occ of expanded) {
          if (occ.date >= formatDate(today)) {
            results.push(occ);
          }
        }
      }
    }

    // Sort by date then startTime
    results.sort((a, b) => {
      const dateCmp = a.date.localeCompare(b.date);
      if (dateCmp !== 0) return dateCmp;
      return (a.activity.startTime ?? '').localeCompare(b.activity.startTime ?? '');
    });

    return results.slice(0, 30);
  });

  // Actions
  async function loadActivities() {
    isLoading.value = true;
    error.value = null;
    try {
      activities.value = await activityRepo.getAllActivities();
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to load activities';
    } finally {
      isLoading.value = false;
    }
  }

  async function createActivity(input: CreateFamilyActivityInput): Promise<FamilyActivity | null> {
    isLoading.value = true;
    error.value = null;
    try {
      const activity = await activityRepo.createActivity(input);
      activities.value.push(activity);
      return activity;
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to create activity';
      return null;
    } finally {
      isLoading.value = false;
    }
  }

  async function updateActivity(
    id: string,
    input: UpdateFamilyActivityInput
  ): Promise<FamilyActivity | null> {
    isLoading.value = true;
    error.value = null;
    try {
      const updated = await activityRepo.updateActivity(id, input);
      if (updated) {
        const index = activities.value.findIndex((a) => a.id === id);
        if (index !== -1) {
          activities.value[index] = updated;
        }
      }
      return updated ?? null;
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to update activity';
      return null;
    } finally {
      isLoading.value = false;
    }
  }

  async function deleteActivity(id: string): Promise<boolean> {
    isLoading.value = true;
    error.value = null;
    try {
      const success = await activityRepo.deleteActivity(id);
      if (success) {
        useTombstoneStore().recordDeletion('familyActivity', id);
        activities.value = activities.value.filter((a) => a.id !== id);
      }
      return success;
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to delete activity';
      return false;
    } finally {
      isLoading.value = false;
    }
  }

  function resetState() {
    activities.value = [];
    isLoading.value = false;
    error.value = null;
  }

  return {
    // State
    activities,
    isLoading,
    error,
    // Getters
    activeActivities,
    inactiveActivities,
    filteredActivities,
    upcomingActivities,
    // Methods
    monthActivities,
    // Actions
    loadActivities,
    createActivity,
    updateActivity,
    deleteActivity,
    resetState,
  };
});
