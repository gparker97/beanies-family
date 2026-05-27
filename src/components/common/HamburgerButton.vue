<script setup lang="ts">
/**
 * The brand hamburger button — three lines in a squircle, the bottom one
 * shorter and Heritage Orange (a deliberate brand signature). Presentational:
 * emits `click`; the parent decides what it opens. Extracted from `AppHeader`
 * so the planner's reclaimed mobile command bar reuses the exact same button
 * (single source of truth — no drifting second hamburger).
 */
import { useTranslation } from '@/composables/useTranslation';

const emit = defineEmits<{ click: [] }>();
const { t } = useTranslation();
</script>

<template>
  <button
    type="button"
    class="flex h-10 w-10 flex-shrink-0 cursor-pointer flex-col items-start justify-center gap-[5px] rounded-[14px] bg-white pl-3 shadow-[0_2px_8px_rgba(44,62,80,0.06)] dark:bg-slate-800 dark:shadow-none"
    :aria-label="t('mobile.menu')"
    @click="emit('click')"
  >
    <span class="bg-secondary-500/50 h-[2px] w-[14px] rounded-full dark:bg-gray-400/50" />
    <span class="bg-secondary-500/50 h-[2px] w-[14px] rounded-full dark:bg-gray-400/50" />
    <span class="bg-primary-500 h-[2px] w-[10px] rounded-full" />
  </button>
</template>
