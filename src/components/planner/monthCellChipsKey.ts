/**
 * How a month chip draws (#141): its density, whether it is a control, and whether it
 * shows times and solo faces. An out-of-month day is not a chip concern: `MonthGridCell`
 * fades its whole content block, so chips always draw their normal ink and wash.
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
 *  - `MonthGridCell`: the grid densities, and `interactive: false` inside a phone cell,
 *    whose root is the button (never nest buttons).
 *  - `MonthDayCard`: `interactive: false`, because the stream card's root is the button
 *    (never nest buttons). Everything else is the default.
 *  - `MonthDayContents`: full anatomy for every day list (the stream card, the desktop
 *    popover, the phone day row). Vue's `inject` reads the PARENT chain, so a provider
 *    affects only its descendants, and this one overrides any grid context above it,
 *    except `interactive`, which it passes through from its parent.
 *
 * The ONLY readers, and adding one needs a reason written here:
 *  - `MonthChipFrame` (one-line chips) and `AllDayChip` (spanning bars). Adapters pass
 *    content, never presentation.
 *  - `MonthDayContents`, for its parent's `interactive` (and its own "+N more").
 *  - `MonthDayItem`, for `interactive` only: it places the drag source (#142) on the two
 *    activity chips, and a drag source is a control, so it exists only where the chip is a
 *    control (never inside a phone cell or the stream card, whose roots are the buttons).
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
  interactive: true,
  showTime: true,
  hideSoloFace: false,
};

/** The ONE nullish-safe reader. No provider = today's look, so the week and day views are unchanged. */
export function useMonthCellChips(): ComputedRef<MonthCellChips> {
  const ctx = inject(MONTH_CELL_CHIPS, undefined);
  return computed(() => ctx?.value ?? DEFAULT_CELL_CHIPS);
}
