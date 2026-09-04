<script setup lang="ts">
import { computed } from 'vue';

/**
 * ONE chip. Purely presentational: no state, no store, no emit beyond `click`.
 *
 * Extracted verbatim from `FrequencyChips` when the cookbook needed the same chip in a
 * MULTI-select group. The alternative — giving `FrequencyChips` a `multiple` flag and a
 * `string | string[]` modelValue — was rejected: a union-typed modelValue widens the
 * `update:modelValue` emit for all 16 existing call sites, so `v-model` bound to a
 * `Ref<string>` stops type-checking without a cast. That is a type hole opened in sixteen
 * unrelated controls to save one file, and it contradicts the app's own convention, where
 * single-select and multi-select are separate components (`FrequencyChips`/`TogglePillGroup`
 * single, `DayOfWeekSelector`/`BaseMultiSelect` multi).
 *
 * The classes here are byte-identical to the ones `FrequencyChips` shipped;
 * `FrequencyChips.test.ts` pins them.
 */
interface Props {
  label: string;
  selected: boolean;
  icon?: string;
  disabled?: boolean;
  disabledHint?: string;
  /** Selected-chip accent. Defaults to Heritage Orange; 'purple' for to-do surfaces. */
  accent?: 'orange' | 'purple';
  /** Dimmed trailing count, e.g. how many recipes carry this course. */
  badge?: string | number;
}

const props = defineProps<Props>();
defineEmits<{ click: [] }>();

const selectedClass = computed(() =>
  props.accent === 'purple'
    ? 'border-purple-500 text-purple-500 dark:bg-purple-500/15 border-2 bg-[var(--tint-purple-12)]'
    : 'border-primary-500 text-primary-500 dark:bg-primary-500/15 border-2 bg-[var(--tint-orange-8)]'
);

// `0` is a real count and must render; only an absent badge is hidden. `v-if="badge"` would
// silently drop every zero.
const hasBadge = computed(() => props.badge !== undefined && props.badge !== null);
</script>

<template>
  <span class="group relative inline-flex">
    <button
      type="button"
      class="font-outfit rounded-full px-3.5 py-1.5 text-xs font-semibold transition-all duration-150"
      :class="[
        selected
          ? selectedClass
          : disabled
            ? 'dark:bg-surface-overlay dark:text-ink-faint border-2 border-transparent bg-[var(--tint-slate-5)] text-[var(--color-text-muted)] opacity-40'
            : 'dark:bg-surface-overlay dark:text-ink-soft border-2 border-transparent bg-[var(--tint-slate-5)] text-[var(--color-text-muted)] hover:bg-[var(--tint-slate-10)]',
        disabled ? 'cursor-not-allowed' : '',
      ]"
      :disabled="disabled"
      @click="!disabled && $emit('click')"
    >
      <span v-if="icon" class="mr-1">{{ icon }}</span>
      {{ label }}
      <span v-if="hasBadge" class="ml-1 opacity-50">{{ badge }}</span>
    </button>
    <!-- Disabled hint tooltip -->
    <span
      v-if="disabled && disabledHint"
      class="dark:bg-surface-hover pointer-events-none absolute bottom-full left-0 z-50 mb-1.5 rounded-lg bg-gray-800 px-2.5 py-1 text-[0.625rem] font-medium whitespace-nowrap text-white opacity-0 shadow-lg transition-opacity group-hover:opacity-100"
    >
      {{ disabledHint }}
    </span>
  </span>
</template>
