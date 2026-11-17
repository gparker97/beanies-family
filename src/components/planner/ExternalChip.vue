<script setup lang="ts">
/**
 * A view-only external event as a one-line chip (plan 2026-11-17, C2): the month cell,
 * the day lists (popover, phone day row, stream card) and the all-day rows of the week,
 * day and phone timeline.
 *
 * Built on `MonthChipFrame` with `striped`: the soft stripes in the calendar's color,
 * no left color bar, the lighter inks, and a hollow dot in the decor slot. It is a
 * sibling of the holiday and birthday chips, never a "locked activity":
 *  - no drag attributes, no `data-activity-id`, no reveal hooks, so no drag path and no
 *    activity lookup can ever pick it up;
 *  - a click emits `open` with the event, and the frame stops propagation, so the day
 *    under it never also opens;
 *  - inside a phone cell or the stream card (`interactive: false`) the frame draws an
 *    `aria-hidden` span, so buttons never nest.
 *
 * The time shows only on a timed event and only where the chip context asks for times.
 * The calendar's name is in the accessible name and the tooltip; the dot carries it
 * visually at this size.
 */
import { computed } from 'vue';
import { useTranslation } from '@/composables/useTranslation';
import {
  externalEventTitle,
  externalSpokenLabel,
  externalWindowOn,
} from '@/utils/calendar/externalDisplay';
import { formatTime12 } from '@/utils/date';
import type { ExternalEvent } from '@/types/externalEvents';
import MonthChipFrame from '@/components/planner/MonthChipFrame.vue';

const props = defineProps<{
  event: ExternalEvent;
  /** The day this chip is drawn on (a multi-day event has a chip per day). */
  date: string;
}>();

const emit = defineEmits<{ open: [event: ExternalEvent] }>();

const { t } = useTranslation();

const title = computed(() => externalEventTitle(props.event, t));
const time = computed(() =>
  props.event.allDay ? '' : formatTime12(externalWindowOn(props.event, props.date).startTime)
);
const spoken = computed(() => externalSpokenLabel(props.event, t, time.value || undefined));
</script>

<template>
  <MonthChipFrame
    :color="event.color"
    striped
    :label="title"
    :time="time"
    :spoken-label="spoken"
    :title="`${title} · ${event.calendarName}`"
    testid="external-chip"
    @click="emit('open', event)"
  >
    <template #decor>
      <span
        class="view-only-dot h-2 w-2 flex-none rounded-full border-2"
        :style="{ '--vo-hue': event.color }"
        aria-hidden="true"
      />
    </template>
  </MonthChipFrame>
</template>
