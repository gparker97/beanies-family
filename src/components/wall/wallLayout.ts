import { AXIS_WIDTH_PX } from '@/utils/wallTimeGrid';

/**
 * Page-layout facts about the wall's chrome.
 *
 * ⚠️ Deliberately NOT in `wallTimeGrid.ts`. That module is the pure, exhaustively
 * tested layout ENGINE, with more invariants than anything else in the wall;
 * rail widths and viewport thresholds are chrome, with a different lifetime and
 * a different set of reviewers, and parking them there would drag unrelated
 * churn through the file where churn is most expensive. `AXIS_WIDTH_PX` stays
 * where it is and is only referenced by the arithmetic below.
 */

/** The peripheral rail's fixed width in landscape, shared by all three calendar views. */
export const RAIL_WIDTH_PX = 296;

/**
 * The viewport width at which the days view can afford the rail — `railFits(x, 7)`
 * expressed as a number, kept only for the derivation it documents.
 *
 * Days view is the only one with SEVEN columns, and the rail's width comes out
 * of theirs. Derived, not invented:
 *
 *   296 rail + 16 gap + 62 axis (AXIS_WIDTH_PX) + 56 page padding (px-7 both
 *   sides) + 7 × 120 minimum column = 1270
 *
 * The 120px minimum sits comfortably above `WallTimeBlock`'s SLIVER_PX (95) and
 * below its WIDE_PX (210), so day columns land in the "tight" density rather
 * than the cramped one. At 1024px wide the same arithmetic gives 95px per
 * column — exactly the sliver threshold — which is the crowding this threshold
 * exists to prevent.
 *
 * ⭐ It is a MEDIA QUERY on the viewport, never a measurement of the plot. A
 * measured plot width would be bistable: enabling the rail shrinks the plot
 * below the threshold, which disables the rail, which widens it again. No
 * last-good fallback fixes an input that oscillates by construction.
 */
export const DAYS_RAIL_MIN_VIEWPORT_PX = 1270;

/**
 * ⚠️ There is no longer a media-query path. Days used `matchMedia` while lanes
 * used `innerWidth`; those disagree by the scrollbar width and by fractional
 * zoom, so near the threshold the two views could reach opposite conclusions on
 * the same screen at the same instant. Both now call `railFits`.
 */

/** Everything the rail costs a view's columns, in px. */
const RAIL_GAP_PX = 16;
const PAGE_PADDING_PX = 56; // px-7, both sides

/**
 * A column width that keeps a block's title. Comfortably above `WallTimeBlock`'s
 * SLIVER_PX (95) and below its WIDE_PX (210), so columns land in the readable
 * "tight" density rather than the cramped one.
 */
const MIN_READABLE_COLUMN_PX = 120;

/**
 * Does the rail fit beside `columns` columns at this viewport width?
 *
 * ⚠️ ONE rule for both views, because the crowding is the same arithmetic and
 * two rules drifted immediately. An earlier version gave days a fixed 1270px
 * threshold and lanes a `railWide || members <= 4` shortcut, which failed in
 * three directions at once: the `railWide ||` short-circuit meant a wide wall
 * never checked the count at all (nine lanes at 1270px get 93px, under the
 * sliver threshold this was written to prevent); dropping the rail for a large
 * family on a narrow wall pushed the cards into a band whose ~250px cost
 * `WallLanesView`'s own docblock had already measured and rejected; and four
 * lanes at 1024px gives ~148px, five pixels below the width that same file
 * measures inline-header truncation starting at.
 *
 * Substituting 7 reproduces DAYS_RAIL_MIN_VIEWPORT_PX exactly, which is the
 * check that this generalisation did not move the days view.
 */
export function railFits(viewportPx: number, columns: number): boolean {
  const forColumns = viewportPx - PAGE_PADDING_PX - RAIL_WIDTH_PX - RAIL_GAP_PX - AXIS_WIDTH_PX;
  return forColumns >= columns * MIN_READABLE_COLUMN_PX;
}
