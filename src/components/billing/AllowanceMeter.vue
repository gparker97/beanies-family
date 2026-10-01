<script setup lang="ts">
/**
 * The magic-beans allowance as a meter plus its sentence (#95): "7 of 10 magic beans left today,
 * more at 8am" over a track that fills as beans are used, the same track the trial meter uses; it fills with what is LEFT, so it shrinks as beans are used.
 * One component for the Settings card and the Plan page. Renders nothing when the line does not
 * apply (BYOK, beta, read-only) and only the sentence when usage could not be read.
 */
import { useTranslation } from '@/composables/useTranslation';
import { useAllowanceLine } from '@/composables/useAllowanceLine';

const { t } = useTranslation();
const { line, pct } = useAllowanceLine();
</script>

<template>
  <div v-if="line" data-testid="allowance-meter" class="mt-3">
    <div
      v-if="pct !== null"
      role="progressbar"
      :aria-label="t('plan.allowance.meterLabel')"
      :aria-valuenow="pct"
      aria-valuemin="0"
      aria-valuemax="100"
      class="dark:bg-surface-overlay h-2 overflow-hidden rounded-full bg-[var(--tint-slate-5)]"
    >
      <!-- Decorative fill: the orange to terracotta gradient reads the same on dark. -->
      <span
        class="block h-full rounded-full bg-gradient-to-r from-[#F15D22] to-[#E67E22] transition-all"
        :style="{ width: `${pct}%` }"
      />
    </div>
    <p class="text-secondary-400 dark:text-ink-soft mt-2 text-sm leading-relaxed">{{ line }}</p>
  </div>
</template>
