// Pure reconcile planner (#32 Layer 5) — no I/O, unit-tested.
//
// Given the family's activities + this connection's existing event links, decide
// what to upsert and what to delete. Kept pure so the diff logic is testable
// without a calendar client or the CRDT. The engine (calendarSyncStore) applies
// the plan against the CalendarClient.

import type { CalendarEventLink, FamilyActivity } from '@/types/models';
import { addDaysYmd } from '@/utils/date';
import { deterministicEventId } from './deterministicEventId';
import { computePushHash, computeExceptionHash } from './activityToGoogleEvent';
import { overrideOccurrenceYmd } from './overrideOccurrenceYmd';

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

/** A per-occurrence recurring-instance EXCEPTION to apply to a synced master.
 *  `mode:'modify'` moves/edits the instance to the override child's values;
 *  `mode:'cancel'` cancels it (delete-this-only). `existingInstanceId` (from the
 *  child's exception link) lets the engine patch by the stored id and skip a
 *  `listInstances` discovery after the first time. */
export interface ReconcileExceptionUpsert {
  child: FamilyActivity;
  master: FamilyActivity;
  occurrenceYmd: string;
  hash: string;
  existingHash?: string;
  existingInstanceId?: string;
  mode: 'modify' | 'cancel';
}

/** An exception link whose override child is gone (deleted/reverted) or whose master
 *  is no longer pushable. `master` is the still-pushable master (restore the instance
 *  to its generated value) or `null` (drop the link — the master is being series-
 *  deleted or is simply not synced; never patch an instance of a deleted master). */
export interface ReconcileExceptionRestore {
  link: CalendarEventLink;
  master: FamilyActivity | null;
}

export interface ReconcilePlan {
  /** Activities that should exist in the calendar (create or update). */
  upserts: ReconcileUpsert[];
  /** MASTER links whose activity is no longer pushable → remote event + link removed. */
  deletes: CalendarEventLink[];
  /** Per-occurrence overrides to apply as Google recurring-instance exceptions. */
  exceptionUpserts: ReconcileExceptionUpsert[];
  /** Exception links to restore/drop (override removed or master unpushable). */
  exceptionRestores: ReconcileExceptionRestore[];
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
 * Whether an activity is eligible to be pushed as a whole (master) event: active,
 * in-window, and NOT a recurring-override child. Override children (`parentActivityId`
 * set) are deliberately excluded from the master path so they never create a second
 * top-level event alongside the master's generated instance — instead they are applied
 * as Google recurring-instance EXCEPTIONS (`exceptionUpserts`, see `planReconcile`).
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
 * `memberName` (optional) resolves member ids → names so the push hash reflects
 * resolved names (a member rename re-pushes the affected activities — #32 F3).
 */
export function planReconcile(
  activities: FamilyActivity[],
  links: CalendarEventLink[],
  todayYmd: string,
  memberName?: (id: string) => string | undefined
): ReconcilePlan {
  // Partition links by kind up front. This is mandatory: `deletes` filters by
  // `pushableIds` (which never contains an override-child id), so an exception link
  // left in the master pool would be misclassified as a stray master link and its
  // Google INSTANCE deleted. Exception links are governed solely by exceptionRestores.
  const masterLinks = links.filter((l) => !l.exceptionOf);
  const exceptionLinks = links.filter((l) => l.exceptionOf);

  const linkByActivity = new Map(masterLinks.map((l) => [l.activityId, l]));
  const pushable = activities.filter((a) => isPushable(a, todayYmd));
  const pushableIds = new Set(pushable.map((a) => a.id));
  const mastersById = new Map(pushable.map((a) => [a.id, a]));

  const upserts: ReconcileUpsert[] = pushable.map((activity) => ({
    activity,
    eventId: deterministicEventId(activity.id),
    hash: computePushHash(activity, memberName),
    existingHash: linkByActivity.get(activity.id)?.lastPushedHash,
  }));

  // A MASTER link whose activity is gone / inactive / out-of-window must be deleted.
  const deletes = masterLinks.filter((l) => !pushableIds.has(l.activityId));

  // Per-occurrence override children whose master is synced → apply as instance
  // exceptions. A child whose master isn't pushable is skipped here (no instance to
  // except) and its stale link, if any, is handled by exceptionRestores below.
  const activityIds = new Set(activities.map((a) => a.id));
  const exceptionLinkByChild = new Map(exceptionLinks.map((l) => [l.activityId, l]));
  const exceptionUpserts: ReconcileExceptionUpsert[] = [];
  for (const child of activities) {
    if (!child.parentActivityId) continue;
    const master = mastersById.get(child.parentActivityId);
    if (!master) continue; // parent not synced → no instance to modify
    const occurrenceYmd = overrideOccurrenceYmd(child);
    const mode: 'modify' | 'cancel' = child.isActive ? 'modify' : 'cancel';
    const link = exceptionLinkByChild.get(child.id);
    exceptionUpserts.push({
      child,
      master,
      occurrenceYmd,
      hash: computeExceptionHash(child, occurrenceYmd, mode, memberName),
      existingHash: link?.lastPushedHash,
      existingInstanceId: link?.googleEventId,
      mode,
    });
  }

  // Exception links whose child is gone (override deleted/reverted) OR whose master is
  // no longer pushable → restore the instance (or drop the link if the master is being
  // series-deleted; the engine gates on the master still being pushable).
  const exceptionRestores: ReconcileExceptionRestore[] = exceptionLinks
    .filter((l) => !activityIds.has(l.activityId) || !mastersById.has(l.exceptionOf!))
    .map((link) => ({ link, master: mastersById.get(link.exceptionOf!) ?? null }));

  return { upserts, deletes, exceptionUpserts, exceptionRestores };
}
