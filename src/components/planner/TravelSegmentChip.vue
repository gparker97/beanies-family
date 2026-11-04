<script setup lang="ts">
import { computed } from 'vue';
import { travelSegmentLabels, type TravelSegmentOccurrence } from '@/utils/vacation';
import { useTranslation } from '@/composables/useTranslation';

interface Props {
  occurrence: TravelSegmentOccurrence;
}

const props = defineProps<Props>();
const emit = defineEmits<{ click: [vacationId: string, segmentIndex: number] }>();
const { t } = useTranslation();

// Emoji, pending flag, time and the short / full kind labels, from the ONE pure
// helper the month grid's `MonthSegmentChip` shares, so the two chips cannot
// describe one flight differently. The short kind label is a title prefix, so a
// 9am departure and a 5:30pm arrival of the same flight don't read as two flights.
const labels = computed(() => travelSegmentLabels(props.occurrence, t));

function onClick() {
  emit('click', props.occurrence.vacationId, props.occurrence.segmentIndex);
}
</script>

<template>
  <button
    type="button"
    class="travel-chip"
    :class="labels.isPending ? 'travel-chip-pending' : 'travel-chip-booked'"
    :title="labels.ariaLabel"
    :aria-label="labels.ariaLabel"
    @click.stop="onClick"
  >
    <span class="travel-chip-emoji" aria-hidden="true">{{ labels.emoji }}</span>
    <span class="travel-chip-kind" aria-hidden="true">{{ labels.kindLabelShort }}</span>
    <span class="travel-chip-title">{{ occurrence.title }}</span>
    <span v-if="labels.formattedTime" class="travel-chip-time">{{ labels.formattedTime }}</span>
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
