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
} from '@/services/google/googleAuth';
import type { RedirectMode } from '@/services/google/redirectState';
import { tryReconnectSilently } from '@/services/google/driveTokenRecovery';
import { GoogleDriveProvider } from '@/services/sync/providers/googleDriveProvider';
import * as syncService from '@/services/sync/syncService';
import { supportsFileSystemAccess, isNative } from '@/services/sync/capabilities';
import { withTimeout } from '@/utils/timing';
import { detectFileVersion } from '@/services/sync/fileSync';
import { FileNameCollisionError, CollisionCheckUnavailableError } from '@/types/sync';

// `RESUME_SETUP_PATH` now lives in the lightweight `resumePaths.ts` (so it can
// be imported without this module's heavy Drive/sync graph). Imported for this
// module's own use + re-exported for back-compat with existing importers.
import { RESUME_SETUP_PATH } from '@/components/login/resumePaths';
export { RESUME_SETUP_PATH };

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
 * resume at (create → RESUME_SETUP_PATH; load → the login-flow's LOAD_DRIVE_PATH).
 * A throw from `startRedirectAuth` (e.g. no client id, Browser.open rejects)
 * propagates to the caller's try/catch — never swallowed.
 *
 * `opts.forceReauth` redirects even when a valid token is held — the
 * switch-account case on a redirect surface, where the popup `forceConsent`
 * path can't run. `startRedirectAuth`'s `prompt=consent` re-prompts Google;
 * the create path never passes this (default false → unchanged).
 */
export async function beginDriveAuthRedirectIfNeeded(
  returnPath: string,
  loginHint: string | undefined,
  mode: RedirectMode,
  opts: { forceReauth?: boolean } = {}
): Promise<boolean> {
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
    await startRedirectAuth(returnPath, loginHint, mode);
    return true;
  }
  return false;
}

/** Provider was installed; caller should now write the pod file. */
export interface StorageConnected {
  status: 'connected';
  type: 'local' | 'google_drive';
}
/** Connect failed; `cancelled` ⇒ a benign user abort the caller should not report. */
export interface StorageConnectFailed {
  status: 'failed';
  error: string;
  cancelled?: boolean;
  /**
   * Discriminator for failure classes the caller may want to surface with
   * a focused message:
   * - `name-collision` — Drive folder already has a `.beanpod` with this name.
   * - `collision-check-unavailable` — could NOT verify whether a same-name file
   *   exists (transient Drive list failure). Distinct from "no collision": we
   *   refused to create blindly to avoid a second orphan. Retryable.
   * - `unsupported-browser` — local files need the File System Access API
   *   (Chromium-only); this browser (e.g. Firefox/Safari) can't do it, so a
   *   retry is futile. Steer the user to Google Drive (works everywhere) or
   *   Chrome/Edge instead of showing the generic "try again".
   * Other failures pass through with no `errorKind` set and the caller shows
   * the generic error.
   */
  errorKind?: 'name-collision' | 'collision-check-unavailable' | 'unsupported-browser';
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
/** A full-page redirect to Google is in flight; nothing after this runs. */
export interface StorageRedirecting {
  status: 'redirecting';
}
export type StorageConnectOutcome = StorageConnected | StorageConnectFailed | StorageRedirecting;

/**
 * Connect Google Drive as the storage for a new pod.
 *
 * - On iOS / installed PWAs (`shouldUseRedirectAuth()`), and only when we
 *   don't already hold a valid token, this performs a full-page redirect to
 *   Google and returns `{ status: 'redirecting' }` — the page navigates away,
 *   so the caller must treat that as "we're done here". On return the
 *   resume-setup screen finishes the job (it'll hit this function again, this
 *   time with a valid token in hand, so no second auth).
 * - Otherwise it acquires a token (fresh consent if we have none, the cached
 *   one if we do), creates the `.beanpod` file in the user's Drive, and
 *   installs the provider on `syncService`.
 *
 * @param podFileBaseName Base name for the `.beanpod` file (family name).
 * @param opts.googleEmail Pre-fills Google's account chooser (`login_hint`).
 * @param opts.activeFamilyId If known, persists the provider→family mapping.
 */
export async function connectDriveStorage(
  podFileBaseName: string,
  opts: { googleEmail?: string; activeFamilyId?: string | null } = {}
): Promise<StorageConnectOutcome> {
  // On a redirect surface (native / iOS / installed PWA) with no valid token,
  // bounce through the system browser / full-page redirect; the appUrlOpen
  // listener (native) or OAuthCallbackPage (web) drives the resume-setup
  // continuation on return. `shouldUseRedirectAuth()` already covers native
  // (ADR-029), so no separate `isNative()` check is needed here.
  if (await beginDriveAuthRedirectIfNeeded(RESUME_SETUP_PATH, opts.googleEmail, 'create')) {
    return { status: 'redirecting' };
  }

  try {
    const fileName = `${podFileBaseName || 'my-family'}.beanpod`;
    // Force a fresh consent screen only when we have no token yet; if we just
    // returned from a redirect we already hold a valid one — reuse it (no
    // popup, no second chooser).
    const provider = await withTimeout(
      GoogleDriveProvider.createNew(fileName, { forceConsent: !isTokenValid() }),
      150_000,
      'Connecting to Google Drive is taking too long. Try again, or use a local file instead.'
    );
    syncService.setProvider(provider);
    if (opts.activeFamilyId) await provider.persist(opts.activeFamilyId);
    return { status: 'connected', type: 'google_drive' };
  } catch (e) {
    if (e instanceof FileNameCollisionError) {
      // Hand the caller the grouped collision metadata (no decrypt here — that
      // lives in `resolveExistingBeanpod`). The adopt-existing recovery reads
      // `collision.ownedByCurrentAccount` to decide adopt vs. reject.
      return {
        status: 'failed',
        error: e.message,
        errorKind: 'name-collision',
        collision: { fileId: e.existingFileId, ownedByCurrentAccount: e.ownedByCurrentAccount },
      };
    }
    if (e instanceof CollisionCheckUnavailableError) {
      // We could not verify the user's Drive for existing files, so we refused
      // to create blindly (avoiding a second orphan). Retryable, not fatal.
      return {
        status: 'failed',
        error: e.message,
        errorKind: 'collision-check-unavailable',
        retryable: true,
      };
    }
    return { status: 'failed', error: e instanceof Error ? e.message : String(e) };
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
    return { kind: 'adopt-existing', fileId: collision.fileId };
  }
}

/** True when the file is the empty placeholder `createNew` wrote (never populated). */
function isStubBeanpod(text: string | null): boolean {
  if (!text) return true; // empty / zero-byte
  const trimmed = text.trim();
  if (trimmed === '' || trimmed === '{}') return true; // the createNew placeholder
  // Anything that isn't a real V4 envelope is treated as a non-pod stub.
  return detectFileVersion(text) !== '4.0';
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
  syncService.setProvider(provider);
  if (opts.activeFamilyId) await provider.persist(opts.activeFamilyId);
  return { status: 'connected', type: 'google_drive' };
}

/**
 * Connect a local file as the storage for a new pod (the OS save-file
 * picker). Returns `{ status: 'failed', cancelled: true }` when the user
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
    return { status: 'failed', error: 'File picker cancelled', cancelled: true };
  } catch (e) {
    return { status: 'failed', error: e instanceof Error ? e.message : String(e) };
  }
}
