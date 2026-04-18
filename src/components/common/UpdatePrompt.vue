<script setup lang="ts">
import { ref, watch, onUnmounted } from 'vue';
import { useRouter } from 'vue-router';
import { useRegisterSW } from 'virtual:pwa-register/vue';
import { useTranslation } from '@/composables/useTranslation';

const { t } = useTranslation();
const router = useRouter();

// Grace period before auto-updating on next navigation (ms)
const AUTO_UPDATE_GRACE_MS = 60_000; // 1 minute
// SW update polling interval (ms)
const POLL_INTERVAL_MS = 5 * 60_000; // 5 minutes

let swRegistration: ServiceWorkerRegistration | undefined;
const readyToAutoUpdate = ref(false);
let graceTimer: ReturnType<typeof setTimeout> | null = null;
let removeRouteGuard: (() => void) | null = null;

const { needRefresh, updateServiceWorker } = useRegisterSW({
  onRegisteredSW(_swUrl: string, registration: ServiceWorkerRegistration | undefined) {
    swRegistration = registration;
    if (registration) {
      // Poll for updates every 5 minutes
      setInterval(() => registration.update(), POLL_INTERVAL_MS);
    }
  },
});

// Check for updates when the tab becomes visible
function handleVisibilityChange() {
  if (document.visibilityState === 'visible' && swRegistration) {
    swRegistration.update();
  }
}
document.addEventListener('visibilitychange', handleVisibilityChange);

// When an update is detected, start the grace timer → auto-update on next navigation
watch(needRefresh, (ready) => {
  if (ready) {
    startGraceTimer();
  } else {
    clearGraceTimer();
  }
});

function startGraceTimer() {
  clearGraceTimer();
  graceTimer = setTimeout(() => {
    readyToAutoUpdate.value = true;
    // Install a route guard that triggers the update on next navigation
    removeRouteGuard = router.beforeEach((to, _from, next) => {
      // Persist the user's intended destination so App.vue can resume there
      // after the hard reload — otherwise the reload returns the user to the
      // page they were already on and the click appears to do nothing.
      try {
        sessionStorage.setItem('pwa-post-update-route', to.fullPath);
      } catch {
        /* sessionStorage unavailable (private mode) — degrade gracefully */
      }
      // Trigger update — the page will reload
      performUpdate();
      // Don't call next() — the reload will handle navigation
      next(false);
    });
  }, AUTO_UPDATE_GRACE_MS);
}

function clearGraceTimer() {
  if (graceTimer) {
    clearTimeout(graceTimer);
    graceTimer = null;
  }
  readyToAutoUpdate.value = false;
  if (removeRouteGuard) {
    removeRouteGuard();
    removeRouteGuard = null;
  }
}

async function performUpdate() {
  try {
    await updateServiceWorker();
  } catch {
    // Fallback: hard reload if service worker update fails
  }
  setTimeout(() => window.location.reload(), 500);
}

function handleUpdate() {
  clearGraceTimer();
  performUpdate();
}

function handleDismiss() {
  // Dismiss the banner but keep the grace timer running —
  // the update will still apply on the next navigation after the grace period
  needRefresh.value = false;
}

onUnmounted(() => {
  document.removeEventListener('visibilitychange', handleVisibilityChange);
  clearGraceTimer();
});
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
      class="bg-secondary-500 flex items-center gap-3 rounded-lg px-4 py-3 text-sm text-white shadow-lg"
      role="alert"
    >
      <span>{{ t('pwa.updateAvailable') }}</span>
      <button
        class="bg-primary-500 hover:bg-primary-600 rounded-md px-3 py-1 text-xs font-semibold transition-colors"
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
