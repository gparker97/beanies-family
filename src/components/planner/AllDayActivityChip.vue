<script setup lang="ts">
/**
 * Activity adapter over the generic `AllDayChip` — resolves the activity's
 * colour (with a defensive neutral-slate fallback that warns rather than
 * rendering broken CSS) and fills the chip's content slot with the activity
 * title plus a photo indicator. Public API: `activity` / `date` / `isStart` /
 * `isEnd` / `showLabel` / `withFaces` props, `click` event,
 * `data-testid="all-day-activity-chip"`; callers are `WeeklyCalendarView` and the month
 * grid's `MonthDayItem`.
 *
 * Text ink is the neutral `--color-text` on every surface; the owner's hue lives in the
 * edge and the flat wash, as on `MonthChip`. (It used to paint member-hue text on a
 * member-hue tint, which could fail contrast and had no lift on dark.)
 */
import { computed } from 'vue';
import type { FamilyActivity } from '@/types/models';
import { useActivityIdentity } from '@/composables/useActivityIdentity';
import AllDayChip from '@/components/planner/AllDayChip.vue';
import CelebrationConfetti from '@/components/ui/CelebrationConfetti.vue';
import PhotoIndicator from '@/components/media/PhotoIndicator.vue';

interface Props {
  activity: FamilyActivity;
  /** The occurrence date (`YYYY-MM-DD`), so an occasion can name its milestone. */
  date: string;
  /** First cell of the run. true for single-day; true on day 1 of multi-day. */
  isStart: boolean;
  /** Last cell of the run. true for single-day; true on the last day of multi-day. */
  isEnd: boolean;
  /** Draw the label. Unset = follow `isStart` (AllDayChip's tri-state; see its docblock). */
  showLabel?: boolean;
  /**
   * Draw the owners' faces after the label on the run's first day. Off by default, so
   * the week view's bars are unchanged; only the month grid's `MonthDayItem` sets it.
   */
  withFaces?: boolean;
}
const { identityFor, displayTitle } = useActivityIdentity();

const props = withDefaults(defineProps<Props>(), { showLabel: undefined, withFaces: false });
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
const bgColor = computed(() => identity.value.flatWash);
const faces = computed(() => (props.withFaces ? identity.value.stackMembers : undefined));
const title = computed(() => displayTitle(props.activity, props.date));
</script>

<template>
  <AllDayChip
    :title="title"
    :color="color"
    :bg-color="bgColor"
    :leading-emoji="identity.emoji"
    :celebrating="identity.celebration.celebrating"
    :is-start="isStart"
    :is-end="isEnd"
    :show-label="showLabel"
    ink="var(--color-text)"
    :faces="faces"
    :solo="identity.kind === 'solo'"
    testid="all-day-activity-chip"
    @click="(e: MouseEvent) => $emit('click', e)"
  >
    <CelebrationConfetti
      v-if="identity.celebration.celebrating"
      :activity-id="activity.id"
      density="month"
    />
    <span>{{ title }}<PhotoIndicator :photo-ids="activity.photoIds" /></span>
  </AllDayChip>
</template>
