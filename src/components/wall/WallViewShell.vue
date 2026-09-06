<script setup lang="ts">
/**
 * The frame every calendar view sits in: the view's own content, and the
 * peripheral cards beside or beneath it.
 *
 * ⚠️ The duplication this removes was NOT the two-div flex shell — it was the
 * ten-prop `WallPeripheralCards` invocation and the `wallPeripheralVariant`
 * computed, both written out once per view, three times over. A slot-based
 * wrapper would have left all six copies standing. So this component owns the
 * cards, and the job/list props arrive as one `WallPeripheralData` bundle.
 *
 * Views pass their five props by name. No `v-bind="props"` forwarding: spreading
 * a view's whole prop bag through here would re-create exactly the untyped
 * pass-through this exists to remove, hiding which props are actually read and
 * silently delivering every future prop a view gains.
 */
import { computed } from 'vue';
import WallPeripheralCards from '@/components/wall/WallPeripheralCards.vue';
import { wallPeripheralVariant } from '@/utils/wallActivities';
import { RAIL_WIDTH_PX } from '@/components/wall/wallLayout';
import type { WallPeripheralData, WallSheetTarget } from '@/types/wall';

defineOptions({ inheritAttrs: false });

const props = defineProps<{
  portrait: boolean;
  /**
   * Whether this view gets the side rail. Days view says no below
   * `daysLayoutFor`, where a rail and its columns are decided together and would crowd
   * every day into a sliver; today and lanes have fewer columns and always
   * prefer it in landscape.
   *
   * Portrait ignores this entirely — there is no width to give away.
   */
  rail: boolean;
  /**
   * The busiest column's event count. Content-derived, never layout-derived:
   * `wallPeripheralVariant` downgrades a band to a strip on a heavy day, and
   * feeding it a measured height instead would oscillate.
   */
  busiest: number;
  /**
   * Is the window tall enough for a stacked band to leave the grid a real day?
   *
   * ⚠️ A PROP, deliberately, rather than a `useMediaQuery` read here. The page
   * already owns the wall's ONE viewport mechanism — a rAF-coalesced `resize`
   * listener feeding `viewportWidth`/`viewportHeight` — and its docblock says
   * why: two mechanisms disagree by the scrollbar and by fractional zoom, so
   * near a threshold two views can reach opposite conclusions about the same
   * screen at the same instant. Adding a media query here would have been the
   * third. It is also what lets the page REPORT the variant it actually got.
   */
  roomForBand: boolean;
  /** The day the meals card opens — the anchored day, not necessarily today. */
  mealsYmd: string;
  peripherals: WallPeripheralData;
}>();

const emit = defineEmits<{ open: [WallSheetTarget]; openChores: [] }>();

const useRail = computed(() => props.rail && !props.portrait);

const peripheralVariant = computed(() =>
  wallPeripheralVariant(
    useRail.value ? 'rail' : 'band',
    props.busiest,
    props.portrait,
    props.roomForBand
  )
);
</script>

<template>
  <div class="flex min-h-0 flex-1 gap-4" :class="portrait || !useRail ? 'flex-col' : 'flex-row'">
    <div class="flex min-h-0 flex-1 flex-col gap-2.5">
      <slot name="main" />
    </div>

    <!--
      ⚠️ A stacked band SHRINKS AND CLIPS; it is not `shrink-0`.

      `WallTimeGrid` states the policy — "if the wall is genuinely too short for
      everything, the peripherals clip" — and the calendar backs it with a
      `min-h-[13.75rem]` floor. While this wrapper refused to shrink, the two
      rules fought and the calendar lost QUIETLY: on a 1024x768 tablet the plot
      held its 220px floor, ran past the bottom of its slot, and the cards drew
      over the last two hours of the day. Nothing threw, because the plot is
      `overflow-hidden` and clipped its own contents tidily in the wrong place.

      With `min-h-0 shrink` the arithmetic can only resolve one way, so a wrong
      answer from `bandFitsHeight` — Large reading mode, an unusually tall
      portrait band — costs a clipped card instead of a covered evening.

      The rail keeps `shrink-0`: it sits BESIDE the grid and takes no height from
      it, and shrinking it would just narrow the cards for nothing.
    -->
    <div
      class="wall-peripherals"
      :class="useRail ? 'shrink-0 overflow-y-auto' : 'min-h-0 shrink overflow-hidden'"
      :style="useRail ? { width: `${RAIL_WIDTH_PX}px` } : undefined"
    >
      <WallPeripheralCards
        :variant="peripheralVariant"
        :portrait="portrait"
        :meals-ymd="mealsYmd"
        :peripherals="peripherals"
        @open="emit('open', $event)"
        @open-chores="emit('openChores')"
      />
    </div>
  </div>
</template>
