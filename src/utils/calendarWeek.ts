import { parseLocalDate } from '@/utils/date';

/**
 * Translation-key for a week's position relative to today's week. Single
 * source of truth for the key set, shared by the 2-week strip navigator
 * (`WeekStripNav`) and the mobile-month week-divider headers (`CalendarGrid`).
 *
 * Past rows get "last week" / "earlier"; future rows get "next week" /
 * "upcoming"; the row containing today gets "this week".
 */
export type RelativeWeekLabelKey =
  | 'planner.weekThis'
  | 'planner.weekNext'
  | 'planner.weekUpcoming'
  | 'planner.weekLast'
  | 'planner.weekEarlier';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Resolve a week-aligned row's label key by its position relative to today's
 * week. All args are `YYYY-MM-DD` strings; `todayStr` is injectable for tests.
 *
 *   - today within [weekStart, weekEnd]      → "this week"
 *   - row immediately after today's week      → "next week"
 *   - row further forward                     → "upcoming"
 *   - row immediately before today's week     → "last week"
 *   - row further back                        → "earlier"
 *
 * Faithful extraction of the previously-inline `labelFor` in
 * `WeeklyCalendarView` so the strip and the month dividers stay in lockstep.
 */
export function relativeWeekLabelKey(
  weekStartStr: string,
  weekEndStr: string,
  todayStr: string
): RelativeWeekLabelKey {
  if (todayStr >= weekStartStr && todayStr <= weekEndStr) return 'planner.weekThis';

  if (weekStartStr > todayStr) {
    // Row is fully in the future — measure from its first day.
    const days =
      (parseLocalDate(weekStartStr).getTime() - parseLocalDate(todayStr).getTime()) / DAY_MS;
    return days <= 7 ? 'planner.weekNext' : 'planner.weekUpcoming';
  }

  // Row is fully in the past — measure from its last day.
  const days = (parseLocalDate(todayStr).getTime() - parseLocalDate(weekEndStr).getTime()) / DAY_MS;
  return days <= 7 ? 'planner.weekLast' : 'planner.weekEarlier';
}
