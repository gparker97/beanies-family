/**
 * Return a YYYY-MM-DD date string for "tomorrow" — clamped to today on
 * the last day of the month.
 *
 * Why: the planner's default month-view renders activity chips only for
 * the visible calendar month. Padding cells that bleed into prev/next
 * month don't carry chips (see CalendarGrid.vue — monthActivities is
 * fetched per `year, month`). On the final day of a month, naive
 * "tomorrow" crosses into next month and the just-created activity
 * becomes invisible in the May view, so subsequent `getByText('...')
 * .click()` times out. Clamping to today on month-end keeps the
 * activity in the visible grid while preserving the "future/today"
 * intent the rest of the time. The few tests that genuinely depend on
 * "tomorrow > today" semantics (e.g. upcoming-list assertions) don't
 * use this helper.
 */
export function tomorrowOrTodayStr(): string {
  const today = new Date();
  const next = new Date(today);
  next.setDate(today.getDate() + 1);
  const target = next.getMonth() === today.getMonth() ? next : today;
  return `${target.getFullYear()}-${String(target.getMonth() + 1).padStart(2, '0')}-${String(target.getDate()).padStart(2, '0')}`;
}
