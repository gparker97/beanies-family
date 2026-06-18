<script setup lang="ts">
/**
 * The canonical "add a thing" CTA — a gradient pill with a leading ＋, used to
 * start a new activity, list, contact, recipe, bean, etc. One component so every
 * add-button across the app stays visually identical instead of each page
 * re-deriving the gradient / shadow / ＋ markup.
 *
 *  - `tone`    — gradient + shadow colour. `'orange'` (default) is the brand add
 *                colour (Heritage Orange → Terracotta); `'ocean'` is the
 *                travel-plans cyan→blue, for ocean-themed add CTAs.
 *  - `compact` — for tight toolbars (e.g. the planner command bar): collapses to
 *                a circular ＋ on mobile, expanding to the full ＋label pill from
 *                `sm` up. Default `false` = the ＋label pill at every width.
 *
 * The ＋ is ALWAYS shown; only `compact` hides the label on mobile (where the
 * label still provides the button's accessible name via `aria-label`). Width and
 * alignment (full-width-on-mobile, `ml-auto`, `flex-1`, …) are layout concerns
 * owned by the call site — pass them as `class`; Vue merges them onto the root.
 */
import { computed } from 'vue';

const props = withDefaults(
  defineProps<{
    label: string;
    tone?: 'orange' | 'ocean';
    compact?: boolean;
  }>(),
  { tone: 'orange', compact: false }
);
const emit = defineEmits<{ click: [] }>();

const toneClass = computed(() =>
  props.tone === 'ocean'
    ? 'from-[#00B4D8] to-[#0077B6] shadow-[0_4px_12px_rgba(0,180,216,0.2)] hover:shadow-[0_6px_16px_rgba(0,180,216,0.3)]'
    : 'from-primary-500 to-terracotta-400 shadow-[0_4px_12px_rgba(241,93,34,0.2)] hover:shadow-[0_6px_16px_rgba(241,93,34,0.3)]'
);

// Shape/size lives here (not in the base) so the compact circle doesn't fight
// the pill's padding — the two sets are mutually exclusive, never additive.
const shapeClass = computed(() =>
  props.compact
    ? 'h-10 w-10 flex-shrink-0 gap-2 rounded-full text-xl sm:h-auto sm:w-auto sm:gap-1.5 sm:rounded-2xl sm:px-5 sm:py-2.5 sm:text-sm'
    : 'gap-1.5 rounded-2xl px-5 py-2.5 text-sm'
);
</script>

<template>
  <button
    type="button"
    class="font-outfit inline-flex cursor-pointer items-center justify-center bg-gradient-to-r font-semibold text-white transition-all"
    :class="[toneClass, shapeClass]"
    :aria-label="label"
    @click="emit('click')"
  >
    <span aria-hidden="true">＋</span>
    <span :class="{ 'hidden sm:inline': compact }">{{ label }}</span>
  </button>
</template>
