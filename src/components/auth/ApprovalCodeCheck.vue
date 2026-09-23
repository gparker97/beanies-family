<script setup lang="ts">
/**
 * The short code both devices show during a sign-in approval, with the instruction to
 * compare it (#97).
 *
 * ONE component for both sides — the device asking and the device approving — because the
 * comparison only works if the two screens present the same thing the same way. The
 * instruction sits directly ABOVE the code, in heading weight, because it is the action the
 * person must take; it used to trail below the code in faint caption text and read as a
 * footnote. The code carries a Heritage Orange border so it reads as the thing to compare.
 */
import { useTranslation } from '@/composables/useTranslation';

defineProps<{ code: string; testid?: string }>();

const { t } = useTranslation();
</script>

<template>
  <div class="flex flex-col items-center gap-2">
    <p class="font-outfit dark:text-ink text-base font-semibold text-gray-900">
      {{ t('deviceApproval.compareHint') }}
    </p>
    <p
      class="font-outfit border-primary-500 dark:border-accent-lift dark:text-ink dark:bg-surface-overlay inline-block rounded-2xl border-2 bg-gray-50 px-4 py-2 text-xl font-extrabold tracking-[0.22em] text-gray-900"
      :data-testid="testid"
    >
      {{ code }}
    </p>
  </div>
</template>
