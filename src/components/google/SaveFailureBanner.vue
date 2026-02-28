<script setup lang="ts">
import { ref } from 'vue';
import { useTranslation } from '@/composables/useTranslation';
import { useSyncStore } from '@/stores/syncStore';
import { requestAccessToken, loadGIS } from '@/services/google/googleAuth';
import { exportToFile } from '@/services/sync/fileSync';

const props = defineProps<{
  show: boolean;
}>();

const { t } = useTranslation();
const syncStore = useSyncStore();
const isReconnecting = ref(false);
const isDownloading = ref(false);

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

async function handleDownloadBackup() {
  isDownloading.value = true;
  try {
    const password = syncStore.isEncryptionEnabled
      ? (syncStore.currentSessionPassword ?? undefined)
      : undefined;
    await exportToFile('beanies-backup', password);
  } catch {
    // Best-effort — user can retry
  } finally {
    isDownloading.value = false;
  }
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
      v-if="props.show"
      class="fixed top-0 right-0 left-0 z-[250] bg-red-600 px-4 py-3 text-white shadow-lg dark:bg-red-800"
      role="alert"
      aria-live="assertive"
    >
      <div class="mx-auto flex max-w-3xl flex-col items-start gap-2 sm:flex-row sm:items-center">
        <!-- Warning icon + text -->
        <div class="flex min-w-0 flex-1 items-start gap-2">
          <svg
            class="mt-0.5 h-5 w-5 flex-shrink-0"
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
          <div class="min-w-0">
            <p class="text-sm font-semibold">{{ t('googleDrive.saveFailureTitle') }}</p>
            <p class="text-xs text-red-100">{{ t('googleDrive.saveFailureBody') }}</p>
          </div>
        </div>

        <!-- Action buttons -->
        <div class="flex flex-shrink-0 gap-2">
          <button
            :disabled="isDownloading"
            class="rounded-lg bg-white/20 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-white/30 disabled:opacity-50"
            @click="handleDownloadBackup"
          >
            {{ isDownloading ? '...' : t('googleDrive.downloadBackup') }}
          </button>
          <button
            :disabled="isReconnecting"
            class="rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-red-700 transition-colors hover:bg-red-50 disabled:opacity-50"
            @click="handleReconnect"
          >
            {{ isReconnecting ? '...' : t('googleDrive.saveFailureReconnect') }}
          </button>
        </div>
      </div>
    </div>
  </Transition>
</template>
