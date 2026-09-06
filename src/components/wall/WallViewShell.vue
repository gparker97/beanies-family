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
import { useMediaQuery } from '@/composables/useMediaQuery';
import { wallPeripheralVariant } from '@/utils/wallActivities';
import { BAND_HEIGHT_QUERY, RAIL_WIDTH_PX } from '@/components/wall/wallLayout';
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
  /** The day the meals card opens — the anchored day, not necessarily today. */
  mealsYmd: string;
  peripherals: WallPeripheralData;
}>();

const emit = defineEmits<{ open: [WallSheetTarget]; openChores: [] }>();

const useRail = computed(() => props.rail && !props.portrait);

/**
 * Is the window tall enough for a stacked band to leave the grid a real day?
 *
 * Read here rather than plumbed down from the page: all three views ask the same
 * question of the same window, and a prop would have to be threaded through each
 * of them to arrive at the one component that uses it. `useMediaQuery` is
 * reactive and releases with the scope, so rotating a mounted tablet re-answers
 * it — the wall's stated requirement for every other layout decision.
 *
 * Defaults to `true` under SSR/jsdom, matching the pre-existing behaviour: the
 * band is the preference, and the first real match corrects it.
 */
const roomForBand = useMediaQuery(BAND_HEIGHT_QUERY, true);

const peripheralVariant = computed(() =>
  wallPeripheralVariant(
    useRail.value ? 'rail' : 'band',
    props.busiest,
    props.portrait,
    roomForBand.value
  )
);
</script>

<template>
  <div class="flex min-h-0 flex-1 gap-4" :class="portrait || !useRail ? 'flex-col' : 'flex-row'">
    <div class="flex min-h-0 flex-1 flex-col gap-2.5">
      <slot name="main" />
    </div>

    <div
      :class="useRail ? 'shrink-0 overflow-y-auto' : 'shrink-0'"
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
