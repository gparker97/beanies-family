<script setup lang="ts">
/**
 * A view-only external event as a row in the day agenda (plan 2026-11-17, C2), beside the
 * activities' `ActivityListCard`s in time order. A row has room, so it spells out
 * "view only" after the calendar's name (the mockup's agenda).
 *
 * The same quiet vocabulary as every other view-only item: the stripes utility, no edge
 * bar, the lighter inks, a hollow dot. A real `button` that opens the read-only details;
 * it carries no drag attributes and no `data-activity-id`.
 */
import { computed } from 'vue';
import { useTranslation } from '@/composables/useTranslation';
import {
  externalEventTitle,
  externalSpokenLabel,
  externalTimeLabel,
} from '@/utils/calendar/externalDisplay';
import type { ExternalEvent } from '@/types/externalEvents';
import ExternalSourceLabel from '@/components/planner/ExternalSourceLabel.vue';

const props = defineProps<{
  event: ExternalEvent;
  /** The day the agenda shows (an overnight event's tail reads from midnight). */
  date: string;
}>();

const emit = defineEmits<{ open: [event: ExternalEvent] }>();

const { t } = useTranslation();

const title = computed(() => externalEventTitle(props.event, t));
const time = computed(() => (props.event.allDay ? '' : externalTimeLabel(props.event, props.date)));
const spoken = computed(() => externalSpokenLabel(props.event, t, time.value || undefined));
</script>

<template>
  <button
    type="button"
    class="view-only-stripes flex w-full cursor-pointer items-center gap-2.5 rounded-2xl px-3 py-2.5 text-left"
    :style="{ '--vo-hue': event.color }"
    :aria-label="spoken"
    data-testid="external-event-row"
    @click="emit('open', event)"
  >
    <div class="min-w-0 flex-1" aria-hidden="true">
      <div class="flex items-center justify-between gap-2">
        <span class="font-outfit min-w-0 truncate text-sm font-medium">{{ title }}</span>
        <span v-if="time" class="flex-shrink-0 text-xs text-[var(--vo-ink-faint)] tabular-nums">{{
          time
        }}</span>
      </div>
      <ExternalSourceLabel
        :name="event.calendarName"
        :color="event.color"
        :suffix="t('calendarView.event.viewOnly')"
        on-stripes
        class="mt-0.5"
      />
    </div>
  </button>
</template>
