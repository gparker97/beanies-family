<script setup lang="ts">
/**
 * Generic all-day calendar chip — the single visual treatment for a labelled
 * bar in the planner's all-day lane. It knows nothing about activities or
 * holidays; domain adapters (`AllDayActivityChip`, `HolidayChip`) resolve the
 * label/colour and fill the `default` slot with any trailing bits (e.g. a
 * photo indicator), so this stays decoupled.
 *
 * `isStart` / `isEnd` collapse the four span states into two booleans:
 *   single-day       → both true  (rounded both ends, accent border, label visible)
 *   multi-day start  → isStart    (rounded-l + accent border, label visible)
 *   multi-day middle → neither    (square corners, no border, no label — just the tint fill)
 *   multi-day end    → isEnd      (rounded-r, no border, no label)
 * Only the start cell carries the 2px colour border; middle/end cells are just
 * the tint fill — so adjacent per-cell slices read as one continuous bar rather
 * than a row of separate chips.
 */
import { computed } from 'vue';

interface Props {
  /** Label text — used as the title tooltip AND as the default slot content. */
  title: string;
  /** Border + text colour (hex or CSS var). */
  color: string;
  /** Background fill (typically the colour at ~8% alpha, or a CSS tint var). */
  bgColor: string;
  /** Optional emoji shown before the label on the start cell. */
  leadingEmoji?: string;
  italic?: boolean;
  /** First cell of the run (true for single-day; true on day 1 of multi-day). */
  isStart: boolean;
  /** Last cell of the run (true for single-day; true on the last day of multi-day). */
  isEnd: boolean;
  /** data-testid for the root button — adapters override it (e.g. 'holiday-chip'). */
  testid?: string;
  /**
   * Tier 3: a genuine celebration. Draws the gradient border — and ONLY that.
   *
   * No corner sticker here, for the reason `MonthChip` already records: this chip is
   * `truncate` (overflow-hidden) so the title can ellipsis, while `.is-celebration::after`
   * overhangs the corner at `right: -6px; top: -9px`, so it was clipped away entirely.
   * There is deliberately no `sticker` prop either: one existed, `AllDayActivityChip`
   * passed it, and it could never render — an accepted-and-discarded prop is the shape of
   * a defect, not a feature. The gradient border and the leading emoji carry the
   * celebration at this size.
   */
  celebrating?: boolean;
}
const props = withDefaults(defineProps<Props>(), {
  testid: 'all-day-chip',
  celebrating: false,
});
// Pass the native MouseEvent through so consumers can apply `.stop` etc. on the listener.
defineEmits<{ click: [event: MouseEvent] }>();

// Defensive — a falsy colour would render `border-left-color: ''` (silently
// transparent). Adapters guarantee a valid value, so this should never fire;
// if it does it warns rather than rendering broken CSS.
const NEUTRAL = 'rgb(100, 116, 139)'; // slate-500
const safeColor = computed(() => {
  if (props.color) return props.color;
  console.warn('[AllDayChip] missing `color` — using neutral fallback.');
  return NEUTRAL;
});
const safeBg = computed(() => props.bgColor || 'rgb(100 116 139 / 8%)');
</script>

<template>
  <button
    type="button"
    class="font-outfit min-w-0 cursor-pointer truncate px-1.5 py-0.5 text-xs font-medium transition-opacity hover:opacity-80"
    :class="{
      'rounded-l-md': isStart,
      'rounded-r-md': isEnd,
      'border-l-2': isStart,
      italic,
      'is-celebration': celebrating,
    }"
    :style="
      celebrating
        ? { color: safeColor }
        : { borderLeftColor: safeColor, background: safeBg, color: safeColor }
    "
    :title="title"
    :data-testid="testid"
    @click="(e: MouseEvent) => $emit('click', e)"
  >
    <span v-if="isStart"
      ><span v-if="leadingEmoji" aria-hidden="true">{{ leadingEmoji }} </span
      ><slot>{{ title }}</slot></span
    >
    <!-- Middle/end cells of a multi-day run keep their height but no text,
         so the chip reads as one continuous bar visually. -->
    <span v-else aria-hidden="true">&nbsp;</span>
  </button>
</template>
