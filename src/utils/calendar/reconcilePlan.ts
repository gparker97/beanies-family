// Pure reconcile planner (#32 Layer 5) — no I/O, unit-tested.
//
// Given the family's activities + this connection's existing event links, decide
// what to upsert and what to delete. Kept pure so the diff logic is testable
// without a calendar client or the CRDT. The engine (calendarSyncStore) applies
// the plan against the CalendarClient.

import type { CalendarEventLink, FamilyActivity } from '@/types/models';
import { deterministicEventId } from './deterministicEventId';
import { computePushHash } from './activityToGoogleEvent';

/** Forward/backward window bounds (days). Pushing is limited to this range so the
 *  per-activity verify cost and the link table stay bounded over years. */
export const RECONCILE_PAST_DAYS = 30;
export const RECONCILE_FUTURE_DAYS = 365;

export interface ReconcileUpsert {
  activity: FamilyActivity;
  eventId: string;
  hash: string;
  /** Hash from the existing link, if any — equal ⇒ unchanged (skip on a light pass). */
  existingHash?: string;
}

export interface ReconcilePlan {
  /** Activities that should exist in the calendar (create or update). */
  upserts: ReconcileUpsert[];
  /** Links whose activity is no longer pushable → remote event + link must be removed. */
  deletes: CalendarEventLink[];
}

/** `YYYY-MM-DD` + n days → `YYYY-MM-DD` (TZ-safe local arithmetic). */
function addDaysYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.slice(0, 10).split('-').map(Number);
  const dt = new Date(y, m - 1, d + days);
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const dd = String(dt.getDate()).padStart(2, '0');
  return `${dt.getFullYear()}-${mm}-${dd}`;
}

/**
 * Whether an activity falls within the push window relative to `todayYmd`.
 * ISO date strings compare lexicographically, so plain string comparison works.
 * An ongoing recurring activity (no end date) is in-window once it has started
 * before the forward bound; otherwise the activity's [start, lastRelevant] range
 * must overlap [today-past, today+future].
 */
export function activityInWindow(
  activity: FamilyActivity,
  todayYmd: string,
  pastDays = RECONCILE_PAST_DAYS,
  futureDays = RECONCILE_FUTURE_DAYS
): boolean {
  const start = activity.date.slice(0, 10);
  const pastBound = addDaysYmd(todayYmd, -pastDays);
  const futureBound = addDaysYmd(todayYmd, futureDays);

  if (activity.recurrence !== 'none' && !activity.recurrenceEndDate) {
    return start <= futureBound; // ongoing recurring
  }
  const lastRelevant = (activity.recurrenceEndDate ?? activity.endDate ?? activity.date).slice(
    0,
    10
  );
  return lastRelevant >= pastBound && start <= futureBound;
}

/**
 * Whether an activity is eligible to be pushed at all: active, in-window, and NOT
 * a recurring-override child. (Per-occurrence override exceptions are a v1
 * follow-up — the recurring master syncs; an individually-edited occurrence does
 * not yet get its own Google exception. Skipping override children here prevents
 * a duplicate event alongside the master's generated instance.)
 */
export function isPushable(activity: FamilyActivity, todayYmd: string): boolean {
  return (
    activity.isActive &&
    activity.parentActivityId === undefined &&
    activityInWindow(activity, todayYmd)
  );
}

/**
 * Build the reconcile plan. Pure. `links` is this connection's existing links.
 * `targetActivityIds`, when provided, restricts the plan to a dirty subset (drain
 * pass); omit for a full scan. Deletes always cover the full link set so a
 * dropped/expired activity is cleaned up even on a dirty drain that includes it.
 */
export function planReconcile(
  activities: FamilyActivity[],
  links: CalendarEventLink[],
  todayYmd: string,
  targetActivityIds?: ReadonlySet<string>
): ReconcilePlan {
  const linkByActivity = new Map(links.map((l) => [l.activityId, l]));
  const pushable = activities.filter((a) => isPushable(a, todayYmd));
  const pushableIds = new Set(pushable.map((a) => a.id));

  const consider = targetActivityIds
    ? pushable.filter((a) => targetActivityIds.has(a.id))
    : pushable;

  const upserts: ReconcileUpsert[] = consider.map((activity) => ({
    activity,
    eventId: deterministicEventId(activity.id),
    hash: computePushHash(activity),
    existingHash: linkByActivity.get(activity.id)?.lastPushedHash,
  }));

  // A link whose activity is gone / inactive / out-of-window must be deleted.
  // On a dirty drain, only consider links for the targeted activities (so we
  // don't sweep the whole calendar); on a full scan, consider every link.
  const deleteCandidates = targetActivityIds
    ? links.filter((l) => targetActivityIds.has(l.activityId))
    : links;
  const deletes = deleteCandidates.filter((l) => !pushableIds.has(l.activityId));

  return { upserts, deletes };
}
