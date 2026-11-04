/**
 * Month calendar sizing: the density names, the stream's fixed day caps, and the
 * month grid's cell geometry (#141).
 *
 * The two month surfaces no longer share one cap. The mobile stream (a vertical
 * list of day cards) shows a FIXED number of items per day, `STREAM_DAY_CAPS`.
 * The month grid instead computes how many chips fit from the measured row height
 * and `MONTH_CELL_METRICS` (`cellCapacity` in `utils/monthGridLayout.ts`), so a
 * taller window shows more and a smaller one shows fewer, and nothing is ever
 * clipped. The old rule that "the two surfaces must show the same number" is
 * retired on purpose: a grid cell and a stream card are different shapes now.
 *
 * Module direction is one way: `utils/*` import these names and types, and this
 * file imports nothing from `utils/*`, so no type-only cycle forms.
 */

/** Desktop and tablet grid densities, in ascending detail. */
export const DESKTOP_DENSITIES = ['compact', 'comfortable'] as const;
/** Phone grid densities, in ascending detail (a spread steps right, a pinch steps left). */
export const PHONE_DENSITIES = ['faces', 'bars', 'titles'] as const;
export type DesktopDensity = (typeof DESKTOP_DENSITIES)[number];
export type PhoneDensity = (typeof PHONE_DENSITIES)[number];
export type MonthGridDensity = DesktopDensity | PhoneDensity;

/** A day list's caps. The stream's are fixed; the grid computes its own from geometry. */
export interface DayCaps {
  allDay: number;
  timed: number;
  segments: number;
}

/** The mobile stream's per-day caps (`capDayContents` in `utils/monthDayItems.ts`).
 *  `MonthDayCard` passes them to `MonthDayContents`. */
export const STREAM_DAY_CAPS: DayCaps = { allDay: 2, timed: 4, segments: 2 };

/**
 * One density's cell geometry, in rem so Large reading mode scales it. The grid's
 * capacity maths (`fitCount`, `cellCapacity`, `minRowPx`) and the cell's CSS
 * (`monthCellCssVars`) both read these numbers, so they cannot drift apart.
 */
export interface MonthCellMetrics {
  /** Cell padding above the numeral row. */
  padTopRem: number;
  /** Cell padding below the last chip. */
  padBottomRem: number;
  /** The numeral row's height (no gap below it). */
  numeralRem: number;
  /** The spanning lane bar's height. */
  laneRem: number;
  /** One chip's height. */
  chipRem: number;
  /** The gap between the lane and the first chip, and between chips. */
  gapRem: number;
  /** The "+N more" line's height. */
  moreRem: number;
  /** Chip slots shown when the row has not been measured (`rowPx === null`). */
  fallbackSlots: number;
}

/** The desktop cell's bottom border, reserved in both variants (phones get 1px of slack). */
export const MONTH_CELL_BORDER_PX = 1;

/**
 * Narrowest desktop cell (px) on which a Compact chip still shows its start time. Below it the
 * time would eat the title ("F... 4pm" at 1024x768), and the title is what a glance needs, so
 * the time yields. The breakpoint rule (times off on tablets) stays; this covers the widths
 * just above it, and any window where the sidebar leaves the grid narrow.
 */
export const MIN_CELL_PX_FOR_TIMES = 120;

export const MONTH_CELL_METRICS: Record<MonthGridDensity, MonthCellMetrics> = {
  compact: {
    padTopRem: 0.125,
    padBottomRem: 0.0625,
    numeralRem: 1.125,
    laneRem: 1.25,
    chipRem: 1.25,
    gapRem: 0.125,
    moreRem: 1,
    fallbackSlots: 3,
  },
  comfortable: {
    padTopRem: 0.125,
    padBottomRem: 0.0625,
    numeralRem: 1.375,
    laneRem: 1.5,
    chipRem: 1.75,
    gapRem: 0.125,
    moreRem: 1,
    fallbackSlots: 2,
  },
  titles: {
    padTopRem: 0.125,
    padBottomRem: 0.125,
    numeralRem: 1.125,
    laneRem: 0.5625,
    chipRem: 0.9375,
    gapRem: 0.09375,
    moreRem: 0.75,
    fallbackSlots: 5,
  },
  bars: {
    padTopRem: 0.125,
    padBottomRem: 0.1875,
    numeralRem: 1.125,
    laneRem: 0.5625,
    chipRem: 0.375,
    gapRem: 0.1875,
    moreRem: 0.75,
    fallbackSlots: 8,
  },
  // Faces has no chip stack; chipRem is the face cluster's two-line height
  // (2 × 0.875 faces + 0.1875 gap + 0.25 top pad), so minRowPx protects it.
  faces: {
    padTopRem: 0.125,
    padBottomRem: 0.1875,
    numeralRem: 1.125,
    laneRem: 0.5625,
    chipRem: 2.1875,
    gapRem: 0.1875,
    moreRem: 0.75,
    fallbackSlots: 0,
  },
};

/** The same numbers as CSS custom properties, bound on each grid cell. */
export function monthCellCssVars(m: MonthCellMetrics): Record<string, string> {
  return {
    '--mg-pad-t': `${m.padTopRem}rem`,
    '--mg-pad-b': `${m.padBottomRem}rem`,
    '--mg-numeral-h': `${m.numeralRem}rem`,
    '--mg-lane-h': `${m.laneRem}rem`,
    '--mg-chip-h': `${m.chipRem}rem`,
    '--mg-gap': `${m.gapRem}rem`,
    '--mg-more-h': `${m.moreRem}rem`,
  };
}
