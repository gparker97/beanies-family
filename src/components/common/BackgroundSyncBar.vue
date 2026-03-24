<script setup lang="ts">
/**
 * BackgroundSyncBar — thin indeterminate progress bar for cache-first background sync.
 *
 * Shows at the very top of the viewport while fresh data is being fetched
 * from Google Drive in the background. Fires a toast on error.
 */
import { ref, watch } from 'vue';
import { useSyncStore } from '@/stores/syncStore';
import { showToast } from '@/composables/useToast';
import { useTranslation } from '@/composables/useTranslation';

const syncStore = useSyncStore();
const { t } = useTranslation();

// Track completion state for the fill-then-fade animation
const isCompleting = ref(false);

// When background sync finishes successfully, briefly show "complete" then hide
watch(
  () => syncStore.isBackgroundSyncing,
  (syncing, wasSyncing) => {
    if (wasSyncing && !syncing && !syncStore.backgroundSyncError) {
      isCompleting.value = true;
      setTimeout(() => {
        isCompleting.value = false;
      }, 600);
    }
  }
);

// Fire toast on background sync error
watch(
  () => syncStore.backgroundSyncError,
  (err) => {
    if (err) {
      showToast('warning', t('sync.backgroundError'));
    }
  }
);

const visible = ref(false);
watch(
  [() => syncStore.isBackgroundSyncing, isCompleting],
  ([syncing, completing]) => {
    visible.value = syncing || completing;
  },
  { immediate: true }
);
</script>

<template>
  <Transition
    enter-active-class="transition-opacity duration-200"
    enter-from-class="opacity-0"
    enter-to-class="opacity-100"
    leave-active-class="transition-opacity duration-400"
    leave-from-class="opacity-100"
    leave-to-class="opacity-0"
  >
    <div v-if="visible" class="fixed top-0 right-0 left-0 z-[200] h-[3px] overflow-hidden">
      <div class="h-full" :class="isCompleting ? 'sync-bar-complete' : 'sync-bar-indeterminate'" />
    </div>
  </Transition>
</template>

<style scoped>
.sync-bar-indeterminate {
  animation: sync-indeterminate 2s ease-in-out infinite;
  background: #f15d22;
  transform-origin: left;
}

.sync-bar-complete {
  background: #f15d22;
  transition: width 0.3s ease-out;
  width: 100%;
}

@keyframes sync-indeterminate {
  0% {
    transform: translateX(-100%) scaleX(0.3);
  }

  50% {
    transform: translateX(30%) scaleX(0.6);
  }

  100% {
    transform: translateX(100%) scaleX(0.3);
  }
}
</style>
