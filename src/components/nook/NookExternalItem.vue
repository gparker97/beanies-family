<script setup lang="ts">
/**
 * A view-only external event as a row on the Nook schedule cards (plan 2026-11-17, C3).
 * Never editable: a real `button` that asks the page to open the read-only details.
 *
 * Same quiet vocabulary as every view-only surface: the stripes utility (it carries its
 * own dark partner), lighter inks, a hollow dot and the source calendar's name.
 */
import { computed } from 'vue';
import { useTranslation } from '@/composables/useTranslation';
import { formatTime12 } from '@/utils/date';
import { externalSpokenLabel } from '@/utils/calendar/externalDisplay';
import type { ExternalEvent } from '@/types/externalEvents';
import ExternalSourceLabel from '@/components/planner/ExternalSourceLabel.vue';

const props = defineProps<{
  event: ExternalEvent;
  /** The event's title, or "Busy" (already resolved by the card). */
  title: string;
  /** `HH:mm` or '' for an all-day event. */
  time: string;
  endTime: string;
}>();

const emit = defineEmits<{ open: [event: ExternalEvent] }>();

const { t } = useTranslation();

const timeLabel = computed(() =>
  props.time
    ? formatTime12(props.time) + (props.endTime ? ' - ' + formatTime12(props.endTime) : '')
    : ''
);
const spoken = computed(() => externalSpokenLabel(props.event, t, timeLabel.value || undefined));
</script>

<template>
  <button
    type="button"
    class="view-only-stripes flex w-full cursor-pointer items-center gap-3 rounded-xl px-2 py-1.5 text-left"
    :style="{ '--vo-hue': event.color }"
    :aria-label="spoken"
    data-testid="nook-external-item"
    @click="emit('open', event)"
  >
    <div class="min-w-0 flex-1" aria-hidden="true">
      <div class="truncate text-sm leading-tight font-medium text-[var(--vo-ink)]">
        {{ title }}
      </div>
      <div class="font-outfit mt-0.5 flex items-center gap-1 text-xs">
        <span v-if="timeLabel" class="flex-none text-[var(--vo-ink-faint)]">{{ timeLabel }} ·</span>
        <ExternalSourceLabel
          :name="event.calendarName"
          :color="event.color"
          :suffix="t('calendarView.event.viewOnly')"
          on-stripes
        />
      </div>
    </div>
  </button>
</template>
