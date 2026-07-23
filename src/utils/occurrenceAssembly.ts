/**
 * Shared activity-occurrence assembly.
 *
 * One month-bucketed pass over the caller's (UNFILTERED) activity source,
 * producing `date → occurrences`. Extracted so BOTH the in-app notifications
 * snapshot (`stores/notificationsStore`) and the OS forward scheduler
 * (`composables/useScheduledReminders`) assemble occurrences identically — the
 * OS path can't silently narrow the set (e.g. by using the member-filtered
 * `upcomingActivities`, which drops duty-only dropoff/pickup occurrences).
 *
 * Pure: the month source is injected, so it's framework-free and unit-testable.
 */
import type { NotificationOccurrence } from '@/utils/notifications';

/** Distinct `{year, month}` pairs spanning `[start, end]` inclusive. */
export function distinctMonths(start: Date, end: Date): { year: number; month: number }[] {
  const out: { year: number; month: number }[] = [];
  const cur = new Date(start.getFullYear(), start.getMonth(), 1);
  const last = new Date(end.getFullYear(), end.getMonth(), 1);
  while (cur <= last) {
    out.push({ year: cur.getFullYear(), month: cur.getMonth() });
    cur.setMonth(cur.getMonth() + 1);
  }
  return out;
}

/**
 * Bucket activity occurrences by local date across every month the `[start, end]`
 * window touches, over the caller's UNFILTERED month source. Whole months are
 * expanded (never re-expanded per-day); the consumer applies its own
 * fire-time/date-window check.
 */
export function assembleOccurrencesByDate(
  activeActivitiesForMonth: (year: number, month: number) => NotificationOccurrence[],
  start: Date,
  end: Date
): Record<string, NotificationOccurrence[]> {
  const byDate: Record<string, NotificationOccurrence[]> = {};
  for (const { year, month } of distinctMonths(start, end)) {
    for (const occ of activeActivitiesForMonth(year, month)) {
      (byDate[occ.date] ??= []).push(occ);
    }
  }
  return byDate;
}
