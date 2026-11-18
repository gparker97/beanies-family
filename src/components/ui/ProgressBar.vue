<script setup lang="ts">
/**
 * A slim progress bar: the Heritage Orange gradient fill (a filled mark, the same in both themes)
 * on a `--tint-slate-10` track, which carries its own dark value (`style.css`). Extracted from
 * the "This Week" card (`ChoreWeekSummary`, #146) for its second use, the Star Report's special
 * rewards (#148), and used for a child's day head on the Choreboard.
 *
 * `size` is the bar's height: `sm` (the default, 0.375rem), `md` (0.5rem) or `lg` (0.75rem, the
 * wall's stars sheet, #154, read from a few steps away). The root's class
 * adds spacing and width only. `percent` is clamped to 0..100. Decorative by default
 * (`aria-hidden`): the words beside it say the number. A caller that needs the bar itself
 * spoken passes `role="progressbar"` and its own `aria-*`, which fall through to the root.
 */
import { computed, useAttrs } from 'vue';

const props = withDefaults(
  defineProps<{
    /** 0..100. */
    percent: number;
    /** The bar's height. */
    size?: 'sm' | 'md' | 'lg';
    /** The fill's `data-testid`. */
    fillTestid?: string;
  }>(),
  { size: 'sm', fillTestid: undefined }
);

const HEIGHT = { sm: 'h-1.5', md: 'h-2', lg: 'h-3' } as const;

const attrs = useAttrs();
const width = computed(() =>
  Number.isFinite(props.percent) ? Math.min(100, Math.max(0, props.percent)) : 0
);
const spoken = computed(() => !!attrs.role);
</script>

<template>
  <span
    class="block overflow-hidden rounded-full bg-[var(--tint-slate-10)]"
    :class="HEIGHT[size]"
    :aria-hidden="spoken ? undefined : 'true'"
  >
    <span
      class="from-primary-500 to-terracotta-400 block h-full rounded-full bg-gradient-to-r transition-[width] duration-300 motion-reduce:transition-none"
      :style="{ width: `${width}%` }"
      :data-testid="fillTestid"
    />
  </span>
</template>
