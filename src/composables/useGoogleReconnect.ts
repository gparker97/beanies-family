import { ref } from 'vue';
import {
  requestAccessToken,
  shouldUseRedirectAuth,
  startRedirectAuth,
  invalidateAccessToken,
} from '@/services/google/googleAuth';
import { tryReconnectSilently } from '@/services/google/driveTokenRecovery';

/**
 * The four distinct things a reconnect attempt can end in. `recovered` and
 * `reconnected` both mean the connection is live NOW and it is safe to clear the
 * banner; `redirecting` means the page is on its way to Google and the caller
 * must do nothing at all; `failed` means say so.
 */
export type ReconnectOutcome = 'recovered' | 'reconnected' | 'redirecting' | 'failed';

/** True when the connection is live right now. The only safe "did it work?" test. */
export function reconnectSucceeded(outcome: ReconnectOutcome): boolean {
  return outcome === 'recovered' || outcome === 'reconnected';
}

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
  /**
   * What actually happened, because a boolean could not say.
   *
   * ⚠️ `true` USED TO MEAN THREE DIFFERENT THINGS: the silent path recovered, an
   * interactive consent completed, or the page is NAVIGATING AWAY to Google and
   * nothing has happened yet. Callers read the third as success and tore down the
   * reconnect banner, then issued Drive reads and a full pod upload on the
   * still-dead token while the user was looking at the consent screen. Two
   * separate call sites got this wrong, one of them twice, so the fix belongs in
   * the return type rather than in a comment at each caller.
   */
  async function reconnect(loginHint?: string): Promise<ReconnectOutcome> {
    isReconnecting.value = true;
    reconnectError.value = null;
    try {
      // B: try a silent recovery using the refresh token mirrored into the
      // beanpod (account-matched to loginHint) BEFORE any consent screen. On
      // success the connection is restored with no user interaction; on false
      // we fall through to the unchanged forced-consent flow below.
      // ⚠️ INVALIDATE FIRST, or a "reconnect" can reconnect nothing. When the
      // grant was revoked on ANOTHER device the local access token has not passed
      // its own expiry, so `tryReconnectSilently` returns true at its first line
      // (`if (isTokenValid()) return true`) without contacting Google at all.
      // The caller then reports success and the next request 401s identically:
      // an infinite human loop with a success message on top. Dropping the cached
      // ACCESS token forces a real acquisition; the refresh token is untouched,
      // so the silent path still gets its chance before any consent screen.
      invalidateAccessToken();

      if (await tryReconnectSilently(loginHint)) {
        return 'recovered';
      }
      // Standalone PWAs and iOS Safari can't bridge popup→postMessage back
      // to the app window, so the popup-based auth flow hangs silently.
      // Use full-page redirect auth instead — the page navigates to Google,
      // returns to the same path, and App.vue's onMounted consumes the
      // pending OAuth code via completeRedirectAuth().
      if (shouldUseRedirectAuth()) {
        const returnPath = `${window.location.pathname}${window.location.search}`;
        await startRedirectAuth(returnPath, loginHint, 'reconnect');
        // Page is navigating away and NOTHING has been acquired yet. This is not
        // success: a caller that treats it as such will clear the reconnect
        // banner and start issuing requests on a dead token mid-navigation.
        return 'redirecting';
      }
      // Force consent so Google re-issues a refresh_token. A stale stored token
      // would make `!hasRefreshToken()` false → prompt=select_account → an
      // access-token-only grant with no refresh token (the reconnect-every-launch
      // bug). Reconnect is interactive + rare, so the extra consent screen is fine.
      await requestAccessToken({ forceConsent: true, loginHint });
      return 'reconnected';
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      console.warn('[useGoogleReconnect] reconnect failed:', message);
      reconnectError.value = message || 'Reconnect failed';
      return 'failed';
    } finally {
      isReconnecting.value = false;
    }
  }

  return { isReconnecting, reconnectError, reconnect };
}
