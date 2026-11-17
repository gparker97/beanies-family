<script setup lang="ts">
/**
 * A timed view-only external event on a planner time grid (plan 2026-11-17, C2): the
 * desktop week grid, the day view's lanes, and the phone `DayTimeline`.
 *
 * Positioned exactly like `PlannerTimedBlock` (the grid's `getPosition` plus the lane
 * props), so an external event sits side by side with the activities it overlaps. But it
 * is quieter and it is not an activity:
 *  - the `.view-only-stripes` utility, no left color bar, the lighter inks;
 *  - no resize handle, no drag attributes, no `data-activity-id`, so neither the drag
 *    gesture (`resolveDragSource`) nor the reveal hooks can find it;
 *  - `@click.stop`, so the hour slot underneath (click-to-add) never also fires; the
 *    click opens the read-only details instead.
 *
 * Content: the title (or "Busy"), the time when the block is tall enough to hold a
 * second line, and the source (hollow dot + calendar name).
 *
 * The host passes the stacking class (`z-10` on the desktop grids, `z-[2]` in the phone
 * timeline), the same layer its activity blocks use.
 */
import { computed } from 'vue';
import { useTranslation } from '@/composables/useTranslation';
import {
  externalEventTitle,
  externalSpokenLabel,
  externalWindowLabel,
} from '@/utils/calendar/externalDisplay';
import type { ExternalEvent } from '@/types/externalEvents';
import ExternalSourceLabel from '@/components/planner/ExternalSourceLabel.vue';

const props = defineProps<{
  event: ExternalEvent;
  /** The window drawn on this day (`externalCards`: a tail starts at 00:00). */
  startTime: string;
  endTime: string;
  laneIndex: number;
  laneCount: number;
  /** The grid's `useTimeGrid().getPosition`. */
  getPosition: (startTime: string, endTime?: string) => { top: string; height: string };
}>();

const emit = defineEmits<{ open: [event: ExternalEvent] }>();

const { t } = useTranslation();

const title = computed(() => externalEventTitle(props.event, t));
const timeLabel = computed(() => externalWindowLabel(props.startTime, props.endTime));
const spoken = computed(() => externalSpokenLabel(props.event, t, timeLabel.value));

const blockStyle = computed(() => ({
  ...props.getPosition(props.startTime, props.endTime),
  left: `${(props.laneIndex / props.laneCount) * 100}%`,
  width: `calc(${100 / props.laneCount}% - 2px)`,
  '--vo-hue': props.event.color,
}));
</script>

<template>
  <button
    type="button"
    class="view-only-stripes absolute flex cursor-pointer flex-col gap-0.5 overflow-hidden rounded-lg px-1.5 py-1 text-left text-xs"
    :style="blockStyle"
    :aria-label="spoken"
    :title="`${title} · ${event.calendarName}`"
    data-testid="external-timed-block"
    @click.stop="emit('open', event)"
  >
    <span class="font-outfit block w-full truncate text-xs font-medium">{{ title }}</span>
    <span
      class="block w-full truncate text-xs leading-tight text-[var(--vo-ink-faint)] tabular-nums"
      aria-hidden="true"
      >{{ timeLabel }}</span
    >
    <ExternalSourceLabel
      :name="event.calendarName"
      :color="event.color"
      on-stripes
      class="w-full"
      aria-hidden="true"
    />
  </button>
</template>
