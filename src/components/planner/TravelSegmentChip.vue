<script setup lang="ts">
import { computed } from 'vue';
import { transportEmoji, type TravelSegmentOccurrence } from '@/utils/vacation';
import { formatTime12 } from '@/utils/date';
import { useTranslation } from '@/composables/useTranslation';

interface Props {
  occurrence: TravelSegmentOccurrence;
}

const props = defineProps<Props>();
const emit = defineEmits<{ click: [vacationId: string, segmentIndex: number] }>();
const { t } = useTranslation();

const emoji = computed(() => transportEmoji(props.occurrence.transportType, props.occurrence.kind));
const isPending = computed(() => props.occurrence.status === 'pending');
const formattedTime = computed(() =>
  props.occurrence.time ? formatTime12(props.occurrence.time) : ''
);
// Short kind label rendered as a title prefix so a 9am departure and a
// 5:30pm arrival of the same flight don't read as two separate flights.
const kindLabelShort = computed(() =>
  props.occurrence.kind === 'departure'
    ? t('planner.segmentDepartureShort')
    : t('planner.segmentArrivalShort')
);
// Full label still used for the tooltip / aria-label (screen readers).
const ariaLabel = computed(() => {
  const fullKindLabel =
    props.occurrence.kind === 'departure'
      ? t('planner.segmentDeparture')
      : t('planner.segmentArrival');
  return `${fullKindLabel}: ${props.occurrence.title}`;
});

function onClick() {
  emit('click', props.occurrence.vacationId, props.occurrence.segmentIndex);
}
</script>

<template>
  <button
    type="button"
    class="travel-chip"
    :class="isPending ? 'travel-chip-pending' : 'travel-chip-booked'"
    :title="ariaLabel"
    :aria-label="ariaLabel"
    @click.stop="onClick"
  >
    <span class="travel-chip-emoji" aria-hidden="true">{{ emoji }}</span>
    <span class="travel-chip-kind" aria-hidden="true">{{ kindLabelShort }}</span>
    <span class="travel-chip-title">{{ occurrence.title }}</span>
    <span v-if="formattedTime" class="travel-chip-time">{{ formattedTime }}</span>
  </button>
</template>

<style scoped>
.travel-chip {
  align-items: center;
  background: var(--vacation-teal-15, rgb(0 180 216 / 10%));
  border-radius: 0.5rem;
  color: var(--color-text);
  cursor: pointer;
  display: flex;
  font-family: Outfit, sans-serif;
  font-size: 0.75rem;
  gap: 0.375rem;
  line-height: 1.1;
  padding: 0.25rem 0.5rem;
  text-align: left;
  transition:
    box-shadow 0.15s ease,
    transform 0.1s ease;
  width: 100%;
}

.travel-chip:hover {
  box-shadow: 0 1px 4px rgb(0 0 0 / 8%);
}

.travel-chip:focus-visible {
  outline: 2px solid var(--vacation-teal);
  outline-offset: 2px;
}

.travel-chip-booked {
  border-left: 3px solid var(--vacation-teal);
}

.travel-chip-pending {
  background: var(--vacation-teal-5, rgb(0 180 216 / 5%));
  border: 2px dashed var(--vacation-teal);
  font-style: italic;
  opacity: 0.85;
}

.travel-chip-emoji {
  flex-shrink: 0;
}

.travel-chip-kind {
  color: var(--vacation-teal);
  flex-shrink: 0;
  font-size: 0.75rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  opacity: 0.85;
  text-transform: uppercase;
}

.travel-chip-title {
  flex: 1 1 auto;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.travel-chip-time {
  flex-shrink: 0;
  font-variant-numeric: tabular-nums;
  opacity: 0.7;
}
</style>
