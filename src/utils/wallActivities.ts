/**
 * How the wall filters, orders and colours a day's activities.
 *
 * Pure and shared by all four screens plus the drill-in sheet, because three
 * copies of "which events does this bean see" is three chances to disagree —
 * and two of them had already drifted apart by the time this file existed.
 */
import { effectiveAssignees, matchesAssigneeFilter } from '@/utils/assignees';
import { SHARED_EVENT_COLOR, resolveMemberColor } from '@/constants/memberColors';
import type { FamilyActivity, FamilyMember } from '@/types/models';

export interface WallOccurrence {
  activity: FamilyActivity;
  date: string;
}

/**
 * Does this activity survive the wall's person filter?
 *
 * An activity with NO assignees is family-wide and always shows. That is the
 * app's canonical rule (`useMemberFiltered`), and the naive `.some()` broke it:
 * tapping "Leo" silently removed the family dinner, the school holiday and the
 * trip — the very things everyone standing at the wall needs to see.
 */
export function matchesWallFilter(
  activity: FamilyActivity,
  visibleMemberIds: string[] | null
): boolean {
  if (!visibleMemberIds) return true;
  const allowed = new Set(visibleMemberIds);
  // The "no assignees means everyone's" rule lives in matchesAssigneeFilter, shared with
  // the planner's filters so the convention has exactly one definition.
  return matchesAssigneeFilter(activity, (id) => allowed.has(id));
}

/**
 * Chronological, all-day first.
 *
 * `activitiesForDate` returns repository order, so nothing on the wall was
 * sorted: a day capped at six could hide the 8:05 school run behind "+2 more"
 * while showing bin night, and view C — whose whole job is "what is next" —
 * could list 6:30pm above 8:05am.
 */
export function sortByTime(entries: readonly WallOccurrence[]): WallOccurrence[] {
  return [...entries].sort((a, b) => {
    const at = a.activity.startTime;
    const bt = b.activity.startTime;
    if (!at && !bt) return a.activity.title.localeCompare(b.activity.title);
    if (!at) return -1;
    if (!bt) return 1;
    return at.localeCompare(bt);
  });
}

/** Filter + sort in the one order every screen wants. */
export function wallEvents(
  entries: readonly WallOccurrence[],
  visibleMemberIds: string[] | null
): WallOccurrence[] {
  return sortByTime(entries.filter((e) => matchesWallFilter(e.activity, visibleMemberIds)));
}

/**
 * Whose event this is, by colour.
 *
 * The mockup colours every chip, stripe and pip by the OWNER, not the category:
 * a row of pips is meant to say whose day is busy at a glance, and category
 * colour made Leo's football and Milo's football identical. Falls back to the
 * category colour for a family-wide activity, which has no owner to show.
 */
export function wallActivityColour(
  activity: FamilyActivity,
  membersById: Map<string, FamilyMember>
): string {
  // A shared event wears the shared colour, not the first assignee's. Picking the first
  // of several owners made a joint event look like one person's, and made a family-wide
  // event indistinguishable from an unassigned one.
  //
  // The roster IS the resolver: an id that names nobody here is not a second owner. Before
  // this, a record carrying one real member plus one stale id read as shared.
  const owners = effectiveAssignees(activity, (id) => membersById.has(id));
  if (owners.length !== 1) return SHARED_EVENT_COLOR;
  // Falls back to NEUTRAL, not the category colour. `|| getActivityColor(activity)` sent
  // a colourless bean's event to a CATEGORY hue — and nine category colours are
  // byte-identical to member hues (`drum` and `after_school` are both #3B82F6, the pod
  // owner's default). So a colourless child's after-school club rendered as Dad's event
  // on the one screen where hue is the sole identity signal, while the face beside it
  // showed neutral grey. `resolveMemberColor` also absorbs the empty string the `||`
  // was silently covering for.
  return resolveMemberColor(membersById.get(owners[0]!)?.color);
}
