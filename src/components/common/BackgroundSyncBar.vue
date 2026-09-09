<script setup lang="ts">
/**
 * BackgroundSyncBar — thin indeterminate progress bar for cache-first background sync.
 *
 * Shows at the very top of the viewport while fresh data is being fetched
 * from Google Drive in the background. Fires a toast on error.
 */
import { ref, watch } from 'vue';
import { useSyncStore, BANNERED_BLOCKER_KINDS } from '@/stores/syncStore';
import { isBlockerDismissed } from '@/composables/useBlockerLatch';
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

// Fire toast on background sync error — but stay quiet when the failure is
// auth-transient (token expired + silent refresh failed). The auth layer
// (`setupTokenExpiryHandler` + Google reconnect banner) owns the user-facing
// escalation in that case; a competing "beans got lost" toast on every
// failed reload would just confuse the message.
watch(
  () => syncStore.backgroundSyncError,
  (err) => {
    if (!err || syncStore.backgroundSyncErrorKind === 'auth-transient') return;

    // ⚠️ THIS COMMENT USED TO SAY THIS TOAST WAS THE ONLY PLACE ANY OF IT
    // REACHED THE USER. That is now false for `decrypt`, which has
    // `PodUnreadableBanner`, and still TRUE for `lineage` and
    // `local-unreadable`, whose banners are mounted inside the layout and so
    // render on no `noChrome` route.
    //
    // Suppress only when a banner is ACTUALLY up — never on the kind alone. The
    // `kind &&` is required rather than cosmetic: `backgroundSyncErrorKind` is
    // nullable, and two paths ("password may have changed", and a rotated key)
    // set `backgroundSyncErrorKind = 'decrypt'` WITHOUT `podUnopenable`, which
    // `notePodUnopenable` declines to latch. The banner's gate is
    // `podUnopenable && kind === 'decrypt'`, so neither of those gets one — and
    // suppressing on kind alone would take their only surface away.
    // ⚠️ AND `!isBlockerDismissed(kind)`, WITHOUT WHICH THIS COMMENT IS A LIE.
    // The banner's `dismissed` flag was component-local, so this condition could
    // not see it: one tap on Dismiss hid the banner AND kept the toast
    // suppressed, leaving a session-ending blocker with no surface at all for the
    // rest of the session. Nothing on the failed-retry path calls
    // `clearPodUnopenable`, so the latch never re-arms on its own.
    const kind = syncStore.backgroundSyncErrorKind;
    if (
      syncStore.podUnopenable &&
      kind &&
      BANNERED_BLOCKER_KINDS.has(kind) &&
      !isBlockerDismissed(kind)
    ) {
      return;
    }

    // The store resolves a SPECIFIC translated message for a pod that cannot be
    // opened at all ("this device ran out of memory…"). Showing the generic
    // "using cached data" line over it would be the same toast a flaky network
    // produces, with no hint that sync has just latched off for the session.
    showToast(
      'warning',
      syncStore.podUnopenable ? t('sync.podUnopenable') : t('sync.backgroundError'),
      syncStore.podUnopenable ? err : undefined
    );
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
