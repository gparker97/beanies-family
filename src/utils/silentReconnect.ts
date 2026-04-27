import { attemptSilentRefresh } from '@/services/google/googleAuth';
import { useSyncStore } from '@/stores/syncStore';
import { showToast } from '@/composables/useToast';
import { useTranslation } from '@/composables/useTranslation';

/**
 * Attempt a silent Google token refresh. If a refresh succeeds AND the user
 * had a visible reconnect/save-failure surface up, clear that surface and
 * show a "reconnected" toast.
 *
 * Lives in `utils/` rather than `services/google/` because it bridges the
 * pure auth service with Pinia state + the UI toast layer — services don't
 * import stores or composables, but utilities are allowed to.
 *
 * Module-scoped guard prevents concurrent reconnect attempts (would race on
 * the `hadVisibleError` snapshot and could double-toast).
 *
 * Errors are caught and logged with the `[silentReconnect]` prefix — never
 * silently swallowed. The "silent" in the name refers to the OAuth flow
 * (no popup), not the error handling.
 */

let isReconnecting = false;

export async function attemptSilentReconnect(): Promise<void> {
  const syncStore = useSyncStore();
  if (isReconnecting || !syncStore.isGoogleDriveConnected) return;
  isReconnecting = true;
  try {
    const refreshed = await attemptSilentRefresh();
    if (!refreshed) return;
    const hadVisibleError = syncStore.showGoogleReconnect || syncStore.saveFailureLevel !== 'none';
    if (!hadVisibleError) return;
    await syncStore.handleGoogleReconnected();
    const { t } = useTranslation();
    showToast('success', t('googleDrive.reconnected'));
  } catch (e) {
    console.warn('[silentReconnect] silent reconnect failed', e);
  } finally {
    isReconnecting = false;
  }
}
