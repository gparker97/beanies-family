/**
 * ONE-SHOT MIGRATION — #55, shipped 2026-07.
 *
 * Sets `reminderMinutes` to `DEFAULT_ACTIVITY_LEAD` on activities still carrying
 * the old modal default of `0`. Under the new "0 = None" rule those activities
 * would never produce an OS reminder, so without this the feature ships dark for
 * every calendar that already exists.
 *
 * KNOWN, ACCEPTED LIMITATION: `0` cannot distinguish "the old default" from "the
 * user deliberately chose None" — they are the same stored value. A deliberate
 * None is therefore reset. greg approved this 2026-07-23; it is called out in
 * the changelog.
 *
 * Runs once per FAMILY (marker in synced `Settings`), not once per device —
 * otherwise a second device would re-apply it over a later deliberate None.
 *
 * ── RETIREMENT ──────────────────────────────────────────────────────────────
 * Delete this file, `activityStore.backfillReminderMinutes()`, its call in
 * App.vue and its tests once the `notif_backfilled` telemetry has stopped
 * appearing fleet-wide for ~90 days (i.e. every active family has run it).
 *
 * DELETE THE CODE FIRST AND LEAVE `Settings.activityReminderBackfilledAt` IN
 * PLACE — removing the marker field while any device still runs an old build
 * would re-run a corpus-wide mutation. Mark the field `@deprecated` instead.
 * ────────────────────────────────────────────────────────────────────────────
 */
import type { FamilyActivity } from '@/types/models';

/**
 * Back-fill candidates: `reminderMinutes === 0` AND a single-occurrence-per-day
 * shape.
 *
 * Multi-day all-day spans are EXCLUDED — `expandOneOff` (activityStore) yields
 * one occurrence per day of the span, and an all-day occurrence fires at the
 * 09:00 anchor, so a back-filled 10-day trip would buzz ten mornings running.
 *
 * Vacation-linked activities are excluded outright: they render as trip cards
 * rather than planner rows, travel already has its own reminders, and
 * `vacationStore` sets their `reminderMinutes: 0` deliberately — it is not the
 * stale modal default.
 */
export function selectActivitiesToBackfill(activities: FamilyActivity[]): FamilyActivity[] {
  return activities.filter(
    (a) =>
      a.reminderMinutes === 0 && !a.vacationId && !(a.isAllDay && a.endDate && a.endDate !== a.date)
  );
}
