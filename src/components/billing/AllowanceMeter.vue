<script setup lang="ts">
/**
 * The magic-beans allowance as a meter plus its sentence (#95): "7 of N magic beans left today,
 * more at 8am" over a track that fills as beans are used, the same track the trial meter uses; it fills with what is LEFT, so it shrinks as beans are used.
 * One component for the Settings card and the Plan page. Renders nothing when the line does not
 * apply (BYOK, beta, read-only) and only the sentence when usage could not be read.
 *
 * `compact` is the FAB composer's variant (#119): the short `brief` line, right-aligned, over a
 * thinner bar, and nothing at all when usage could not be read.
 */
import { useTranslation } from '@/composables/useTranslation';
import { useAllowanceLine } from '@/composables/useAllowanceLine';

const { t } = useTranslation();
defineProps<{ compact?: boolean }>();

const { line, pct, brief } = useAllowanceLine();
</script>

<template>
  <div
    v-if="compact ? brief : line"
    data-testid="allowance-meter"
    :class="compact ? undefined : 'mt-3'"
  >
    <p
      v-if="compact"
      class="text-secondary-400 dark:text-ink-soft mb-1 text-right text-xs leading-snug"
    >
      {{ brief }}
    </p>
    <div
      v-if="pct !== null"
      role="progressbar"
      :aria-label="t('plan.allowance.meterLabel')"
      :aria-valuenow="pct"
      aria-valuemin="0"
      aria-valuemax="100"
      class="dark:bg-surface-overlay overflow-hidden rounded-full bg-[var(--tint-slate-5)]"
      :class="compact ? 'h-1' : 'h-2'"
    >
      <!-- Decorative fill: the orange to terracotta gradient reads the same on dark. -->
      <span
        class="block h-full rounded-full bg-gradient-to-r from-[#F15D22] to-[#E67E22] transition-all"
        :style="{ width: `${pct}%` }"
      />
    </div>
    <p v-if="!compact" class="text-secondary-400 dark:text-ink-soft mt-2 text-sm leading-relaxed">
      {{ line }}
    </p>
  </div>
</template>
