/**
 * Shared "wire up a storage provider for a brand-new pod" helpers.
 *
 * Used by the create-pod wizard's storage step *and* the resume-setup
 * recovery screen — the two places a fresh `.beanpod` location is chosen.
 * Keeping the logic here (rather than duplicated in each component) means the
 * popup-vs-redirect decision, the timeout, and the "already have a token,
 * don't re-auth" handling live in one place.
 *
 * Neither helper writes the pod file — that's `syncStore.createNewFile()`,
 * which the caller invokes after a successful connect. These only select the
 * storage location and install the provider on `syncService`.
 */

import {
  shouldUseRedirectAuth,
  startRedirectAuth,
  isTokenValid,
  whenRedirectAuthSettled,
  awaitNativeOAuthReturn,
  preferRedirectAuth,
} from '@/services/google/googleAuth';
import type { RedirectMode } from '@/services/google/redirectState';
import { currentLocationPath } from '@/services/google/redirectState';
import { tryReconnectSilently } from '@/services/google/driveTokenRecovery';
import { GoogleDriveProvider } from '@/services/sync/providers/googleDriveProvider';
import * as syncService from '@/services/sync/syncService';
import { supportsFileSystemAccess, isNative } from '@/services/sync/capabilities';
import { withTimeout } from '@/utils/timing';
import { logEvent } from '@/services/telemetry/logEvent';
import { reportError } from '@/utils/errorReporter';
import { trackOnboardingStep } from '@/services/telemetry/onboardingAttempt';
import { currentCreateAttempt } from '@/utils/createAttemptState';
import { FileNameCollisionError } from '@/types/sync';
import {
  CREATE_DRIVE_ERRORS,
  DRIVE_CONNECT_TIMEOUT_NAME,
  classifyCreateDriveFailure,
  type CreateDriveErrorCode,
} from '@/services/sync/createDriveErrors';

// The create flow's WEB return path. On native the trip is awaited in place and this is not used
// (see `createReturnPath`). The old `export { RESUME_SETUP_PATH }` back-compat re-export is GONE —
// every importer takes it from `resumePaths` directly, which is where it lives.
import { RESUME_SETUP_PATH } from '@/components/login/resumePaths';
import { toSearchParams } from '@beanies/brand/attribution';
import { peekAttribution } from '@/utils/attributionStash';

/**
 * Begin a redirect/deep-link OAuth flow IFF the current surface needs one and we
 * don't already hold a valid token. Returns `true` when it kicked off the
 * redirect (the page is navigating away on web / the system browser opened on
 * native — the caller MUST return early and treat it as "redirecting"); `false`
 * when a token is already in hand or a popup is acceptable (desktop), in which
 * case the caller proceeds with its normal token-bearing path.
 *
 * `shouldUseRedirectAuth()` is the single source of truth for the transport
 * decision (it returns true on native + iOS/PWA). `startRedirectAuth` preserves
 * the `prompt=consent` refresh-token invariant; do not hand-roll an auth URL.
 *
 * Return-path-agnostic by design — each caller passes the path it wants to
 * resume at (create → `RESUME_SETUP_PATH` on web, the current location on native; see
 * `createReturnPath`. Load → the login-flow's LOAD_DRIVE_PATH).
 * A throw from `startRedirectAuth` (e.g. no client id, Browser.open rejects)
 * propagates to the caller's try/catch — never swallowed (`gateCreateDriveAuth` is that
 * try/catch for the two create callers).
 *
 * `opts.forceReauth` redirects even when a valid token is held — the
 * switch-account case on a redirect surface, where the popup `forceConsent`
 * path can't run. It sends `prompt=select_account consent`: the default
 * `consent` re-asks on the account already signed in and SUPPRESSES the
 * chooser, so a switch would land on the same account. Used by LoadPodView's
 * "different account" and create's "use a different Google account".
 */
export async function beginDriveAuthRedirectIfNeeded(
  returnPath: string,
  loginHint: string | undefined,
  mode: RedirectMode,
  opts: { forceReauth?: boolean } = {}
): Promise<boolean> {
  // A pending redirect `code` may still be mid-exchange on the post-redirect boot;
  // redeem it (shared, once) before judging the token — otherwise we bounce a
  // spurious second redirect. No-op once settled / on native. See ADR-026.
  await whenRedirectAuthSettled();
  if (shouldUseRedirectAuth() && (opts.forceReauth || !isTokenValid())) {
    // B: on a redirect surface (the iPhone case), try a silent recovery using
    // the beanpod-mirrored refresh token before bouncing through Google. Wired
    // with an EXPLICIT boolean (do NOT lean on isTokenValid() side-effects).
    // Skipped when forceReauth (deliberate account switch needs the chooser).
    // Resolve the account from the caller's hint, else the current provider's
    // bound account — `loginHint` is often absent on the reconnect seam, and
    // without this fallback the silent recovery would never fire there.
    const expectedEmail = loginHint ?? syncService.getProvider()?.getAccountEmail() ?? undefined;
    if (!opts.forceReauth && (await tryReconnectSilently(expectedEmail))) {
      return false; // connection restored silently; caller proceeds with the token
    }
    if (opts.forceReauth) {
      await startRedirectAuth(returnPath, loginHint, mode, { prompt: 'select_account consent' });
    } else {
      await startRedirectAuth(returnPath, loginHint, mode);
    }
    return true;
  }
  return false;
}

/** Provider was installed; caller should now write the pod file. */
export interface StorageConnected {
  status: 'connected';
  type: 'local' | 'google_drive';
}
/** Connect failed. `errorKind` says why; callers render and report from it, never from `error`. */
export interface StorageConnectFailed {
  status: 'failed';
  /** English-only and may carry ids: for logs, NEVER rendered. */
  error: string;
  /**
   * The ONE discriminator, a `CREATE_DRIVE_ERRORS` code (`createDriveErrors.ts`). Every Drive
   * connect failure carries one (`classifyCreateDriveFailure`); callers take the message,
   * recoveries and severity from the registry. The local-file connect sets `unsupported-browser`
   * (no File System Access API) and `cancelled` (a dismissed picker, a benign abort the caller
   * does not report); its other failures leave it unset.
   *
   * ⚠️ THERE IS NO SEPARATE `cancelled` FLAG ANY MORE. It said the same thing as
   * `errorKind === 'cancelled'`, and two fields saying one thing is how the two create surfaces
   * drifted apart on what a cancel was.
   */
  errorKind?: CreateDriveErrorCode;
  /**
   * The raw failure behind a Drive `errorKind`, for `reportCreateDriveFailure` only: it carries
   * the error name, stack and Google's `reason` that the `error` string drops. Never rendered.
   */
  cause?: unknown;
  /**
   * Present iff `errorKind === 'name-collision'`. Grouped into one object
   * (rather than loose `collision*` siblings) so the failure shape stays
   * legible as the adopt-existing recovery reads it. `ownedByCurrentAccount`
   * comes from the cheap `ownedByMe` file metadata — NO decrypt here (that
   * lives in `resolveExistingBeanpod`, the single decrypt-to-classify site).
   */
  collision?: { fileId: string; ownedByCurrentAccount: boolean };
  /** Set on transient/verify failures the caller may retry (e.g. collision-check-unavailable). */
  retryable?: boolean;
}
/**
 * A full-page redirect to Google is in flight; nothing after this runs.
 *
 * ⚠️ WEB ONLY. On native `connectDriveStorage` never returns this — nothing unloads there, so it
 * awaits the round trip and reports `connected` / `failed` in place.
 */
export interface StorageRedirecting {
  status: 'redirecting';
}
export type StorageConnectOutcome = StorageConnected | StorageConnectFailed | StorageRedirecting;

/** What the create flow's Drive-auth gate did. */
export type DriveAuthGate =
  { kind: 'proceed' } | { kind: 'redirecting' } | { kind: 'failed'; error: Error };

/**
 * Where a create-side redirect lands. WEB: the resume screen — the reload must hit LoginPage's
 * fast path at first paint. NATIVE: right here — the stack is alive and continues in place, so
 * the sink's `router.replace` must be a DUPLICATE (from `CreatePodView` at `/create`,
 * `RESUME_SETUP_PATH` would be a real navigation that flips the view out from under the wizard).
 * It matters only on a JS-context restart mid-trip, where App.vue's boot routes a podless session
 * on anyway.
 */
function createReturnPath(): string {
  if (isNative()) return currentLocationPath();
  // The campaign tag (#118) rides the return URL: WebKit (iOS Safari / standalone PWA) clears
  // script-writable storage across the cross-site OAuth hop, and `main.ts` re-captures the tag
  // from this query on the post-redirect boot (a no-op under first-touch when storage survived).
  const attribution = peekAttribution();
  return attribution
    ? `${RESUME_SETUP_PATH}&${toSearchParams(attribution).toString()}`
    : RESUME_SETUP_PATH;
}

/**
 * The create flow's Drive-auth gate, shared by `connectDriveStorage` and the registry probe.
 * Runs `beginDriveAuthRedirectIfNeeded`, and then — on native, where nothing unloaded — WAITS for
 * the trip. `redirecting` is web-only: the page is unloading and the caller returns. A failed trip
 * is handed back as the SAME error the popup path would have thrown, so callers classify it once.
 *
 * This is ALSO the try/catch for a start failure (no client id, `Browser.open` rejected — already
 * settled as `open_failed`). The probe has no envelope between here and `onMounted`, and an
 * uncaught throw there would leave the screen on its probing spinner for good.
 *
 * NOT used by the Drive-LOAD picker, whose return is the `load-drive` marker by design.
 */
export async function gateCreateDriveAuth(
  loginHint: string | undefined,
  opts: { forceReauth?: boolean } = {}
): Promise<DriveAuthGate> {
  try {
    if (!(await beginDriveAuthRedirectIfNeeded(createReturnPath(), loginHint, 'create', opts))) {
      return { kind: 'proceed' };
    }
    if (!isNative()) return { kind: 'redirecting' };
    // ⚠️ INSIDE THE try, and that is the point of the try. This await now spans an entire
    // system-browser consent plus the dismissal grace, and the registry probe calls this with no
    // envelope of its own — so a throw escaping here would pin the resume screen on its probing
    // spinner for good, with the only escape being "Start over", which signs the person out.
    // `awaitNativeOAuthReturn` is contracted never to reject; this is the belt for the day that
    // stops being true.
    const outcome = await awaitNativeOAuthReturn();
    return outcome.kind === 'completed'
      ? { kind: 'proceed' }
      : { kind: 'failed', error: outcome.error };
  } catch (e) {
    logConnectFailure('drive-auth-gate-threw', e);
    return { kind: 'failed', error: e instanceof Error ? e : new Error(String(e)) };
  }
}

/**
 * Stage markers and the local connects reach the firehose here (audit C12): the stub probe, the
 * local-file failures, and the gate's `drive-auth-gate-threw` (the redirect could not START, a
 * stage the classified report cannot carry). A Drive CONNECT failure is NOT logged here: it is
 * reported exactly once, by `reportCreateDriveFailure` below, from the caller that renders it.
 */
function logConnectFailure(action: string, e: unknown): void {
  logEvent({
    level: 'warn',
    surface: 'connect-storage',
    message: 'storage connect step failed',
    error: e instanceof Error ? e : undefined,
    context: { action, error_code: e instanceof Error ? e.name : 'unknown' },
  });
}

/**
 * The surfaces that report a create-flow Drive failure. `resumeSetup.write` is the pod write after
 * a successful connect (a full Drive that passed the stub), kept apart so CloudWatch can tell a
 * write-time failure from a connect-time one.
 */
export type CreateDriveSurface =
  | 'createPod.connectDrive'
  | 'resumeSetup.connectDrive'
  | 'resumeSetup.probeDriveAuth'
  | 'resumeSetup.write';

/**
 * THE one report for a create-flow Drive failure: `reportError` at the registry's severity (only
 * `unknown` and `drive-api-disabled` page Slack) plus one console line. Lives beside
 * `logConnectFailure` so "one report per failure" reads in one file, and here rather than in the
 * leaf registry because it needs `reportError` and the transport.
 *
 * `detail` is a closed `transport=<popup|redirect|native>[;reason=<google reason>]`. The transport
 * is derived HERE at report time, never passed, so the call sites cannot disagree. Pass the raw
 * failure as `error` (a `StorageConnectFailed`'s `cause ?? error`) so the report keeps the error
 * name, stack and Google's `reason`.
 */
export function reportCreateDriveFailure(
  surface: CreateDriveSurface,
  code: CreateDriveErrorCode,
  error: unknown
): void {
  const { severity } = CREATE_DRIVE_ERRORS[code];
  const transport = isNative() ? 'native' : shouldUseRedirectAuth() ? 'redirect' : 'popup';
  const reason = (error as { reason?: unknown } | null | undefined)?.reason;
  const detail =
    typeof reason === 'string'
      ? `transport=${transport};reason=${reason}`
      : `transport=${transport}`;
  const log = severity === 'critical' ? console.error : console.warn;
  // `resumeSetup.write` failed AFTER a successful connect; saying "connect" there misleads triage.
  const what = surface === 'resumeSetup.write' ? 'write' : 'connect';
  log(`[${surface}] Google Drive ${what} failed (${code}):`, error);
  reportError({
    surface,
    message: error instanceof Error ? error.message : String(error ?? code),
    severity,
    error,
    context: { provider_type: 'google_drive', error_code: code, detail },
  });
}

/**
 * Connect Google Drive as the storage for a new pod.
 *
 * - On WEB redirect surfaces (installed PWAs / iOS Safari), and only when we don't already hold
 *   a valid token, this performs a full-page redirect to Google and returns
 *   `{ status: 'redirecting' }` — the caller must treat that as "we're done here", because the
 *   page is unloading. The work resumes at `RESUME_SETUP_PATH` on the fresh load.
 *
 *   ⚠️ ON NATIVE IT NEVER RETURNS `redirecting`. Nothing unloads there: the system browser opens
 *   over a live WebView, so this function AWAITS the round trip and then continues in place,
 *   returning `connected` / `failed` exactly as the desktop popup path does. Assuming otherwise
 *   was the 2026-09-21 bug — the person landed back on the storage picker with nothing to
 *   finish the job, because the continuation lived on a marker nothing re-read.
 * - Otherwise it acquires a token (fresh consent if we have none, the cached
 *   one if we do), creates the `.beanpod` file in the user's Drive, and
 *   installs the provider on `syncService`.
 *
 * - A BLOCKED POPUP is not handed back: this records the tab's redirect preference
 *   (`preferRedirectAuth`) and re-runs ONCE, now through the redirect gate. This is the ONE place
 *   the preference is recorded, because a connect always runs behind a person's tap, which the
 *   popup opener cannot know. The re-run fails with its own classified code if it fails.
 *
 * @param podFileBaseName Base name for the `.beanpod` file (family name).
 * @param opts.googleEmail Pre-fills Google's account chooser (`login_hint`).
 * @param opts.activeFamilyId If known, persists the provider→family mapping.
 * @param opts.chooseAccount "Use a different Google account": forces Google's account chooser
 *   and drops the login hint, on every transport.
 */
export async function connectDriveStorage(
  podFileBaseName: string,
  opts: { googleEmail?: string; activeFamilyId?: string | null; chooseAccount?: boolean } = {}
): Promise<StorageConnectOutcome> {
  let outcome = await connectDriveStorageOnce(podFileBaseName, opts);
  if (outcome.status === 'failed' && outcome.errorKind === 'popup-blocked') {
    preferRedirectAuth();
    // ⚠️ GUARDED ON THE PREFERENCE HAVING TAKEN. The in-memory flag makes the re-run a redirect
    // even when sessionStorage throws; were it somehow still a popup surface, a re-run would only
    // open a second popup into the same blocker. Exactly one retry, structurally: no loop.
    if (shouldUseRedirectAuth()) outcome = await connectDriveStorageOnce(podFileBaseName, opts);
  }
  recordDriveConsentOutcome(outcome);
  return outcome;
}

/**
 * Close the create funnel's open `drive-consent` step (#128) with this call's outcome, for the
 * two transports that finish in place (desktop popup, native round trip). The web redirect
 * returns `redirecting` here and its exit is recorded by `OAuthCallbackPage` / App.vue's boot
 * catch instead.
 *
 * Only while the attempt's current step IS `drive-consent`: the resume screen's finalize runs
 * this again after a redirect return with the token already in hand (no consent in this call,
 * step already `pin`), and the callback page has recorded that consent once. Collision outcomes
 * count as `submitted`: Google said yes; what failed was the file, not the consent.
 */
function recordDriveConsentOutcome(outcome: StorageConnectOutcome): void {
  if (outcome.status === 'redirecting') return;
  if (currentCreateAttempt()?.step !== 'drive-consent') return;
  if (outcome.status === 'connected') {
    trackOnboardingStep('drive-consent', 'submitted');
    return;
  }
  if (
    outcome.errorKind === 'name-collision' ||
    outcome.errorKind === 'collision-check-unavailable'
  ) {
    trackOnboardingStep('drive-consent', 'submitted');
    return;
  }
  trackOnboardingStep('drive-consent', 'back', { error_code: outcome.errorKind ?? 'unknown' });
}

async function connectDriveStorageOnce(
  podFileBaseName: string,
  opts: { googleEmail?: string; activeFamilyId?: string | null; chooseAccount?: boolean }
): Promise<StorageConnectOutcome> {
  const chooseAccount = Boolean(opts.chooseAccount);
  try {
    // On a redirect surface with no valid token, bounce through the system browser / full-page
    // redirect. The gate is INSIDE this try so one catch classifies both transports: a native
    // trip that fails hands back the very error the popup path would have thrown. A switch of
    // account sends no login hint (it would pre-select the account being left) and forces the
    // redirect even with a valid token.
    const gate = await gateCreateDriveAuth(chooseAccount ? undefined : opts.googleEmail, {
      forceReauth: chooseAccount,
    });
    if (gate.kind === 'redirecting') return { status: 'redirecting' };
    if (gate.kind === 'failed') throw gate.error;

    const fileName = `${podFileBaseName || 'my-family'}.beanpod`;
    // Force a fresh consent screen only when we have no token yet; if we just
    // returned from a redirect we already hold a valid one — reuse it (no
    // popup, no second chooser). The chooser rides the popup ONLY: on native
    // `requestAccessToken({ chooseAccount })` throws, and on a redirect surface
    // the gate above already switched accounts.
    const provider = await withTimeout(
      GoogleDriveProvider.createNew(fileName, {
        forceConsent: !isTokenValid(),
        chooseAccount: chooseAccount && !shouldUseRedirectAuth(),
      }),
      150_000,
      'Connecting to Google Drive is taking too long. Try again, or use a local file instead.',
      DRIVE_CONNECT_TIMEOUT_NAME
    );
    // Bind the provider to the family the caller will compare it against. An unbound provider
    // that survives a native round trip is exactly what reached a create write on 2026-09-21.
    syncService.setProvider(provider, opts.activeFamilyId);
    if (opts.activeFamilyId) await provider.persist(opts.activeFamilyId);
    return { status: 'connected', type: 'google_drive' };
  } catch (e) {
    // ONE classification for every transport and every failure (`createDriveErrors.ts` owns the
    // ordered ladder: typed errors, deadlines, policy blocks, statuses, then the message
    // predicates, with `isUserCancellation` below the typed arms so a real fault is never read as
    // a cancel). ⚠️ `errorKind` IS WHAT KEEPS THE COPY TRANSLATED: `error` is English-only.
    const errorKind = classifyCreateDriveFailure(e);
    const error = e instanceof Error ? e.message : String(e);
    if (e instanceof FileNameCollisionError) {
      // Hand the caller the grouped collision metadata (no decrypt here — that
      // lives in `resolveExistingBeanpod`). The adopt-existing recovery reads
      // `collision.ownedByCurrentAccount` to decide adopt vs. reject.
      return {
        status: 'failed',
        error,
        errorKind,
        cause: e,
        collision: { fileId: e.existingFileId, ownedByCurrentAccount: e.ownedByCurrentAccount },
      };
    }
    // `collision-check-unavailable`: we could not verify the Drive for an existing file, so we
    // refused to create blindly (avoiding a second orphan). Retryable, not fatal.
    return {
      status: 'failed',
      error,
      errorKind,
      cause: e,
      ...(errorKind === 'collision-check-unavailable' ? { retryable: true } : {}),
    };
  }
}

/**
 * Outcome of classifying a same-name `.beanpod` collision during onboarding —
 * the single decrypt/inspect site for the adopt-existing recovery (2026-06-19).
 *
 * - `adopt-stub` — the file is the authenticating account's OWN empty `{}`
 *   placeholder from a prior aborted attempt. Safe to reuse as the create
 *   target; the caller installs it via `adoptDriveStub` and continues creating.
 * - `adopt-existing` — the file is owned but holds a REAL `.beanpod` envelope.
 *   The caller confirms with the user, then loads it (never creates over it).
 * - `reject-different-account` — not owned by the current account. Never adopt;
 *   the caller shows the "pick a different name" guidance.
 */
export type ExistingBeanpodResolution =
  | { kind: 'adopt-stub'; fileId: string }
  | { kind: 'adopt-existing'; fileId: string }
  | { kind: 'reject-different-account' };

/**
 * Classify an owned-vs-not / stub-vs-populated `.beanpod` collision.
 *
 * Distinguishes the empty `{}` placeholder `createNew` writes (an orphan from
 * an aborted attempt) from a real V4 envelope WITHOUT decrypting — `'{}'` vs a
 * V4 envelope is structural, so this sidesteps the "orphan encrypted with a
 * different key" risk entirely. ANY failure to read/inspect falls SAFE to
 * `adopt-existing` (confirm-before-open) and is never re-thrown — a throw
 * escaping here would re-trap the user in the collision loop this fix removes.
 */
export async function resolveExistingBeanpod(collision: {
  fileId: string;
  ownedByCurrentAccount: boolean;
}): Promise<ExistingBeanpodResolution> {
  if (!collision.ownedByCurrentAccount) return { kind: 'reject-different-account' };
  try {
    // Read-only probe. `fromExisting` does NOT register a flush target
    // (finding 11), so inspecting here can't write anything back.
    const probe = GoogleDriveProvider.fromExisting(collision.fileId, '(collision-probe).beanpod');
    const text = await probe.read();
    return isStubBeanpod(text)
      ? { kind: 'adopt-stub', fileId: collision.fileId }
      : { kind: 'adopt-existing', fileId: collision.fileId };
  } catch (e) {
    // Fail safe: ask the user rather than silently adopting, and never re-throw.
    console.warn('[connectStorage] stub probe inconclusive — treating as populated:', e);
    logConnectFailure('stub-probe-inconclusive', e);
    return { kind: 'adopt-existing', fileId: collision.fileId };
  }
}

/**
 * True when the file is the empty placeholder `createNew` wrote (never populated).
 *
 * ⚠️ STRUCTURAL, AND IT PARSES NOTHING. This used to end in a version sniff
 * (`!== '4.0'`), so any real envelope at a version this build did not know (a
 * compacted 5.0 pod, on a stale build) was classed as an EMPTY PLACEHOLDER,
 * adopted as the create target with no confirm, and overwritten with a
 * brand-new family. Any non-empty text other than the literal `{}` is a
 * populated file: it falls to `adopt-existing`, which is confirm-gated, and the
 * confirmed open then goes through `parseBeanpodV4` like every other read, so a
 * newer version surfaces its own copy. Not parsing is also cheaper: this was a
 * second full JSON.parse of a multi-megabyte file to read one field.
 */
function isStubBeanpod(text: string | null): boolean {
  if (!text) return true; // empty / zero-byte
  const trimmed = text.trim();
  return trimmed === '' || trimmed === '{}'; // the createNew placeholder
}

/**
 * Adopt the current account's own orphan stub `.beanpod` as the create target:
 * install a provider on the existing fileId so the in-flight create writes the
 * real pod INTO it (no duplicate, no dead-end). Mirrors `connectDriveStorage`'s
 * success tail. The caller proceeds exactly as for a fresh connect.
 */
export async function adoptDriveStub(
  fileId: string,
  podFileBaseName: string,
  opts: { activeFamilyId?: string | null } = {}
): Promise<StorageConnected> {
  const fileName = `${podFileBaseName || 'my-family'}.beanpod`;
  const provider = GoogleDriveProvider.fromExisting(fileId, fileName);
  syncService.setProvider(provider, opts.activeFamilyId);
  if (opts.activeFamilyId) await provider.persist(opts.activeFamilyId);
  return { status: 'connected', type: 'google_drive' };
}

/**
 * Connect a local file as the storage for a new pod (the OS save-file
 * picker). Returns `{ status: 'failed', errorKind: 'cancelled' }` when the user
 * dismisses the picker — a normal abort the caller should not report — or
 * `{ status: 'failed', errorKind: 'unsupported-browser' }` when the browser
 * lacks the File System Access API (Firefox/Safari), where a retry can never
 * succeed and the caller should steer to Drive / Chrome / Edge.
 */
export async function connectLocalStorage(
  baseName?: string
): Promise<StorageConnected | StorageConnectFailed> {
  // Native (Capacitor): no File System Access API and no save picker — the pod
  // is written to an app-private file via @capacitor/filesystem (app-managed
  // location, persisted for cold-boot restore). See ADR-029.
  if (isNative()) {
    try {
      const ok = await syncService.selectNativeLocalFile(baseName);
      return ok
        ? { status: 'connected', type: 'local' }
        : { status: 'failed', error: 'Could not set up local file storage' };
    } catch (e) {
      logConnectFailure('native-local-connect-failed', e);
      return { status: 'failed', error: e instanceof Error ? e.message : String(e) };
    }
  }

  // showSaveFilePicker is Chromium-only. In Firefox/Safari it's absent, so
  // there's no local-file path at all — flag it as its own failure class so
  // the caller surfaces an actionable message instead of a futile "try again".
  if (!supportsFileSystemAccess()) {
    return {
      status: 'failed',
      error: 'File System Access API not supported in this browser',
      errorKind: 'unsupported-browser',
    };
  }

  try {
    const ok = await syncService.selectSyncFile();
    if (ok) return { status: 'connected', type: 'local' };
    return { status: 'failed', error: 'File picker cancelled', errorKind: 'cancelled' };
  } catch (e) {
    logConnectFailure('local-connect-failed', e);
    return { status: 'failed', error: e instanceof Error ? e.message : String(e) };
  }
}
