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
import { GoogleDriveProvider } from '@/services/sync/providers/googleDriveProvider';
import * as syncService from '@/services/sync/syncService';
import { supportsFileSystemAccess, isNative } from '@/services/sync/capabilities';
import { withTimeout } from '@/utils/timing';
import { FileNameCollisionError } from '@/types/sync';

/** Path the OAuth redirect returns to — `LoginPage` shows the resume-setup screen here. */
export const RESUME_SETUP_PATH = '/welcome?resume=setup';

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
   * - `unsupported-browser` — local files need the File System Access API
   *   (Chromium-only); this browser (e.g. Firefox/Safari) can't do it, so a
   *   retry is futile. Steer the user to Google Drive (works everywhere) or
   *   Chrome/Edge instead of showing the generic "try again".
   * Other failures pass through with no `errorKind` set and the caller shows
   * the generic error.
   */
  errorKind?: 'name-collision' | 'unsupported-browser';
  /** Set when `errorKind === 'name-collision'`. */
  collisionFileId?: string;
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
  // Native (Capacitor) must also take the redirect-style branch: popups don't
  // work in a WebView, and `shouldUseRedirectAuth()` keys off iOS-WebKit /
  // standalone-PWA heuristics that a native shell may not match. On native,
  // `startRedirectAuth` opens the system browser and the appUrlOpen listener
  // drives the resume-setup continuation. See ADR-029.
  if ((shouldUseRedirectAuth() || isNative()) && !isTokenValid()) {
    await startRedirectAuth(RESUME_SETUP_PATH, opts.googleEmail);
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
      return {
        status: 'failed',
        error: e.message,
        errorKind: 'name-collision',
        collisionFileId: e.existingFileId,
      };
    }
    return { status: 'failed', error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Connect a local file as the storage for a new pod (the OS save-file
 * picker). Returns `{ status: 'failed', cancelled: true }` when the user
 * dismisses the picker — a normal abort the caller should not report — or
 * `{ status: 'failed', errorKind: 'unsupported-browser' }` when the browser
 * lacks the File System Access API (Firefox/Safari), where a retry can never
 * succeed and the caller should steer to Drive / Chrome / Edge.
 */
export async function connectLocalStorage(): Promise<StorageConnected | StorageConnectFailed> {
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
