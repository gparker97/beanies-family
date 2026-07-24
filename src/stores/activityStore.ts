import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { createMemberFiltered } from '@/composables/useMemberFiltered';
import { wrapAsync } from '@/composables/useStoreActions';
import * as activityRepo from '@/services/automerge/repositories/activityRepository';
import { syncEntityLinkedRecurringItem } from '@/utils/linkedRecurringItem';
import { activityCategoryToExpenseCategory } from '@/constants/categories';
import { calculateMonthlyFee } from '@/utils/finance';
import { useSettingsStore } from './settingsStore';
import {
  toDateInputValue,
  addDays,
  parseLocalDate,
  getWeekdayOrdinalInMonth,
  nthWeekdayOfMonth,
} from '@/utils/date';
import { useToday } from '@/composables/useToday';
import { normalizeAssignees } from '@/utils/assignees';
import { overrideOccurrenceYmd } from '@/utils/calendar/overrideOccurrenceYmd';
import { ACTIVITY_COLORS, getActivityCategoryColor } from '@/constants/activityCategories';
import { selectActivitiesToBackfill } from '@/utils/activityReminderBackfill';
import { DEFAULT_ACTIVITY_LEAD } from '@/utils/reminderSchedule';
import { logEvent } from '@/services/telemetry';
import { reportError } from '@/utils/errorReporter';
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
        dates.add(overrideOccurrenceYmd(a));
      }
    }
    return map;
  });

  /**
   * Periodic (every-N-days) recurrence helper, shared by `'weekly'` and
   * `'biweekly'`. The weekly case passes `stepDays=7` and may include
   * multi-day-of-week (via `daysOfWeek`); the biweekly case passes
   * `stepDays=14` and single-day-only (anchored to `startDate`'s weekday).
   */
  function expandPeriodic(
    activity: FamilyActivity,
    startDate: Date,
    monthStart: Date,
    effectiveEnd: Date,
    stepDays: 7 | 14
  ): { activity: FamilyActivity; date: string }[] {
    const results: { activity: FamilyActivity; date: string }[] = [];
    // Multi-day only for weekly (step=7); biweekly anchors to the start
    // date's weekday and ignores `daysOfWeek` (out of scope by design).
    const targetDays =
      stepDays === 7 && activity.daysOfWeek?.length ? activity.daysOfWeek : [startDate.getDay()];

    for (const targetDay of targetDays) {
      // For biweekly: anchor to a date that's both this targetDay AND
      // aligned to startDate's cadence (same parity of weeks-since-start).
      // We start from startDate and step forward by `stepDays` until we're
      // within the month window.
      const cursor =
        stepDays === 14
          ? new Date(startDate)
          : (() => {
              const c = new Date(monthStart);
              while (c.getDay() !== targetDay) c.setDate(c.getDate() + 1);
              return c;
            })();

      // Advance cursor up to monthStart (for biweekly when startDate is earlier).
      while (cursor < monthStart) {
        cursor.setDate(cursor.getDate() + stepDays);
      }

      while (cursor <= effectiveEnd) {
        if (cursor >= startDate) {
          results.push({ activity, date: formatDate(cursor) });
        }
        cursor.setDate(cursor.getDate() + stepDays);
      }
    }
    return results;
  }

  /**
   * Expand a single recurring activity into occurrences for a given month.
   *
   * Failure modes (NEVER silent — all surface via `reportError`):
   *   - `activity.date` is missing/invalid → warning, no occurrences emitted.
   *   - `activity.recurrence` is not a known enum value → error, no
   *     occurrences. Catches future enum drift and corrupt data.
   *
   * On success, applies the override filter (`parentActivityId` +
   * `originalOccurrenceDate`) so a one-off override of a recurring date
   * replaces the parent's occurrence at that date.
   */
  function expandRecurring(
    activity: FamilyActivity,
    year: number,
    month: number
  ): { activity: FamilyActivity; date: string }[] {
    const startDate = activity.date ? parseLocalDate(activity.date) : null;
    if (!startDate || Number.isNaN(startDate.getTime())) {
      reportError({
        surface: 'activityStore.invalidStartDate',
        message: `Activity ${activity.id} has invalid date "${activity.date}" — skipping occurrence expansion`,
        severity: 'warning',
        context: {
          activity_id: activity.id,
          recurrence: activity.recurrence,
          raw_date: activity.date ?? null,
        },
      });
      return [];
    }

    const endDate = activity.recurrenceEndDate ? parseLocalDate(activity.recurrenceEndDate) : null;
    const monthStart = new Date(year, month, 1);
    const monthEnd = new Date(year, month + 1, 0);

    // If the recurrence ended before this month, skip entirely.
    if (endDate && endDate < monthStart) return [];

    // Effective month boundary respecting end date.
    const effectiveEnd = endDate && endDate < monthEnd ? endDate : monthEnd;

    let results: { activity: FamilyActivity; date: string }[];
    switch (activity.recurrence) {
      case 'none':
        results = expandOneOff(activity, startDate, monthStart, monthEnd);
        break;
      case 'daily':
        results = expandDaily(activity, startDate, monthStart, effectiveEnd);
        break;
      case 'weekly':
        results = expandPeriodic(activity, startDate, monthStart, effectiveEnd, 7);
        break;
      case 'biweekly':
        results = expandPeriodic(activity, startDate, monthStart, effectiveEnd, 14);
        break;
      case 'monthly':
        results = expandMonthlyByDate(
          activity,
          startDate,
          year,
          month,
          monthStart,
          monthEnd,
          effectiveEnd
        );
        break;
      case 'monthly-by-day':
        results = expandMonthlyByDay(activity, startDate, year, month, monthStart, effectiveEnd);
        break;
      case 'yearly':
        results = expandYearly(activity, startDate, year, month, endDate);
        break;
      default: {
        // Exhaustive guard. If a future `ActivityRecurrence` value is added
        // without a case here, we surface loudly + return no occurrences
        // rather than silently dropping the activity from the calendar.
        const exhaustiveCheck: never = activity.recurrence;
        reportError({
          surface: 'activityStore.unknownRecurrence',
          message: `Activity ${activity.id} has unknown recurrence "${String(exhaustiveCheck)}" — calendar will not show it until this is fixed`,
          severity: 'error',
          context: { activity_id: activity.id, recurrence: String(exhaustiveCheck) },
        });
        return [];
      }
    }

    // Filter out dates that have materialized overrides (one-offs with
    // parentActivityId). Same path for every recurrence kind.
    const overrides = overridesByParent.value.get(activity.id);
    return overrides ? results.filter((r) => !overrides.has(r.date)) : results;
  }

  /** Single one-off activity (no recurrence). Multi-day all-day expands into
   *  one occurrence per day in the range; single-day emits one occurrence. */
  function expandOneOff(
    activity: FamilyActivity,
    startDate: Date,
    monthStart: Date,
    monthEnd: Date
  ): { activity: FamilyActivity; date: string }[] {
    const results: { activity: FamilyActivity; date: string }[] = [];
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
      results.push({ activity, date: activity.date });
    }
    return results;
  }

  /** Every day within the month, bounded by startDate + effectiveEnd. */
  function expandDaily(
    activity: FamilyActivity,
    startDate: Date,
    monthStart: Date,
    effectiveEnd: Date
  ): { activity: FamilyActivity; date: string }[] {
    const results: { activity: FamilyActivity; date: string }[] = [];
    const cursor = new Date(Math.max(startDate.getTime(), monthStart.getTime()));
    while (cursor <= effectiveEnd) {
      results.push({ activity, date: formatDate(cursor) });
      cursor.setDate(cursor.getDate() + 1);
    }
    return results;
  }

  /** Monthly on the Nth of the month, derived from startDate. Clamps to the
   *  month's last day for months without that date (e.g. Feb 30 → Feb 28). */
  function expandMonthlyByDate(
    activity: FamilyActivity,
    startDate: Date,
    year: number,
    month: number,
    monthStart: Date,
    monthEnd: Date,
    effectiveEnd: Date
  ): { activity: FamilyActivity; date: string }[] {
    const dayOfMonth = startDate.getDate();
    const candidate = new Date(year, month, Math.min(dayOfMonth, monthEnd.getDate()));
    if (candidate >= startDate && candidate >= monthStart && candidate <= effectiveEnd) {
      return [{ activity, date: formatDate(candidate) }];
    }
    return [];
  }

  /** Monthly on the Nth weekday of the month, derived from startDate. The
   *  5th-weekday case is coerced to "last weekday" by
   *  `getWeekdayOrdinalInMonth` so every month gets an occurrence. */
  function expandMonthlyByDay(
    activity: FamilyActivity,
    startDate: Date,
    year: number,
    month: number,
    monthStart: Date,
    effectiveEnd: Date
  ): { activity: FamilyActivity; date: string }[] {
    const ordinal = getWeekdayOrdinalInMonth(startDate);
    const weekday = startDate.getDay();
    const candidate = nthWeekdayOfMonth(new Date(year, month, 1), ordinal, weekday);
    if (candidate >= startDate && candidate >= monthStart && candidate <= effectiveEnd) {
      return [{ activity, date: formatDate(candidate) }];
    }
    return [];
  }

  /** Yearly on the same month + day as startDate. */
  function expandYearly(
    activity: FamilyActivity,
    startDate: Date,
    year: number,
    month: number,
    endDate: Date | null
  ): { activity: FamilyActivity; date: string }[] {
    // INVARIANT: `month` must be a normalized 0-11 value. This guard compares it
    // raw against `startDate.getMonth()` (0-11), so any caller passing an
    // un-normalized month (e.g. `baseMonth + i`, which can exceed 11) silently
    // excludes every yearly activity. Callers that walk months forward MUST
    // normalize each step through a `Date` first (see `linkableActivities`).
    if (startDate.getMonth() !== month) return [];
    const candidate = new Date(year, month, startDate.getDate());
    if (candidate >= startDate && (!endDate || candidate <= endDate)) {
      return [{ activity, date: formatDate(candidate) }];
    }
    return [];
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
   * All occurrences (direct + recurring expanded) whose date falls within
   * `[startYmd, endYmd]` inclusive. Same member-filtered source as
   * {@link monthActivities} — this is the arbitrary-range form of it, used by
   * the month grid so the prev/next-month padding cells show their items too.
   *
   * Walks every calendar month the range touches, normalizing the month index
   * through a `Date` on each step. That normalization is REQUIRED, not stylistic:
   * `expandRecurring`'s yearly branch compares `month` raw against `getMonth()`
   * (0-11), so a caller stepping `month + i` past 11 silently drops every yearly
   * activity (see the INVARIANT note on `expandRecurringYearly`).
   */
  function activitiesInRange(startYmd: string, endYmd: string) {
    const all: { activity: FamilyActivity; date: string }[] = [];
    if (!startYmd || !endYmd || startYmd > endYmd) return all;
    const start = parseLocalDate(startYmd);
    const end = parseLocalDate(endYmd);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return all;
    // Cursor sits on the 1st of each month, so `setMonth` can never overflow
    // a short month (e.g. Jan 31 → Mar 3).
    const cursor = new Date(start.getFullYear(), start.getMonth(), 1);
    while (cursor <= end) {
      const y = cursor.getFullYear();
      const m = cursor.getMonth();
      for (const a of filteredActivities.value) {
        for (const occ of expandRecurring(a, y, m)) {
          if (occ.date >= startYmd && occ.date <= endYmd) all.push(occ);
        }
      }
      cursor.setMonth(m + 1);
    }
    return all;
  }

  /**
   * All occurrences for a month over the UNFILTERED `activeActivities` source
   * (same source as `activitiesForDate`) — so drop-off/pick-up duty-only
   * occurrences are never dropped by the global member filter. Used by the
   * notification deriver's month-bucketed window pass; do NOT use the
   * member-filtered `monthActivities` there.
   */
  function activeActivitiesForMonth(year: number, month: number) {
    const all: { activity: FamilyActivity; date: string }[] = [];
    for (const a of activeActivities.value) {
      all.push(...expandRecurring(a, year, month));
    }
    return all;
  }

  /**
   * Get upcoming activities from today, limited to `limit` items.
   * Excludes vacation-linked activities (they appear as sidebar cards instead).
   *
   * Reads `today` from the reactive `useToday` composable so this list
   * auto-refreshes at midnight and on tab wake — without a reactive source
   * the previous `new Date()` call only re-ran when other deps changed.
   */
  const { today: todayRef } = useToday();
  const upcomingActivities = computed(() => {
    const today = parseLocalDate(todayRef.value);
    const todayStr = todayRef.value;
    const results: { activity: FamilyActivity; date: string }[] = [];

    // Look ahead 90 days
    for (const a of filteredActivities.value) {
      for (let i = 0; i < 3; i++) {
        const y = today.getFullYear();
        const m = today.getMonth() + i;
        const expanded = expandRecurring(a, y, m);
        for (const occ of expanded) {
          if (occ.date >= todayStr) {
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

  /** True when an activity has a usable start date. ONE source of truth for the
   *  one-off branch of `linkableActivities` (which reads `activity.date` directly,
   *  bypassing `expandRecurring`'s own validation). */
  function isValidActivityDate(activity: FamilyActivity): boolean {
    return !!activity.date && !Number.isNaN(parseLocalDate(activity.date).getTime());
  }

  /**
   * Candidate list for the Beanie List → activity link picker: each active
   * activity ONCE, keyed by its next occurrence on-or-after today, sorted
   * soonest-first. UNCAPPED — the picker applies its own display bound AFTER
   * search (so search always reaches every activity). This differs from
   * `upcomingActivities` (a near-term, occurrence-capped widget source) which
   * must stay unchanged. Member-filter-independent: uses `activeActivities` so
   * any family activity is linkable regardless of the global member chip.
   *
   * A one-off appears indefinitely into the future (by its own date); a recurring
   * appears by its soonest upcoming occurrence, found by walking months forward
   * through `expandRecurring` (yearly can be up to ~12 months out → 13-month bound).
   */
  const linkableActivities = computed<{ activity: FamilyActivity; date: string }[]>(() => {
    const todayStr = todayRef.value;
    const base = parseLocalDate(todayStr);
    const surface = 'activityStore.linkableActivities';

    /** Next occurrence YMD ≥ today, or null if none / entirely past / ended. */
    function nextOccurrenceYmd(activity: FamilyActivity): string | null {
      if (activity.recurrence === 'none') {
        if (!isValidActivityDate(activity)) {
          reportError({
            surface,
            message: `Activity ${activity.id} has invalid date "${activity.date}" — excluded from link picker`,
            severity: 'warning',
            context: { activity_id: activity.id, raw_date: activity.date ?? null },
          });
          return null;
        }
        const startYmd = activity.date.slice(0, 10);
        // Multi-day relevance intentionally mirrors `expandOneOff` (gates on
        // isAllDay && endDate — keep in sync). An ongoing multi-day activity
        // (start past, end future) surfaces on today, honouring the ≥-today
        // contract rather than sorting under a past start date.
        const lastRelevant =
          activity.isAllDay && activity.endDate ? activity.endDate.slice(0, 10) : startYmd;
        if (lastRelevant < todayStr) return null; // past-only
        return startYmd < todayStr ? todayStr : startYmd;
      }

      // Recurring: skip if the series has already ended.
      if (activity.recurrenceEndDate && activity.recurrenceEndDate.slice(0, 10) < todayStr) {
        return null;
      }
      // Walk months forward (normalized through a Date so `expandYearly`'s raw
      // month guard never trips — see its INVARIANT comment). 13 months covers
      // a yearly whose anniversary month is the current month but whose day has
      // already passed (found next year at i=12).
      for (let i = 0; i <= 12; i++) {
        const step = new Date(base.getFullYear(), base.getMonth() + i, 1);
        const occs = expandRecurring(activity, step.getFullYear(), step.getMonth());
        // expandRecurring is NOT globally sorted (multi-day-of-week interleaves),
        // so take the MIN matching date; drop `< today` in the current month.
        let min: string | null = null;
        for (const occ of occs) {
          if (occ.date >= todayStr && (min === null || occ.date < min)) min = occ.date;
        }
        if (min !== null) return min;
      }
      return null;
    }

    const results: { activity: FamilyActivity; date: string }[] = [];
    for (const activity of activeActivities.value) {
      try {
        const date = nextOccurrenceYmd(activity);
        if (date !== null) results.push({ activity, date });
      } catch (err) {
        // Backstop: one corrupt record must never break the whole picker.
        reportError({
          surface,
          message: `Failed to compute next occurrence for activity ${activity.id} — excluded from link picker`,
          severity: 'warning',
          context: { activity_id: activity.id, error: String(err) },
        });
      }
    }

    results.sort((a, b) => {
      const dateCmp = a.date.localeCompare(b.date);
      if (dateCmp !== 0) return dateCmp;
      return (a.activity.startTime ?? '').localeCompare(b.activity.startTime ?? '');
    });
    return results;
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

  /**
   * ONE-SHOT #55 back-fill — see `utils/activityReminderBackfill.ts` for the rule
   * and the retirement contract.
   *
   * Deliberately NOT `wrapAsync` (unlike every other action here): that sets the
   * shared `isLoading` — flashing the planner skeletons at boot — writes
   * `error.value`, and error-toasts by default. This is invisible maintenance, so
   * it owns a single try/catch, exactly like `familyStore.normalizeRoles`.
   *
   * Writes the CONSTANT, not the device's `activityReminderLead`: activities are
   * family-shared data, so the result must not depend on which device ran it.
   */
  async function backfillReminderMinutes(opts: { canEdit: boolean }): Promise<void> {
    const settingsStore = useSettingsStore();
    // Both pre-conditions return WITHOUT writing the marker, so a skipped run
    // stays retryable:
    //  • already done for this family
    //  • an empty list at boot is indistinguishable from "still settling";
    //    burning the one-shot on it would leave the corpus dark forever behind a
    //    marker saying it was done
    //  • a limited member's device must not silently rewrite family-shared data
    if (settingsStore.activityReminderBackfilledAt) return;
    if (activities.value.length === 0) return;
    if (!opts.canEdit) return;

    try {
      const candidates = selectActivitiesToBackfill(activities.value);
      const ids = candidates.map((a) => a.id);
      // Zero candidates still marks — otherwise an already-clean family
      // re-selects on every boot forever. Only the pre-conditions skip marking.
      if (ids.length > 0) {
        await activityRepo.backfillActivityReminders(ids, DEFAULT_ACTIVITY_LEAD);
        const patched = new Set(ids);
        activities.value = activities.value.map((a) =>
          patched.has(a.id) ? { ...a, reminderMinutes: DEFAULT_ACTIVITY_LEAD } : a
        );
      }
      // Marker LAST: if the app dies mid-migration it stays unset and the next
      // run resumes. Re-running is a no-op — the selector only matches 0.
      await settingsStore.setActivityReminderBackfilledAt(new Date().toISOString());
      logEvent({
        level: 'info',
        surface: 'activity-reminder-backfill',
        message: 'activity reminder back-fill complete',
        context: { notif_backfilled: ids.length },
      });
    } catch (err) {
      // Not critical: no user action failed and no data is at risk — the
      // activities are untouched on failure and the marker stays unset, so the
      // next boot retries. No toast: invisible maintenance.
      reportError({
        surface: 'activity-reminder-backfill',
        severity: 'error',
        message: 'activity reminder back-fill failed; will retry next boot',
        error: err,
        context: { notif_error_stage: 'backfill' },
      });
    }
  }

  // Actions
  async function loadActivities() {
    await wrapAsync(
      isLoading,
      error,
      async () => {
        activities.value = await activityRepo.getAllActivities();
      },
      { action: 'activityStore:loadActivities' }
    );
  }

  async function createActivity(input: CreateFamilyActivityInput): Promise<FamilyActivity | null> {
    const result = await wrapAsync(
      isLoading,
      error,
      async () => {
        const activity = await activityRepo.createActivity(input);
        // Immutable update: assign a new array so downstream computeds re-evaluate
        activities.value = [...activities.value, activity];
        return activity;
      },
      { action: 'activityStore:createActivity' }
    );
    if (result) await syncLinkedRecurringPayment(result);
    return result ?? null;
  }

  async function updateActivity(
    id: string,
    input: UpdateFamilyActivityInput
  ): Promise<FamilyActivity | null> {
    const result = await wrapAsync(
      isLoading,
      error,
      async () => {
        const updated = await activityRepo.updateActivity(id, input);
        if (updated) {
          // Immutable update: assign a new array so downstream computeds re-evaluate
          activities.value = activities.value.map((a) => (a.id === id ? updated : a));
        }
        return updated;
      },
      { action: 'activityStore:updateActivity' }
    );
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
    const result = await wrapAsync(
      isLoading,
      error,
      async () => {
        const success = await activityRepo.deleteActivity(id);
        if (success) {
          activities.value = activities.value.filter((a) => a.id !== id);
          // Clear any Beanie List link to this activity (no orphan reference).
          const { useListStore } = await import('@/stores/listStore');
          await useListStore().clearLinksFor('activity', id);
        }
        return success;
      },
      { action: 'activityStore:deleteActivity' }
    );
    return result ?? false;
  }

  /**
   * Reset a rescheduled/edited single occurrence back to the recurring series default.
   *
   * IMPORTANT — this is the ONE intentional "restore": removing the one-off override
   * child lifts `overridesByParent`'s suppression, so the master's original occurrence
   * reappears (in-app + on Google via the recurring-exception restore path). Deleting a
   * session must NEVER restore — that is a `cancelOccurrence` (isActive:false). Do not
   * "simplify" this to `updateActivity({isActive:false})`: that would silently break
   * reset. Named so the surprising `deleteActivity = restore-series` mapping is explicit.
   */
  function resetOccurrenceToSeries(childId: string): Promise<boolean> {
    return deleteActivity(childId);
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
    backfillReminderMinutes,
    // State
    activities,
    isLoading,
    error,
    // Getters
    activeActivities,
    inactiveActivities,
    filteredActivities,
    upcomingActivities,
    linkableActivities,
    // Methods
    monthActivities,
    activitiesInRange,
    activeActivitiesForMonth,
    activitiesForDate,
    // Actions
    loadActivities,
    createActivity,
    updateActivity,
    deleteActivity,
    splitActivity,
    materializeOverride,
    resetOccurrenceToSeries,
    removeFromMemory,
    resetState,
  };
});
