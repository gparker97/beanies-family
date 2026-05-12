<script setup lang="ts">
/**
 * Activity adapter over the generic `AllDayChip` — resolves the activity's
 * colour (with a defensive neutral-slate fallback that warns rather than
 * rendering broken CSS) and fills the chip's content slot with the activity
 * title plus a photo indicator. Public API (`activity` / `isStart` / `isEnd`
 * props, `click` event, `data-testid="all-day-activity-chip"`) is unchanged so
 * its callers (`WeeklyCalendarView`, `CalendarGrid`) need no changes.
 */
import { computed } from 'vue';
import type { FamilyActivity } from '@/types/models';
import { getActivityColor } from '@/stores/activityStore';
import AllDayChip from '@/components/planner/AllDayChip.vue';
import PhotoIndicator from '@/components/media/PhotoIndicator.vue';

interface Props {
  activity: FamilyActivity;
  /** First cell of the run. true for single-day; true on day 1 of multi-day. */
  isStart: boolean;
  /** Last cell of the run. true for single-day; true on the last day of multi-day. */
  isEnd: boolean;
}
const props = defineProps<Props>();
defineEmits<{ click: [event: MouseEvent] }>();

// Defensive — a corrupted activity (unknown category, missing colour) never
// produces invalid CSS. Falls back to neutral slate and warns once per render
// so a real data corruption is diagnosable in production telemetry.
const NEUTRAL_FALLBACK = 'rgb(100, 116, 139)'; // slate-500
const color = computed(() => {
  const c = getActivityColor(props.activity);
  if (!c) {
    console.warn(
      `[AllDayActivityChip] No color resolved for activity ${props.activity.id} ` +
        `(category="${props.activity.category}"). Falling back to neutral slate.`
    );
    return NEUTRAL_FALLBACK;
  }
  return c;
});
// 8% alpha tinted background — `${color}15` (15 hex = 21 dec ≈ 8%). Category
// colours are always hex, so this concatenation is safe.
const bgColor = computed(() =>
  color.value.startsWith('#') ? `${color.value}15` : 'rgb(100 116 139 / 8%)'
);
</script>

<template>
  <AllDayChip
    :title="activity.title"
    :color="color"
    :bg-color="bgColor"
    :is-start="isStart"
    :is-end="isEnd"
    testid="all-day-activity-chip"
    @click="(e: MouseEvent) => $emit('click', e)"
  >
    <span>{{ activity.title }}<PhotoIndicator :photo-ids="activity.photoIds" /></span>
  </AllDayChip>
</template>
