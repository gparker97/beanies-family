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
 * The viewport width at which the days view can afford the rail.
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

/** The media query behind `DAYS_RAIL_MIN_VIEWPORT_PX`. */
export const DAYS_RAIL_QUERY = `(min-width: ${DAYS_RAIL_MIN_VIEWPORT_PX}px)`;
