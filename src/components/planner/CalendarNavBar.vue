<script setup lang="ts">
import { useTranslation } from '@/composables/useTranslation';

defineProps<{ label: string }>();
defineEmits<{ prev: []; next: []; today: [] }>();

const { t } = useTranslation();
</script>

<template>
  <div class="mb-4 flex items-center justify-between">
    <div class="flex items-center gap-3">
      <button
        type="button"
        class="text-secondary-500/50 flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg transition-colors hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-slate-700"
        @click="$emit('prev')"
      >
        <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
          <path d="M15 19l-7-7 7-7" />
        </svg>
      </button>

      <h3
        class="font-outfit text-secondary-500 min-w-[160px] text-center text-lg font-bold dark:text-gray-100"
      >
        {{ label }}
      </h3>

      <button
        type="button"
        class="text-secondary-500/50 flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg transition-colors hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-slate-700"
        @click="$emit('next')"
      >
        <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
          <path d="M9 5l7 7-7 7" />
        </svg>
      </button>
    </div>

    <button
      type="button"
      class="font-outfit text-primary-500 hover:bg-primary-500/10 cursor-pointer rounded-xl px-3 py-1.5 text-sm font-semibold transition-colors"
      @click="$emit('today')"
    >
      {{ t('planner.today') }}
    </button>
  </div>
</template>
