<script setup lang="ts">
/**
 * The recovery-kit affordance (login rethink Phase 3) — the SAME chip on every surface
 * that offers it (the prove screen's cold escape, the bootstrap decrypt panel). A quiet
 * Sky Silk pill with a life-buoy: per the CIG, Sky Silk is the calm/safety accent — an
 * emergency exit should read as reassurance, not alarm (never red, not even orange).
 */
import { useTranslation } from '@/composables/useTranslation';

defineProps<{
  disabled?: boolean;
}>();

const emit = defineEmits<{
  click: [];
}>();

const { t } = useTranslation();
</script>

<template>
  <button
    type="button"
    class="dark:text-silk-lift mx-auto flex items-center gap-2 rounded-full bg-[#AED6F1]/20 px-4 py-2 text-xs font-semibold text-[#2C3E50] transition-all hover:-translate-y-px hover:bg-[#AED6F1]/35 disabled:opacity-40 dark:bg-[#AED6F1]/10 dark:hover:bg-[#AED6F1]/20"
    :disabled="disabled"
    @click="emit('click')"
  >
    <!-- Life buoy: the universal "rescue" mark -->
    <svg
      class="dark:text-silk-lift h-4 w-4 text-[#5B8DB8]"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="10" />
      <circle cx="12" cy="12" r="4" />
      <line x1="4.93" y1="4.93" x2="9.17" y2="9.17" />
      <line x1="14.83" y1="14.83" x2="19.07" y2="19.07" />
      <line x1="14.83" y1="9.17" x2="19.07" y2="4.93" />
      <line x1="4.93" y1="19.07" x2="9.17" y2="14.83" />
    </svg>
    {{ t('recovery.useKitLink') }}
  </button>
</template>
