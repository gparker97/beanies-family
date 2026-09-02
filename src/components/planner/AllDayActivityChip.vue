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
import { useActivityIdentity } from '@/composables/useActivityIdentity';
import AllDayChip from '@/components/planner/AllDayChip.vue';
import PhotoIndicator from '@/components/media/PhotoIndicator.vue';

interface Props {
  activity: FamilyActivity;
  /** First cell of the run. true for single-day; true on day 1 of multi-day. */
  isStart: boolean;
  /** Last cell of the run. true for single-day; true on the last day of multi-day. */
  isEnd: boolean;
}
const { identityFor } = useActivityIdentity();

const props = defineProps<Props>();
defineEmits<{ click: [event: MouseEvent] }>();

/**
 * Colour now says WHOSE, not what category. `getActivityColor` returned the category
 * hue, and there are 95 categories across 86 colours — the Appointments group alone is
 * five shades of red — so hue could never distinguish them. It is spent on the small
 * closed set instead: the beans.
 *
 * The old local NEUTRAL_FALLBACK and its per-render `console.warn` are gone. A member
 * with no usable colour is now resolved centrally by `resolveMemberColor`, and reported
 * once per roster change from `familyStore` rather than once per paint.
 */
const identity = computed(() => identityFor(props.activity));
const color = computed(() => identity.value.color);
/**
 * A FLAT tint, never the shared gradient. AllDayChip paints one button per day cell,
 * so a multi-day run reads as one continuous bar only if every cell's fill matches —
 * a `linear-gradient` restarts in each cell and produces a seam per day boundary.
 * "Shared" is still carried here by the dashed edge and the face stack.
 */
const bgColor = computed(() => `${identity.value.color}22`);
</script>

<template>
  <AllDayChip
    :title="activity.title"
    :color="color"
    :bg-color="bgColor"
    :leading-emoji="identity.emoji"
    :is-start="isStart"
    :is-end="isEnd"
    testid="all-day-activity-chip"
    @click="(e: MouseEvent) => $emit('click', e)"
  >
    <span>{{ activity.title }}<PhotoIndicator :photo-ids="activity.photoIds" /></span>
  </AllDayChip>
</template>
