<script setup lang="ts">
/**
 * Generic all-day calendar chip — the single visual treatment for a labelled
 * bar in the planner's all-day lane. It knows nothing about activities, trips or
 * holidays; domain adapters (`AllDayActivityChip`, `HolidayChip`, `BirthdayChip`,
 * `TripChip`) resolve the label/colour and fill the `default` slot with any
 * trailing bits (e.g. a photo indicator), so this stays decoupled.
 *
 * `isStart` / `isEnd` collapse the four span states into two booleans:
 *   single-day       → both true  (rounded both ends, accent border, label visible)
 *   multi-day start  → isStart    (rounded-l + accent border, label visible)
 *   multi-day middle → neither    (square corners, no border, no label — just the tint fill)
 *   multi-day end    → isEnd      (rounded-r, no border, no label)
 * Only the start cell carries the 2px colour border; middle/end cells are just
 * the tint fill — so adjacent per-cell slices read as one continuous bar rather
 * than a row of separate chips.
 *
 * Month grid options (#141), all backward compatible:
 *  - `showLabel` decouples "show the name" from "round the left end", so the name
 *    can repeat at column 0 of a row the run wraps into, and the phone lane can hide
 *    it. ⚠️ It is TRI-STATE and defaults to `undefined`, read as `showLabel ?? isStart`.
 *    Vue casts an absent `Boolean` prop to `false` unless a default is declared, so
 *    without the explicit `undefined` every existing chip (holidays, birthdays, the
 *    week view) would lose its label.
 *  - `ink` separates the text colour from the edge hue (default: `color`).
 *  - `faces` / `solo` draw a 2xs face stack after the label on the run's true first
 *    day only (`isStart && labelShown`), and not for a solo chip when the context says
 *    `hideSoloFace`.
 *  - The month chip context (`useMonthCellChips`, `monthCellChipsKey.ts`):
 *    `interactive: false` renders an `aria-hidden` span with no click (inside a phone
 *    cell, whose root is the button), and `interactive: true` adds `select-none` and no
 *    iOS long-press callout, since an interactive activity bar is a drag source (#142); `density: 'bars'` leaves a plain bar with no
 *    label or faces; `density: 'titles'` drops the emoji and faces and sits the text
 *    `leading-none` inside the short bar. No provider = today's look.
 */
import { computed } from 'vue';
import type { FamilyMember } from '@/types/models';
import ActivityOwnerStack from '@/components/ui/ActivityOwnerStack.vue';
import { useMonthCellChips } from '@/components/planner/monthCellChipsKey';

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
  /** Draw the label. Unset (the default) = follow `isStart`; see the docblock. */
  showLabel?: boolean;
  /** Text colour (CSS colour or var), separate from the edge hue. Default: `color`. */
  ink?: string;
  /** Faces after the label on the run's true first day. */
  faces?: FamilyMember[];
  /** A one-owner chip: its face is dropped when the context says `hideSoloFace`. */
  solo?: boolean;
}
const props = withDefaults(defineProps<Props>(), {
  testid: 'all-day-chip',
  celebrating: false,
  showLabel: undefined,
  solo: false,
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
const safeInk = computed(() => props.ink || safeColor.value);

const chips = useMonthCellChips();
const interactive = computed(() => chips.value.interactive);
const isBars = computed(() => chips.value.density === 'bars');
const isTitles = computed(() => chips.value.density === 'titles');

const labelShown = computed(() => (props.showLabel ?? props.isStart) && !isBars.value);
const showFaces = computed(
  () =>
    !!props.faces?.length &&
    props.isStart &&
    labelShown.value &&
    !isTitles.value &&
    !(props.solo && chips.value.hideSoloFace)
);
</script>

<template>
  <component
    :is="interactive ? 'button' : 'span'"
    :type="interactive ? 'button' : undefined"
    class="font-outfit flex min-w-0 items-center gap-1 truncate px-1.5 text-xs font-medium"
    :class="{
      // A control is also a drag source (#142): no long-press callout or text selection.
      'cursor-pointer transition-opacity select-none [-webkit-touch-callout:none] hover:opacity-80':
        interactive,
      'py-0 leading-none': isTitles,
      'py-0.5': !isTitles,
      'rounded-l-md': isStart,
      'rounded-r-md': isEnd,
      'border-l-2': isStart,
      italic,
      'is-celebration': celebrating,
    }"
    :style="
      celebrating
        ? { color: safeInk }
        : { borderLeftColor: safeColor, background: safeBg, color: safeInk }
    "
    :title="title"
    :aria-hidden="interactive ? undefined : 'true'"
    :data-testid="testid"
    @click="(e: MouseEvent) => interactive && $emit('click', e)"
  >
    <span v-if="labelShown" class="min-w-0 flex-1 truncate"
      ><span v-if="leadingEmoji && !isTitles" aria-hidden="true">{{ leadingEmoji }} </span
      ><slot>{{ title }}</slot></span
    >
    <!-- Middle/end cells of a multi-day run keep their height but no text,
         so the chip reads as one continuous bar visually. A Bars-density bar
         draws nothing inside: its height comes from the cell. -->
    <span v-else-if="!isBars" aria-hidden="true">&nbsp;</span>
    <ActivityOwnerStack v-if="showFaces" :members="faces!" size="2xs" :max="3" />
  </component>
</template>
