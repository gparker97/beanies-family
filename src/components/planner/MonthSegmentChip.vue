<script setup lang="ts">
/**
 * Travel-segment content adapter for the month chip (#141): the month chip anatomy
 * (`MonthChipFrame`) with a teal edge, so a flight sits in a day's timeline like any
 * other timed item. Labels come from `travelSegmentLabels`, the pure helper
 * `TravelSegmentChip` (week, day and timeline views) shares, so the two chips cannot
 * describe one flight differently.
 *
 * The washes are themed in `style.css` for light and dark: `--vacation-teal-15`, and
 * `--vacation-teal-tint` for a pending (unbooked) segment, which also takes the dashed
 * edge. (`--vacation-teal-5` is not defined anywhere, so it is not used.)
 */
import { computed } from 'vue';
import { travelSegmentLabels, type TravelSegmentOccurrence } from '@/utils/vacation';
import { useTranslation } from '@/composables/useTranslation';
import MonthChipFrame from '@/components/planner/MonthChipFrame.vue';

const props = defineProps<{ occurrence: TravelSegmentOccurrence }>();
const emit = defineEmits<{ click: [vacationId: string, segmentIndex: number] }>();

const { t } = useTranslation();
const labels = computed(() => travelSegmentLabels(props.occurrence, t));
</script>

<template>
  <MonthChipFrame
    color="var(--vacation-teal)"
    :wash="labels.isPending ? 'var(--vacation-teal-tint)' : 'var(--vacation-teal-15)'"
    :dashed="labels.isPending"
    :emoji="labels.emoji"
    :label="`${labels.kindLabelShort} ${occurrence.title}`"
    :time="labels.formattedTime"
    :spoken-label="labels.ariaLabel"
    testid="month-segment-chip"
    @click="emit('click', occurrence.vacationId, occurrence.segmentIndex)"
  />
</template>
