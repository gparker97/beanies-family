import { ref } from 'vue';
import {
  requestAccessToken,
  shouldUseRedirectAuth,
  startRedirectAuth,
  tryGetSilentToken,
  isPopupBlocked,
  isUserCancellation,
  getEmailVerifiedForToken,
  DRIVE_FILE_SCOPE,
} from '@/services/google/googleAuth';
import { pickBeanpodFile, type PickBeanpodFileResult } from '@/services/google/drivePicker';
import { getFileMetadata } from '@/services/google/driveService';
import { tryReconnectSilently } from '@/services/google/driveTokenRecovery';
import { logEvent } from '@/services/telemetry/logEvent';
import {
  consumePickerRedirectResult,
  discardPickerRedirectResult,
  PICKER_EVENTS,
} from '@/services/google/pickerRedirect';
import { isFlagEnabled } from '@/config/flags';
import { platformContext } from '@/utils/platformLabel';

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
/**
 * Put the real file NAME back on a system-browser picker result.
 *
 * ⚠️ THIS IS A SAFETY GUARD, NOT COSMETICS, and that is easy to miss. Google's onepick return
 * carries `picked_file_ids` and nothing else, so a picked file arrives with `fileName: ''`. The
 * only content gate stopping a rebind onto a compaction safety copy is `isSafetyCopyName`, which
 * is NAME-based — and `isSafetyCopyName('')` is false. Without this resolve, selecting
 * `family (before compacting).beanpod` from the picker would re-home the whole family onto its own
 * backup, which is exactly the ADR-033 fork that guard exists to prevent. The iframe Picker never
 * had this problem because it always carried `docs[0].name`.
 *
 * `rebindPodFile` also fails closed on an empty name, so this is belt AND braces: this restores
 * the working path, that one keeps it safe if this fails.
 *
 * Never throws: a metadata blip must cost the caller nothing worse than an empty name, which the
 * owning layer already refuses safely.
 */
async function resolvePickedName(result: PickBeanpodFileResult): Promise<PickBeanpodFileResult> {
  if (result.kind !== 'picked' || result.fileName) return result;
  try {
    const token = await tryGetSilentToken();
    if (!token) {
      console.warn('[usePickBeanpodFile] no token to resolve the picked file name; leaving blank');
      // ⚠️ THE MOST LIKELY OF THE THREE DEGRADED PATHS, so it is the one that most needs a rate.
      // Its siblings below (`!name`, and the catch) already emit this; leaving the common case
      // un-instrumented would make "how often does the safety-copy guard degrade to a blank
      // name?" unanswerable from CloudWatch for exactly the reason that causes it most.
      logEvent({
        level: 'warn',
        surface: PICKER_EVENTS.surface,
        message: 'no token available to resolve the picked file name',
        context: { ...platformContext(), action: PICKER_EVENTS.nameUnresolved },
      });
      return result;
    }
    const meta = await getFileMetadata(token, result.fileId, 'name');
    const name = typeof meta.name === 'string' ? meta.name : '';
    if (!name) {
      console.warn('[usePickBeanpodFile] Drive returned no name for the picked file');
      logEvent({
        level: 'warn',
        surface: PICKER_EVENTS.surface,
        message: 'picked file has no resolvable name; safety-copy guard cannot be evaluated',
        context: { ...platformContext(), action: PICKER_EVENTS.nameUnresolved },
      });
      return result;
    }
    return { ...result, fileName: name };
  } catch (e) {
    console.warn(
      '[usePickBeanpodFile] could not resolve the picked file name; the caller will refuse a ' +
        'rebind rather than risk binding onto a compaction safety copy',
      e
    );
    logEvent({
      level: 'warn',
      surface: PICKER_EVENTS.surface,
      message: 'picked file name lookup failed',
      context: { ...platformContext(), action: PICKER_EVENTS.nameUnresolved },
      error: e,
    });
    return result;
  }
}

/**
 * Where a full-page redirect should land the user again. Both "this page is going away" exits in
 * `pick()` use it, so they cannot drift apart.
 */
function currentReturnPath(): string {
  return `${window.location.pathname}${window.location.search}`;
}

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
    /**
     * The Drive file id this pick is looking for, when the caller already knows it (a join link
     * carries it as `fid=`). Used ONLY to filter the system-browser picker down to that one file,
     * so the joiner is not made to hunt for a `.beanpod` they have never seen across someone
     * else's Drive. Omitted by the recovery banners, where the user genuinely is choosing.
     */
    expectedFileId?: string;
  }): Promise<PickBeanpodFileResult> {
    const chooseAccount = opts?.chooseAccount ?? false;

    // ⚠️ FIRST, BEFORE ANY AUTH WORK. If the system-browser Picker just sent us back, the
    // selection is parked and this call IS the pick. Returning here is what closes the loop;
    // without it the redirect would land, the value would sit unread, and the user would be
    // looking at the same "Choose your data file" button that sent them to Google.
    //
    // ⚠️ EXCEPT WHEN THE USER ASKED TO SWITCH ACCOUNTS. `chooseAccount` comes from "Sign in with a
    // different Google account", a control only reached by someone already stuck. Consuming a
    // parked result there answers a question they did not ask — worst case they tapped it after
    // cancelling in Google's UI and are told "you cancelled" instead of being shown the chooser.
    if (chooseAccount) {
      // ⚠️ DISCARD, DO NOT STEP OVER. Leaving it parked keeps account A's file id alive for five
      // minutes; the next ordinary pick then consumes it under account B's token and the join
      // binds to a file the new account may not be able to read. Asking for a different account
      // means the previous account's selection is void, so say that.
      discardPickerRedirectResult();
    } else {
      const fromRedirect = consumePickerRedirectResult();
      if (fromRedirect) {
        // ⚠️ THE BUSY FLAG COVERS THE NAME LOOKUP TOO. `resolvePickedName` makes a Drive round
        // trip, and `SaveFailureBanner` disables its buttons on `isPicking` alone — without this,
        // a second tap during that window finds the stash already cleared, falls through to the
        // auth chain and navigates the page to Google mid-rebind.
        isPicking.value = true;
        pickError.value = null;
        try {
          return await resolvePickedName(fromRedirect);
        } finally {
          isPicking.value = false;
        }
      }
    }

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
            const returnPath = currentReturnPath();
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

      // THE SYSTEM-BROWSER PICKER, when the flag is on.
      //
      // Placed here, at the one `pickBeanpodFile` call, so all three consumers (the join flow and
      // both pod-recovery banners) get it with NO code of their own: each already switches on
      // `PickBeanpodFileResult` with `assertNever` and already handles `'redirecting'`, so no new
      // result kind is needed. Branching in the join path instead would duplicate this into both
      // banners later and bypass the `isPicking` bookkeeping `useDriveFileReselect` exists to
      // guarantee.
      //
      // ⚠️ AFTER `resolveWithoutPicker`, so a file the app can already read is still read
      // directly and nobody is sent to Google for nothing.
      //
      // ⚠️ GATED ON THE FLAG ALONE, not `flag && shouldUseRedirectAuth()`, so this runs on EVERY
      // platform including desktop Chrome, where the old iframe Picker works fine.
      //
      // ⚠️ AND THE FLAG IS COMMITTED `true` (0.21.3), so that is not a dev-only statement: every
      // production join and every pod-recovery reselect takes this path. An earlier version of
      // this comment said "production safety is the committed false" — true when written, false
      // now. Do not reinstate that reasoning. The actual basis for shipping is that greg ran the
      // full join end to end on desktop Chrome AND Firefox, where the iframe Picker was failing
      // with the same symptoms as iOS Safari, and judged the chooser it replaces bad enough that
      // a regression on an already-working browser is the better risk. The kill switch is a
      // revert of `featureFlags.committed.ts` plus a deploy, not a runtime toggle.
      //
      // Native iOS is still UNVERIFIED. See the exit condition on the flagRegistry entry.
      if (isFlagEnabled('systemBrowserPicker')) {
        const returnPath = currentReturnPath();
        logEvent({
          level: 'info',
          surface: PICKER_EVENTS.surface,
          message: 'system-browser picker redirect starting',
          context: { ...platformContext(), action: PICKER_EVENTS.start },
        });
        try {
          await startRedirectAuth(
            returnPath,
            // Pin the grant to the account the app actually holds a token for. Verified against
            // THIS token, never a cached best-guess: the same failure class `setAuthUser` was
            // added to fix, where the chooser listed the wrong account's Drive.
            // ⚠️ FALL BACK TO THE INVITE'S HINT. `getEmailVerifiedForToken` only answers when the
            // email was verified against THIS exact token, which on a join it usually has not been
            // — so passing it alone sent the joiner to an account chooser with no pre-selection and
            // made them hunt for their own address. CLAUDE.md's cloud-auth rule is explicit:
            // pre-populate the chooser whenever the expected identity is known, and on a join it is
            // (the inviter typed it). Verified email first, because that is the account the grant
            // will actually land on; the invite hint second, because it is better than nothing.
            getEmailVerifiedForToken(token) ?? loginHint,
            'join',
            {
              grant: 'picker',
              // ⚠️ `drive.file` ALONE. Google forbids combining it on a onepick request, and a
              // probe confirmed the return carries exactly this scope. Never `DRIVE_SCOPES`.
              scope: DRIVE_FILE_SCOPE,
              extraParams: {
                trigger_onepick: 'true',
                // ⚠️ SHOW ONLY THE FILE THEY CAME FOR. Unfiltered, the picker opens on the user's
                // whole Drive and the joiner has to hunt across tabs and folders for a `.beanpod`
                // they have never seen — the iframe Picker at least applied `setQuery('*.beanpod')`
                // and a "Shared with me" view first. Google's onepick takes `file_ids` as a filter,
                // and on a join we know the id exactly: it rides the invite link as `fid=`.
                // Omitted when unknown (the recovery banners), where an unfiltered picker is right.
                ...(opts?.expectedFileId ? { file_ids: opts.expectedFileId } : {}),
              },
            }
          );
        } catch (e) {
          // ⚠️ `pick()` PROMISES TO ALWAYS RESOLVE STRUCTURED, and none of its three callers wraps
          // it. `startRedirectAuth` can genuinely throw here — `sessionStorage.setItem` on the
          // native branch, `generateCodeChallenge`, `Browser.open()` — and iOS Safari private
          // browsing makes the storage write a real failure mode. Unhandled, it would reject out
          // of a bare `@click`, leaving the step stuck at 'authenticating' with no error and no
          // telemetry: exactly the stranded-step symptom Phase 1 exists to remove, reintroduced
          // on the new path.
          const message = e instanceof Error ? e.message : String(e);
          console.error('[usePickBeanpodFile] system-browser picker redirect failed', e);
          pickError.value = message;
          logEvent({
            level: 'error',
            surface: PICKER_EVENTS.surface,
            message: 'system-browser picker redirect could not start',
            context: { ...platformContext(), action: PICKER_EVENTS.startFailed },
            error: e,
          });
          // ⚠️ NOT `reason: 'open'`, which maps to PICKER_FAILED at 'critical'. The realistic
          // causes here are `sessionStorage.setItem` in iOS private browsing, a blocked
          // `Browser.open`, or the PKCE challenge: structural user/platform configuration, the
          // same class this change deliberately moved OFF the pager for the iframe arm. Paging a
          // developer because a joiner browses privately is the mis-set we just removed.
          return { kind: 'failed', reason: 'iframe', message };
        }
        // Same contract as the auth redirect above: the page is going away, the user has done
        // nothing, and this is emphatically not a cancel.
        return { kind: 'redirecting' };
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
