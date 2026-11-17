<script setup lang="ts">
/**
 * A timed view-only external event on the wall's time grid (plan 2026-11-17, C4): the
 * sibling of `WallTimeBlock`, positioned by the same layout (`layoutTimeGrid` packs it
 * into lanes beside the activities it overlaps), but quieter, and not an activity:
 *  - the shared `.view-only-stripes` utility in the calendar's color (`--vo-hue`), and
 *    NO 5px owner bar, because nobody in the family owns it;
 *  - lighter type (semibold title in the stripes' soft ink, faint meta);
 *  - a tap opens the read-only details. There is nothing to edit, so the lock is never
 *    asked: a locked wall opens it too, and no PIN prompt can follow.
 *
 * Sized with the wall's own type scale (`wall-block-title`, `wall-block-meta`, set on
 * `.wall-root` per tier), so it reads at the same distance as the activity beside it.
 * Density is chosen from the width THIS block gets, with `WallTimeBlock`'s thresholds.
 *
 * Content, as height allows: the title (or "Busy"), the time range, the source (hollow
 * dot + calendar name). A sliver keeps only the dot; the accessible name always carries
 * the title, the time and the calendar.
 */
import { computed } from 'vue';
import ExternalSourceLabel from '@/components/planner/ExternalSourceLabel.vue';
import { useTranslation } from '@/composables/useTranslation';
import { externalEventTitle, externalSpokenLabel } from '@/utils/calendar/externalDisplay';
import { BLOCK_FULL_PX, BLOCK_SLIVER_PX } from '@/components/wall/wallLayout';
import type { ExternalEvent } from '@/types/externalEvents';

/** A second line (the source) needs this much height; `WallTimeBlock`'s meta floor. */
const SOURCE_MIN_HEIGHT_PX = 46;
/** A third line (the time range) needs this much. */
const TIME_MIN_HEIGHT_PX = 64;
/** Above this a block is mostly empty, so its content sits at the optical centre. */
const TALL_PX = 90;

const props = defineProps<{
  event: ExternalEvent;
  /** Rendered width in px, already divided by the lane share. */
  width: number;
  height: number;
  /** "15:00–17:00", the grid's own clock format for this column's day. */
  timeRange: string;
}>();
defineEmits<{ open: [] }>();

const { t } = useTranslation();

const density = computed<'full' | 'tight' | 'sliver'>(() =>
  props.width < BLOCK_SLIVER_PX ? 'sliver' : props.width > BLOCK_FULL_PX ? 'full' : 'tight'
);
const title = computed(() => externalEventTitle(props.event, t));
const showSource = computed(
  () => density.value !== 'sliver' && props.height >= SOURCE_MIN_HEIGHT_PX
);
const showTime = computed(() => density.value !== 'sliver' && props.height >= TIME_MIN_HEIGHT_PX);
const spoken = computed(() => externalSpokenLabel(props.event, t, props.timeRange));
</script>

<template>
  <button
    type="button"
    class="view-only-stripes absolute flex flex-col overflow-hidden rounded-xl text-left"
    :class="[
      density === 'sliver' ? 'items-center justify-center px-0.5 py-1' : 'px-2 py-1',
      density === 'full' ? 'px-2.5' : '',
      height > TALL_PX && density !== 'sliver' ? 'justify-center' : '',
    ]"
    :style="{ '--vo-hue': event.color }"
    :title="`${title} · ${event.calendarName}`"
    :aria-label="spoken"
    data-testid="wall-external-block"
    @click="$emit('open')"
  >
    <span
      v-if="density === 'sliver'"
      class="view-only-dot block h-2.5 w-2.5 flex-none rounded-full border-2 border-solid"
      aria-hidden="true"
    />
    <template v-else>
      <span
        class="wall-block-title font-outfit block w-full overflow-hidden leading-tight font-semibold"
        :class="[
          density === 'tight' ? 'wall-block-title-tight' : '',
          height > TALL_PX ? 'line-clamp-2' : 'truncate',
        ]"
        aria-hidden="true"
        data-testid="wall-external-title"
        >{{ title }}</span
      >
      <span
        v-if="showTime"
        class="wall-block-meta font-inter mt-0.5 block w-full truncate text-[var(--vo-ink-faint)] tabular-nums"
        aria-hidden="true"
        data-testid="wall-external-time"
        >{{ timeRange }}</span
      >
      <ExternalSourceLabel
        v-if="showSource"
        :name="event.calendarName"
        :color="event.color"
        on-stripes
        class="wall-block-meta mt-0.5 w-full"
        aria-hidden="true"
      />
    </template>
  </button>
</template>
