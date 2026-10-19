<script setup lang="ts">
/**
 * One friendly line on the storage step: tells the person the one thing Google's consent screen
 * will ask of them (tick the file-access box). Expectation-setting, not a failure warning.
 * Shared by CreatePodView's storage step and ResumePodSetup's storage phase.
 */
import { useTranslation } from '@/composables/useTranslation';

const { t } = useTranslation();
</script>

<template>
  <div
    class="dark:bg-surface-overlay mt-2.5 flex items-start gap-2.5 rounded-xl bg-[var(--tint-silk-20)] px-3 py-2.5"
  >
    <span
      class="border-primary-500 text-primary-500 dark:border-accent-lift dark:text-accent-lift mt-px flex h-[18px] w-[18px] flex-shrink-0 items-center justify-center rounded-[5px] border-2"
      aria-hidden="true"
    >
      <svg class="h-3 w-3" fill="none" stroke="currentColor" stroke-width="3" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
      </svg>
    </span>
    <p class="text-secondary-500 dark:text-ink-soft text-xs leading-snug">
      {{ t('createPod.consent.hint') }}
    </p>
  </div>
</template>
