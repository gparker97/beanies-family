import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { createMemberFiltered } from '@/composables/useMemberFiltered';
import { wrapAsync } from '@/composables/useStoreActions';
import * as activityRepo from '@/services/automerge/repositories/activityRepository';
import { syncEntityLinkedRecurringItem } from '@/utils/linkedRecurringItem';
import { activityCategoryToExpenseCategory } from '@/constants/categories';
import { calculateMonthlyFee } from '@/utils/finance';
import { useSettingsStore } from './settingsStore';
import { toDateInputValue, addDays, parseLocalDate } from '@/utils/date';
import { normalizeAssignees } from '@/utils/assignees';
import { ACTIVITY_COLORS, getActivityCategoryColor } from '@/constants/activityCategories';
import type {
  FamilyActivity,
  CreateFamilyActivityInput,
  UpdateFamilyActivityInput,
  ISODateString,
  CurrencyCode,
} from '@/types/models';

/** Re-export for backwards compatibility with components that import from here. */
export const CATEGORY_COLORS = ACTIVITY_COLORS;

/** Returns the activity's custom color or falls back to category default. */
export function getActivityColor(activity: FamilyActivity): string {
  return activity.color ?? getActivityCategoryColor(activity.category);
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
  const filteredActivities = createMemberFiltered(activeActivities, (a) => normalizeAssignees(a));

  /** Map of parentActivityId → Set of override dates, for skipping in expansion. */
  const overridesByParent = computed(() => {
    const map = new Map<string, Set<string>>();
    for (const a of activities.value) {
      if (a.parentActivityId) {
        let dates = map.get(a.parentActivityId);
        if (!dates) {
          dates = new Set();
          map.set(a.parentActivityId, dates);
        }
        dates.add(a.originalOccurrenceDate ?? a.date);
      }
    }
    return map;
  });

  /**
   * Expand a single recurring activity into occurrences for a given month.
   */
  function expandRecurring(
    activity: FamilyActivity,
    year: number,
    month: number
  ): { activity: FamilyActivity; date: string }[] {
    const results: { activity: FamilyActivity; date: string }[] = [];
    const startDate = parseLocalDate(activity.date);
    const endDate = activity.recurrenceEndDate ? parseLocalDate(activity.recurrenceEndDate) : null;
    const monthStart = new Date(year, month, 1);
    const monthEnd = new Date(year, month + 1, 0);

    // If the recurrence ended before this month, skip entirely
    if (endDate && endDate < monthStart) return results;

    // Effective month boundary respecting end date
    const effectiveEnd = endDate && endDate < monthEnd ? endDate : monthEnd;

    if (activity.recurrence === 'none') {
      // Multi-day all-day: expand to each day in the date range
      if (activity.isAllDay && activity.endDate) {
        const rangeEnd = parseLocalDate(activity.endDate);
        const cursor = new Date(Math.max(startDate.getTime(), monthStart.getTime()));
        const limit = rangeEnd < monthEnd ? rangeEnd : monthEnd;
        while (cursor <= limit) {
          if (cursor >= startDate) {
            results.push({ activity, date: formatDate(cursor) });
          }
          cursor.setDate(cursor.getDate() + 1);
        }
      } else if (startDate >= monthStart && startDate <= monthEnd) {
        // Single-day one-off
        results.push({ activity, date: activity.date });
      }
    } else if (activity.recurrence === 'daily') {
      const cursor = new Date(Math.max(startDate.getTime(), monthStart.getTime()));
      while (cursor <= effectiveEnd) {
        results.push({ activity, date: formatDate(cursor) });
        cursor.setDate(cursor.getDate() + 1);
      }
    } else if (activity.recurrence === 'weekly') {
      // Multi-day support: use daysOfWeek array, fall back to single day from start date
      const targetDays = activity.daysOfWeek?.length ? activity.daysOfWeek : [startDate.getDay()];

      for (const targetDay of targetDays) {
        // Find first occurrence of targetDay in the month
        const cursor = new Date(monthStart);
        while (cursor.getDay() !== targetDay) {
          cursor.setDate(cursor.getDate() + 1);
        }
        // Only include if activity has started by this date
        while (cursor <= effectiveEnd) {
          if (cursor >= startDate) {
            results.push({ activity, date: formatDate(cursor) });
          }
          cursor.setDate(cursor.getDate() + 7);
        }
      }
    } else if (activity.recurrence === 'monthly') {
      const dayOfMonth = startDate.getDate();
      const candidate = new Date(year, month, Math.min(dayOfMonth, monthEnd.getDate()));
      if (candidate >= startDate && candidate >= monthStart && candidate <= effectiveEnd) {
        results.push({ activity, date: formatDate(candidate) });
      }
    } else if (activity.recurrence === 'yearly') {
      if (startDate.getMonth() === month) {
        const candidate = new Date(year, month, startDate.getDate());
        if (candidate >= startDate && (!endDate || candidate <= endDate)) {
          results.push({ activity, date: formatDate(candidate) });
        }
      }
    }

    // Filter out dates that have materialized overrides (one-offs with parentActivityId)
    const overrides = overridesByParent.value.get(activity.id);
    if (overrides) {
      return results.filter((r) => !overrides.has(r.date));
    }
    return results;
  }

  const formatDate = toDateInputValue;

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
   * Excludes vacation-linked activities (they appear as sidebar cards instead).
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

  // ── Linked recurring payment sync ──────────────────────────────────────────
  async function syncLinkedRecurringPayment(activity: FamilyActivity) {
    const enabled = !!(activity.payFromAccountId && activity.feeAmount);
    const settingsStore = useSettingsStore();
    const isAllSchedule = activity.feeSchedule === 'all';
    const isOneOff = activity.recurrence === 'none';

    // One-off activities and 'all' schedule use the full amount as a one-time payment;
    // recurring activities calculate the monthly equivalent
    const isOneTimePayment = isOneOff || isAllSchedule;
    const paymentAmount = isOneTimePayment
      ? (activity.feeAmount ?? 0)
      : calculateMonthlyFee({
          feeSchedule: activity.feeSchedule,
          feeAmount: activity.feeAmount ?? 0,
          sessionsPerWeek: activity.daysOfWeek?.length || 1,
          feeCustomPeriod: activity.feeCustomPeriod,
          feeCustomPeriodUnit: activity.feeCustomPeriodUnit,
        });
    const newItemId = await syncEntityLinkedRecurringItem({
      enabled,
      existingItemId: activity.linkedRecurringItemId,
      accountId: activity.payFromAccountId,
      amount: paymentAmount,
      currency: (activity.feeCurrency || settingsStore.displayCurrency) as CurrencyCode,
      category: activityCategoryToExpenseCategory(activity.category) || 'other_lessons',
      description: `${activity.title} Fee`,
      activityId: activity.id,
      startDate: activity.date,
      frequency: isOneTimePayment ? 'one-time' : 'monthly',
    });
    // Sync linkedRecurringItemId on the activity (clear with '' when removed)
    const currentId = activity.linkedRecurringItemId || '';
    const nextId = newItemId || '';
    if (nextId !== currentId) {
      await activityRepo.updateActivity(activity.id, { linkedRecurringItemId: nextId });
      activities.value = activities.value.map((a) =>
        a.id === activity.id ? { ...a, linkedRecurringItemId: nextId } : a
      );
    }
  }

  // Actions
  async function loadActivities() {
    await wrapAsync(isLoading, error, async () => {
      activities.value = await activityRepo.getAllActivities();
    });
  }

  async function createActivity(input: CreateFamilyActivityInput): Promise<FamilyActivity | null> {
    const result = await wrapAsync(isLoading, error, async () => {
      const activity = await activityRepo.createActivity(input);
      // Immutable update: assign a new array so downstream computeds re-evaluate
      activities.value = [...activities.value, activity];
      return activity;
    });
    if (result) await syncLinkedRecurringPayment(result);
    return result ?? null;
  }

  async function updateActivity(
    id: string,
    input: UpdateFamilyActivityInput
  ): Promise<FamilyActivity | null> {
    const result = await wrapAsync(isLoading, error, async () => {
      const updated = await activityRepo.updateActivity(id, input);
      if (updated) {
        // Immutable update: assign a new array so downstream computeds re-evaluate
        activities.value = activities.value.map((a) => (a.id === id ? updated : a));
      }
      return updated;
    });
    if (result) await syncLinkedRecurringPayment(result);
    return result ?? null;
  }

  async function deleteActivity(id: string): Promise<boolean> {
    // Prevent standalone deletion of vacation-linked activities
    const activity = activities.value.find((a) => a.id === id);
    if (activity?.vacationId) {
      console.warn(
        'Cannot delete a vacation-linked activity directly. Use vacationStore.deleteVacation() instead.'
      );
      return false;
    }
    const result = await wrapAsync(isLoading, error, async () => {
      const success = await activityRepo.deleteActivity(id);
      if (success) {
        activities.value = activities.value.filter((a) => a.id !== id);
      }
      return success;
    });
    return result ?? false;
  }

  /**
   * Split a recurring activity at a given date.
   * End-dates the original at the day before, creates a new template from the split date.
   */
  async function splitActivity(
    activityId: string,
    fromDate: ISODateString
  ): Promise<FamilyActivity | null> {
    const original = activities.value.find((a) => a.id === activityId);
    if (!original) return null;

    const dayBefore = toDateInputValue(addDays(parseLocalDate(fromDate), -1));
    await updateActivity(activityId, { recurrenceEndDate: dayBefore });

    // Deep-clone to strip Automerge/Vue proxy wrappers (nested arrays like daysOfWeek)
    const {
      id: _id,
      createdAt: _ca,
      updatedAt: _ua,
      recurrenceEndDate: _re,
      ...rest
    } = JSON.parse(JSON.stringify(original));
    return createActivity({
      ...rest,
      date: fromDate,
      recurrenceEndDate: original.recurrenceEndDate,
    });
  }

  /**
   * Materialize a one-off override for a single occurrence of a recurring activity.
   */
  async function materializeOverride(
    parentId: string,
    occurrenceDate: ISODateString,
    overrides?: UpdateFamilyActivityInput
  ): Promise<FamilyActivity | null> {
    const parent = activities.value.find((a) => a.id === parentId);
    if (!parent) return null;

    // Deep-clone to strip Automerge/Vue proxy wrappers (nested arrays like daysOfWeek)
    const {
      id: _id,
      createdAt: _ca,
      updatedAt: _ua,
      recurrence: _rec,
      daysOfWeek: _dow,
      recurrenceEndDate: _re,
      ...rest
    } = JSON.parse(JSON.stringify(parent));
    const finalDate = overrides?.date ?? occurrenceDate;
    const isRescheduled = finalDate !== occurrenceDate;

    return createActivity({
      ...rest,
      ...overrides,
      date: finalDate,
      recurrence: 'none',
      parentActivityId: parentId,
      ...(isRescheduled ? { originalOccurrenceDate: occurrenceDate } : {}),
    });
  }

  /** Remove an activity from the in-memory array (used when another store deletes from the repo directly). */
  function removeFromMemory(id: string) {
    activities.value = activities.value.filter((a) => a.id !== id);
  }

  function resetState() {
    activities.value = [];
    isLoading.value = false;
    error.value = null;
  }

  /**
   * Get all activity occurrences for a specific date (unfiltered by member).
   * Uses activeActivities so pickup/dropoff assignments are never excluded
   * by the global member filter.
   */
  function activitiesForDate(dateStr: string): { activity: FamilyActivity; date: string }[] {
    const d = parseLocalDate(dateStr);
    const all: { activity: FamilyActivity; date: string }[] = [];
    for (const a of activeActivities.value) {
      all.push(...expandRecurring(a, d.getFullYear(), d.getMonth()));
    }
    return all.filter((occ) => occ.date === dateStr);
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
    activitiesForDate,
    // Actions
    loadActivities,
    createActivity,
    updateActivity,
    deleteActivity,
    splitActivity,
    materializeOverride,
    removeFromMemory,
    resetState,
  };
});
