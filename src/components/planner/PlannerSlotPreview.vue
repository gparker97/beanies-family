<script setup lang="ts">
/**
 * Where a lifted timed block would land on a timeline column (#142): a ringed, Heritage
 * Orange-washed box over the slot `useCalendarDrag`'s `overSlot` names, sized by the grid's
 * own `getPosition` so it lines up with the blocks exactly. Shared by the week grid, the day
 * view's member columns and `DayTimeline`. Decorative (`aria-hidden`, the live region speaks
 * for the drag) and never hit-tested (`pointer-events-none`). A pointer drag's ghost snaps
 * onto the same slot; a keyboard lift has no ghost, so this is all it shows.
 */
import { computed } from 'vue';
import type { TimelineSlot } from '@/composables/drag/timelineSlot';
import { DROP_TARGET_RING } from '@/constants/dragStyles';

const props = defineProps<{
  preview: TimelineSlot;
  getPosition: (startTime: string, endTime?: string) => { top: string; height: string };
}>();

const position = computed(() => props.getPosition(props.preview.startTime, props.preview.endTime));
</script>

<template>
  <div
    aria-hidden="true"
    data-testid="drop-slot-preview"
    class="pointer-events-none absolute inset-x-0 z-[15] rounded-lg"
    :class="DROP_TARGET_RING"
    :style="position"
  />
</template>
