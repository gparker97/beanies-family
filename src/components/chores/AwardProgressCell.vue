<script setup lang="ts">
/**
 * Stars and rewards: a special reward's progress as one cell, the bar and its "64 of 160 stars"
 * label (#154). Shared by the Star Report's Special Rewards Progress and the wall's stars sheet.
 *
 * Bar plus label only: each caller draws its own reward header and its own achieved state (the
 * report a green tag with no bar, the wall the orange Earned badge over a full bar), because one
 * branch could not serve both without changing the report. The bar is the spoken element
 * (`aria`); the label beside it is hidden from a screen reader, which hears it in `aria`.
 *
 * Dark mode: the bar is `ProgressBar`'s (brand gradient on its `--tint-slate-10` track, which
 * carries its own dark value); the label `secondary-500` / `ink-soft`.
 *
 * `size`: `md`, the default, is the Star Report's cell; `lg` is the wall's, read from a few steps
 * away: a taller bar and the wall's line size for the label. Sizes only.
 */
import { computed } from 'vue';
import ProgressBar from '@/components/ui/ProgressBar.vue';

const props = withDefaults(
  defineProps<{
    /** "64 of 160 stars" (`awardProgressLabel`, the one wording). */
    label: string;
    /** 0..100. */
    percent: number;
    /** The bar's spoken name. */
    aria: string;
    /** The bar fill's `data-testid`. */
    fillTestid?: string;
    /** `md`: the report's cell; `lg`: the wall's. */
    size?: 'md' | 'lg';
  }>(),
  { fillTestid: undefined, size: 'md' }
);

/** Every size-dependent class, per size; `md` is the cell as it has always been drawn. */
const SIZES = {
  md: { root: 'gap-2', bar: 'md', label: 'text-xs' },
  lg: { root: 'gap-3', bar: 'lg', label: 'text-base' },
} as const;
const sz = computed(() => SIZES[props.size]);
</script>

<template>
  <span class="flex min-w-0 items-center" :class="sz.root">
    <ProgressBar
      class="min-w-8 flex-1"
      :size="sz.bar"
      :percent="percent"
      role="progressbar"
      aria-valuemin="0"
      aria-valuemax="100"
      :aria-valuenow="percent"
      :aria-label="aria"
      :fill-testid="fillTestid"
    />
    <span
      class="text-secondary-500 dark:text-ink-soft flex-none font-semibold whitespace-nowrap"
      :class="sz.label"
      aria-hidden="true"
      >{{ label }}</span
    >
  </span>
</template>
