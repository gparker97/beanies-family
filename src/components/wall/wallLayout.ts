import { AXIS_WIDTH_PX } from '@/utils/wallTimeGrid';

/**
 * Page-layout facts about the wall's chrome.
 *
 * ⚠️ Deliberately NOT in `wallTimeGrid.ts`. That module is the pure, exhaustively
 * tested layout ENGINE, with more invariants than anything else in the wall;
 * rail widths and column counts are chrome, with a different lifetime and a
 * different set of reviewers, and parking them there would drag unrelated churn
 * through the file where churn is most expensive. `AXIS_WIDTH_PX` is imported
 * because the arithmetic below genuinely depends on it.
 */

/** The peripheral rail's fixed width in landscape, shared by all three calendar views. */
export const RAIL_WIDTH_PX = 296;

/** Everything the rail costs a view's columns, in px. */
const RAIL_GAP_PX = 16;
const PAGE_PADDING_PX = 56; // px-7, both sides

/*
 * ─── Three column widths, three different questions ──────────────────────────
 *
 * Stated together deliberately: each is defined by its distance from the others,
 * and separating them is how 120 and 210 ended up restated in prose across three
 * docblocks while `WallTimeBlock` owned the real numbers.
 *
 *   BLOCK_SLIVER_PX  95 — below this a block is a colour and nothing else. The
 *                         floor nothing may cross.
 *   MIN_READABLE_COLUMN_PX 120 — a column that keeps a block's TITLE. The LANES
 *                         view's question: can N people share the width beside
 *                         the rail? Above the sliver, below full density.
 *   TARGET_COLUMN_PX 211 — a column that renders a block at FULL density (title,
 *                         time, faces). The DAYS view's question, and it is a
 *                         DIFFERENT question: days choose how many columns to
 *                         draw, so they can afford to ask for the good width;
 *                         lanes are handed a family and must fit it.
 *
 * ⚠️ These two rules are NOT the same rule and must not be re-unified. An earlier
 * `railFits` docblock claimed one rule for both views; that was true only while
 * the days view had a fixed seven columns.
 */

/** Below this a block keeps only a colour. `WallTimeBlock`'s sliver density. */
export const BLOCK_SLIVER_PX = 95;
/** Above this a block renders at full density: title, time and owners' faces. */
export const BLOCK_FULL_PX = 210;

/** The narrowest column that keeps a block's title — the LANES view's rail test. */
const MIN_READABLE_COLUMN_PX = 120;

/** The narrowest column that renders a block at FULL density — hence `> BLOCK_FULL_PX`. */
const TARGET_COLUMN_PX = BLOCK_FULL_PX + 1;

/**
 * The right gutter the days view reserves for its forward navigation arrow.
 *
 * The BACK arrow costs nothing: it sits in the `AXIS_WIDTH_PX` gutter, which is
 * already subtracted below and is empty at the date row's height.
 *
 * ⚠️ Reserved by the column commit, OCCUPIED by the arrow commit that follows it.
 * For one commit the days view leaves 56px of unused right margin — deliberate,
 * and the cheap side of the trade: reserving early costs invisible margin,
 * whereas adding the arrows first would squeeze SEVEN columns through the gutter
 * (113px each at 1280, below MIN_READABLE_COLUMN_PX) for one commit of real
 * crowding sitting in the bisect window.
 */
export const ARROW_GUTTER_PX = 56;

/** Below three, the week view stops being distinguishable from the day view. */
export const MIN_DAY_COLUMNS = 3;
export const MAX_DAY_COLUMNS = 7;

/**
 * The width left for content after the page's chrome, at a given viewport.
 *
 * The ONE place the chrome list lives. Both views' width rules read it and then
 * diverge, and that divergence is the point of the two functions below.
 */
function chromeFreeWidth(viewportPx: number, withRail: boolean): number {
  const rail = withRail ? RAIL_WIDTH_PX + RAIL_GAP_PX : 0;
  return viewportPx - PAGE_PADDING_PX - AXIS_WIDTH_PX - rail;
}

/**
 * How many day columns FIT at this viewport — unclamped, and total.
 *
 * ⭐ Unclamped on purpose. `daysLayoutFor` needs the raw count TWICE: once to
 * decide whether the rail can stay, and once to pick the number to render. Two
 * clamped calls would ask one question two different ways, which is precisely
 * how `DAYS_RAIL_MIN_VIEWPORT_PX` and `railFits` drifted apart before.
 *
 * Zero, negative or NaN input yields 0 — never NaN, never negative. The
 * `Number.isFinite` guard has to be here rather than at the clamp, because
 * `Math.max(3, NaN)` is NaN.
 */
function dayColumnsThatFit(viewportPx: number, withRail: boolean): number {
  const content = chromeFreeWidth(viewportPx, withRail) - ARROW_GUTTER_PX;
  if (!Number.isFinite(content)) return 0;
  return Math.max(0, Math.floor(content / TARGET_COLUMN_PX));
}

/**
 * Does the rail fit beside `columns` LANES at this viewport width?
 *
 * ⚠️ This is the LANES rule ONLY. Its previous docblock claimed "ONE rule for
 * both views"; the days view now has its own, because the two views want
 * different things from a column — a lane needs to keep a TITLE
 * (`MIN_READABLE_COLUMN_PX`), a day column is being SIZED to reach full density
 * (`TARGET_COLUMN_PX`). One number cannot mean both, and a stale claim of shared
 * behaviour is worse than an honest statement of two.
 *
 * The 1270px derivation this replaced is preserved as a pinned test rather than
 * as a constant: 1270 = 56 padding + 296 rail + 16 gap + 62 axis + 7 × 120.
 *
 * ⭐ It reads the VIEWPORT, never the plot. A measured plot width is bistable:
 * enabling the rail shrinks the plot below the threshold, which disables the
 * rail, which widens it again. No last-good fallback fixes an oscillating input.
 */
export function railFits(viewportPx: number, columns: number): boolean {
  return chromeFreeWidth(viewportPx, true) >= columns * MIN_READABLE_COLUMN_PX;
}

/**
 * The days view's whole width decision: does the rail fit, and how many day
 * columns are left over?
 *
 * ⚠️ This REPLACES `DAYS_RAIL_MIN_VIEWPORT_PX`. That constant existed only
 * because seven FIXED columns had to be traded against a 296px rail — exactly
 * the "squeezed both ways" result this change set out to remove. Once the column
 * count absorbs whatever the rail leaves, there is nothing left to threshold.
 *
 * ⭐ Rail FIRST: keep it while `MIN_DAY_COLUMNS` still fit beside it, then let
 * the count absorb the remainder. One branch, one clamp, and the rail test and
 * the column count are provably the same arithmetic because they call the same
 * function.
 *
 * Total and pure: a zero, negative or NaN viewport clamps to `MIN_DAY_COLUMNS`
 * with no rail, because a grid with zero columns is a blank screen.
 */
export function daysLayoutFor(
  viewportPx: number,
  portrait: boolean
): { rail: boolean; columns: number } {
  const rail = !portrait && dayColumnsThatFit(viewportPx, true) >= MIN_DAY_COLUMNS;
  const fit = dayColumnsThatFit(viewportPx, rail);
  return { rail, columns: Math.min(MAX_DAY_COLUMNS, Math.max(MIN_DAY_COLUMNS, fit)) };
}

/**
 * The shortest screen on which a stacked BAND still leaves the grid a day worth
 * reading.
 *
 * ⚠️ A height rule, and the one place a height rule is safe. Everywhere else the
 * wall reads the VIEWPORT rather than a measured box, for the reason `railFits`
 * spells out; the same reasoning applies here twice over, because collapsing the
 * band GIVES the grid height, which would let it un-collapse. The window's own
 * height cannot move in response to what the band does, so it cannot oscillate.
 *
 * Derived, not guessed. Measured on the wall at two heights, a band and the
 * chrome above and below it cost the plot ~673px on both (768 → 101px of plot;
 * 1180 → 501px). Leaving the grid the ~320px below which `layoutTimeGrid` stops
 * producing a readable day therefore needs 673 + 320 ≈ 993px of window.
 *
 * Below it the band downgrades to a `strip`, which costs ~182px less and is what
 * the days view already falls back to on a busy day.
 */
export const BAND_MIN_VIEWPORT_HEIGHT_PX = 1000;

/**
 * Is this window tall enough to stack a full band under the grid?
 *
 * ⚠️ An APPROXIMATION, and knowingly so. Two things move the real number and a
 * viewport height in CSS px can see neither: the portrait band lays its cards
 * out `grid-cols-2`, so a family with three or more cards gets a second row the
 * landscape measurement never paid for; and Large reading mode scales every
 * padding, gap and font by 1.1875 while `innerHeight` does not move, pushing the
 * true cutoff to roughly 1120.
 *
 * It is allowed to be an approximation because it is no longer the only thing
 * standing between the cards and the calendar: `WallViewShell`'s peripheral
 * wrapper is shrinkable and clipped, so a wrong answer here costs a clipped card
 * rather than cards painted over the family's evening. Sizing this properly
 * means measuring the chrome in rem against a shared `MIN_READABLE_PLOT_PX` that
 * the grid's own `min-h-[13.75rem]` also consumes — worth doing, not worth doing
 * inside a change about the hour.
 */
export function bandFitsHeight(viewportHeightPx: number): boolean {
  if (!Number.isFinite(viewportHeightPx)) return true;
  return viewportHeightPx >= BAND_MIN_VIEWPORT_HEIGHT_PX;
}
