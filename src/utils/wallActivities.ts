/**
 * How the wall filters, orders and colours a day's activities.
 *
 * Pure and shared by all four screens plus the drill-in sheet, because three
 * copies of "which events does this bean see" is three chances to disagree —
 * and two of them had already drifted apart by the time this file existed.
 */
import {
  belongsInMemberColumn,
  effectiveAssignees,
  matchesAssigneeFilter,
  normalizeAssignees,
} from '@/utils/assignees';
import { minutesOfDay } from '@/utils/date';
import { isAllDayActivity } from '@/utils/calendar/activityDays';
import type { AllDaySpansResult } from '@/utils/allDaySpans';
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

// ── The time grid's content rules ──────────────────────────────────────────
//
// These sit here rather than in `wallTimeGrid.ts` because they are questions
// about the wall's CONTENT — when is this on, who is it for, how busy is the
// day — not about pixels. `wallTimeGrid.ts` stays a pure geometry module.

/**
 * How long an activity with no end time is assumed to run, on the wall.
 *
 * Deliberately a wall constant and a defaulted PARAMETER rather than a globally
 * unified one: the planner's `groupOverlapping` (`useCalendarNavigation.ts`)
 * assumes 60, and quietly changing that would alter clustering in `DayTimeline`,
 * `DailyCalendarView` and `WeeklyCalendarView` as an invisible side effect of a
 * wall feature. Two numbers that disagree on purpose beat one that silently
 * moves three live surfaces.
 */
export const ASSUMED_DURATION_MIN = 90;

/** So an activity running past midnight is a real span, not a negative one. */
const MINUTES_PER_DAY = 1440;

/**
 * The TRUE minute span of a timed occurrence — the one definition of "when is
 * this on" for the wall.
 *
 * Returns `null` for an all-day activity (it has no position on a time axis) and
 * for one whose times cannot be read. The caller MUST handle `null`; the grid
 * routes those into the all-day band so no event is ever lost, and counts them.
 *
 * The end is clamped to be at least one minute after the start, so a record with
 * `endTime` equal to or before `startTime` produces a valid, if tiny, span rather
 * than a negative height.
 */
export function activitySpanMinutes(
  activity: FamilyActivity,
  assumedDurationMin: number = ASSUMED_DURATION_MIN
): { start: number; end: number } | null {
  // ⚠️ `isAllDayActivity` is the canonical predicate, NOT the raw `isAllDay`
  // flag. `isAllDay` is optional and `ActivityModal` writes it as
  // `isAllDay.value || undefined`, so a legitimately all-day record can persist
  // with the flag unset and no start time. Reading the raw flag sent those to
  // `rejected`, which both styled them as corrupt AND fired a false
  // `wall_grid_unreadable_time` warning — poisoning the one diagnostic this
  // feature has for genuine data corruption.
  if (isAllDayActivity(activity)) return null;
  const start = minutesOfDay(activity.startTime);
  if (start === null) return null;
  const rawEnd = minutesOfDay(activity.endTime);
  if (rawEnd === null) return { start, end: start + assumedDurationMin };
  /*
   * ⚠️ An end BEFORE the start means the activity runs past midnight — a
   * sleepover, a night shift, a red-eye. Clamping it to `start + 1` turned a
   * three-hour event into a one-minute sliver, collapsed the evening into a
   * "quiet" fold, marked it `past` a minute after it began, and printed a
   * fabricated "22:00–22:01" range. `resolveActivityDays` already treats this as
   * next-day (`activityDays.ts`), and both the clash detector and the Google
   * export honour it — so the wall was the only surface disagreeing about how
   * long the same record lasts. Reachable via calendar sync and AI extraction,
   * which do not go through the form's own clamp.
   */
  const end = rawEnd <= start ? rawEnd + MINUTES_PER_DAY : rawEnd;
  return { start, end: Math.max(start + 1, end) };
}

/**
 * One all-day item as the grid's band renders it.
 *
 * Declared once and used by BOTH producers (`wallDayAllDay` for day columns,
 * `wallSharedAllDay` for member columns) so the two are structurally forced to
 * agree. They compute different rules over different column shapes; letting each
 * invent its own row type is how the band ends up rendering two things.
 */
export interface WallAllDaySpan {
  occurrence: WallOccurrence;
  /** 0-indexed column within the columns passed to the grid. */
  startCol: number;
  /** Cells covered, clamped to the visible columns. */
  span: number;
  /** Rendered once, spanning every column, tagged "everyone". */
  everyone: boolean;
}

/**
 * Adapt `computeAllDaySpans`' day-shaped result to the grid's all-day band.
 *
 * ⚠️ BOTH halves of the result are required, and this is the whole reason this
 * function exists. `result.spans` holds MULTI-DAY items only; every single-day
 * all-day item — a birthday, a school INSET day, bin night — is in
 * `result.singleByDate`. Feeding the grid `spans` alone drops all of those from
 * the days view entirely: they are not timed, so they never reach the plot
 * either, and they simply stop being on screen. In the chip stack this replaced
 * they rendered fine (`sortByTime` puts all-day first), so the regression would
 * have looked like the grid "losing" events.
 *
 * See the test of the same name, which asserts one 3-day span plus two
 * single-day items yields THREE rows.
 */
export function wallDayAllDay(
  result: AllDaySpansResult,
  days: readonly string[],
  occurrenceFor: (activity: FamilyActivity, ymd: string) => WallOccurrence
): WallAllDaySpan[] {
  const rows: WallAllDaySpan[] = [];
  for (const span of result.spans) {
    rows.push({
      occurrence: occurrenceFor(span.activity, days[span.startCol] ?? span.activity.date),
      startCol: span.startCol,
      span: span.span,
      everyone: false,
    });
  }
  for (const [ymd, activities] of result.singleByDate) {
    const startCol = days.indexOf(ymd);
    // A date outside the visible columns has nowhere to render; `computeAllDaySpans`
    // is given exactly the visible days, so this is a guard, not an expected path.
    if (startCol < 0) continue;
    for (const activity of activities) {
      rows.push({
        occurrence: occurrenceFor(activity, ymd),
        startCol,
        span: 1,
        everyone: false,
      });
    }
  }
  return rows;
}

/**
 * All-day items for MEMBER-shaped columns (the bean lanes, and the today view's
 * single column).
 *
 * An item that lands in every visible column renders once, spanning, tagged
 * "everyone" — five lanes each saying "Term starts" is the same sentence read
 * five times, and on the lanes view that is the common case, because an all-day
 * event with no owner belongs to the whole family.
 *
 * Deliberately separate from `computeAllDaySpans`, which is day-shaped by
 * contract ("pass exactly the days you want to render"). One function serving
 * both column shapes would need a mode flag, which is the shape
 * `WallBeanColumn`'s own docblock warns against.
 *
 * Placement uses `belongsInMemberColumn` (`@/utils/assignees`) — the same
 * predicate the lanes use for timed events — so the band and the plot can never
 * disagree about whose column something is in.
 */
export function wallSharedAllDay(
  occurrences: readonly WallOccurrence[],
  memberIds: readonly string[]
): WallAllDaySpan[] {
  if (!memberIds.length) return [];
  const rows: WallAllDaySpan[] = [];
  const seen = new Set<string>();
  for (const occ of occurrences) {
    if (!occ.activity.isAllDay) continue;
    // `activitiesForDate` can expand one activity into several occurrences; the
    // band shows a thing once.
    const key = `${occ.activity.id}:${occ.date}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const cols: number[] = [];
    memberIds.forEach((id, i) => {
      if (belongsInMemberColumn(occ.activity, id)) cols.push(i);
    });
    if (!cols.length) continue;

    /*
     * ⚠️ "Everyone" means the activity belongs to NOBODY IN PARTICULAR, not
     * merely that it covers every column currently on screen. Testing coverage
     * alone made the claim trivially true whenever the wall's person filter
     * narrowed to one bean — so tapping Leo relabelled "Leo's birthday" as
     * "EVERYONE", and a two-person pod got it for any event those two shared.
     */
    const familyWide = normalizeAssignees(occ.activity).length === 0;
    if (familyWide && cols.length === memberIds.length) {
      rows.push({ occurrence: occ, startCol: 0, span: memberIds.length, everyone: true });
      continue;
    }
    if (cols.length === memberIds.length && memberIds.length > 1) {
      // Covers every visible lane but IS owned — span it without the label.
      rows.push({ occurrence: occ, startCol: 0, span: memberIds.length, everyone: false });
      continue;
    }
    // Not everyone's: one row per column it belongs to. Contiguity is not
    // assumed — two non-adjacent beans must not be joined by a bar across a
    // third bean who is not on it.
    for (const col of cols) {
      rows.push({ occurrence: occ, startCol: col, span: 1, everyone: false });
    }
  }
  return rows;
}

/**
 * Which peripheral-card layout this view should use, given how busy the day is.
 *
 * ⚠️ Content-derived, NEVER layout-derived. Collapsing the band gives the grid
 * more height, which could let it lay out gently, which would un-collapse the
 * band, which shrinks it again. On a screen that re-renders every 20s forever
 * that is a permanent flicker. The busiest column's event count cannot feed back.
 *
 * ⚠️ A `rail` is NEVER collapsed. The rail sits BESIDE the grid, not above it, so
 * collapsing it buys the grid no height at all — it just leaves a 40px bar
 * stranded at the top of a 296px column of white space, which is what it did on
 * the today view the first time this shipped. Only a `band`, which is stacked
 * with the grid and genuinely competes with it for height, can be downgraded.
 *
 * `roomForBand` is the ONE height input, and it is the window's height, not a
 * measured one — see `BAND_MIN_VIEWPORT_HEIGHT_PX`. It cannot feed back for the
 * same reason the viewport width cannot: collapsing the band does not resize the
 * window. Without it, six bean lanes on a 1024x768 tablet kept a full band and
 * left the grid 101px — a whole day drawn in the height of three lines.
 */
export function wallPeripheralVariant(
  preferred: 'band' | 'rail',
  busiestColumnCount: number,
  portrait: boolean,
  roomForBand = true
): 'band' | 'rail' | 'strip' {
  if (preferred === 'rail') return 'rail';
  if (!roomForBand) return 'strip';
  return busiestColumnCount > (portrait ? 9 : 7) ? 'strip' : preferred;
}
