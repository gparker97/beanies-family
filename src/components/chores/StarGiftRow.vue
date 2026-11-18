<script setup lang="ts">
/**
 * Stars and rewards: one bonus or take-away as a row (#154). Shared by the Star Report's bonus
 * summary (`StarBonusPopover`), its week breakdown (`StarWeekPopover`) and the wall's stars sheet
 * (`WallStarsSheet`), so the three cannot word or colour an entry differently.
 *
 * The root is an `<li>`; each caller puts its own tile classes and attributes on it
 * (`data-testid`, `data-kind`, `data-gift-id`), because the lists are not identical. `leading`
 * holds a glyph before the words (the bonus summary's), `trailing` an action after the amount (its
 * remove button). Presentational: the line is built by `bonusLine` (`starText.ts`).
 *
 * Dark mode: the title `secondary-500` / `ink`, the day and note `secondary-500` / `ink-soft`; a
 * bonus amount green-700 / `success-lift`, a take-away amount neutral ink (never red: it is not
 * destructive). The tile behind it is the caller's.
 *
 * `size`: `md`, the default, is the app's row (the popovers); `lg` is the wall's, read from a few
 * steps away (the wall's line size for the day and note, its title a step larger). Sizes only.
 */
import { computed } from 'vue';
import type { BonusEntryLine } from '@/components/chores/starText';

const props = withDefaults(
  defineProps<{
    entry: BonusEntryLine;
    /** The amount's `data-testid`. */
    amountTestid?: string;
    /** The amount is left out of the spoken row (the title already says the count). */
    amountHidden?: boolean;
    /** `md`: the app's row; `lg`: the wall's. */
    size?: 'md' | 'lg';
  }>(),
  { amountTestid: undefined, amountHidden: false, size: 'md' }
);

/** Every size-dependent class, per size; `md` is the row as it has always been drawn. */
const SIZES = {
  md: { title: 'text-sm font-semibold', sub: 'text-xs', amount: 'text-sm' },
  lg: { title: 'text-xl font-bold', sub: 'text-base', amount: 'text-xl' },
} as const;
const sz = computed(() => SIZES[props.size]);
</script>

<template>
  <li>
    <slot name="leading" />
    <span class="min-w-0 flex-1">
      <span class="font-outfit text-secondary-500 dark:text-ink block" :class="sz.title">{{
        entry.title
      }}</span>
      <span
        v-if="entry.sub"
        class="text-secondary-500 dark:text-ink-soft block break-words"
        :class="sz.sub"
        >{{ entry.sub }}</span
      >
    </span>
    <b
      class="font-outfit flex-none font-extrabold tabular-nums"
      :class="[
        sz.amount,
        entry.take ? 'text-secondary-500 dark:text-ink' : 'dark:text-success-lift text-green-700',
      ]"
      :aria-hidden="amountHidden ? 'true' : undefined"
      :data-testid="amountTestid"
      >{{ entry.amount }}</b
    >
    <slot name="trailing" />
  </li>
</template>
