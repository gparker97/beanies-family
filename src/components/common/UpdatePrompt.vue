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

async function handleUpdate() {
  try {
    await updateServiceWorker();
  } catch {
    // Fallback: hard reload if service worker update fails (e.g. desktop browser)
  }
  // If still on the page after a short delay, force a hard reload
  setTimeout(() => window.location.reload(), 500);
}

function handleDismiss() {
  needRefresh.value = false;
}
</script>

<template>
  <Transition
    enter-active-class="transition-all duration-300 ease-out"
    enter-from-class="translate-y-4 opacity-0"
    enter-to-class="translate-y-0 opacity-100"
    leave-active-class="transition-all duration-200 ease-in"
    leave-from-class="translate-y-0 opacity-100"
    leave-to-class="translate-y-4 opacity-0"
  >
    <div
      v-if="needRefresh"
      class="flex items-center gap-3 rounded-lg bg-[#2C3E50] px-4 py-3 text-sm text-white shadow-lg"
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
