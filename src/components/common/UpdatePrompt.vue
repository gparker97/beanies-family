<script setup lang="ts">
import { ref, watch, onUnmounted } from 'vue';
import { useRouter } from 'vue-router';
import { useRegisterSW } from 'virtual:pwa-register/vue';
import { useTranslation } from '@/composables/useTranslation';
import { useSyncStore } from '@/stores/syncStore';
import { hasOpenOverlays } from '@/utils/overlayStack';
import { safeServiceWorkerUpdate } from '@/utils/safeServiceWorkerUpdate';

const { t } = useTranslation();
const router = useRouter();
const syncStore = useSyncStore();

// SW update polling interval (ms)
const POLL_INTERVAL_MS = 5 * 60_000; // 5 minutes

let swRegistration: ServiceWorkerRegistration | undefined;
let removeRouteGuard: (() => void) | null = null;
// Banner visibility is separate from needRefresh so dismissing doesn't tear
// down the route guard — the update still applies on the next quiet nav.
const bannerHidden = ref(false);

const { needRefresh, updateServiceWorker } = useRegisterSW({
  onRegisteredSW(_swUrl: string, registration: ServiceWorkerRegistration | undefined) {
    swRegistration = registration;
    if (registration) {
      setInterval(() => safeServiceWorkerUpdate(registration, 'periodic-poll'), POLL_INTERVAL_MS);
    }
  },
});

function handleVisibilityChange() {
  if (document.visibilityState === 'visible' && swRegistration) {
    safeServiceWorkerUpdate(swRegistration, 'visibility-change');
  }
}
document.addEventListener('visibilitychange', handleVisibilityChange);

watch(needRefresh, (ready) => {
  if (ready) {
    bannerHidden.value = false;
    installRouteGuard();
  } else {
    uninstallRouteGuard();
  }
});

function installRouteGuard() {
  if (removeRouteGuard) return;
  removeRouteGuard = router.beforeEach((to, _from, next) => {
    // Defer the reload while the user is mid-edit or a save is in flight —
    // the guard stays armed and will fire on the next clean navigation.
    if (hasOpenOverlays() || syncStore.isSyncing) {
      next();
      return;
    }
    // Persist the intended destination so App.vue can resume there after the
    // hard reload — otherwise the reload returns the user to the page they
    // were already on and the click appears to do nothing.
    try {
      sessionStorage.setItem('pwa-post-update-route', to.fullPath);
    } catch {
      /* sessionStorage unavailable (private mode) — degrade gracefully */
    }
    performUpdate();
    next(false);
  });
}

function uninstallRouteGuard() {
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
  performUpdate();
}

function handleDismiss() {
  // Hide the banner but keep the guard armed — the update still applies on
  // the next quiet navigation. Flipping `needRefresh` here would tear down
  // the guard via the watcher and strand the user on the stale version.
  bannerHidden.value = true;
}

onUnmounted(() => {
  document.removeEventListener('visibilitychange', handleVisibilityChange);
  uninstallRouteGuard();
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
      v-if="needRefresh && !bannerHidden"
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
