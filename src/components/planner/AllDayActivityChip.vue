<script setup lang="ts">
/**
 * Shared all-day activity chip — the single visual treatment used by both
 * the weekly view and the monthly view. Replaces what used to be inline
 * markup in `WeeklyCalendarView.vue` (single-day chips at lines 480-493
 * and 506-517 of the pre-2026-05-10 version).
 *
 * Two boolean props (`isStart`, `isEnd`) collapse what could have been a
 * four-state variant enum:
 *   - Single-day chip → both true (rounded both ends, title visible)
 *   - Multi-day start  → isStart=true, isEnd=false (rounded-l only, title visible)
 *   - Multi-day middle → both false (square corners, no title)
 *   - Multi-day end    → isEnd=true, isStart=false (rounded-r only, no title)
 *
 * The "title visible only on the start cell" rule keeps a multi-day run
 * reading as one continuous bar with one label, even though it's rendered
 * as N per-cell slices in the monthly view.
 */
import { computed } from 'vue';
import type { FamilyActivity } from '@/types/models';
import { getActivityColor } from '@/stores/activityStore';

interface Props {
  activity: FamilyActivity;
  /** First cell of the run. true for single-day; true on day 1 of multi-day. */
  isStart: boolean;
  /** Last cell of the run. true for single-day; true on the last day of multi-day. */
  isEnd: boolean;
}
const props = defineProps<Props>();
// Pass the native MouseEvent through so consumers can apply Vue template
// modifiers like `.stop` on the bound listener (those modifiers call
// `event.stopPropagation()` on the emitted payload).
defineEmits<{ click: [event: MouseEvent] }>();

// Defensive — corrupted activity (unknown category, missing color) never
// produces invalid CSS like `border-left-color: undefined`. Falls back to
// neutral slate; warns once per render so a real data corruption is
// diagnosable in production telemetry.
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

// Title only on the start cell of a run. A single-day chip has both flags
// true → title renders. Multi-day middle/end cells suppress the title.
const showTitle = computed(() => props.isStart);

// 8% alpha for the tinted background — matches the recipe weekly used:
// `getActivityColor(...) + '15'` (15 hex = 21 dec ≈ 8% alpha).
const bgColor = computed(() => `${color.value}15`);
</script>

<template>
  <button
    type="button"
    class="font-outfit min-w-0 cursor-pointer truncate border-l-2 px-1.5 py-0.5 text-xs font-medium transition-opacity hover:opacity-80"
    :class="{
      'rounded-l-md': isStart,
      'rounded-r-md': isEnd,
    }"
    :style="{
      borderLeftColor: color,
      background: bgColor,
      color: color,
    }"
    :title="activity.title"
    data-testid="all-day-activity-chip"
    @click="(e: MouseEvent) => $emit('click', e)"
  >
    <span v-if="showTitle">{{ activity.title }}</span>
    <!-- Middle/end cells of a multi-day run keep their height but no text,
         so the chip reads as one continuous bar visually. The non-breaking
         space ensures the cell maintains the same vertical rhythm as a
         titled chip — without it, empty buttons collapse to ~0 height. -->
    <span v-else aria-hidden="true">&nbsp;</span>
  </button>
</template>
