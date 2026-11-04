/**
 * How a month chip draws (#141): its density, whether it is muted, whether it is a
 * control, and whether it shows times and solo faces.
 *
 * A typed provide rather than props, the `WALL_LOCK` / `WALL_WEATHER` precedent. The
 * cell decides the presentation and the two leaf renderers act on it, but between them
 * sit `MonthDayItem` and the content adapters (`MonthChip`, `MonthSegmentChip`,
 * `AllDayActivityChip`, `TripChip`), which only say WHAT a chip is. Drilling five
 * presentation flags through those components, which would only pass them on, is worse
 * than one typed channel, and it would teach every adapter about densities.
 *
 * Optional at every consumer: `inject(MONTH_CELL_CHIPS, undefined)`. No provider means
 * `DEFAULT_CELL_CHIPS`, which is today's look, so the week and day views (which mount
 * `AllDayChip` with no provider) render exactly as they did.
 *
 * The ONLY providers, and adding one needs a reason written here:
 *  - `MonthGridCell`: the grid densities, muted out-of-month days, and `interactive:
 *    false` inside a phone cell, whose root is the button (never nest buttons).
 *  - `MonthDayContents`: full anatomy for every day list (the stream card, the desktop
 *    popover, the phone day row). Vue's `inject` reads the PARENT chain, so a provider
 *    affects only its descendants, and this one overrides any grid context above it.
 *
 * The ONLY readers, and adding one needs a reason written here:
 *  - `MonthChipFrame` (one-line chips) and `AllDayChip` (spanning bars). Adapters pass
 *    content, never presentation.
 *
 * The scope matches the per-cell `--mg-*` CSS vars: the popover and the phone day row
 * are siblings of the cells, not descendants, so they never inherit grid presentation.
 *
 * Tests provide it as a ref (the key is ref-valued):
 * `global: { provide: { [MONTH_CELL_CHIPS as symbol]: ref({ ...DEFAULT_CELL_CHIPS, density: 'compact' }) } }`.
 */
import { computed, inject } from 'vue';
import type { ComputedRef, InjectionKey, Ref } from 'vue';
import type { MonthGridDensity } from '@/constants/calendarCaps';

export interface MonthCellChips {
  density: MonthGridDensity;
  /** Out-of-month cell: edge only, muted ink (`MonthChipFrame` only). */
  muted: boolean;
  /** False inside a phone cell, whose root is the button. */
  interactive: boolean;
  showTime: boolean;
  hideSoloFace: boolean;
}

export const MONTH_CELL_CHIPS: InjectionKey<Readonly<Ref<MonthCellChips>>> =
  Symbol('monthCellChips');

/** Today's look: what every chip outside the month grid and day lists renders. */
export const DEFAULT_CELL_CHIPS: MonthCellChips = {
  density: 'comfortable',
  muted: false,
  interactive: true,
  showTime: true,
  hideSoloFace: false,
};

/** The ONE nullish-safe reader. No provider = today's look, so the week and day views are unchanged. */
export function useMonthCellChips(): ComputedRef<MonthCellChips> {
  const ctx = inject(MONTH_CELL_CHIPS, undefined);
  return computed(() => ctx?.value ?? DEFAULT_CELL_CHIPS);
}
