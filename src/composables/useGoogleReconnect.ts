import { ref } from 'vue';
import {
  requestAccessToken,
  shouldUseRedirectAuth,
  startRedirectAuth,
  awaitNativeOAuthReturn,
  isUserCancellation,
} from '@/services/google/googleAuth';
import { currentLocationPath } from '@/services/google/redirectState';
import { isNative } from '@/services/sync/capabilities';
import { tryReconnectSilently } from '@/services/google/driveTokenRecovery';
import { OAuthRoundTripAbandonedError } from '@/types/sync';
import { logEvent } from '@/services/telemetry';

/**
 * The four distinct things a reconnect attempt can end in. `recovered` and
 * `reconnected` both mean the connection is live NOW and it is safe to clear the
 * banner; `redirecting` is WEB-ONLY and means the page is on its way to Google and the caller
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
   *   'redirecting' — WEB ONLY. The page is NAVIGATING AWAY to Google and NOTHING has been
   *                   acquired yet. Not success. A caller that proceeds here
   *                   issues requests on a dead token mid-navigation.
   *                   ⚠️ NATIVE NEVER RETURNS THIS. Nothing unloads there, so this composable
   *                   awaits the round trip and resolves `reconnected` / `failed` in place —
   *                   which is what makes every caller's `reconnectSucceeded` branch run in ONE
   *                   tap. `isReconnecting` therefore spans the whole sheet on native.
   *   'failed'      — the flow failed before any navigation, or the native round trip came back
   *                   without a grant. `reconnectError` carries the reason.
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
  async function reconnect(loginHint?: string): Promise<ReconnectOutcome> {
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
    /**
     * ⚠️ SEPARATES A DECISION FROM A FAULT, and it exists because native made "close the sheet"
     * a COMMON outcome rather than an unreachable one. Without it every abort landed in the
     * `warn` / `reconnect-failed` bucket — the same event stream this composable's docblock
     * above calls "the reconnect SUCCESS RATE, the number this whole work is judged on". A
     * denominator that counts people changing their mind as failures measures nothing.
     */
    let abandoned = false;
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
        // The current path is the right return for BOTH transports: on web the reload of this
        // same page IS the resume; on native nothing unloads, so the sink's `router.replace`
        // resolves as a duplicate and this stack carries on below.
        await startRedirectAuth(currentLocationPath(), loginHint, 'reconnect');
        if (!isNative()) {
          // WEB: the page is navigating away and NOTHING has been acquired yet. This is not
          // success: a caller that treats it as such will clear the reconnect banner and start
          // issuing requests on a dead token mid-navigation.
          outcome = 'redirecting';
          return outcome;
        }
        // NATIVE: nothing unloaded — this stack is still here, so wait for the trip and report
        // what it did. This is what makes every caller's `reconnectSucceeded` branch run in ONE
        // tap; it used to need a per-surface marker + latch + watcher, of which exactly one
        // existed.
        const trip = await awaitNativeOAuthReturn();
        if (trip.kind === 'failed') throw trip.error; // classified below, like a popup failure
        outcome = 'reconnected';
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
      // ⚠️ BOTH TRANSPORTS. The native round trip rejects with `OAuthRoundTripAbandonedError`;
      // the desktop popup rejects with a plain `Error('Authentication cancelled')` when the
      // window is closed. They are the same event — the person aborted — and classifying only
      // the first left the far more common desktop path painting raw English and counting a
      // decision as a failure. `isUserCancellation` is the project's one predicate for this.
      if (e instanceof OAuthRoundTripAbandonedError || isUserCancellation(e)) {
        // ⚠️ `reconnectError` LEFT NULL ON PURPOSE. It is rendered VERBATIM by four call sites,
        // and these messages are untranslated English. Every one of those sites already falls
        // back to `t('googleDrive.reconnectFailed')` when it is empty, so leaving it null is
        // what keeps a Chinese UI in Chinese. (Writing a KEY here would be worse still: a key
        // is truthy, so it would defeat the `||` fallback and paint the key itself.)
        abandoned = true;
        console.warn('[useGoogleReconnect] reconnect abandoned by the user:', message);
      } else {
        console.warn('[useGoogleReconnect] reconnect failed:', message);
        reconnectError.value = message || 'Reconnect failed';
      }
      outcome = 'failed';
      return outcome;
    } finally {
      isReconnecting.value = false;
      logEvent({
        // `warn` only for an outright failure. A redirect is the normal native
        // path, not a problem — but it MUST be counted, or "the button does
        // nothing" reports have nothing behind them. An ABANDONED trip is a decision, so it is
        // `info` and carries its own action: aborts must be separable from faults in the rate.
        level: outcome === 'failed' && !abandoned ? 'warn' : 'info',
        surface: 'google-reconnect',
        message: `google reconnect ${abandoned ? 'abandoned' : outcome}`,
        context: {
          action: abandoned ? 'reconnect-abandoned' : `reconnect-${outcome}`,
          ...(reconnectError.value ? { detail: reconnectError.value } : {}),
        },
      });
    }
  }

  return { isReconnecting, reconnectError, reconnect };
}
