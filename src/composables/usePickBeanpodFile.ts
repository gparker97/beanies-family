import { ref } from 'vue';
import {
  requestAccessToken,
  shouldUseRedirectAuth,
  startRedirectAuth,
  tryGetSilentToken,
  isPopupBlocked,
  isUserCancellation,
} from '@/services/google/googleAuth';
import { pickBeanpodFile, type PickBeanpodFileResult } from '@/services/google/drivePicker';
import { tryReconnectSilently } from '@/services/google/driveTokenRecovery';
import { logEvent } from '@/services/telemetry/logEvent';

/**
 * Composable for re-picking a `.beanpod` file from Google Drive — used by
 * recovery surfaces (SaveFailureBanner re-select, future inviter flows)
 * that need the user to grant or re-grant `drive.file` scope to a
 * specific file.
 *
 * Token acquisition strategy: try silent first (cached or refresh-token),
 * then fall back to interactive auth — popup on browsers that support
 * it, full-page redirect on standalone PWAs and iOS Safari where
 * `window.open` either fails or can't bridge `postMessage` back to
 * the app window.
 */
export function usePickBeanpodFile() {
  const isPicking = ref(false);
  const pickError = ref<string | null>(null);

  /**
   * Open the Google Picker for the user to select a `.beanpod`.
   * Always returns a structured result — never throws. See
   * `PickBeanpodFileResult` for the discriminated outcomes.
   *
   * The try/catch here narrowly wraps the auth chain (silent-token /
   * redirect / popup). A thrown error there is surfaced as
   * `{ kind: 'failed', reason: 'auth', message }` with the underlying
   * Error.message captured so the join flow's diagnostic blob carries
   * the actual cause. The `pickBeanpodFile` call lives outside the try
   * because it always resolves to a structured result by contract — it
   * has its own catch sites that map to `'load'` / `'open'` / `'iframe'`
   * / `'timeout'`. Keeping the two concerns visibly separate prevents
   * future drift back to a single opaque `'script'` catch-all.
   *
   * When the auth flow kicks off a full-page redirect (PWA / iOS Safari
   * standalone), the page navigates away; the returned promise resolves
   * to `'cancelled'` since no Picker actually opened — the next session
   * completes redirect auth and the user re-triggers.
   *
   * @param opts.chooseAccount When true, bypasses every silent token path and shows Google's
   *   account chooser. Defaults to `false`: the silent token is what lets the Picker open at all
   *   on a redirect-auth platform, so the chooser is opt-in, reserved for the one surface whose
   *   whole purpose is switching accounts.
   * @param opts.loginHint Optional Google email to pre-populate the
   *   account chooser via `login_hint`. Use when the expected account
   *   is known (e.g. invitee's email from the invite URL hint).
   */
  async function pick(opts?: {
    /**
     * Show Google's ACCOUNT CHOOSER, because the signed-in account may be the wrong one.
     *
     * ⚠️ REPLACES `forceConsent`, which did the opposite of what every caller wanted.
     * `performPopupAuth` computes `prompt = forceConsent ? 'consent' : 'select_account'` — so the
     * one flag named for surfacing the chooser is the flag that SUPPRESSES it, and it kept
     * sending `login_hint`, which pre-selects the very account the user is trying to get away
     * from. The "sign in with a different account" link was built on it and could not, on any
     * platform, sign you in with a different account.
     */
    chooseAccount?: boolean;
    /**
     * Request OFFLINE ACCESS on the interactive call, so Google returns a refresh token.
     *
     * ⚠️ Does NOT skip the silent token. `chooseAccount` does, and that bypass is what
     * produced the iOS closed consent loop — so the two must stay separate however similar
     * their prompts end up looking. Forwarded to BOTH auth arms: the popup derives its
     * prompt from the flag, the redirect arm is handed the prompt string directly.
     */
    offlineAccess?: boolean;
    loginHint?: string;
    /**
     * Called with the FRESHLY ACQUIRED token, before the Picker opens. Return true if the
     * file was loaded without it, and the Picker never opens.
     *
     * ⚠️ WHY THIS EXISTS. Under `drive.file` the Picker selection is one way to grant the
     * app access to a file — but it is not the only one. The app ALSO holds a permanent
     * grant for any file it created itself, stored server-side per (app, Google account,
     * file). So the owner of a pod, signing in on a new device with a link that already
     * carries the `fileId`, can read it directly the moment they have a token.
     *
     * They were being shown the Picker anyway, because the silent direct read is attempted
     * only BEFORE authentication — where a fresh browser has no token — and nothing
     * retried it once the token existed. The result was a file chooser presented to
     * someone whose own file it is, defaulting to a tab that by definition cannot contain
     * it. Retrying here costs one API call on the paths where it fails (a genuine first
     * join, where a 404 is expected and the Picker IS the grant) and removes a whole
     * confusing step on the paths where it succeeds.
     */
    resolveWithoutPicker?: (token: string) => Promise<boolean>;
  }): Promise<PickBeanpodFileResult> {
    const chooseAccount = opts?.chooseAccount ?? false;
    const offlineAccess = opts?.offlineAccess ?? false;
    // Suppress the hint when the whole point is to pick a different account.
    const loginHint = chooseAccount ? undefined : opts?.loginHint;
    isPicking.value = true;
    pickError.value = null;

    try {
      // Auth chain — narrow try/catch so callers can distinguish auth
      // failures (`reason: 'auth'`) from picker failures (`'load' /
      // 'open' / 'iframe' / 'timeout'`).
      let token: string | null = null;
      try {
        // ⚠️ ALWAYS TRY THE SILENT TOKEN FIRST, unless the caller is explicitly asking to switch
        // accounts. This is the root fix for the reported consent loop, and fixing it HERE rather
        // than at one call site is the difference between fixing the bug and moving it.
        //
        // Skipping the silent token guarantees a full-page `startRedirectAuth` on every
        // redirect-auth platform — the whole iOS/Android app, every iOS browser and every
        // installed PWA. The join flow hit that and looped; both pod-recovery banners, which
        // called `pick()` bare, hit exactly the same thing on the two screens a family only
        // reaches when their pod is already broken.
        if (!chooseAccount) {
          // Seed a beanpod-mirrored refresh token (account-matched) so the silent path can
          // succeed without consent; harmless no-op if there is no doc token.
          //
          // ⚠️ ITS OWN CATCH, because "best-effort" was only ever a claim in a comment. Sharing
          // the outer `try` meant a rejection here — an offline device, a Drive blip, a
          // malformed stored token — abandoned the whole auth chain and returned
          // `{kind:'failed', reason:'auth'}`, so an OPTIONAL optimisation could cost the joiner
          // the Picker entirely. There may still be a perfectly good cached token one line
          // below; find out before giving up.
          if (loginHint) {
            try {
              await tryReconnectSilently(loginHint);
            } catch (reconnectErr) {
              console.warn(
                '[usePickBeanpodFile] silent reconnect failed; continuing',
                reconnectErr
              );
            }
          }
          token = await tryGetSilentToken();
        }
        if (!token) {
          if (shouldUseRedirectAuth()) {
            const returnPath = `${window.location.pathname}${window.location.search}`;
            await startRedirectAuth(returnPath, loginHint, 'join', {
              // The redirect path hardcoded `prompt=consent`, so it could not show the chooser
              // either. Pass it through so "different account" means that on iOS too.
              //
              // ⚠️ BOTH VALUES, never a bare `select_account`. Join is emphatically an
              // offline-access caller, and Google returns a `refresh_token` only when `consent`
              // is asked for. A second Google account that has already granted the scopes — the
              // common case here — would otherwise come back with nothing to refresh, and the
              // joiner would face a consent screen on every cold start thereafter.
              // `offlineAccess` reaches the same pair, for the join's first grant. See
              // `offlineAccess` in this file's options and in `requestAccessToken`.
              prompt: chooseAccount || offlineAccess ? 'select_account consent' : undefined,
            });
            // ⚠️ `'redirecting'`, NOT `'cancelled'` — and that distinction is a production bug fix,
            // not a nicety. The page is navigating to Google; the user has done nothing and
            // certainly has not dismissed anything. Reporting it as a cancel meant every caller
            // treated "we just redirected them" identically to "they backed out", which on
            // iOS/PWA produced a silent consent loop with no error and no telemetry.
            //
            // Note (from `ReconnectOutcome`, which already learned this): on native the WebView
            // does NOT unload, so "the page is leaving" cannot be relied on as a guard.
            return { kind: 'redirecting' };
          }
          token = await requestAccessToken({ chooseAccount, offlineAccess, loginHint });
        }
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        console.warn('[usePickBeanpodFile] auth failed before picker:', message);
        pickError.value = message || 'Authentication failed';
        // A blocked popup is its OWN reason. `isUserCancellation` deliberately does not match it,
        // and collapsing it into `auth` is why `OAUTH_POPUP_BLOCKED` was a declared code that
        // nothing ever emitted — a registry entry that lied about coverage.
        if (isPopupBlocked(e)) return { kind: 'failed', reason: 'popup-blocked', message };
        // ⚠️ A CLOSED CHOOSER IS NOT A FAILURE. `waitForAuthCode` rejects with
        // `Error('Authentication cancelled')`, which `isUserCancellation` matches exactly — but
        // this catch never asked, so someone opening "Use a different Google account", looking
        // at the list and closing it got a red error card (`PICKER_AUTH_FAILED` on the join
        // page, an error toast on the pod banners) plus a `reportError`. That is a scolding for
        // changing your mind, on the surfaces where people are already stuck. Every other
        // Google-auth call site in the app consults this predicate; this one was added without
        // it, and the omission only became reachable when `chooseAccount` started opening a
        // chooser people might close.
        if (isUserCancellation(e)) return { kind: 'cancelled' };
        return { kind: 'failed', reason: 'auth', message };
      }

      // ⚠️ BEFORE the Picker. See `resolveWithoutPicker`. Guarded: a throwing callback must
      // fall through to the Picker, which is the behaviour that has always worked, rather
      // than dead-ending the one flow that cannot be retried from anywhere else.
      if (opts?.resolveWithoutPicker) {
        try {
          if (await opts.resolveWithoutPicker(token)) return { kind: 'loaded' };
        } catch (e) {
          console.warn('[usePickBeanpodFile] direct load before picker threw; opening picker', e);
          logEvent({
            level: 'warn',
            surface: 'login-flow',
            message: 'direct load before picker threw; falling back to the picker',
            context: { action: 'direct_load_threw' },
          });
        }
      }

      // pickBeanpodFile always resolves to a structured result by
      // contract — no try/catch needed at this layer.
      return await pickBeanpodFile(token);
    } finally {
      isPicking.value = false;
    }
  }

  return { isPicking, pickError, pick };
}
