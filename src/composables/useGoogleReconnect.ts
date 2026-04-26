import { ref } from 'vue';
import {
  requestAccessToken,
  hasRefreshToken,
  shouldUseRedirectAuth,
  startRedirectAuth,
} from '@/services/google/googleAuth';

export function useGoogleReconnect() {
  const isReconnecting = ref(false);
  const reconnectError = ref<string | null>(null);

  /**
   * Trigger an interactive Google OAuth flow to refresh the user's access
   * token. Returns true on success, false if the flow failed before any
   * navigation happened. **Returns never** when the page is about to
   * navigate away (redirect-auth path) — callers should handle that as
   * "in flight" rather than waiting on the promise.
   *
   * @param loginHint Optional email to pre-fill Google's account chooser.
   *   Pass the user's expected Google account so they're nudged toward
   *   the correct one when multiple accounts are signed in.
   */
  async function reconnect(loginHint?: string): Promise<boolean> {
    isReconnecting.value = true;
    reconnectError.value = null;
    try {
      // Standalone PWAs and iOS Safari can't bridge popup→postMessage back
      // to the app window, so the popup-based auth flow hangs silently.
      // Use full-page redirect auth instead — the page navigates to Google,
      // returns to the same path, and App.vue's onMounted consumes the
      // pending OAuth code via completeRedirectAuth().
      if (shouldUseRedirectAuth()) {
        const returnPath = `${window.location.pathname}${window.location.search}`;
        await startRedirectAuth(returnPath, loginHint);
        // Page is navigating away. The promise will not resolve in any
        // useful way. Return true so callers don't think they failed.
        return true;
      }
      await requestAccessToken({ forceConsent: !hasRefreshToken(), loginHint });
      return true;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      console.warn('[useGoogleReconnect] reconnect failed:', message);
      reconnectError.value = message || 'Reconnect failed';
      return false;
    } finally {
      isReconnecting.value = false;
    }
  }

  return { isReconnecting, reconnectError, reconnect };
}
