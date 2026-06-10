<script setup lang="ts">
// Subtle external-calendar clash indicator (#34). PURELY presentational — receives
// a resolved calendar label as a prop and renders a small Heritage-Orange dot with
// an accessible tooltip. It does NOT read the clash store (store coupling lives only
// in `useClash`). A gentle nudge, never Alert Red, never the other event's details.
import { computed } from 'vue';
import { useTranslation } from '@/composables/useTranslation';

const props = defineProps<{ calendarLabel: string }>();
const { t } = useTranslation();

const label = computed(() => `${t('calendarSync.clash.tooltipPrefix')} ${props.calendarLabel}`);
</script>

<template>
  <span
    class="bg-primary-500 inline-block h-2 w-2 flex-shrink-0 rounded-full"
    role="img"
    :aria-label="label"
    :title="label"
  />
</template>
