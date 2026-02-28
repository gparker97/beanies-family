<script setup lang="ts">
import { ref } from 'vue';
import { useTranslation } from '@/composables/useTranslation';
import { requestAccessToken, loadGIS } from '@/services/google/googleAuth';

const { t } = useTranslation();
const isReconnecting = ref(false);

const emit = defineEmits<{
  reconnected: [];
}>();

async function handleReconnect() {
  isReconnecting.value = true;
  try {
    await loadGIS();
    await requestAccessToken();
    emit('reconnected');
  } catch {
    // Will retry on next click
  } finally {
    isReconnecting.value = false;
  }
}
</script>

<template>
  <div
    class="flex items-center gap-3 rounded-2xl bg-amber-50 px-4 py-3 shadow-lg ring-1 ring-amber-200 dark:bg-amber-900/80 dark:ring-amber-700"
  >
    <svg
      class="h-5 w-5 flex-shrink-0 text-amber-600 dark:text-amber-400"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path
        stroke-linecap="round"
        stroke-linejoin="round"
        stroke-width="2"
        d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.072 16.5c-.77.833.192 2.5 1.732 2.5z"
      />
    </svg>
    <p class="text-sm text-amber-800 dark:text-amber-200">
      {{ t('googleDrive.sessionExpired') }}
    </p>
    <button
      :disabled="isReconnecting"
      class="rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-amber-700 disabled:opacity-50"
      @click="handleReconnect"
    >
      {{ isReconnecting ? '...' : t('googleDrive.reconnect') }}
    </button>
  </div>
</template>
