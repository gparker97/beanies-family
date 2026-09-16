/**
 * Google Picker API — lets a user select a shared .beanpod file from their Drive.
 *
 * Selecting a file via Picker grants the app `drive.file` access to that file,
 * which is required when the file was shared by another user (not created by the app).
 */
import type { UIStringKey } from '@/services/translation/uiStrings';
import { fetchGoogleUserEmail, getEmailVerifiedForToken } from '@/services/google/googleAuth';
import { withTimeout } from '@/utils/timing';
import { logEvent } from '@/services/telemetry';

const PICKER_SCRIPT_URL = 'https://apis.google.com/js/api.js';

/**
 * How long we will wait to learn WHICH account the token belongs to before opening the Picker
 * unpinned. Short: the answer is usually cached, the call is one small GET, and the chooser
 * must never be held hostage to it.
 */
const ACCOUNT_RESOLVE_TIMEOUT_MS = 4_000;

let scriptPromise: Promise<void> | null = null;

/**
 * Close and dispose a built Picker.
 *
 * ⚠️ `setVisible(true)` HAD NO COUNTERPART ANYWHERE IN THIS FILE, and that is
 * how a configuration problem became a browser restart. When Google rejects the
 * developer key the Picker renders its OWN modal — "There was an error! The API
 * developer key is invalid." — which carries no close control. With nothing
 * disposing the Picker, that dialog covers the app permanently: no Escape, no
 * backdrop click, no way back. Observed in the field on 2026-09-07, where the
 * only way out was to restart the browser.
 *
 * So every exit from every picker in this file goes through here — a pick, a
 * cancel, a timeout, an iframe failure, a throw. `dispose()` is missing from
 * some versions of the typings, so it is optional and `setVisible(false)` is the
 * floor. Wrapped, because a teardown that throws must never replace the real
 * result the caller is waiting on.
 */
type BuiltPicker = { setVisible: (visible: boolean) => void; dispose?: () => void };

function disposePicker(picker: BuiltPicker | null): void {
  // ⚠️ TWO GUARDED CALLS, NOT ONE `try` AROUND BOTH. `dispose()` is the one that
  // actually releases the iframe; with a single block, a throwing
  // `setVisible(false)` skipped it and leaked the picker — and the whole reason
  // this function exists is a Google dialog that once had to be waited out.
  // A tiny local helper rather than two copy-pasted blocks.
  const attempt = (label: string, fn: () => void): void => {
    try {
      fn();
    } catch (e) {
      console.warn(`[drivePicker] picker teardown failed at ${label}`, e);
    }
  };
  if (!picker) return;
  attempt('setVisible', () => picker.setVisible(false));
  attempt('dispose', () => picker.dispose?.());
}

/** Load the Google API script (idempotent). */
function loadPickerScript(): Promise<void> {
  if (scriptPromise) return scriptPromise;

  scriptPromise = new Promise<void>((resolve, reject) => {
    if (typeof gapi !== 'undefined') {
      resolve();
      return;
    }

    const script = document.createElement('script');
    // `crossorigin="anonymous"` is REQUIRED for error observability. Without it,
    // any exception thrown inside this cross-origin Google script (gapi / GSI /
    // picker) is redacted by the browser — most aggressively by iOS WebKit — to
    // an opaque `window.onerror` "Script error." with no message or stack
    // (prod #4, 2026-06-19, the failing iPhone onboarding session). Google's
    // `apis.google.com` serves `Access-Control-Allow-Origin: *`, so requesting
    // CORS here does not break loading and lets the real error + stack surface
    // to `#beanies-errors` instead of an un-actionable blank.
    script.crossOrigin = 'anonymous';
    script.src = PICKER_SCRIPT_URL;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      // Reset cache so a subsequent retry actually re-attempts the fetch
      // instead of returning the same rejected promise forever.
      scriptPromise = null;
      reject(new Error('Failed to load Google Picker script'));
    };
    document.head.appendChild(script);
  });

  return scriptPromise;
}

/** Load the Picker library within gapi. */
function loadPickerLibrary(): Promise<void> {
  return new Promise<void>((resolve) => {
    gapi.load('picker', resolve);
  });
}

export type PickBeanpodFileResult =
  | { kind: 'picked'; fileId: string; fileName: string }
  | { kind: 'cancelled' }
  /**
   * A full-page redirect has been started; this page is going away.
   *
   * ⚠️ NOT a cancellation, and conflating the two is what hid a production bug. The joiner had
   * done nothing wrong — we had just navigated them to Google — but three of the four call sites
   * treated the result as "the user dismissed the chooser" and silently did nothing, which on
   * iOS/PWA produced a closed consent loop with no error and no telemetry.
   *
   * Vocabulary borrowed deliberately from `ReconnectOutcome` in `useGoogleReconnect.ts`, which
   * already defines this case and warns that on native the WebView does NOT unload — so "the page
   * is leaving" is not a guard you can rely on.
   */
  | { kind: 'redirecting' }
  | {
      kind: 'failed';
      reason: 'config' | 'load' | 'open' | 'auth' | 'iframe' | 'timeout' | 'popup-blocked';
      message?: string;
    };

const PICKER_TIMEOUT_MS = 30_000;

/**
 * Open the Google Picker to select a .beanpod file. Always resolves
 * (never throws) so callers can route to the structured registry of
 * join errors without wrapping in try/catch. See `PickBeanpodFileResult`.
 *
 * This is the preferred join entry point. Folder-picking under
 * `drive.file` scope does NOT grant API list-access to files inside a
 * folder shared by another user — the API returns 0 results even though
 * the folder is visible in the Drive UI. File-picking grants direct
 * `drive.file` access to the chosen file, which works for files shared
 * by another user. Photos are reachable independently via public-link
 * permissions + the Google CDN, so the join flow does not need folder
 * scope.
 */
/**
 * Which Google account the Picker should LIST, resolved from the token it will grant against.
 *
 * ⚠️ WITHOUT THIS THE PICKER SHOWS AN EMPTY LIST to anyone signed into more than one Google
 * account, and a joiner cannot join at all. The reason is not obvious and cost the better part
 * of a day to find: `setOAuthToken` does NOT decide what the Picker lists. The Picker runs in a
 * `docs.google.com` iframe that enumerates using the BROWSER's own Google session cookies; the
 * token only decides which account receives the `drive.file` grant once something is selected.
 * With several sessions present the iframe defaults to account index 0, and when that is the pod
 * OWNER, "Shared with me" is legitimately empty for it — the owner owns the `.beanpod`, so it
 * sits in their My Drive. Signing out of every other Google account made the file appear
 * instantly, which is the observation that identified this.
 *
 * ⚠️ FROM THE TOKEN, NOT FROM `inviteEmailHint`. The hint is what the inviter typed. The whole
 * failure mode is the browser using an account nobody intended, so the only email worth pinning
 * to is the one belonging to the token whose grant the selection will actually land on.
 * `fetchGoogleUserEmail` returns its cache only when it was verified against THIS exact token,
 * so a primed guess from persisted provider config cannot leak in here.
 *
 * Never throws: a userinfo blip must cost a joiner nothing worse than today's behaviour.
 */
async function resolvePickerAccount(accessToken: string): Promise<string | null> {
  try {
    // ⚠️ TIMEBOXED, because this now sits in front of the Picker. `fetchGoogleUserEmail` is a
    // bare `fetch` with no `AbortSignal`, and this call happens BEFORE `new Promise` arms
    // `PICKER_TIMEOUT_MS` — so on a captive portal or a stalled iOS WebKit connection the whole
    // of `pickBeanpodFile` hung forever with no safety net. `usePickBeanpodFile`'s
    // `finally { isPicking = false }` never ran either, latching `isBusy` true and leaving the
    // SaveFailureBanner's only recovery button disabled at '...' until a reload. Pinning the
    // account is a nice-to-have; blocking the chooser on it is not.
    await withTimeout(
      fetchGoogleUserEmail(accessToken),
      ACCOUNT_RESOLVE_TIMEOUT_MS,
      'resolving the Google account timed out'
    );

    // ⚠️ VERIFIED AGAINST THIS TOKEN, not whatever `fetchGoogleUserEmail` returned. Its three
    // failure paths (`!res.ok`, a throw, an empty `data.email`) all fall back to the cached
    // email with NO token check — a "best-known value" that suits a label and is actively
    // dangerous here. `GoogleDriveProvider.fromExisting` primes that cache, and the #62 notes
    // record it can hold the FILE OWNER's address. Trusting it would mean a userinfo blip pins
    // the Picker to the owner's Drive, whose "Shared with me" is legitimately empty — a
    // deterministic reproduction of the exact bug this pinning exists to fix, and silent.
    const verified = getEmailVerifiedForToken(accessToken);
    if (!verified) {
      // Never silent. Unpinned is the broken state on a multi-account browser, so a rise in
      // this event is the early warning for join failures we would otherwise only hear about
      // by email.
      logEvent({
        level: 'warn',
        surface: 'drive-picker',
        message: 'token account unverified; picker not pinned to an account',
        context: { action: 'picker_authuser_unpinned' },
      });
    }
    return verified;
  } catch (e) {
    logEvent({
      level: 'warn',
      surface: 'drive-picker',
      message: 'resolving the token account failed; picker not pinned to an account',
      context: { action: 'picker_authuser_unpinned' },
    });
    console.warn('[drivePicker] could not resolve the account to pin the Picker to', e);
    return null;
  }
}

export async function pickBeanpodFile(accessToken: string): Promise<PickBeanpodFileResult> {
  const apiKey = import.meta.env.VITE_GOOGLE_API_KEY;
  if (!apiKey) {
    console.error('[drivePicker] VITE_GOOGLE_API_KEY is not configured');
    return {
      kind: 'failed',
      reason: 'config',
      message: 'VITE_GOOGLE_API_KEY is not configured',
    };
  }

  try {
    await loadPickerScript();
    await loadPickerLibrary();
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error('[drivePicker] script/library load failed', e);
    return { kind: 'failed', reason: 'load', message };
  }

  const account = await resolvePickerAccount(accessToken);

  return new Promise<PickBeanpodFileResult>((resolve) => {
    // Tracks whether the Picker iframe successfully bootstrapped. Used
    // to distinguish a real cancel (LOADED-then-CANCEL) from an iframe
    // failure (CANCEL with no preceding LOADED) — the iOS WebKit
    // symptom path.
    let hasLoaded = false;
    let settled = false;
    /** Set once `build()` returns, so `settle` can always tear the UI down. */
    let built: BuiltPicker | null = null;

    const settle = (result: PickBeanpodFileResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutHandle);
      // EVERY exit, not just a clean pick — see `disposePicker`.
      disposePicker(built);
      resolve(result);
    };

    const timeoutHandle = setTimeout(() => {
      console.warn('[drivePicker] timed out waiting for Picker callback');
      settle({
        kind: 'failed',
        reason: 'timeout',
        message: `No Picker callback within ${PICKER_TIMEOUT_MS}ms`,
      });
    }, PICKER_TIMEOUT_MS);

    try {
      // "My Drive" view filtered to .beanpod files
      const myDriveView = new google.picker.DocsView(google.picker.ViewId.DOCS);
      myDriveView.setQuery('*.beanpod');
      myDriveView.setOwnedByMe(true);
      myDriveView.setMode(google.picker.DocsViewMode.LIST);

      // "Shared with me" view — files shared by another user won't appear
      // in "My Drive" until explicitly added, so we need a separate view
      const sharedView = new google.picker.DocsView(google.picker.ViewId.DOCS);
      sharedView.setQuery('*.beanpod');
      sharedView.setOwnedByMe(false);
      sharedView.setMode(google.picker.DocsViewMode.LIST);

      const appId = import.meta.env.VITE_GOOGLE_PROJECT_NUMBER;

      const builder = new google.picker.PickerBuilder()
        .addView(sharedView) // Show shared files first (most likely for join flow)
        .addView(myDriveView)
        .setOAuthToken(accessToken)
        .setDeveloperKey(apiKey)
        .setOrigin(window.location.origin);

      // AppId (numeric project number) is required for the Picker to grant
      // drive.file scope access to the selected file. Without it, the Picker
      // UI works but the OAuth token doesn't get file-level access.
      if (appId) builder.setAppId(appId);

      // Pin the Picker to the account that just consented. See `resolvePickerAccount` for why
      // `setOAuthToken` does not already do this, and what an unpinned Picker costs a joiner.
      if (account && typeof builder.setAuthUser === 'function') {
        builder.setAuthUser(account);
      }

      const picker = builder
        .setCallback((data: google.picker.PickerResponse) => {
          console.warn('[drivePicker] Picker callback:', data.action, data.docs?.[0]?.id);
          // LOADED isn't in @types/google.picker's Action enum but the
          // Picker emits it at runtime when the iframe finishes
          // bootstrapping. Compare as string to avoid the typedef gap.
          if ((data.action as string) === 'loaded') {
            hasLoaded = true;
            return;
          }
          if (data.action === google.picker.Action.PICKED && data.docs?.[0]) {
            settle({
              kind: 'picked',
              fileId: data.docs[0].id,
              fileName: data.docs[0].name,
            });
            return;
          }
          if (data.action === google.picker.Action.CANCEL) {
            // CANCEL without a preceding LOADED → iframe-bootstrap failure
            // (the iOS WebKit symptom). LOADED-then-CANCEL → real cancel.
            settle(
              hasLoaded
                ? { kind: 'cancelled' }
                : {
                    kind: 'failed',
                    reason: 'iframe',
                    message: 'Picker iframe cancelled before LOADED event',
                  }
            );
            return;
          }
        })
        .build();

      // Recorded BEFORE `setVisible`, so a synchronous throw inside it still
      // leaves `settle`'s teardown something to close.
      built = picker as unknown as BuiltPicker;
      picker.setVisible(true);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      console.error('[drivePicker] picker open failed', e);
      settle({ kind: 'failed', reason: 'open', message });
    }
  });
}

/** The failure reasons `pickBeanpodFile` can report. */
export type PickFailureReason = Extract<PickBeanpodFileResult, { kind: 'failed' }>['reason'];

/**
 * User-facing copy + a queryable code for a pick failure, in ONE place.
 *
 * ⚠️ WHY A TABLE RATHER THAN A SECOND `switch`. Every surface that opens the
 * Picker has to say something when it fails, and the two that exist rendered
 * `picked.message` directly — which for `reason: 'config'` puts the literal
 * string "VITE_GOOGLE_API_KEY is not configured" in front of a family. A table
 * keyed on the closed `reason` union means a new reason is a compile error here
 * instead of a raw developer string leaking to a user somewhere else.
 *
 * The caller keeps its own error ref and its own telemetry surface — only the
 * words and the code are shared.
 */
const PICK_FAILURE_COPY = {
  // A build/config problem, not something the user did or can fix. Say what
  // they CAN do (use a local file) rather than naming an env var at them.
  config: { messageKey: 'settings.drivePickerUnavailable', errorCode: 'picker-config' },
  auth: { messageKey: 'settings.drivePickerAuth', errorCode: 'picker-auth' },
  load: { messageKey: 'settings.drivePickerFailed', errorCode: 'picker-load' },
  open: { messageKey: 'settings.drivePickerFailed', errorCode: 'picker-open' },
  iframe: { messageKey: 'settings.drivePickerFailed', errorCode: 'picker-iframe' },
  timeout: { messageKey: 'settings.drivePickerFailed', errorCode: 'picker-timeout' },
  // The browser refused the popup. Distinct from a user cancel, and distinct from the Picker
  // failing — `isUserCancellation` deliberately does not match it (see googleAuth.ts).
  'popup-blocked': { messageKey: 'join.error.popupBlocked', errorCode: 'picker-popup-blocked' },
} as const satisfies Record<PickFailureReason, { messageKey: UIStringKey; errorCode: string }>;

export function describePickFailure(reason: PickFailureReason): {
  messageKey: UIStringKey;
  errorCode: string;
} {
  // `reason` is a closed union and the table is exhaustive over it.
  return PICK_FAILURE_COPY[reason];
}
