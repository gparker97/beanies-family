<script setup lang="ts">
/**
 * A drawn copy of Google's file-access consent row, shown when the person left that box unticked.
 * An ILLUSTRATION of Google's screen, never a control: `role="img"`, glyphs `aria-hidden`, no
 * hover state and no cursor change. The label is Google's own wording, rendered through `t()`
 * because Google localises it per account language.
 */
import { useTranslation } from '@/composables/useTranslation';

const { t } = useTranslation();
</script>

<template>
  <div
    class="dark:bg-surface-overlay dark:border-line-strong relative mb-4 flex items-start gap-2.5 rounded-xl border border-gray-300 bg-white py-3 pr-3 pl-2.5"
    role="img"
    :aria-label="t('createPod.consent.rowAlt')"
  >
    <span
      class="border-primary-500 dark:border-accent-lift pointer-events-none absolute top-[5px] left-0.5 h-[34px] w-[34px] rounded-full border-[3px]"
      aria-hidden="true"
    />
    <span
      class="font-outfit dark:bg-accent-lift dark:text-surface-ground bg-primary-500 pointer-events-none absolute -top-2.5 left-[38px] rounded-full px-2 py-0.5 text-xs font-semibold text-white"
      aria-hidden="true"
      >{{ t('createPod.consent.tick') }}</span
    >
    <span
      class="dark:border-line-strong dark:bg-surface-hover mt-0.5 h-[18px] w-[18px] flex-shrink-0 rounded-[3px] border-2 border-gray-500 bg-white"
      aria-hidden="true"
    />
    <div aria-hidden="true">
      <p class="dark:text-ink text-xs leading-snug text-gray-900">
        {{ t('createPod.consent.label') }}
      </p>
      <p class="dark:text-ink-soft mt-0.5 text-xs text-gray-500">{{ 'beanies.family' }}</p>
    </div>
  </div>
</template>
