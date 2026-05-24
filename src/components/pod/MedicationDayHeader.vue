<script setup lang="ts">
/**
 * Presentational day-header for the grouped medication dose log.
 *
 * Pure props in, markup out — no store, no clock, no async. Owns the
 * over-limit visual (the Heritage-Orange count pill + the over-note) so
 * that treatment lives in exactly one place. The day `label` is passed in
 * already-resolved (the parent computes it via `relativeDayLabel`, which
 * needs the grouping date key); over/within is decided upstream by the
 * shared `getDailyDoseStatus`, so this component never re-derives the rule.
 */
import { computed } from 'vue';
import { useTranslation } from '@/composables/useTranslation';
import type { DailyDoseStatus } from '@/utils/doseLimit';

const props = defineProps<{
  label: string;
  count: number;
  status: DailyDoseStatus;
}>();

const { t } = useTranslation();

const countLabel = computed(
  () => `${props.count} ${t(props.count === 1 ? 'medicationLog.dose' : 'medicationLog.doses')}`
);

const overNote = computed(() =>
  t('medicationLog.overNote')
    .replace('{over}', String(props.status.over))
    .replace('{limit}', String(props.status.limit))
);
</script>

<template>
  <div>
    <div class="flex items-center gap-2">
      <p
        class="font-outfit text-xs font-semibold tracking-wide text-[#2C3E50]/55 uppercase dark:text-gray-400"
      >
        {{ label }}
      </p>
      <span class="h-px flex-1 bg-[var(--tint-slate-8)] dark:bg-slate-700" aria-hidden="true" />
      <span
        class="font-outfit inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-bold"
        :class="
          status.isOver
            ? 'bg-[var(--tint-orange-15)] text-[#F15D22]'
            : 'bg-[var(--tint-slate-8)] text-[#2C3E50]/70 dark:bg-slate-700 dark:text-gray-300'
        "
      >
        <span v-if="status.isOver" aria-hidden="true">⚠</span>
        {{ countLabel }}
      </span>
    </div>
    <div
      v-if="status.isOver"
      class="font-inter mt-1.5 flex items-center gap-1.5 rounded-xl bg-[var(--tint-orange-8)] px-3 py-1.5 text-xs font-medium text-[#F15D22]"
    >
      <span aria-hidden="true">⚠️</span>
      <span>{{ overNote }}</span>
    </div>
  </div>
</template>
