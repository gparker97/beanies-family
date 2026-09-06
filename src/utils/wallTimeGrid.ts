/**
 * The concertina time grid — the beanie wall's layout algorithm.
 *
 * Pure: no Vue, no stores, no DOM. That is the single most important structural
 * decision in this feature. Every defect this design has ever had lived in the
 * arithmetic below, and a pure function is the only version of it that can be
 * tested exhaustively. It sits beside `wallActivities.ts` and `wallJobs.ts`,
 * which are pure for the same reason.
 *
 * ─── The idea ────────────────────────────────────────────────────────────────
 *
 * A real family day spans 07:30–20:00. A mounted tablet gives the calendar about
 * 470–520px. A uniform hour grid needs ~900px, so every product in this category
 * makes the family deal with the shortfall by hand — pinch-zoom, a fixed window,
 * a "compact" density, auto-scroll. None of them clamps to the day's own first
 * and last event, and none of them folds.
 *
 * This does both. Events keep TRUE proportional height; a stretch where nothing
 * is on, in ANY column on screen, collapses to a labelled band ("quiet until
 * 15:20"). A fold covers only emptiness, so nothing is ever hidden by one. The
 * window clamps to the first start and the last end, so there are no dead hours
 * at either end. It never scrolls, and it never drops an event.
 *
 * ─── ⚠️ Five rules, each earned by a defect ──────────────────────────────────
 *
 * All five appeared only when a working prototype was screenshotted and LOOKED
 * AT — none was caught by reasoning about the code. The naive implementation of
 * each one reintroduces the bug, so each is stated where it applies and each has
 * a regression test.
 *
 *  1. Fold detection runs on TRUE event spans, never on rendered heights.
 *  2. The scale is QUANTIZED and the axis ticks on the HOUR — a grid whose hour
 *     changes height day to day, or whose labels sit at irregular event times,
 *     does not read as a grid at all.
 *  3. A REAL overlap splits the column; it must never displace a later block.
 *  4. A fold is PROPORTIONAL to what it skips, or it cannot say how much.
 *  5. (Rendering, in WallTimeGrid.vue) the now-line goes BEHIND the blocks.
 */
import { activitySpanMinutes, ASSUMED_DURATION_MIN } from '@/utils/wallActivities';
import { isAllDayActivity } from '@/utils/calendar/activityDays';
import type { WallOccurrence } from '@/utils/wallActivities';

// ── Tunables — the only tuning surface ────────────────────────────────────
// Every number the layout depends on is here. No magic number appears anywhere
// else in this module. All nine match the approved prototype.

/**
 * ⭐ The NATURAL scale — the ceiling on pixels-per-minute.
 *
 * The grid used to divide the whole available height between the day's live
 * minutes, which meant a quiet day STRETCHED to fill the screen: two events and
 * one of them half a wall. That is backwards. A wall should look the same from
 * one day to the next, and a quiet day should look quiet — empty space is the
 * honest way to say "not much on", not a reason to inflate what is.
 *
 * So the scale may SHRINK to make a busy day fit, and never grows past this.
 * A 60-minute event is ~48px at natural scale, a little more than the agenda
 * card it replaces; anything left over is blank space below the last event.
 */
export const NATURAL_PX_PER_MIN = 0.8;

/**
 * ⭐ The scale is QUANTIZED, not continuously fitted.
 *
 * A continuous fit gave every day its own pixels-per-minute, so an hour was a
 * different height on Tuesday than on Thursday — and a calendar whose grid
 * changes size day to day cannot be read at a glance, which is the entire job.
 * Picking from a short list means most days land on the SAME step, so the grid
 * looks identical from one day to the next, and a genuinely packed day steps
 * down visibly rather than drifting.
 *
 * Ordered widest-first: the search takes the first step that fits.
 */
export const SCALE_STEPS = [0.8, 0.7, 0.6, 0.5, 0.42, 0.35] as const;

/**
 * A folded stretch is PROPORTIONAL to the time it skips — compressed, but
 * monotonic.
 *
 * A fixed height made a one-hour lull and a six-hour school day the same band,
 * which is exactly as confusing as it sounds: the fold said "time passed here"
 * and then refused to say how much. These three numbers keep a long fold
 * visibly longer than a short one while still collapsing an empty afternoon to
 * a fraction of what it would otherwise cost.
 */
export const MIN_FOLD_PX = 44;
export const MAX_FOLD_PX = 110;
export const FOLD_PX_PER_MIN = 0.09;

export function foldHeightFor(gapMinutes: number): number {
  const over = Math.max(0, gapMinutes - MIN_FOLDABLE_MINUTES);
  return Math.min(MAX_FOLD_PX, MIN_FOLD_PX + over * FOLD_PX_PER_MIN);
}

/**
 * The axis gutter, in px — ONE value, because the columns have to line up when a
 * family switches view. It was declared three times (62, 74, and an inline
 * `portrait ? 60 : 62`) under a comment claiming it was "62px in every view".
 */
export const AXIS_WIDTH_PX = 62;

/** Beyond this many pixels an empty stretch is worth folding rather than drawing. */
export const MAX_GAP_PX = 74;
/** Tightening ladder, MIDDLE axis: folding harder comes before changing scale. */
export const GAP_MINUTE_STEPS = [90, 75, 60, 45, 30] as const;
/** Tightening ladder, INNERMOST axis: the cheapest lie. 27px still clears the type floor. */
export const MIN_BLOCK_STEPS = [36, 33, 30, 27] as const;
/**
 * The cap on a single block — deliberately HIGH, about four hours' worth.
 *
 * ⚠️ It was 76px, and once the hour rules became visible that was plainly wrong:
 * a two-hour event has to span exactly two hour rows or the grid contradicts
 * itself, and a cap below a normal event length made every long block stop short
 * of its own end line. The cap exists for the eight-hour conference that would
 * otherwise eat the whole wall, not for the football training.
 *
 * Above the cap the soft ramp keeps the ordering ("a longer event is never drawn
 * shorter"), and a capped block prints its real range so the compression is
 * never silent.
 */
export const MAX_BLOCK_PX = 190;

/**
 * How much of a block's length beyond the cap still shows.
 *
 * The cap is applied SOFTLY — clamped growth, not a hard stop — because a hard
 * clamp is not monotonic: two events that both exceed it come out exactly the
 * same height, so a full working day and a two-hour training look identical and
 * the later one ends lower than the longer one. Damping keeps the ordering
 * ("a longer event is never drawn shorter") while an eight-hour conference still
 * costs about a third of the pixels it asks for.
 */
const OVER_CAP_SCALE = 0.12;

/**
 * Plot height at which the cap reproduces its historical flat value exactly.
 *
 * ⚠️ MUST be >= 720. At exactly 720 this formula yields exactly MAX_BLOCK_PX,
 * which is what keeps `wallTimeGrid.test.ts`'s softness test meaning what it
 * means: that test lays out at 720px and asserts a 240-minute block is capped,
 * and at scale 0.8 that block is 192px raw against a 190px cap — a TWO PIXEL
 * margin. Drop this below 720 and the cap at that height rises above 192, the
 * block stops being capped, and the test silently changes subject.
 */
const CAP_REFERENCE_HEIGHT_PX = 720;

/** The cap's share of the plot — derived so the reference height yields MAX_BLOCK_PX. */
const CAP_HEIGHT_FRACTION = MAX_BLOCK_PX / CAP_REFERENCE_HEIGHT_PX;

/**
 * Ceiling. Past this a single block dominates the wall however large the glass —
 * the eight-hour conference this cap exists for should never own a whole screen.
 */
export const MAX_BLOCK_CEILING_PX = 320;

/**
 * The cap, scaled to the space actually available.
 *
 * A flat 190px was right for the tablet it was tuned on and leaves a large,
 * high-resolution display visibly underused: the day's events stop well short of
 * the bottom of the glass. Scaling the cap with the plot spends that space.
 *
 * ⭐ It responds to the VIEWPORT and never to the CONTENT, which is the whole
 * reason this is safe. "An hour is the same height on a quiet day and a busy
 * one" — the invariant the natural scale's docblock exists to protect, and which
 * a test asserts — is untouched, because at any fixed screen size this returns a
 * fixed number. A quiet day still looks quiet.
 *
 * Floored at MAX_BLOCK_PX, so every device at or below the reference height
 * renders exactly as it did before this change.
 */
export function defaultMaxBlock(availableHeight?: number): number {
  if (!availableHeight || availableHeight <= 0) return MAX_BLOCK_PX;
  return Math.min(
    MAX_BLOCK_CEILING_PX,
    Math.max(MAX_BLOCK_PX, availableHeight * CAP_HEIGHT_FRACTION)
  );
}

/**
 * The cap, applied SOFTLY — clamped growth, not a hard stop.
 *
 * A hard clamp is not monotonic: two events that both exceed the cap come out
 * exactly the same height, so a three-hour block and a two-hour block become
 * indistinguishable, and the later-starting one ends lower than the longer one.
 * "A longer event is never drawn shorter than a shorter one" is an invariant
 * worth keeping — a family reading the wall should never be told the wrong thing
 * about which of two events is the big one.
 *
 * Damping the excess keeps the cap's benefit (a full working day still costs
 * ~half the pixels it asks for) while the ordering survives. It is a documented
 * distortion of duration above the cap, which is the trade the cap always was.
 */
export function applyBlockCap(raw: number, cap: number): number {
  return raw <= cap ? raw : cap + (raw - cap) * OVER_CAP_SCALE;
}
/** A gap shorter than this never folds, however tall it would render. */
const MIN_FOLDABLE_MINUTES = 20;
/** Two blocks in one lane are nudged this far apart when the floor overlaps them. */
const NUDGE_PX = 3;
/** Fraction tolerance when comparing lane widths. */
const EPSILON = 1e-6;

/** One point in the compromise space. */
export interface Rung {
  /** Pixels per minute — the height of the grid's hour. */
  scale: number;
  gapMinutes: number;
  minBlock: number;
}

/**
 * The compromise ladder.
 *
 * ⭐ SCALE IS THE OUTERMOST AXIS, so it moves LAST. Everything else is spent
 * before the grid's hour is allowed to change height, because a calendar whose
 * hour is a different size from one day to the next cannot be read at a glance
 * — which is the whole job of a wall.
 *
 * Within a scale the precedence is the one approved from the prototype: the
 * minimum block shrinks all the way down before the gap threshold moves, because
 * a block 3px shorter is a smaller lie than folding away another half-hour of
 * the family's day.
 *
 * Frozen and exported so the precedence test asserts on THIS ARRAY — a
 * reordering is then caught by a diff on a list rather than by someone reasoning
 * correctly about loop indentation. It was got wrong once already.
 */
export const LADDER: readonly Rung[] = Object.freeze(
  SCALE_STEPS.flatMap((scale) =>
    GAP_MINUTE_STEPS.flatMap((gapMinutes) =>
      MIN_BLOCK_STEPS.map((minBlock) => Object.freeze({ scale, gapMinutes, minBlock }))
    )
  )
);

/** Bound on the search. Asserted in a test so it cannot drift from the arithmetic. */
export const MAX_ATTEMPTS = LADDER.length;

/** Window used when there is nothing at all to lay out. */
const EMPTY_WINDOW = { start: 8 * 60, end: 20 * 60 };

// ── Result shapes ─────────────────────────────────────────────────────────

export interface GridBlock {
  occurrence: WallOccurrence;
  /** TRUE minutes — the block's own truth, independent of how it is drawn. */
  start: number;
  end: number;
  /** Rendered geometry, in px and in column fractions. */
  top: number;
  height: number;
  lane: number;
  lanes: number;
  laneOffset: number;
  laneWidth: number;
  /** Set when MAX_BLOCK_PX bit, so the renderer can say the duration out loud. */
  capped: boolean;
}

/** An occurrence that has no place on the axis, and the column it belongs to. */
export interface PlacedOccurrence {
  occurrence: WallOccurrence;
  column: number;
}

export interface GridFold {
  top: number;
  height: number;
  /** When the fold begins — needed to map a time that falls INSIDE it. */
  startMinutes: number;
  resumeMinutes: number;
}

export type GridTier = 'gentle' | 'tightened' | 'floored' | 'overflow';

export interface GridLayout {
  columns: GridBlock[][];
  folds: GridFold[];
  ticks: { minutes: number; y: number }[];
  yFor: (minutes: number) => number;
  windowStart: number;
  windowEnd: number;
  /**
   * Occurrences whose times could not be read. NEVER silently dropped — the
   * caller renders these in the all-day band, so a corrupt time costs the family
   * a position on the axis, not the event itself.
   *
   * They carry the COLUMN they came from. Without it the band had to guess, and
   * guessing "all of them" drew a single broken Thursday record as a bar across
   * the whole week — a worse lie than the missing position it compensated for.
   *
   * All-day occurrences are NOT returned: every view filters them out before
   * calling, and renders them through `allDaySpans` instead. A second, unread
   * channel for the same items is how the two disagree.
   */
  rejected: PlacedOccurrence[];
  tier: GridTier;
  /** Pixels per minute this layout settled on — one hour is `scale * 60` tall. */
  scale: number;
  /** How many candidates the search evaluated. Diagnostic only. */
  attempts: number;
}

export interface LayoutOptions {
  maxBlock?: number;
  assumedDurationMin?: number;
}

// ── Generic overlap clustering ────────────────────────────────────────────

/**
 * Group items into clusters of mutually-overlapping ranges, on ALREADY PARSED
 * minute offsets. Pure, total, generic — no time-string parsing and no
 * assumed-duration policy, both of which are the caller's business.
 *
 * @see groupOverlapping in `@/composables/useCalendarNavigation` — the same
 * sweep for the planner. The two have deliberately NOT been converged: that one
 * bundles `HH:mm` parsing and a 60-minute default into the sweep, and its parser
 * returns `NaN`, which currently makes a malformed item start a NEW group and
 * still render. Pointing it here would filter it out instead — silently dropping
 * an activity from the live planner, across three call sites. If you are here to
 * change clustering, change BOTH or neither. Follow-ups F1/F2 in
 * `docs/plans/2026-09-03-wall-time-grid.md`.
 *
 * It lives in this module, rather than a generic `timeSpans.ts`, because it has
 * exactly one consumer. Move it out when it gets a second.
 */
export function clusterOverlapping<T extends { start: number; end: number }>(
  items: readonly T[]
): T[][] {
  const sorted = [...items].sort((a, b) => a.start - b.start || b.end - a.end);
  const clusters: T[][] = [];
  let current: T[] = [];
  let reach = -Infinity;
  for (const item of sorted) {
    // `>=` not `>`: an event ending exactly as the next begins is sequential,
    // not simultaneous. Treating a touching pair as a collision would split the
    // column for the school run and the drop-off five minutes later.
    if (current.length && item.start >= reach) {
      clusters.push(current);
      current = [];
      reach = -Infinity;
    }
    current.push(item);
    reach = Math.max(reach, item.end);
  }
  if (current.length) clusters.push(current);
  return clusters;
}

// ── Parsing (hoisted out of the search — done once, not 100 times) ────────

interface ParsedItem {
  occurrence: WallOccurrence;
  start: number;
  end: number;
  column: number;
}

interface ParsedInput {
  items: ParsedItem[];
  byColumn: ParsedItem[][];
  /**
   * Hoisted out of the search, because neither varies with a rung or a budget.
   * Both are pure functions of the frozen true spans, so recomputing them inside
   * `attempt()` did the same work up to 100 times per layout — ~700 redundant
   * sorts and 4,200 discarded Map entries for a seven-day week, on a tablet.
   */
  lanes: ReturnType<typeof assignLanes>[];
  busy: [number, number][];
  rejected: PlacedOccurrence[];
  windowStart: number;
  windowEnd: number;
  columnCount: number;
}

function parseColumns(
  columns: readonly (readonly WallOccurrence[])[],
  assumedDurationMin: number
): ParsedInput {
  const items: ParsedItem[] = [];
  const byColumn: ParsedItem[][] = columns.map(() => []);
  const rejected: PlacedOccurrence[] = [];

  columns.forEach((column, index) => {
    for (const occurrence of column) {
      // An all-day item is not the plot's business — every view routes those to
      // the band. Skipped SILENTLY rather than rejected: `rejected` drives the
      // `wall_grid_unreadable_time` warning, and reporting a perfectly good
      // all-day record as corrupt poisons the one diagnostic this feature has
      // for genuine data corruption.
      if (isAllDayActivity(occurrence.activity)) continue;
      const span = activitySpanMinutes(occurrence.activity, assumedDurationMin);
      if (!span) {
        // An unreadable time. NOT dropped: the caller shows it in the all-day
        // band. Before this, `NaN` propagated into every `top` and the browser
        // silently discarded the declaration, piling every block at the top of
        // an empty axis — which looked like a layout bug, not like bad data.
        rejected.push({ occurrence, column: index });
        continue;
      }
      const item = { occurrence, start: span.start, end: span.end, column: index };
      items.push(item);
      byColumn[index]!.push(item);
    }
  });

  /*
   * ⭐ The window snaps OUT to whole hours, not to the nearest five minutes.
   *
   * With hour rules on screen the grid has to START on one. Clamping to 07:30
   * put the first event flush against the top edge with no label above it, so
   * there was nothing to read the day against — and the first rule then landed
   * at an arbitrary 30px from the top. On the hour, the first and last rules are
   * the boundaries of the plot and every row between them is the same height.
   */
  const windowStart = items.length
    ? Math.floor(Math.min(...items.map((i) => i.start)) / 60) * 60
    : EMPTY_WINDOW.start;
  const windowEnd = items.length
    ? Math.ceil(Math.max(...items.map((i) => i.end)) / 60) * 60
    : EMPTY_WINDOW.end;

  return {
    items,
    byColumn,
    lanes: byColumn.map((columnItems) => assignLanes(columnItems)),
    busy: mergeBusy(items),
    rejected,
    windowStart,
    // A window of zero length would divide by zero downstream.
    windowEnd: Math.max(windowEnd, windowStart + 5),
    columnCount: columns.length,
  };
}

// ── The six layout steps ──────────────────────────────────────────────────

/** Merge every column's TRUE spans into the periods when SOMETHING is on. */
export function mergeBusy(items: readonly { start: number; end: number }[]): [number, number][] {
  const sorted = [...items].sort((a, b) => a.start - b.start);
  const merged: [number, number][] = [];
  for (const { start, end } of sorted) {
    const last = merged[merged.length - 1];
    if (last && start <= last[1]) last[1] = Math.max(last[1], end);
    else merged.push([start, end]);
  }
  return merged;
}

/**
 * How long a gap must be before it is worth folding, at a GIVEN scale.
 *
 * ⚠️ Rule 2 used to be a whole subsection here, because the threshold was
 * measured against a scale that itself depended on the folds — a runaway that
 * chopped a week needing one fold into five. Quantizing the scale dissolves the
 * problem: `pxPerMin` is now an INPUT, so this is a plain division and the
 * feedback loop cannot exist. The rule survives as a test.
 */
export function foldThresholdMinutes(gapMinutes: number, pxPerMin: number): number {
  const byPixels = MAX_GAP_PX / Math.max(pxPerMin, 0.0001);
  return Math.max(MIN_FOLDABLE_MINUTES, Math.min(gapMinutes, byPixels));
}

/**
 * ⚠️ RULE 1 — fold detection runs on TRUE spans, never on rendered heights.
 *
 * The minimum-block floor makes a 15-minute nursery drop-off OCCUPY 90 minutes
 * of a week-scale axis. An earlier cut fed those inflated spans in here, which
 * closed the very gap that was meant to fold: the fold silently stopped firing
 * and five empty hours rendered as white space. The floor is a RENDERING
 * minimum. It is not a claim about the day.
 */
export function findFolds(
  busy: readonly [number, number][],
  windowStart: number,
  windowEnd: number,
  thresholdMinutes: number
): GridFold[] {
  const spans: [number, number][] = [];
  let cursor = windowStart;
  for (const [start, end] of busy) {
    if (start - cursor >= thresholdMinutes) spans.push([cursor, start]);
    cursor = Math.max(cursor, end);
  }
  if (windowEnd - cursor >= thresholdMinutes) spans.push([cursor, windowEnd]);
  return spans.map(([start, end]) => ({
    top: 0,
    height: foldHeightFor(end - start),
    startMinutes: start,
    resumeMinutes: end,
  }));
}

/** The piecewise minutes→px mapping: linear outside folds, fixed across them. */
/**
 * The piecewise minutes→px mapping.
 *
 * Linear at a FIXED `pxPerMin` everywhere outside a fold — so one hour is the
 * same height everywhere on the screen, which is what makes hour rules mean
 * something — and linear across each fold's own (compressed) height.
 */
export function buildScale(
  windowStart: number,
  windowEnd: number,
  folds: readonly GridFold[],
  pxPerMin: number
): { yFor: (t: number) => number; total: number } {
  const yFor = (t: number): number => {
    const clamped = Math.max(windowStart, Math.min(windowEnd, t));
    let acc = 0;
    let cursor = windowStart;
    for (const fold of folds) {
      if (clamped <= fold.startMinutes) return acc + (clamped - cursor) * pxPerMin;
      acc += (fold.startMinutes - cursor) * pxPerMin;
      if (clamped < fold.resumeMinutes) {
        const span = Math.max(1, fold.resumeMinutes - fold.startMinutes);
        return acc + fold.height * ((clamped - fold.startMinutes) / span);
      }
      acc += fold.height;
      cursor = fold.resumeMinutes;
    }
    return acc + (clamped - cursor) * pxPerMin;
  };
  return { yFor, total: yFor(windowEnd) };
}

/**
 * ⚠️ RULE 3 — TWO kinds of collision, and they want opposite answers.
 *
 * A REAL overlap — the two events genuinely run at the same time — splits the
 * column and sits side by side. It must NEVER push anything down: stacking a
 * real overlap cascades into every later block, and Thursday's dinner stopped
 * lining up with every other Thursday's dinner across the week. A grid whose y
 * no longer means one time is not a grid; that is the entire product claim, and
 * stacking silently voids it.
 *
 * A FLOOR-INDUCED collision is two CONSECUTIVE events five minutes apart, both
 * forced to the legible minimum height. They are not simultaneous and must not
 * be drawn as if they were — splitting those turned every week column into
 * unreadable slivers. They stack, and the push is small and honest, because the
 * events really do follow one another.
 *
 * The two are told apart by testing the TRUE time ranges for intersection.
 */
export function assignLanes(items: readonly ParsedItem[]): Map<
  ParsedItem,
  {
    lane: number;
    lanes: number;
    offset: number;
    width: number;
  }
> {
  const placement = new Map<
    ParsedItem,
    { lane: number; lanes: number; offset: number; width: number }
  >();
  for (const cluster of clusterOverlapping(items)) {
    const laneEnds: number[] = [];
    const laneItems: ParsedItem[][] = [];
    for (const item of cluster) {
      let lane = laneEnds.findIndex((end) => item.start >= end);
      if (lane === -1) {
        lane = laneEnds.length;
        laneEnds.push(0);
        laneItems.push([]);
      }
      laneEnds[lane] = item.end;
      laneItems[lane]!.push(item);
      placement.set(item, { lane, lanes: 0, offset: 0, width: 0 });
    }

    const lanes = laneEnds.length;
    // On a narrow week column a 50/50 split leaves neither event readable, so
    // for a PAIR the longer one keeps the majority width and its title, and the
    // shorter becomes a sliver. Borrowed from Fantastical, whose overlap rule
    // degrades what is inside the block rather than the block itself.
    //
    // The weights come from the LANE OCCUPANTS, not from the first two events in
    // cluster order — a three-event cluster that packs into two lanes would
    // otherwise take its widths from the wrong pair.
    let widths: number[];
    if (lanes === 2) {
      const longest = (list: ParsedItem[]) => Math.max(...list.map((i) => i.end - i.start));
      widths = longest(laneItems[0]!) >= longest(laneItems[1]!) ? [0.62, 0.38] : [0.38, 0.62];
    } else {
      widths = Array.from({ length: lanes }, () => 1 / lanes);
    }
    const offsets: number[] = [];
    widths.reduce((acc, w, i) => {
      offsets[i] = acc;
      return acc + w;
    }, 0);

    for (const item of cluster) {
      const p = placement.get(item)!;
      p.lanes = lanes;
      p.width = widths[p.lane]!;
      p.offset = offsets[p.lane]!;
    }
  }
  return placement;
}

/**
 * ⚠️ RULE 4 (first half) — a fold is never overrun; it is PUSHED.
 *
 * A block held open by the height floor can end LATER than the fold that follows
 * it. Letting it bleed into the fold put an event block on top of the one
 * sentence that explains what is being skipped. So the fold moves down instead,
 * and everything after it moves with it — the axis, the rules, the now-line and
 * every later block, all through one shifted mapping.
 */
export function settle(
  blocks: readonly GridBlock[],
  folds: readonly GridFold[],
  yFor: (t: number) => number
): { bands: GridFold[]; shiftedYFor: (t: number) => number } {
  const shifts: { from: number; by: number }[] = [];
  const bands: GridFold[] = [];
  let shift = 0;
  for (const fold of folds) {
    const bottoms = blocks.filter((b) => b.start < fold.startMinutes).map((b) => b.top + b.height);
    const want = yFor(fold.startMinutes) + shift;
    const actual = bottoms.length ? Math.max(want, Math.max(...bottoms) + 4) : want;
    const delta = actual - want;
    if (delta) {
      for (const block of blocks) if (block.start >= fold.resumeMinutes) block.top += delta;
    }
    shift += delta;
    shifts.push({ from: fold.resumeMinutes, by: shift });
    bands.push({ ...fold, top: actual });
  }
  /*
   * ⚠️ A time INSIDE a fold must map onto that fold's BAND.
   *
   * Keying the shift on `foldEnd` alone meant a time within `[foldStart, foldEnd)`
   * picked up only the PREVIOUS fold's shift, landing up to ~34px above the band
   * it belongs on — often inside an event that had already finished. Since most
   * of a family's day is quiet, "now is inside a fold" is the COMMON case, so
   * this was the now-line's normal behaviour all morning, not an edge case.
   */
  const shiftedYFor = (t: number): number => {
    let acc = 0;
    for (let i = 0; i < bands.length; i++) {
      const band = bands[i]!;
      if (t < band.startMinutes) break;
      if (t < band.resumeMinutes) {
        const span = Math.max(1, band.resumeMinutes - band.startMinutes);
        return band.top + band.height * ((t - band.startMinutes) / span);
      }
      acc = shifts[i]!.by;
    }
    return yFor(t) + acc;
  };
  return { bands, shiftedYFor };
}

interface Attempt {
  columns: GridBlock[][];
  bands: GridFold[];
  yFor: (t: number) => number;
  total: number;
  scale: number;
}

/** Lay out once at a fixed rung. Pure; no search, no retry. */
function attempt(input: ParsedInput, rung: Rung, maxBlock: number): Attempt {
  const threshold = foldThresholdMinutes(rung.gapMinutes, rung.scale);
  const folds = findFolds(input.busy, input.windowStart, input.windowEnd, threshold);
  const { yFor } = buildScale(input.windowStart, input.windowEnd, folds, rung.scale);

  const columns: GridBlock[][] = input.byColumn.map((columnItems, columnIndex) => {
    const placement = input.lanes[columnIndex]!;
    const blocks: GridBlock[] = columnItems.map((item) => {
      const p = placement.get(item)!;
      const raw = yFor(item.end) - yFor(item.start);
      const height = Math.max(rung.minBlock, applyBlockCap(raw, maxBlock));
      return {
        occurrence: item.occurrence,
        start: item.start,
        end: item.end,
        top: yFor(item.start),
        height,
        lane: p.lane,
        lanes: p.lanes,
        laneOffset: p.offset,
        laneWidth: p.width,
        capped: raw > maxBlock,
      };
    });

    /*
     * Nudge apart what the height FLOOR overlapped — tested on the rendered
     * boxes, not on lane index.
     *
     * ⚠️ Bucketing by `block.lane` was wrong and silently lost events. Lane
     * indices are assigned PER CLUSTER, so lane 1 of an early cluster and lane 0
     * of a later one are unrelated numbers: a full-width block could be dropped
     * straight on top of a half-width one from the cluster before it and paint
     * over it completely. Fuzzing found it in 8.4% of realistic layouts — an
     * event gone from a screen whose whole promise is that it never drops one.
     *
     * Two blocks need separating exactly when their horizontal bands overlap:
     * a genuine simultaneous pair sits in different lanes and does not overlap
     * horizontally, so it is never pushed (Rule 3), while anything sharing
     * horizontal space is sequential and may be pushed.
     */
    const ordered = [...blocks].sort((a, b) => a.top - b.top || a.laneOffset - b.laneOffset);
    for (let i = 1; i < ordered.length; i++) {
      const block = ordered[i]!;
      for (let j = 0; j < i; j++) {
        const above = ordered[j]!;
        const sharesWidth =
          block.laneOffset < above.laneOffset + above.laneWidth - EPSILON &&
          above.laneOffset < block.laneOffset + block.laneWidth - EPSILON;
        if (!sharesWidth) continue;
        const bottom = above.top + above.height;
        if (block.top < bottom + NUDGE_PX) block.top = bottom + NUDGE_PX;
      }
    }
    return blocks;
  });

  const all = columns.flat();
  const { bands, shiftedYFor } = settle(all, folds, yFor);
  const gridBottom = buildScale(input.windowStart, input.windowEnd, bands, rung.scale).total;
  const blockBottom = all.length ? Math.max(...all.map((b) => b.top + b.height)) : 0;
  return {
    columns,
    bands,
    yFor: shiftedYFor,
    total: Math.max(gridBottom, blockBottom),
    scale: rung.scale,
  };
}

/**
 * Last resort: one global uniform squeeze, so the grid NEVER clips.
 *
 * The prototype simply returned its last attempt even when it overflowed, and
 * the plot is `overflow: hidden` — so the last event of the day silently
 * disappeared. Scaling the whole layout by one factor preserves cross-column
 * y-alignment EXACTLY (it is a single affine transform); only legibility
 * degrades, and the tier is telemetered so the degradation is measurable.
 */
function squeeze(a: Attempt, availableHeight: number): Attempt {
  if (a.total <= availableHeight || a.total <= 0) return a;
  const k = availableHeight / a.total;
  for (const block of a.columns.flat()) {
    block.top *= k;
    block.height *= k;
  }
  const bands = a.bands.map((band) => ({ ...band, top: band.top * k, height: band.height * k }));
  const inner = a.yFor;
  return { ...a, bands, yFor: (t: number) => inner(t) * k, total: availableHeight };
}

/**
 * ⭐ Axis rules and labels sit on the HOUR — not on event start times.
 *
 * Ticking at event starts was the single biggest readability problem this grid
 * had. The scale was already uniform, but the labels came out at 07:30, 08:05,
 * 15:20, 16:00, 16:30 … irregularly spaced, so nothing on screen told the reader
 * the vertical axis was linear. It looked arbitrary, and there was no way to
 * judge when an event started except by reading its own block.
 *
 * On the hour, evenly spaced by construction, the grid reads the way every
 * calendar a family has ever used reads — and a fold becomes the ONE deliberate
 * interruption, which is exactly what its label announces.
 *
 * Hours falling inside a fold are skipped: there is no room to draw them, and
 * they would claim a precision the compressed band does not have.
 */
function buildTicks(
  windowStart: number,
  windowEnd: number,
  folds: readonly GridFold[],
  yFor: (t: number) => number
): { minutes: number; y: number }[] {
  const ticks: { minutes: number; y: number }[] = [];
  const insideFold = (t: number) => folds.some((f) => t > f.startMinutes && t < f.resumeMinutes);
  for (let minutes = Math.ceil(windowStart / 60) * 60; minutes <= windowEnd; minutes += 60) {
    // (windowStart is already on the hour, so this begins at the plot's top edge)
    if (insideFold(minutes)) continue;
    ticks.push({ minutes, y: yFor(minutes) });
  }
  return ticks;
}

/**
 * Lay out the wall's time grid.
 *
 * TOTAL — never throws, for any input: zero events, a single instantaneous
 * event, an all-day-only day, unparseable times, or a zero/negative height.
 *
 * ⚠️ RULE 4 (second half) — overflow is a BUDGET problem, not a fold problem.
 * The settle pass ADDS height, so a configuration that fits on paper can
 * overflow once folds are pushed clear of the blocks above them. Reacting by
 * folding harder exhausted every rung and landed on the most aggressive setting
 * available, chopping a week that needed one fold into five. Lay out again
 * against a SMALLER BUDGET and the same gentle fold survives; only when the
 * budget genuinely cannot absorb it does the rung move.
 */
export function layoutTimeGrid(
  columns: readonly (readonly WallOccurrence[])[],
  availableHeight: number,
  options: LayoutOptions = {}
): GridLayout {
  const height = Math.max(1, availableHeight);
  const maxBlock = options.maxBlock ?? defaultMaxBlock(height);
  const input = parseColumns(columns, options.assumedDurationMin ?? ASSUMED_DURATION_MIN);

  const base = {
    windowStart: input.windowStart,
    windowEnd: input.windowEnd,
    rejected: input.rejected,
  };

  if (!input.items.length) {
    // A day with nothing on still draws its hours: an empty grid reads as "the
    // day is clear", where an empty rectangle reads as "this is broken".
    const scale = SCALE_STEPS[0]!;
    const { yFor } = buildScale(input.windowStart, input.windowEnd, [], scale);
    return {
      ...base,
      columns: columns.map(() => []),
      folds: [],
      ticks: buildTicks(input.windowStart, input.windowEnd, [], yFor),
      yFor,
      scale,
      tier: 'gentle',
      attempts: 0,
    };
  }

  /*
   * One pass down the ladder — no inner budget loop any more.
   *
   * The budget retry existed because the scale was fitted CONTINUOUSLY to the
   * available height, so overflow had to be absorbed by shrinking a number that
   * could take any value. Quantizing the scale replaced that whole mechanism:
   * the scale is now just another rung, tried in order, and the first rung whose
   * layout fits wins. Simpler, bounded by construction, and — the point — it
   * keeps the grid's hour on one of six known heights instead of a different one
   * every day.
   */
  let attempts = 0;
  let last: Attempt | null = null;
  let acceptedRung = 0;

  for (let rungIndex = 0; rungIndex < LADDER.length; rungIndex++) {
    const candidate = attempt(input, LADDER[rungIndex]!, maxBlock);
    attempts++;
    // The +1px tolerance is deliberate: without it a layout landing a hundredth
    // of a pixel over budget walks the entire ladder for nothing.
    if (candidate.total <= height + 1) {
      return finish(candidate, base, input, rungIndex, attempts, 'fit');
    }
    last = candidate;
    acceptedRung = rungIndex;
  }

  return finish(squeeze(last!, height), base, input, acceptedRung, attempts, 'squeezed');
}

function finish(
  a: Attempt,
  base: Pick<GridLayout, 'windowStart' | 'windowEnd' | 'rejected'>,
  input: ParsedInput,
  rungIndex: number,
  attempts: number,
  outcome: 'fit' | 'squeezed'
): GridLayout {
  /*
   * The tier says which compromise this day cost, and it leads with whether the
   * grid's HOUR had to change height — the one a family would notice from across
   * the room, and the one worth an alert if it starts happening to everybody.
   */
  const rung = LADDER[rungIndex]!;
  const tier: GridTier =
    outcome === 'squeezed'
      ? 'overflow'
      : rung.scale < SCALE_STEPS[0]!
        ? 'floored'
        : rungIndex > 0
          ? 'tightened'
          : 'gentle';
  return {
    ...base,
    columns: a.columns,
    folds: a.bands,
    ticks: buildTicks(input.windowStart, input.windowEnd, a.bands, a.yFor),
    yFor: a.yFor,
    scale: a.scale,
    tier,
    attempts,
  };
}
