<script setup lang="ts">
import { useOnline } from '@/composables/useOnline';
import { useTranslation } from '@/composables/useTranslation';

const { isOnline } = useOnline();
const { t } = useTranslation();
</script>

<template>
  <Transition
    enter-active-class="transition-all duration-300 ease-out"
    enter-from-class="-translate-y-full opacity-0"
    enter-to-class="translate-y-0 opacity-100"
    leave-active-class="transition-all duration-200 ease-in"
    leave-from-class="translate-y-0 opacity-100"
    leave-to-class="-translate-y-full opacity-0"
  >
    <div
      v-if="!isOnline"
      class="fixed top-0 right-0 left-0 z-[200] flex items-center justify-center bg-[#F15D22] px-4 py-2 text-sm font-medium text-white shadow-md"
      role="status"
      aria-live="polite"
    >
      <span class="mr-2">&#x26A0;</span>
      {{ t('pwa.offlineBanner') }}
    </div>
  </Transition>
</template>
