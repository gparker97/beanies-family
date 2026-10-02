<script setup lang="ts">
/**
 * How many times a recipe gets cooked (#116): a prominent "Cook ×3" in the success green,
 * or a quiet "Cook Once". Shared by the week's shopping list (the week's total) and the
 * edit-meal drawer's shopping sheet (this meal), so the two surfaces can never disagree about
 * what the marker means.
 *
 * Contrast: #1E8449 with white clears 4.5:1, and the fill stays the same in BOTH modes
 * (it is a filled marker, not accent text, so it needs no lift). The quiet Cook Once pill
 * has its own dark partner. A screen reader hears "Cook 3 times" / "Cook once".
 */
import { computed } from 'vue';
import { useTranslation } from '@/composables/useTranslation';
import { fillTemplate } from '@/utils/fillTemplate';

const props = defineProps<{ count: number }>();

const { t } = useTranslation();

const n = computed(() => String(props.count));
const once = computed(() => props.count <= 1);
</script>

<template>
  <span
    v-if="once"
    class="font-outfit dark:bg-surface-hover dark:text-ink-soft inline-flex flex-shrink-0 items-center rounded-xl bg-[var(--tint-slate-5)] px-2.5 py-1 text-xs font-semibold whitespace-nowrap text-[var(--color-text-muted)]"
    data-testid="cook-count-pill"
  >
    <span aria-hidden="true">{{ t('mealPlanner.shopping.cook.once') }}</span>
    <span class="sr-only">{{ t('mealPlanner.shopping.cook.onceAria') }}</span>
  </span>
  <span
    v-else
    class="font-outfit inline-flex flex-shrink-0 items-center rounded-xl bg-[#1e8449] px-3 py-1 text-sm font-extrabold whitespace-nowrap text-white tabular-nums dark:bg-[#1e8449] dark:text-white"
    data-testid="cook-count-pill"
  >
    <!-- "×3" is decorative to a screen reader; it hears "Cook 3 times" instead. -->
    <span aria-hidden="true">{{ fillTemplate(t('mealPlanner.shopping.cook.times'), { n }) }}</span>
    <span class="sr-only">{{ fillTemplate(t('mealPlanner.shopping.cook.timesAria'), { n }) }}</span>
  </span>
</template>
