<script setup lang="ts">
/**
 * Holiday adapter over the generic `AllDayChip` — renders a public-holiday
 * occurrence as an italic, clay-tinted chip labelled "<Name> (<CC>)" so it
 * reads as a "special day" distinct from user activities and travel bars.
 * The country code goes in parentheses *after* the name (not a leading flag
 * emoji — flag emoji rendering is device-dependent and looks cramped on the
 * dense calendar grid).
 */
import type { HolidayOccurrence } from '@/types/models';
import AllDayChip from '@/components/planner/AllDayChip.vue';

interface Props {
  holiday: HolidayOccurrence;
  /** First cell of the run (true for single-day; true on day 1 of a multi-day holiday). */
  isStart: boolean;
  /** Last cell of the run. */
  isEnd: boolean;
}
defineProps<Props>();
defineEmits<{ click: [event: MouseEvent] }>();
</script>

<template>
  <AllDayChip
    :title="`${holiday.name} (${holiday.countryCode})`"
    color="var(--holiday-clay)"
    bg-color="var(--holiday-clay-tint)"
    italic
    :is-start="isStart"
    :is-end="isEnd"
    testid="holiday-chip"
    @click="(e: MouseEvent) => $emit('click', e)"
  />
</template>
