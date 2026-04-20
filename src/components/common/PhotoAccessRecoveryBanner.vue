<script setup lang="ts">
/**
 * Warning banner that fires when photoStore has any unresolved photos
 * (typically the `drive.file`-scope-mismatch case documented in
 * ADR-021: joined members picked the `.beanpod` file, not the folder,
 * so sibling photos 404 under their OAuth token).
 *
 * Reconnect → opens the folder Picker, validates, clears unresolved.
 * Dismiss  → session-scoped (`sessionStorage`) so the banner reappears
 *            next session if the underlying condition persists. We
 *            deliberately don't use `noticeFlag` / localStorage here —
 *            `noticeFlag`'s "forever until cleared" semantics would
 *            permanently hide the banner for users who dismiss once
 *            without reconnecting, stranding them on broken photos.
 */
import { computed, ref } from 'vue';
import ErrorBanner from '@/components/common/ErrorBanner.vue';
import { usePhotoStore } from '@/stores/photoStore';
import { useTranslation } from '@/composables/useTranslation';
import { useRecoverPhotoAccess } from '@/composables/useRecoverPhotoAccess';

const DISMISS_KEY = 'beanies:photoRecoveryBanner:dismissed';

const photoStore = usePhotoStore();
const { t } = useTranslation();
const { isReconnecting, reconnect } = useRecoverPhotoAccess();

function readDismissed(): boolean {
  try {
    return sessionStorage.getItem(DISMISS_KEY) === '1';
  } catch {
    // sessionStorage unavailable (private mode, sandboxed frame, etc.).
    // Safe fallback: treat as not dismissed so the user still sees the
    // banner — worse UX than a one-time nag, but never worse than
    // silently hiding a broken-photos indicator.
    return false;
  }
}

const dismissed = ref(readDismissed());
const show = computed(() => photoStore.hasBrokenPhotos && !dismissed.value);

function handleDismiss(): void {
  try {
    sessionStorage.setItem(DISMISS_KEY, '1');
  } catch (e) {
    console.warn('[PhotoAccessRecoveryBanner] could not persist dismissal', e);
  }
  dismissed.value = true;
}

async function handleReconnect(): Promise<void> {
  const ok = await reconnect();
  // Success → `clearUnresolved` in the composable flips `hasBrokenPhotos`
  // to false and the banner disappears via the computed. Also clear
  // any stale dismissal so future 404s aren't suppressed.
  if (ok) {
    try {
      sessionStorage.removeItem(DISMISS_KEY);
    } catch {
      /* ignore — dismissed.value reset below is enough for this session */
    }
    dismissed.value = false;
  }
  // Failure → the composable surfaced a specific toast; banner stays
  // visible so the user can retry or dismiss.
}
</script>

<template>
  <ErrorBanner :show="show" severity="warning">
    <template #title>{{ t('recoverPhotos.bannerTitle') }}</template>
    <template #message>{{ t('recoverPhotos.bannerBody') }}</template>
    <template #actions>
      <button
        class="rounded-lg bg-white/20 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-white/30 disabled:opacity-50"
        @click="handleDismiss"
      >
        {{ t('recoverPhotos.dismiss') }}
      </button>
      <button
        :disabled="isReconnecting"
        class="rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-amber-700 transition-colors hover:bg-amber-50 disabled:opacity-50"
        @click="handleReconnect"
      >
        {{ isReconnecting ? '…' : t('recoverPhotos.reconnect') }}
      </button>
    </template>
  </ErrorBanner>
</template>
