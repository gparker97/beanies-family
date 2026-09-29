// Activity links (#114) — the ONE definition of how a to-do or a list points at an activity,
// and of which activity session a link belongs to. Pure leaf: no store, no I/O.
//
// A link lives on the CHILD (`TodoItem.activityId`, `FamilyList.linkedActivityId`), never as an
// array on the activity (`models.ts` FamilyList rationale). A link may carry `activityDate`: the
// session of a repeating activity it belongs to. Absent = the whole activity (every session).
//
// Repeating activities are one stored record whose sessions are generated at render time. Only
// an edited session exists as its own record (an override child: `parentActivityId` + the
// occurrence it replaces, `overrideOccurrenceYmd`). So a session link is always keyed to the
// SERIES id + the session's ORIGINAL date, which survives "reset to series", splits (see
// `activityStore.moveSessionLinks`) and whole-series deletes.
//
// Forward (`sessionLinkMatcher`: which items does this session show) and inverse (`resolveLink`:
// which session does this item's chip open) sit together here and are held to a round-trip
// invariant by `__tests__/activityLinks.test.ts`.
//
// Every link WRITE goes through `todoLinkPatch` / `listLinkPatch`, which always carry both keys
// (`undefined` clears), so a stale session date can never survive a relink. That rule is enforced
// by the `activityLinkWrites.test.ts` source-scan guard.

import type { FamilyActivity, FamilyList, TodoItem } from '@/types/models';
import { isRepeatingActivity } from '@/utils/calendar/activityDays';
import { overrideOccurrenceYmd } from '@/utils/calendar/overrideOccurrenceYmd';

/** Where a to-do or list points: an activity, optionally one session of a repeating one. */
export interface ActivityLink {
  activityId: string;
  /** `YYYY-MM-DD` session of a repeating series. Absent = the whole activity. */
  activityDate?: string;
}

/** How a linked item relates to the session being viewed. */
export type SessionLinkScope = 'session' | 'every-session';

/** An item that belongs to the session being viewed, and how. */
export interface SessionItem<T> {
  item: T;
  scope: SessionLinkScope;
}

/** What a link resolves to on the calendar: the activity record to open, and its session date. */
export interface ResolvedActivityLink {
  activity: FamilyActivity;
  /** The session's date as shown on the calendar. Absent for a dateless link. */
  date?: string;
}

/** The lookups `resolveLink` needs; `activityStore.resolveActivityLink` supplies them. */
export interface ActivityLinkLookup {
  byId(id: string): FamilyActivity | undefined;
  /** The override child that replaced `seriesId`'s occurrence on `ymd`, if that session was edited. */
  overrideFor(seriesId: string, ymd: string): FamilyActivity | undefined;
}

/**
 * The link for a new item added while viewing `activity` on `sessionYmd`.
 *
 *  - a repeating master: the series + that session's date;
 *  - an edited session (override child): the series + the occurrence it replaced, so the item
 *    survives the session being reset to the series;
 *  - a one-off: the activity alone.
 *
 * An override child's `parentActivityId` is TRUSTED rather than checked against the store. An
 * orphaned child (its series deleted but its own delete failed) still round-trips: the matcher
 * below accepts the parent+date link on the child, and `resolveLink` finds the child through
 * `overrideFor` (the store's `overridesByParent` indexes children by `parentActivityId` whether or
 * not the parent still exists). Keeping this pure avoids threading a lookup into every caller.
 */
export function linkForSession(activity: FamilyActivity, sessionYmd: string): ActivityLink {
  if (activity.parentActivityId) {
    return {
      activityId: activity.parentActivityId,
      activityDate: overrideOccurrenceYmd(activity),
    };
  }
  if (isRepeatingActivity(activity)) {
    return { activityId: activity.id, activityDate: sessionYmd.slice(0, 10) };
  }
  return { activityId: activity.id };
}

/**
 * Which links show on `activity`'s `sessionYmd` session, and how.
 *
 *  - repeating master: its own id with no date → `'every-session'`; with this session's date →
 *    `'session'`; any other date → no match.
 *  - edited session (override child): its own id → `'session'` (links written before #114, e.g.
 *    by `ListDetailModal`); the series id with no date → `'every-session'`; the series id with
 *    the replaced occurrence's date → `'session'`. `sessionYmd` is not consulted: the key is the
 *    ORIGINAL date, so a rescheduled session keeps its items.
 *  - anything else (a one-off): its own id → `'session'`, and any `activityDate` is IGNORED. That
 *    is the fail-safe: an activity edited from repeating to one-off keeps every item visible.
 */
export function sessionLinkMatcher(
  activity: FamilyActivity,
  sessionYmd: string
): (link: ActivityLink | null) => SessionLinkScope | null {
  if (activity.parentActivityId) {
    const seriesId = activity.parentActivityId;
    const occurrence = overrideOccurrenceYmd(activity);
    return (link) => {
      if (!link) return null;
      if (link.activityId === activity.id) return 'session';
      if (link.activityId !== seriesId) return null;
      if (!link.activityDate) return 'every-session';
      return link.activityDate === occurrence ? 'session' : null;
    };
  }
  if (isRepeatingActivity(activity)) {
    const ymd = sessionYmd.slice(0, 10);
    return (link) => {
      if (!link || link.activityId !== activity.id) return null;
      if (!link.activityDate) return 'every-session';
      return link.activityDate === ymd ? 'session' : null;
    };
  }
  return (link) => (link?.activityId === activity.id ? 'session' : null);
}

/** The items that belong to `activity`'s `sessionYmd` session, in input order, with their scope. */
export function itemsForSession<T>(
  items: readonly T[],
  toLink: (item: T) => ActivityLink | null,
  activity: FamilyActivity,
  sessionYmd: string
): SessionItem<T>[] {
  const match = sessionLinkMatcher(activity, sessionYmd);
  const out: SessionItem<T>[] = [];
  for (const item of items) {
    const scope = match(toLink(item));
    if (scope) out.push({ item, scope });
  }
  return out;
}

function readLink(activityId: string | undefined, activityDate: string | undefined) {
  if (!activityId) return null;
  return activityDate ? { activityId, activityDate } : { activityId };
}

/** A to-do's activity link, or `null` when it has none. */
export function todoLink(todo: Pick<TodoItem, 'activityId' | 'activityDate'>): ActivityLink | null {
  return readLink(todo.activityId, todo.activityDate);
}

/** A list's activity link, or `null` when it has none. */
export function listLink(
  list: Pick<FamilyList, 'linkedActivityId' | 'activityDate'>
): ActivityLink | null {
  return readLink(list.linkedActivityId, list.activityDate);
}

/**
 * The patch that sets (or, for `null`, clears) a to-do's link. ALWAYS both keys: a key set to
 * `undefined` is deleted by the repository (`update` / `patchMany`), so relinking to the whole
 * activity really removes an old session date.
 */
export function todoLinkPatch(link: ActivityLink | null): {
  activityId: string | undefined;
  activityDate: string | undefined;
} {
  return { activityId: link?.activityId, activityDate: link?.activityDate };
}

/** The patch that sets (or, for `null`, clears) a list's activity link. Always both keys. */
export function listLinkPatch(link: ActivityLink | null): {
  linkedActivityId: string | undefined;
  activityDate: string | undefined;
} {
  return { linkedActivityId: link?.activityId, activityDate: link?.activityDate };
}

/**
 * The inverse of the matcher: the calendar session a link opens.
 *
 *  - A dated link whose session was edited resolves to the override child and ITS date (the date
 *    shown on the calendar, which differs from the key when the session was rescheduled), or to
 *    `null` when that child is a cancelled session (`isActive === false`), so its chip hides.
 *  - Otherwise the linked activity, with the link's date while it still repeats (a series
 *    edited to one-off drops the stale date); `null` when it does not resolve.
 *  - A dateless link resolves to its activity alone.
 */
export function resolveLink(
  link: ActivityLink,
  lookup: ActivityLinkLookup
): ResolvedActivityLink | null {
  if (link.activityDate) {
    const child = lookup.overrideFor(link.activityId, link.activityDate);
    if (child) {
      return child.isActive === false ? null : { activity: child, date: child.date.slice(0, 10) };
    }
    const series = lookup.byId(link.activityId);
    if (!series) return null;
    // Mirror the matcher's fail-safe: an activity that no longer repeats has no
    // sessions, so a stale session date must not label the chip or ride the deep link.
    return isRepeatingActivity(series)
      ? { activity: series, date: link.activityDate }
      : { activity: series };
  }
  const activity = lookup.byId(link.activityId);
  return activity ? { activity } : null;
}
