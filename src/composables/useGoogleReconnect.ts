import { ref } from 'vue';
import {
  requestAccessToken,
  shouldUseRedirectAuth,
  startRedirectAuth,
} from '@/services/google/googleAuth';
import { tryReconnectSilently } from '@/services/google/driveTokenRecovery';
import { logEvent } from '@/services/telemetry';

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
   * Trigger a Google reconnect and report WHAT ACTUALLY HAPPENED.
   *
   * ⚠️ NEVER TEST THE RESULT FOR TRUTHINESS. Every arm is a non-empty string, so
   * `if (!outcome)` is dead code that always takes the success path — and that
   * is not hypothetical: this function used to return a boolean, the widening
   * was applied to four of its six call sites, and the three that kept
   * `if (!ok)` went on to show a green "Reconnected" toast on a failed
   * reconnect. Use `reconnectSucceeded(outcome)`, or compare against a specific
   * arm. TypeScript cannot catch the bare test (there is no type-aware linting
   * here), so each call site carries a test instead.
   *
   *   'recovered'   — the silent path restored it; no user interaction at all.
   *   'reconnected' — an interactive consent completed. Connection is live.
   *   'redirecting' — the page is NAVIGATING AWAY to Google and NOTHING has been
   *                   acquired yet. Not success. A caller that proceeds here
   *                   issues requests on a dead token mid-navigation. On native
   *                   the WebView does not unload, so "the page is leaving"
   *                   cannot be relied on to stop the caller: it must return.
   *   'failed'      — the flow failed before any navigation. `reconnectError`
   *                   carries the reason.
   *
   * ⚠️ DO NOT re-derive "are we redirecting" from `shouldUseRedirectAuth()` at a
   * call site. The silent path can recover BEFORE the redirect branch is ever
   * reached, so the predicate and the outcome disagree exactly when it matters.
   * The outcome is the authority.
   *
   * @param loginHint Optional email to pre-fill Google's account chooser.
   *   Pass the user's expected Google account so they're nudged toward
   *   the correct one when multiple accounts are signed in.
   */
  async function reconnect(
    loginHint?: string,
    opts?: {
      /**
       * Where the OAuth redirect should land. Pass a path that DIFFERS from the current one
       * whenever the caller's UI has to re-evaluate on return: on Capacitor the WebView is
       * not unloaded, so returning to the same path is a no-op navigation and nothing
       * remounts. Omitted, it falls back to the current path (correct for web, where the
       * return is a full page load, and for callers with nothing to re-evaluate).
       */
      returnPath?: string;
      /**
       * Refuse to start a NEW redirect; report `'failed'` instead.
       *
       * ⚠️ FOR RESUME CALLERS ONLY. A caller re-entering on the return from consent has no
       * user gesture behind it, so redirecting again on a still-invalid token is a loop the
       * person cannot break out of except by editing the URL.
       */
      noRedirect?: boolean;
    }
  ): Promise<ReconnectOutcome> {
    isReconnecting.value = true;
    reconnectError.value = null;
    // ⚠️ EMITTED HERE, IN THE OWNING LAYER, NOT AT THE CALL SITES. Six surfaces
    // raise a reconnect (Settings, the login open-recovery, the pod-access
    // banner, the app-wide unified prompt, and two Drive-restore paths) and
    // between them they emitted almost nothing: the redirect arms were silent on
    // all six, so a native user who dismissed the consent tab left no trace at
    // all, and the success arms were counted on only two — which means the
    // reconnect SUCCESS RATE, the number this whole work is judged on, was not
    // measurable. Adding a `logEvent` to each caller would be six copies of one
    // fact and would drift the first time a seventh surface appeared.
    //
    // Callers that need to say something extra about their own context still do
    // (the Drive restore carries `pod-load-failure`); this is the denominator.
    let outcome: ReconnectOutcome = 'failed';
    try {
      // B: try a silent recovery using the refresh token mirrored into the
      // beanpod (account-matched to loginHint) BEFORE any consent screen. On
      // success the connection is restored with no user interaction; on false
      // we fall through to the unchanged forced-consent flow below.
      // ⚠️ NO SPECULATIVE `invalidateAccessToken()` HERE, AND THAT IS DELIBERATE.
      //
      // The bug it was added for is real: a grant revoked on ANOTHER device left
      // `isTokenValid()` — a local clock check that never contacts Google —
      // answering true, so `tryReconnectSilently` returned at its first line
      // without acquiring anything and the user was told "Reconnected" on a dead
      // grant. But invalidating HERE fixed one button and broke others. This
      // button also renders for ANY `syncStore.error`, not only auth ones, so
      // pressing it on (say) a "file has newer data" error destroyed a perfectly
      // good access token; and forcing the silent ladder to run on every press
      // drives `consecutiveSilentRefreshFailures` toward its threshold of 2,
      // raising the permanent-failure banner BEFORE the consent screen that would
      // have fixed it even opens.
      //
      // The cure belongs where the 401 is observed, not where a human clicks:
      // `driveService.driveRequest` now invalidates when Google actually refuses.
      // That covers every consumer of `isTokenValid()`, not just this one, and it
      // never touches a token Google still accepts.
      //
      // ⚠️ AND AN ATTEMPT TO ALSO SKIP THE CLOCK CHECK HERE WAS WITHDRAWN. Not
      // every reconnect prompt follows an observed 401 — an account mismatch
      // raises one from a 404 — so a flag was added asking the silent path not to
      // trust `isTokenValid()`. That reinstated, verbatim, the harm the paragraph
      // above records: pressed on a non-auth error it forced the full ladder,
      // which on an `invalid_grant` DELETES the stored refresh token and raises
      // the permanent-failure surface on a connection that was live.
      //
      // The rule stands: invalidate where the badness is OBSERVED. So the account
      // mismatch does it at the point it detects the mismatch, in
      // `googleDriveProvider`, next to the 404 that proves it.
      if (await tryReconnectSilently(loginHint)) {
        outcome = 'recovered';
        return outcome;
      }
      // Standalone PWAs and iOS Safari can't bridge popup→postMessage back
      // to the app window, so the popup-based auth flow hangs silently.
      // Use full-page redirect auth instead — the page navigates to Google,
      // returns to the same path, and App.vue's onMounted consumes the
      // pending OAuth code via completeRedirectAuth().
      if (shouldUseRedirectAuth()) {
        if (opts?.noRedirect) {
          // ⚠️ LEFT NULL ON PURPOSE. `reconnectError` is rendered VERBATIM by four call
          // sites, and every one of them already falls back to `t('googleDrive.reconnectFailed')`
          // when it is empty. Writing the key here would put the literal string
          // "googleDrive.reconnectFailed" on the screen — and defeat the `||` fallback,
          // because a key is truthy.
          logEvent({
            level: 'warn',
            surface: 'login-flow',
            message: 'reconnect resume found the token still invalid',
            context: { action: 'reconnect_resume_invalid' },
          });
          return 'failed';
        }
        // ⚠️ `opts.returnPath` FIRST, and a caller that cares MUST pass one. The fallback
        // below is the current path, which on Capacitor makes the return a
        // `router.replace(samePath)` — a redundant navigation that does not remount anything,
        // so whatever raised this button is still raising it and the person taps twice. See
        // `RECONNECT_LOAD_PATH`.
        const returnPath =
          opts?.returnPath ?? `${window.location.pathname}${window.location.search}`;
        await startRedirectAuth(returnPath, loginHint, 'reconnect');
        // Page is navigating away and NOTHING has been acquired yet. This is not
        // success: a caller that treats it as such will clear the reconnect
        // banner and start issuing requests on a dead token mid-navigation.
        outcome = 'redirecting';
        return outcome;
      }
      // Force consent so Google re-issues a refresh_token. A stale stored token
      // would make `!hasRefreshToken()` false → prompt=select_account → an
      // access-token-only grant with no refresh token (the reconnect-every-launch
      // bug). Reconnect is interactive + rare, so the extra consent screen is fine.
      await requestAccessToken({ forceConsent: true, loginHint });
      outcome = 'reconnected';
      return outcome;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      console.warn('[useGoogleReconnect] reconnect failed:', message);
      reconnectError.value = message || 'Reconnect failed';
      outcome = 'failed';
      return outcome;
    } finally {
      isReconnecting.value = false;
      logEvent({
        // `warn` only for an outright failure. A redirect is the normal native
        // path, not a problem — but it MUST be counted, or "the button does
        // nothing" reports have nothing behind them.
        level: outcome === 'failed' ? 'warn' : 'info',
        surface: 'google-reconnect',
        message: `google reconnect ${outcome}`,
        context: {
          action: `reconnect-${outcome}`,
          ...(reconnectError.value ? { detail: reconnectError.value } : {}),
        },
      });
    }
  }

  return { isReconnecting, reconnectError, reconnect };
}
