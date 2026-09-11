// Pure reconcile planner (#32 Layer 5) — no I/O, unit-tested.
//
// Given the family's activities + this connection's existing event links, decide
// what to upsert and what to delete. Kept pure so the diff logic is testable
// without a calendar client or the CRDT. The engine (calendarSyncStore) applies
// the plan against the CalendarClient.

import type { CalendarEventLink, FamilyActivity } from '@/types/models';
import { addDaysYmd } from '@/utils/date';
import { masterEventId } from './deterministicEventId';
import { beaniesMayDelete, beaniesMayPush } from './linkOwnership';
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
  /** Carried from the link so `applyUpsert` can tell an ADOPTED event apart without a
   *  second lookup. An adopted event that has vanished from Google must NOT be
   *  re-inserted under its foreign id (not base32hex → permanent 400); the engine
   *  drops the link and lets the next pass create a normal beanies-owned event. */
  origin?: CalendarEventLink['origin'];
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
  /** Where the MASTER lives in Google. Resolved here because `planReconcile` is the
   *  only place holding the master links; the engine must not re-derive it, or an
   *  adopted series would have its instances discovered against a stale id. */
  masterEventId: string;
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
  /** Links to FORGET without touching Google, because beanies did not create the
   *  event (#94 import). Never overlaps `deletes`: an imported link is never a
   *  remote delete, or a disconnect would take the family's real events with it. */
  unlinks: CalendarEventLink[];
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

  // #70: this reads the legacy shadow fields DELIBERATELY, and is correct by
  // construction — `recurrence !== 'none'` and `recurrenceEndDate` are both
  // FAITHFUL under the shadow fidelity contract in `adapters.ts` (the latter is
  // written iff `end.kind === 'onDate'`). A rule-bearing series with a `never`
  // or `afterCount` end therefore lands in the ongoing branch below, which is
  // the safe direction: this module is pure and hot (once per activity per
  // reconcile), and a series wrongly EXCLUDED would silently stop syncing to
  // Google. Do not import the engine or the adapters here to "improve" it —
  // expanding an `afterCount` rule to answer a boolean walks up to HARD_CAP.
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

  // Activities beanies may NOT write to Google (#94): an imported event created by
  // someone else, living on another calendar, or repeating in a way beanies cannot
  // express. Computed once and applied to BOTH upserts and the exception path — an
  // override child of an invited series must never patch or cancel an instance of
  // someone else's recurring event.
  const suppressed = new Set(
    masterLinks.filter((l) => !beaniesMayPush(l)).map((l) => l.activityId)
  );

  const mastersById = new Map(pushable.filter((a) => !suppressed.has(a.id)).map((a) => [a.id, a]));

  const upserts: ReconcileUpsert[] = pushable
    .filter((a) => !suppressed.has(a.id))
    .map((activity) => {
      const link = linkByActivity.get(activity.id);
      return {
        activity,
        eventId: masterEventId(link, activity.id),
        hash: computePushHash(activity, memberName),
        existingHash: link?.lastPushedHash,
        origin: link?.origin,
      };
    });

  const activityIds = new Set(activities.map((a) => a.id));

  // A MASTER link whose activity is gone / inactive / out-of-window is resolved one
  // of two ways. For an event beanies created, delete it remotely and drop the link.
  // For an IMPORTED event, never touch Google: only forget the link, and only once
  // the activity itself is gone. While the activity merely sits inactive or outside
  // the push window, KEEP the link — dropping it would let a later re-entry into the
  // window mint a fresh deterministic id beside the user's original event, which is
  // the duplicate again, arriving months later and unexplainably.
  const deletes: CalendarEventLink[] = [];
  const unlinks: CalendarEventLink[] = [];
  for (const l of masterLinks) {
    if (pushableIds.has(l.activityId) && !suppressed.has(l.activityId)) continue;
    if (!beaniesMayDelete(l)) {
      if (!activityIds.has(l.activityId)) unlinks.push(l);
      continue;
    }
    deletes.push(l);
  }

  // Per-occurrence override children whose master is synced → apply as instance
  // exceptions. A child whose master isn't pushable is skipped here (no instance to
  // except) and its stale link, if any, is handled by exceptionRestores below.
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
      masterEventId: masterEventId(linkByActivity.get(master.id), master.id),
    });
  }

  // Exception links whose child is gone (override deleted/reverted) OR whose master is
  // no longer pushable → restore the instance (or drop the link if the master is being
  // series-deleted; the engine gates on the master still being pushable).
  const exceptionRestores: ReconcileExceptionRestore[] = exceptionLinks
    .filter((l) => !activityIds.has(l.activityId) || !mastersById.has(l.exceptionOf!))
    .map((link) => ({ link, master: mastersById.get(link.exceptionOf!) ?? null }));

  return { upserts, deletes, unlinks, exceptionUpserts, exceptionRestores };
}
