<script setup lang="ts">
// External-calendar clash indicator (#34). PURELY presentational — receives a
// resolved clash (or undefined) as a prop and self-gates: renders nothing when
// there's no clash. Self-gating (vs a parent `v-if`) lets every call site — including
// the `v-for` grid surfaces — resolve the clash exactly ONCE. It does NOT read any
// store (coupling lives only in `useClash`).
//
// Two states, one mark (the active dismiss lives in the activity drawer, not here):
//   • active  — unacknowledged: prominent. `variant="chip"` (week/day/agenda) shows
//               a labelled pill naming the calendar; `variant="mark"` (month, tight)
//               shows the solid mark (the chip's orange ring is applied by the host).
//   • quiet   — acknowledged: a small faded mark, on every surface.
// Heritage Orange throughout, never Alert Red — a clash is information, not a failure.
import { computed } from 'vue';
import { useTranslation } from '@/composables/useTranslation';
import OverlapMark from './OverlapMark.vue';
import type { ResolvedClash } from '@/composables/useClash';

const props = withDefaults(defineProps<{ clash?: ResolvedClash; variant?: 'mark' | 'chip' }>(), {
  variant: 'mark',
});
const { t } = useTranslation();

const state = computed<'quiet' | 'active-mark' | 'active-chip'>(() => {
  if (!props.clash || props.clash.acknowledged) return 'quiet';
  return props.variant === 'chip' ? 'active-chip' : 'active-mark';
});

/** Mark height by surface — standard Tailwind sizes (no arbitrary px). */
const markSize = computed(() => (props.variant === 'chip' ? 'h-3.5' : 'h-3'));

const tooltip = computed(() =>
  props.clash ? `${t('calendarSync.clash.tooltipPrefix')} ${props.clash.calendarLabel}` : ''
);
</script>

<template>
  <span
    v-if="clash"
    class="inline-flex flex-shrink-0 items-center"
    role="img"
    :aria-label="tooltip"
    :title="tooltip"
  >
    <span
      v-if="state === 'active-chip'"
      class="bg-primary-500/15 text-primary-600 dark:text-primary-400 font-outfit inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-xs font-semibold"
    >
      <OverlapMark :class="[markSize, 'text-primary-500 w-auto']" />
      <span class="max-w-24 truncate">{{ clash.calendarLabel }}</span>
    </span>
    <OverlapMark
      v-else
      :class="[markSize, 'text-primary-500 w-auto', { 'opacity-70': state === 'quiet' }]"
    />
  </span>
</template>
