/**
 * Tiny formatting helpers shared across the app.
 *
 * Keep this file for utilities that are NOT date/number/currency
 * specific (those have dedicated files). Add new helpers as
 * inline-avoidance — every i18n-sensitive snippet has a right to
 * live in one place.
 */

import type { FamilyActivity, ActivityRecurrence } from '@/types/models';
import type { UIStringKey } from '@/services/translation/uiStrings';
import { getWeekdayOrdinalInMonth } from './date';

/**
 * Pick the singular or plural form based on count. Centralises the
 * previously-inline `count === 1 ? 'dose' : 'doses'` pattern so that
 * future locale-specific rules (zero-form, dual-form, etc.) have a
 * single implementation point.
 *
 * For English + beanie the rule is "one is singular; everything else
 * is plural." Negative counts follow the same rule (not expected in
 * practice, but defined behavior > undefined behavior).
 *
 * @example pluralize(1, 'dose', 'doses')   // "dose"
 * @example pluralize(3, 'dose', 'doses')   // "doses"
 * @example pluralize(0, 'dose', 'doses')   // "doses"
 */
export function pluralize(count: number, singular: string, plural: string): string {
  return count === 1 ? singular : plural;
}

/**
 * Format an integer as an English ordinal: 1 → "1st", 2 → "2nd", etc.
 *
 * The special value `-1` returns `"last"`, used by recurrence rules where
 * "last weekday of month" is a distinct ordinal slot (see
 * `ActivityRecurrence` JSDoc + `getWeekdayOrdinalInMonth`).
 *
 * Previously a private helper inside `recurringProcessor.ts`; lifted here
 * so the activity-recurrence formatter and the transaction-recurrence
 * formatter share one implementation.
 */
export function getOrdinalSuffix(n: number): string {
  if (n === -1) return 'last';
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  const suffix = s[(v - 20) % 10] ?? s[v] ?? s[0] ?? 'th';
  return n + suffix;
}

// ─── Recurrence label formatter ────────────────────────────────────────────
//
// Single source of truth for "how do we describe a recurrence rule in
// user-visible text". Used by:
//   - `ActivityModal.vue` — pill labels in the create form
//   - `ActivityViewEditModal.vue` — recurrence summary on the view/edit
//     surface
//
// Future surfaces (calendar tooltip, daily-briefing line item, etc.) call
// this helper too. If the label needs to change, this is the only file to
// edit.

const WEEKDAY_KEYS: readonly UIStringKey[] = [
  'planner.weekday.short.sun',
  'planner.weekday.short.mon',
  'planner.weekday.short.tue',
  'planner.weekday.short.wed',
  'planner.weekday.short.thu',
  'planner.weekday.short.fri',
  'planner.weekday.short.sat',
] as const;

export type TranslateFn = (key: UIStringKey) => string;

/**
 * Compose a human-readable label for the given activity's recurrence rule.
 * Derives anchors (day-of-month for `'monthly'`, ordinal + weekday for
 * `'monthly-by-day'`) from the activity's `startDate` — no hidden fields.
 *
 * Returns short, self-explanatory labels suitable for pills + summaries:
 *   - `"One-time"` / `"Daily"` / `"Yearly"`
 *   - `"Weekly"` (or `"Weekly on Mon, Wed, Fri"` when `daysOfWeek` is set)
 *   - `"Every 2 weeks"`
 *   - `"Monthly on the 14th"`
 *   - `"Monthly on the 2nd Tue"` / `"Monthly on the last Sat"`
 *
 * Falls back to the generic `planner.recurrence.<kind>` label if the
 * start date is missing or malformed — guards against ever returning
 * an empty string or throwing from a render path.
 */
export function formatActivityRecurrence(
  activity: Pick<FamilyActivity, 'recurrence' | 'date' | 'daysOfWeek'>,
  t: TranslateFn
): string {
  const startDate = activity.date ? new Date(activity.date + 'T00:00:00') : null;
  const dateValid = startDate !== null && !Number.isNaN(startDate.getTime());

  switch (activity.recurrence) {
    case 'none':
      return t('planner.recurrence.none');
    case 'daily':
      return t('planner.recurrence.daily');
    case 'yearly':
      return t('planner.recurrence.yearly');

    case 'weekly': {
      const base = t('planner.recurrence.weekly');
      if (!activity.daysOfWeek?.length) return base;
      const days = activity.daysOfWeek
        .filter((d): d is number => Number.isInteger(d) && d >= 0 && d <= 6)
        .map((d) => t(WEEKDAY_KEYS[d]!))
        .join(', ');
      return days ? `${base} ${t('planner.recurrence.onSeparator')} ${days}` : base;
    }

    case 'biweekly':
      return t('planner.recurrence.biweekly');

    case 'monthly': {
      if (!dateValid) return t('planner.recurrence.monthly');
      const dayOfMonth = startDate.getDate();
      return t('planner.frequencyChip.monthlyOnDate').replace(
        '{date}',
        getOrdinalSuffix(dayOfMonth)
      );
    }

    case 'monthly-by-day': {
      if (!dateValid) return t('planner.recurrence.monthly-by-day');
      const ordinal = getWeekdayOrdinalInMonth(startDate);
      const weekday = startDate.getDay();
      return t('planner.frequencyChip.monthlyOnDay')
        .replace('{ordinal}', getOrdinalSuffix(ordinal))
        .replace('{day}', t(WEEKDAY_KEYS[weekday]!));
    }

    default: {
      // Exhaustive guard — if a future `ActivityRecurrence` value is added
      // without extending this switch, return its generic label rather than
      // crashing the renderer. The store's error path surfaces the real
      // problem (see `activityStore.expandRecurring`).
      const _exhaustive: never = activity.recurrence;
      return String(_exhaustive);
    }
  }
}

/**
 * Build the set of options shown in the recurrence pill row on the activity
 * create modal. Each option's label is generated by `formatActivityRecurrence`
 * with the activity's current `startDate` and `daysOfWeek` — so pill labels
 * update live as the user changes the start date.
 */
export function buildRecurrenceOptions(
  activity: Pick<FamilyActivity, 'date' | 'daysOfWeek'>,
  t: TranslateFn
): Array<{ value: ActivityRecurrence; label: string }> {
  const kinds: ActivityRecurrence[] = ['none', 'weekly', 'biweekly', 'monthly', 'monthly-by-day'];
  return kinds.map((kind) => ({
    value: kind,
    label: formatActivityRecurrence({ ...activity, recurrence: kind }, t),
  }));
}
