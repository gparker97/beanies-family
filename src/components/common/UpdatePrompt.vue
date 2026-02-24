<script setup lang="ts">
import { useRegisterSW } from 'virtual:pwa-register/vue';
import { useTranslation } from '@/composables/useTranslation';

const { t } = useTranslation();

const { needRefresh, updateServiceWorker } = useRegisterSW({
  onRegisteredSW(_swUrl: string, registration: ServiceWorkerRegistration | undefined) {
    // Check for updates every hour
    if (registration) {
      setInterval(() => registration.update(), 60 * 60 * 1000);
    }
  },
});

function handleUpdate() {
  updateServiceWorker();
}

function handleDismiss() {
  needRefresh.value = false;
}
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
      v-if="needRefresh"
      class="fixed top-0 right-0 left-0 z-[200] flex items-center justify-center gap-3 bg-[#2C3E50] px-4 py-2.5 text-sm text-white shadow-md"
      role="alert"
    >
      <span>{{ t('pwa.updateAvailable') }}</span>
      <button
        class="rounded-md bg-[#F15D22] px-3 py-1 text-xs font-semibold transition-colors hover:bg-[#d94f1a]"
        @click="handleUpdate"
      >
        {{ t('pwa.updateButton') }}
      </button>
      <button
        class="text-xs text-gray-300 transition-colors hover:text-white"
        @click="handleDismiss"
      >
        {{ t('pwa.updateDismiss') }}
      </button>
    </div>
  </Transition>
</template>
