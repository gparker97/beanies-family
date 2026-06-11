<script setup lang="ts">
// Subtle external-calendar clash indicator (#34). PURELY presentational — receives
// a resolved `ClashInfo` (or undefined) as a prop and self-gates: it renders a small
// Heritage-Orange dot + accessible tooltip ONLY when a clash is present, otherwise
// nothing. Self-gating (vs parent `v-if`) lets every call site resolve the clash
// exactly ONCE — including the `v-for` grid surfaces, where there's no per-item local
// binding. It does NOT read the clash store (store coupling lives only in `useClash`).
// A gentle nudge, never Alert Red, never the other event's details.
import { computed } from 'vue';
import { useTranslation } from '@/composables/useTranslation';
import type { ClashInfo } from '@/utils/calendar/clashDetection';

const props = defineProps<{ clash?: ClashInfo }>();
const { t } = useTranslation();

const label = computed(() =>
  props.clash ? `${t('calendarSync.clash.tooltipPrefix')} ${props.clash.calendarLabel}` : ''
);
</script>

<template>
  <span
    v-if="clash"
    class="bg-primary-500 inline-block h-2 w-2 flex-shrink-0 rounded-full"
    role="img"
    :aria-label="label"
    :title="label"
  />
</template>
