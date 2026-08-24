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
  extractDatePart,
} from '@/utils/date';
import { occurrencesInRange, monthlyFactor } from '@/services/recurrence/recurrenceEngine';
import { resolveActivityRule } from '@/services/recurrence/adapters';
import { endSeriesPatch, rebaseRuleForSplit } from '@/utils/activitySeriesEnd';
import { useToday } from '@/composables/useToday';
import { normalizeAssignees } from '@/utils/assignees';
import { overrideOccurrenceYmd } from '@/utils/calendar/overrideOccurrenceYmd';
import { ACTIVITY_COLORS, getActivityCategoryColor } from '@/constants/activityCategories';
import { selectActivitiesToBackfill } from '@/utils/activityReminderBackfill';
import { DEFAULT_ACTIVITY_LEAD } from '@/utils/reminderSchedule';
import { logEvent } from '@/services/telemetry';
import { reportError } from '@/utils/errorReporter';
import { reportSessionActionFailed } from '@/utils/actionFailure';
import { trackFeature, withAppInitiatedWrites } from '@/services/analytics/plausible';
import type {
  FamilyActivity,
  CreateFamilyActivityInput,
  UpdateFamilyActivityInput,
  DutyCompletion,
  ISODateString,
  CurrencyCode,
} from '@/types/models';

/** Re-export for backwards compatibility with components that import from here. */
export const CATEGORY_COLORS = ACTIVITY_COLORS;

/** Returns the activity's custom color or falls back to category default. */
export function getActivityColor(activity: FamilyActivity): string {
  return activity.color ?? getActivityCategoryColor(activity.category);
}

/**
 * Fields a SPLIT template must never inherit from the series it replaces.
 *
 * `vacationId` is here because inheriting it mints an activity `deleteActivity`
 * then refuses to delete; `originalOccurrenceDate`/`parentActivityId` because a
 * split produces a master, never a child.
 *
 * `linkedRecurringItemId` is deliberately NOT here. A split TRANSFERS fee
 * ownership to the new template — `splitActivity` carries the id across so the
 * existing item is updated in place, then clears it from the end-dated
 * original. Stripping it instead makes the new template look fee-enabled with
 * no item, so the sync MINTS A SECOND one while the original's keeps running:
 * the family is billed twice, forever.
 *
 * The completion arrays are also not here — they are FILTERED rather than
 * dropped (see `completionsForDerived`), because wholesale removal erases a
 * duty the family already ticked.
 */
export const SPLIT_INVALID_KEYS = [
  'id',
  'createdAt',
  'updatedAt',
  'recurrenceEndDate',
  'vacationId',
  'originalOccurrenceDate',
  'parentActivityId',
] as const satisfies readonly (keyof FamilyActivity)[];

/**
 * An override child is a LEAF: everything a split strips, plus the series rule
 * AND the fee link. Unlike a split, a child is never a fee owner — it is one
 * session, not a series (Recurring Invariant 2).
 */
export const OVERRIDE_INVALID_KEYS = [
  ...SPLIT_INVALID_KEYS,
  'recurrence',
  'daysOfWeek',
  // #70: the canonical series rule must NOT ride onto a one-off override child —
  // `expandRecurring` checks `activity.rule` before honoring `recurrence:'none'`,
  // so a child that kept the parent's rule would re-expand as a full duplicate
  // series (in-app + as a Google RRULE).
  'rule',
  'linkedRecurringItemId',
] as const satisfies readonly (keyof FamilyActivity)[];

/**
 * The completion entries a derived activity should inherit.
 *
 * Dropping the arrays entirely erases work the family already did: if a parent
 * ticks "picked up" for an occurrence and someone then edits that same session,
 * the override suppresses the master for that date — so every reader
 * (`findCompletion`, `useCriticalItems`, `useScheduledReminders`) sees the
 * child, finds nothing, re-lists the duty as outstanding and re-fires the
 * reminder. Carrying the whole history is equally wrong: a split template would
 * inherit ticks for dates before it existed.
 *
 * `retarget` re-dates the kept entries when the occurrence moves, so a
 * completed duty follows its session.
 */
function completionsForDerived(
  entries: DutyCompletion[] | undefined,
  keep: (ymd: string) => boolean,
  retarget?: ISODateString
): DutyCompletion[] | undefined {
  if (!entries?.length) return undefined;
  const kept = entries
    .filter((c) => keep(c.date))
    .map((c) => (retarget ? { ...c, date: retarget } : c));
  return kept.length ? kept : undefined;
}

/**
 * Plain deep-clone of `template` minus `strip`, plus the names actually removed.
 *
 * The clone strips Automerge/Vue proxy wrappers (nested arrays like
 * `daysOfWeek` would otherwise carry a proxy into the new record). The returned
 * `strippedKeys` drives the `recur_stripped_fields` telemetry, so the list of
 * what was removed has exactly one source of truth.
 */
function deriveFromTemplate(
  template: FamilyActivity,
  strip: readonly (keyof FamilyActivity)[]
): { payload: CreateFamilyActivityInput; strippedKeys: string[] } {
  const clone = JSON.parse(JSON.stringify(template)) as Record<string, unknown>;
  const strippedKeys: string[] = [];
  for (const key of strip) {
    if (clone[key] !== undefined) strippedKeys.push(key);
    delete clone[key];
  }
  return { payload: clone as unknown as CreateFamilyActivityInput, strippedKeys };
}

/**
 * Remove every occurrence-invalid key from a caller-supplied override patch.
 *
 * This is the guard that makes `materializeOverride` safe REGARDLESS of caller:
 * a form that hands us the whole series payload cannot leak `recurrenceEndDate`
 * (which would hide the child entirely once the series end date passes) or
 * `linkedRecurringItemId` (which would hijack the series' fee item).
 */
function sanitizeOverridePatch(overrides?: UpdateFamilyActivityInput): {
  patch: UpdateFamilyActivityInput;
  strippedKeys: string[];
} {
  const patch = { ...(overrides ?? {}) } as Record<string, unknown>;
  const strippedKeys: string[] = [];
  for (const key of OVERRIDE_INVALID_KEYS) {
    if (patch[key] !== undefined) strippedKeys.push(key);
    delete patch[key];
  }
  return { patch: patch as UpdateFamilyActivityInput, strippedKeys };
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

  /**
   * Map of parentActivityId → (occurrenceYmd → override child).
   *
   * Serves three readers from one scan: expansion suppression (`.has`), the
   * idempotency lookup in `materializeOverride` (`.get`), and the delete
   * cascade / re-parent loops (`.values()`).
   *
   * When two children collide on one occurrence key (concurrent materialize on
   * two devices, merged by the CRDT) the map keeps the last. That is a real
   * multi-device edge case, surfaced by the `activity-override` telemetry
   * rather than silently merged — see the plan's "idempotency is best-effort
   * and local" note.
   */
  const overridesByParent = computed(() => {
    const map = new Map<string, Map<string, FamilyActivity>>();
    for (const a of activities.value) {
      if (a.parentActivityId) {
        let byYmd = map.get(a.parentActivityId);
        if (!byYmd) {
          byYmd = new Map();
          map.set(a.parentActivityId, byYmd);
        }
        byYmd.set(overrideOccurrenceYmd(a), a);
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

    // #70 dual-path: a rule-bearing activity expands through the canonical engine
    // (which honors interval, weekdays, monthly anchor, and the rule's end); a
    // legacy activity (no `rule`) runs the exact switches below, unchanged, so
    // existing occurrence sets + RRULEs stay byte-identical. The override filter
    // (parentActivityId + originalOccurrenceDate) is applied the same way for both.
    if (activity.rule) {
      const anchor = extractDatePart(activity.date);
      const dates = occurrencesInRange(
        activity.rule,
        anchor,
        toDateInputValue(new Date(year, month, 1)),
        toDateInputValue(new Date(year, month + 1, 0))
      );
      const ruleResults = dates.map((date) => ({ activity, date }));
      const ov = overridesByParent.value.get(activity.id);
      return ov ? ruleResults.filter((r) => !ov.has(r.date)) : ruleResults;
    }

    // `recurrenceEndDate` is a SERIES rule — it must never gate a one-off. An
    // override child that inherited one (possible in `.beanpod` files written
    // before the 2026-08-15 fix) would otherwise be pruned by the early return
    // below and vanish from the calendar entirely. Ignoring it on
    // `recurrence:'none'` un-hides that legacy data with no migration.
    const endDate =
      activity.recurrence !== 'none' && activity.recurrenceEndDate
        ? parseLocalDate(activity.recurrenceEndDate)
        : null;
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
    // NOTE: `.has` on the ymd→child map — same computed the idempotency
    // lookup and the delete cascade read. See `overridesByParent`.
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
  /**
   * Keep an activity's linked recurring PAYMENT item in step with its fee fields.
   *
   * The guard on the first line is load-bearing (Recurring Invariant 2). Both
   * `createActivity` and `updateActivity` call this unconditionally, so without
   * it an override child — which clones the parent's `linkedRecurringItemId`
   * and is always `recurrence:'none'` — would be treated as a ONE-TIME payment
   * and rewrite the SERIES' monthly fee item in place, re-dated to that single
   * occurrence and repointed at the child. Editing or cancelling one session of
   * a paid class would silently stop the family's recurring fee.
   */
  async function syncLinkedRecurringPayment(activity: FamilyActivity) {
    if (activity.parentActivityId) {
      // An override child is never the fee owner. If it carries a leaked id
      // from a `.beanpod` written before the 2026-08-15 fix, clear it on the
      // way out — a leaked id is NOT inert: `TransactionsPage` resolves a
      // recurring item's owning activity by scanning this field, and a child
      // can win that scan. Repo write + in-memory patch directly (not the
      // `updateActivity` action) so this never re-enters the store.
      if (activity.linkedRecurringItemId) {
        await activityRepo.updateActivity(activity.id, { linkedRecurringItemId: undefined });
        activities.value = activities.value.map((a) =>
          a.id === activity.id ? { ...a, linkedRecurringItemId: undefined } : a
        );
        logEvent({
          surface: 'activity-fee-sync',
          level: 'warn',
          message: 'Cleared leaked linkedRecurringItemId from an override child',
          context: { action: 'cleared-leaked-link-on-child' },
        });
      }
      return;
    }
    const enabled = !!(activity.payFromAccountId && activity.feeAmount);
    const settingsStore = useSettingsStore();
    const isAllSchedule = activity.feeSchedule === 'all';
    // #70: resolve the cadence rather than reading `recurrence`/`daysOfWeek`
    // directly — `null` means the activity does not recur at all.
    const resolved = resolveActivityRule(activity);

    // One-off activities and 'all' schedule use the full amount as a one-time payment;
    // recurring activities calculate the monthly equivalent
    const isOneTimePayment = !resolved || isAllSchedule;
    const paymentAmount = isOneTimePayment
      ? (activity.feeAmount ?? 0)
      : calculateMonthlyFee({
          feeSchedule: activity.feeSchedule,
          feeAmount: activity.feeAmount ?? 0,
          // The REAL occurrence rate. `daysOfWeek.length || 1` used to stand in
          // for this and was only ever right for weekly activities.
          monthlyOccurrences: monthlyFactor(resolved.rule),
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

  /**
   * `syncLinkedRecurringPayment` is awaited OUTSIDE `wrapAsync` in both callers,
   * so an unguarded throw here would reject the caller's save AFTER the activity
   * was already written — a partial failure with no attributed toast. The
   * activity write itself succeeded and must not be reported as a failure, so
   * the fee-sync failure is reported on its own surface and swallowed.
   */
  async function safeSyncLinkedRecurringPayment(activity: FamilyActivity): Promise<void> {
    try {
      await syncLinkedRecurringPayment(activity);
    } catch (err) {
      reportError({
        surface: 'activity-fee-sync',
        message: 'Failed to sync the linked recurring payment for an activity',
        severity: 'error',
        error: err,
        context: { action: 'sync-linked-recurring-payment' },
      });
    }
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
    if (result) await safeSyncLinkedRecurringPayment(result);
    return trackFeature(result ?? null, 'activity');
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
    if (result) await safeSyncLinkedRecurringPayment(result);
    return result ?? null;
  }

  /**
   * The shared delete LEAF: repo delete + in-memory removal + Beanie List
   * unlink. Deliberately not an action — `deleteActivity` and
   * `deleteChildrenFrom` both wrap it in a SINGLE `wrapAsync`, so the loading
   * state does not flicker once per child and there is no recursion.
   */
  async function deleteOne(id: string): Promise<boolean> {
    const success = await activityRepo.deleteActivity(id);
    if (success) {
      activities.value = activities.value.filter((a) => a.id !== id);
      // Clear any Beanie List link to this activity (no orphan reference).
      const { useListStore } = await import('@/stores/listStore');
      await useListStore().clearLinksFor('activity', id);
    }
    return success;
  }

  /**
   * Delete an activity and — when it is a recurring master — its override
   * children (Recurring Invariant 7).
   *
   * Without the cascade, deleting a series leaves every edited/moved session
   * behind as a `recurrence:'none'` ghost: still rendered in-app, but excluded
   * from the Google master push path AND skipped by the exception path (its
   * parent is gone), so it can never sync again.
   *
   * ORDER MATTERS — master first, children second. If the master delete fails
   * we abort having lost nothing. Children-first would mean a failed master
   * delete has already destroyed the user's edited occurrences.
   */
  async function deleteActivity(id: string): Promise<boolean> {
    // Prevent standalone deletion of vacation-linked activities
    const activity = activities.value.find((a) => a.id === id);
    if (activity?.vacationId) {
      reportSessionActionFailed();
      logEvent({
        surface: 'activity-series-delete',
        level: 'warn',
        message: 'Refused to delete a vacation-linked activity directly',
        context: { action: 'vacation-linked-delete-refused' },
      });
      return false;
    }
    // Snapshot before the master delete — `overridesByParent` recomputes the
    // moment `activities` changes.
    const children = [...(overridesByParent.value.get(id)?.values() ?? [])];
    const result = await wrapAsync(
      isLoading,
      error,
      async () => {
        const success = await deleteOne(id);
        if (!success) return false;
        let reaped = 0;
        for (const child of children) {
          // A child delete failing after the master is gone leaves today's
          // status quo (an orphan), not a new failure — report and continue.
          //
          // The try/catch is load-bearing: a THROW here (the dynamic import,
          // `clearLinksFor`, or the worker RPC) would escape to `wrapAsync`,
          // which returns undefined — so `deleteActivity` would report FALSE
          // even though the master is already gone from the calendar, and the
          // caller would show "couldn't delete" over a series that no longer
          // exists. Only the boolean path is a tolerable partial failure.
          try {
            if (await deleteOne(child.id)) reaped += 1;
          } catch (err) {
            reportError({
              surface: 'activity-series-delete',
              message: 'Failed to delete an override child during the series cascade',
              severity: 'error',
              error: err,
              context: { action: 'series-delete-child-failed' },
            });
          }
        }
        if (children.length > 0) {
          logEvent({
            surface: 'activity-series-delete',
            level: reaped === children.length ? 'info' : 'warn',
            message: 'Deleted a recurring series and its override children',
            context: {
              action: 'series-delete-cascade',
              recur_outcome: reaped === children.length ? 'complete' : 'partial',
              recur_children_removed: reaped,
              recur_children_expected: children.length,
            },
          });
        }
        return true;
      },
      { action: 'activityStore:deleteActivity' }
    );
    return result ?? false;
  }

  /**
   * Reap override children on/after `fromYmd` when a series is TRUNCATED.
   *
   * "Delete this and all future" end-dates the master, which does nothing to
   * its children — they are `recurrence:'none'` one-offs and no end date
   * applies to them (Recurring Invariant 7). Without this they survive the cut
   * as ghosts on dates the series no longer covers.
   *
   * `ymd >= fromYmd` is a safe lexicographic compare on `YYYY-MM-DD`.
   */
  async function deleteChildrenFrom(masterId: string, fromYmd: ISODateString): Promise<number> {
    // Select by the date the child actually RENDERS on (`child.date`), not its
    // occurrence key. The user picked a cut based on what they can see: a
    // session moved to BEFORE the cut must survive it (selecting by key would
    // hard-delete a session sitting a week earlier than the day they chose to
    // keep), and a session moved to AFTER it must go (selecting by key would
    // spare a ghost rendering a month past the series end).
    const doomed = [...(overridesByParent.value.get(masterId)?.values() ?? [])].filter(
      (child) => child.date.slice(0, 10) >= fromYmd
    );
    if (doomed.length === 0) return 0;

    const result = await wrapAsync(
      isLoading,
      error,
      async () => {
        let reaped = 0;
        for (const child of doomed) {
          // Per-child try/catch for the same reason as the delete cascade: a
          // throw would abandon the remaining children AND lose the count.
          try {
            if (await deleteOne(child.id)) reaped += 1;
          } catch (err) {
            reportError({
              surface: 'activity-series-delete',
              message: 'Failed to reap an override child while truncating a series',
              severity: 'error',
              error: err,
              context: { action: 'series-truncate-child-failed' },
            });
          }
        }
        return reaped;
      },
      { action: 'activityStore:deleteChildrenFrom' }
    );
    const reaped = result ?? 0;
    logEvent({
      surface: 'activity-series-delete',
      level: reaped === doomed.length ? 'info' : 'warn',
      message: 'Reaped override children from a truncated recurring series',
      context: {
        action: 'series-truncate-cascade',
        recur_occurrence_ymd: fromYmd,
        recur_outcome: reaped === doomed.length ? 'complete' : 'partial',
        recur_children_removed: reaped,
        recur_children_expected: doomed.length,
      },
    });
    return reaped;
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
   *
   * Override children on/after the split date are RE-PARENTED onto the new
   * template (Recurring Invariant 7). Without that step the child keeps
   * suppressing an occurrence the old template no longer emits, while the new
   * template emits an unsuppressed one — the split-date session duplicates.
   * Mirrors `recurringStore.splitRecurringItem`, which already re-links its
   * materialised transactions.
   */
  async function splitActivity(
    activityId: string,
    fromDate: ISODateString
  ): Promise<FamilyActivity | null> {
    const original = activities.value.find((a) => a.id === activityId);
    if (!original) return null;

    // Snapshot before any write — `overridesByParent` recomputes on mutation.
    //
    // Re-parenting selects by OCCURRENCE KEY, not render date: the key is the
    // master slot a child suppresses, and slots on/after `fromDate` now belong
    // to the new template. (Contrast `deleteChildrenFrom`, which selects by
    // render date because there the question is what the user can SEE.)
    const childrenToMove = [...(overridesByParent.value.get(activityId)?.entries() ?? [])]
      .filter(([ymd]) => ymd >= fromDate)
      .map(([, child]) => child);

    // CREATE FIRST, end-date LAST. The reverse order (which this used to use)
    // has two unrecoverable failure modes: if the create fails after the
    // original is truncated, the series silently loses every occurrence from
    // the split date on with no replacement; and if the end-date write fails
    // but the create succeeds, BOTH templates expand from `fromDate` and every
    // session renders twice, forever. Mirrors the master-first ordering
    // `deleteActivity` documents.
    const { payload, strippedKeys } = deriveFromTemplate(original, SPLIT_INVALID_KEYS);
    // #70: the replacement CONTINUES the same cadence, so it keeps `rule` — but
    // an `afterCount` end is anchor-relative and would restart the count from
    // the split point (a 10-session course split at session 4 becoming 13, then
    // 16). Re-base it against what the original already consumed.
    const splitRule = original.rule
      ? rebaseRuleForSplit(original.rule, extractDatePart(original.date), fromDate)
      : undefined;
    // A DERIVED record, not a new activity the user adopted: `splitSeries` runs
    // when someone edits this-and-future on a series that already exists, so
    // reporting it would count one edit as an adoption event (two, with the
    // override below).
    const newTemplate = await withAppInitiatedWrites(() =>
      createActivity({
        ...payload,
        ...(splitRule ? { rule: splitRule } : {}),
        date: fromDate,
        recurrenceEndDate: original.recurrenceEndDate,
        // Fee ownership TRANSFERS to the new template: carrying the id means the
        // existing item is updated in place rather than a second one minted.
        ...(original.linkedRecurringItemId
          ? { linkedRecurringItemId: original.linkedRecurringItemId }
          : {}),
        dropoffCompletions: completionsForDerived(
          original.dropoffCompletions,
          (d) => d >= fromDate
        ),
        pickupCompletions: completionsForDerived(original.pickupCompletions, (d) => d >= fromDate),
      })
    );
    if (!newTemplate) return null;

    const dayBefore = toDateInputValue(addDays(parseLocalDate(fromDate), -1));
    // Must end the AUTHORITATIVE representation: `expandRecurring` reads
    // `rule.end` for a rule-bearing series and ignores `recurrenceEndDate`
    // entirely, so writing only the shadow would leave both templates expanding
    // from `fromDate` — the duplicate-series state the comment above calls
    // unrecoverable.
    if (!(await updateActivity(activityId, endSeriesPatch(original, dayBefore)))) {
      // The replacement exists but the original was never truncated — both
      // would expand from `fromDate`. Roll the replacement back so the user is
      // left with the un-split series rather than a permanent duplicate.
      await deleteOne(newTemplate.id);
      reportError({
        surface: 'activity-split',
        message: 'Could not end-date the original series; rolled back the split',
        severity: 'error',
        context: { action: 'split-rollback', recur_occurrence_ymd: fromDate },
      });
      return null;
    }

    // The end-dated original no longer owns the fee item (the new template
    // does). Clear its pointer directly so two activities never claim one item.
    if (original.linkedRecurringItemId) {
      await activityRepo.updateActivity(activityId, { linkedRecurringItemId: undefined });
      activities.value = activities.value.map((a) =>
        a.id === activityId ? { ...a, linkedRecurringItemId: undefined } : a
      );
    }

    // Success counter — emitted on the SUCCESS path so the split failure RATE is
    // measurable, not just its absolute count (CLAUDE.md observability rule 6).
    // `recur_stripped_fields` names what the derivation actually removed, which
    // is the regression signature `SPLIT_INVALID_KEYS` exists to guard.
    logEvent({
      surface: 'activity-series-split',
      level: 'info',
      message: 'Split a recurring series at an occurrence',
      context: {
        action: 'series-split',
        recur_occurrence_ymd: fromDate,
        recur_outcome: 'split',
        recur_stripped_fields: strippedKeys.join(','),
        recur_children_expected: childrenToMove.length,
      },
    });

    for (const child of childrenToMove) {
      if (!(await updateActivity(child.id, { parentActivityId: newTemplate.id }))) {
        logEvent({
          surface: 'activity-series-split',
          level: 'warn',
          message: 'Could not re-parent an override child onto the split template',
          context: { action: 'split-reparent-failed', recur_occurrence_ymd: fromDate },
        });
      }
    }
    return newTemplate;
  }

  /**
   * Materialize a one-off override for a single occurrence of a recurring activity.
   *
   * SAFE REGARDLESS OF CALLER (Recurring Invariant 1): every occurrence-invalid
   * key is stripped from `overrides` AFTER it is applied, so a caller handing us
   * a whole-series form payload cannot leak `recurrenceEndDate` (which would
   * hide the child once the series end date passes) or `linkedRecurringItemId`
   * (which would hijack the series' fee item).
   *
   * IDEMPOTENT per `(parentId, occurrenceDate)`: a second call updates the
   * existing child rather than creating a duplicate. The update branch patches
   * with the sanitized overrides ONLY — re-deriving from the parent would
   * silently revert whatever the first override changed.
   */
  async function materializeOverride(
    parentId: string,
    occurrenceDate: ISODateString,
    overrides?: UpdateFamilyActivityInput
  ): Promise<FamilyActivity | null> {
    const parent = activities.value.find((a) => a.id === parentId);
    if (!parent) return null;

    const { patch, strippedKeys } = sanitizeOverridePatch(overrides);
    if (strippedKeys.length > 0) {
      logEvent({
        surface: 'activity-override',
        level: 'warn',
        message: 'Stripped series-level fields from an override patch',
        context: {
          action: 'override-sanitized',
          recur_occurrence_ymd: occurrenceDate,
          recur_stripped_fields: strippedKeys.join(','),
        },
      });
    }

    // Everything the caller asked to change was series-level, so sanitizing
    // emptied the patch. Creating a child here would silently discard the edit
    // AND permanently detach the occurrence from its series behind a junk
    // duplicate. Refuse instead — the caller reports it as a failed save.
    if (overrides && Object.keys(overrides).length > 0 && Object.keys(patch).length === 0) {
      reportError({
        surface: 'activity-override',
        message: 'Refused an override whose every field was series-level',
        severity: 'warning',
        context: {
          action: 'override-empty-after-sanitize',
          recur_occurrence_ymd: occurrenceDate,
          recur_stripped_fields: strippedKeys.join(','),
        },
      });
      return null;
    }

    const existing = overridesByParent.value.get(parentId)?.get(occurrenceDate);
    if (existing) {
      // Write `date` ONLY when the caller explicitly passed one. Re-deriving it
      // from `occurrenceDate` would snap a previously-rescheduled child back to
      // its original slot on the next unrelated edit.
      // Guard on a TRUTHY date: `diffPayload` can legitimately emit
      // `date: undefined`, and deleting a child's date breaks
      // `overrideOccurrenceYmd` for every calendar computed.
      if (overrides && overrides.date) {
        patch.date = overrides.date;
        // First move of a not-yet-moved child pins the occurrence key so it can
        // never drift afterwards (Recurring Invariant 4).
        if (!existing.originalOccurrenceDate && overrides.date !== occurrenceDate) {
          patch.originalOccurrenceDate = occurrenceDate;
        }
      }
      const updated = await updateActivity(existing.id, patch);
      logEvent({
        surface: 'activity-override',
        level: 'info',
        message: 'Reused an existing override for this occurrence',
        context: {
          action: 'override-updated',
          recur_occurrence_ymd: occurrenceDate,
          recur_resolved_ymd: updated?.date ?? existing.date,
          recur_rescheduled: !!(updated?.originalOccurrenceDate ?? existing.originalOccurrenceDate),
          recur_outcome: 'reused',
        },
      });
      return updated;
    }

    const { payload, strippedKeys: derivedStrippedKeys } = deriveFromTemplate(
      parent,
      OVERRIDE_INVALID_KEYS
    );
    // `patch.date` may be present-but-undefined (a legal `diffPayload` clear).
    // Falling back to `occurrenceDate` keeps a child from ever being created
    // without a date — `overrideOccurrenceYmd` slices it and would throw inside
    // a computed every calendar view reads.
    const finalDate = patch.date || occurrenceDate;
    const isRescheduled = finalDate !== occurrenceDate;

    // Also derived. Reached from DELETING a single occurrence, rescheduling one,
    // and scope-edits — so without this a delete would report as adoption.
    const created = await withAppInitiatedWrites(() =>
      createActivity({
        ...payload,
        ...patch,
        date: finalDate,
        recurrence: 'none',
        parentActivityId: parentId,
        // Carry only THIS occurrence's completions, re-dated if the session moved,
        // so a duty the family already ticked is not silently un-ticked.
        dropoffCompletions: completionsForDerived(
          parent.dropoffCompletions,
          (d) => d === occurrenceDate,
          isRescheduled ? finalDate : undefined
        ),
        pickupCompletions: completionsForDerived(
          parent.pickupCompletions,
          (d) => d === occurrenceDate,
          isRescheduled ? finalDate : undefined
        ),
        ...(isRescheduled ? { originalOccurrenceDate: occurrenceDate } : {}),
      })
    );
    logEvent({
      surface: 'activity-override',
      level: 'info',
      message: 'Materialized a one-off override for a recurring occurrence',
      context: {
        action: 'override-created',
        recur_occurrence_ymd: occurrenceDate,
        recur_resolved_ymd: finalDate,
        recur_rescheduled: isRescheduled,
        recur_outcome: created ? 'created' : 'failed',
        // What the PARENT derivation stripped, alongside the caller-patch strip
        // logged above — both lists reach CloudWatch, not just one.
        recur_stripped_fields: derivedStrippedKeys.join(','),
      },
    });
    return created;
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
    deleteChildrenFrom,
    splitActivity,
    materializeOverride,
    resetOccurrenceToSeries,
    removeFromMemory,
    resetState,
  };
});
