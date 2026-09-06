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
  /** The day the meals card opens — the anchored day, not necessarily today. */
  mealsYmd: string;
  peripherals: WallPeripheralData;
}>();

const emit = defineEmits<{ open: [WallSheetTarget]; openChores: [] }>();

const useRail = computed(() => props.rail && !props.portrait);

const peripheralVariant = computed(() =>
  wallPeripheralVariant(useRail.value ? 'rail' : 'band', props.busiest, props.portrait)
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
