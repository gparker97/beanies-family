/**
 * GoogleDriveProvider — implements StorageProvider for Google Drive.
 *
 * Reads/writes .beanpod files on Google Drive via REST API.
 * Token management is delegated to googleAuth.ts (in-memory only).
 * On 401, attempts token refresh and retries once.
 */
import type { StorageProvider } from '../storageProvider';
import {
  storeProviderConfig,
  clearProviderConfig,
  clearFileHandleForFamily,
} from '../fileHandleStore';
import {
  getValidTokenSilent,
  isTokenValid,
  clearGoogleSessionState,
  requestAccessToken,
  attemptSilentRefresh,
  fetchGoogleUserEmail,
  getGoogleAccountEmail,
  setGoogleAccountEmail,
  TokenExpiredError,
} from '@/services/google/googleAuth';
import { clearDriveConnectionForAccount } from '@/services/google/driveTokenRecovery';
import {
  readFile,
  updateFile,
  getFileModifiedTime,
  getFileMetadata,
  patchFileMetadata,
  getOrCreateAppFolder,
  createFile,
  listBeanpodFiles,
  listFilesInFolder,
  deleteFile,
  clearFolderCache,
  DriveApiError,
} from '@/services/google/driveService';
import { enqueueOfflineSave } from '../offlineQueue';
import { FileNameCollisionError, CollisionCheckUnavailableError } from '@/types/sync';
import { isNetworkError } from '@/utils/isNetworkError';
import { logEvent } from '@/services/telemetry';

/**
 * Retry a Drive API call with exponential backoff on transient failures.
 *
 * Retryable:
 *   - 5xx / 408 (server-side transient)
 *   - TypeError from fetch (network-side transient: DNS, TLS, offline blip,
 *     SW activation race during a deploy). The browser's fetch() throws a
 *     TypeError for these — common right after sign-in if the network is
 *     still warming up.
 *
 * Not retryable: 4xx (incl. 401 — caller handles auth refresh separately).
 */
async function withRetry<T>(fn: () => Promise<T>, maxRetries = 3): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastError = e;
      const isRetryable =
        (e instanceof DriveApiError && (e.status >= 500 || e.status === 408)) ||
        (e instanceof TypeError && isNetworkError(e));
      if (!isRetryable || attempt === maxRetries) throw e;
      // Exponential backoff: 1s, 2s, 4s
      await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
    }
  }
  throw lastError; // unreachable, satisfies TS
}

export class GoogleDriveProvider implements StorageProvider {
  readonly type = 'google_drive' as const;
  private fileId: string;
  private fileName: string;
  private accountEmail: string | null;
  private mimeTypeMigrationDone = false;
  // ADR-032 Plan B aux change-log: the .beanpod's parent folder + a name→fileId
  // cache refreshed by listAux (chunks live as sibling files in the app folder).
  private auxFolderId: string | null = null;
  private auxIdByName = new Map<string, string>();

  constructor(fileId: string, fileName: string, accountEmail?: string | null) {
    this.fileId = fileId;
    this.fileName = fileName;
    this.accountEmail = accountEmail ?? null;
  }

  /**
   * Legacy .beanpod files were uploaded as `application/json` even though the
   * V4 envelope is encrypted binary. Drive then refused to recognize the type
   * (content didn't validate as JSON) and showed "File Type: unknown", which
   * suppressed the Marketplace SDK's "Open with beanies.family" handler.
   * Patches metadata to `application/octet-stream` once per session for any
   * file still on the wrong type. Failures are non-critical — the file
   * remains usable; the next successful sync will write the correct MIME
   * via updateFile's Content-Type header.
   */
  private async ensureCorrectMimeType(token: string): Promise<void> {
    if (this.mimeTypeMigrationDone) return;
    try {
      const meta = await getFileMetadata(token, this.fileId, 'mimeType');
      const currentMime = meta.mimeType as string | undefined;
      if (currentMime === 'application/json') {
        await patchFileMetadata(token, this.fileId, {
          mimeType: 'application/octet-stream',
        });
        console.info(
          '[GoogleDriveProvider] migrated .beanpod mimeType: application/json → application/octet-stream',
          this.fileId
        );
      }
      this.mimeTypeMigrationDone = true;
    } catch (e) {
      console.warn(
        '[GoogleDriveProvider] mimeType migration check failed (non-critical, will retry next session):',
        (e as Error).message
      );
    }
  }

  /**
   * Write content to Google Drive.
   * On 401: try silent refresh first, then interactive auth, then throw.
   * On 5xx: retry up to 3 times with exponential backoff.
   * On network error: queue for offline flush.
   */
  /**
   * Account-drift predicate (2026-06-19, finding 9). This provider is bound to
   * ONE Drive account (`this.accountEmail`) that owns `this.fileId`. Returns true
   * only when BOTH the bound email and the live session email are known and
   * differ. A null bound email means "not yet learned" (the provider learns it
   * via `updateAccountEmailIfAvailable` / `rebindProvenAccount`); a null session
   * email means we can't tell — both cases return false (no mismatch asserted).
   *
   * NOTE: unlike the pre-2026-08-14 `ensureBoundAccount`, this is NO LONGER a
   * pre-emptive gate. A nominal mismatch is not itself an error — the session
   * account may legitimately have shared access to the file. The mismatch only
   * matters when a real Drive op FAILS with a 404 (see `reconnectIfAccountMismatch`).
   */
  private accountMismatch(): boolean {
    if (!this.accountEmail) return false;
    const active = getGoogleAccountEmail();
    return !!active && active !== this.accountEmail;
  }

  /**
   * Shared 404 classifier (finding 9) — the SINGLE home for the reconnect message
   * string and the `drive-account-mismatch-blocked` event. Call from a caught
   * Drive 404. If the live session account is known to differ from this file's
   * bound account, that 404 means "this account can't reach the file" — log it
   * and throw the reconnect `TokenExpiredError` so the reconnect banner appears
   * for the bound account (NOT the missing-file recovery path). Otherwise return;
   * the caller re-throws the raw 404 for missing-file recovery (today's behavior).
   */
  private reconnectIfAccountMismatch(): void {
    if (!this.accountMismatch()) return;
    logEvent({
      level: 'warn',
      surface: 'drive-account-mismatch-blocked',
      message: 'Drive 404 with an account mismatch — surfacing reconnect for the bound account',
      context: { http_status: 404, action: 'reconnect-required' },
    });
    throw new TokenExpiredError(
      `Drive session account (${getGoogleAccountEmail()}) does not match this file's bound account (${this.accountEmail}) — reconnect required`
    );
  }

  /**
   * Rebind this provider to a DIFFERENT account after that account has PROVEN it
   * can access `this.fileId` (a read/write succeeded). This is the ONE safe
   * exception to finding 9's "never rebind A→B" (see `updateAccountEmailIfAvailable`):
   * a successful Drive op is proof the new account is a legitimate accessor.
   * Returns true if the binding changed. Callers MUST only invoke this after a
   * successful Drive operation.
   */
  rebindProvenAccount(verifiedEmail: string): boolean {
    if (this.accountEmail === verifiedEmail) return false;
    this.accountEmail = verifiedEmail;
    return true;
  }

  async write(content: string): Promise<void> {
    try {
      const token = await getValidTokenSilent();
      await withRetry(() => updateFile(token, this.fileId, content));
    } catch (e) {
      // 401 — server says the in-memory token is invalid. Try one silent
      // refresh in case it raced with token expiry; on failure, queue the
      // save and surface a TokenExpiredError so the reconnect banner
      // appears. Never open an unsolicited popup mid-save.
      if (e instanceof DriveApiError && e.status === 401) {
        const silentToken = await attemptSilentRefresh();
        if (silentToken) {
          await withRetry(() => updateFile(silentToken, this.fileId, content));
          return;
        }
        enqueueOfflineSave(content);
        throw new TokenExpiredError(
          'Drive write failed: token rejected and silent refresh failed; save queued offline'
        );
      }

      // Silent token path threw TokenExpiredError before any API call — queue
      // the save so it flushes when the user reconnects, then re-throw so
      // syncStore surfaces the reconnect banner.
      if (e instanceof TokenExpiredError) {
        enqueueOfflineSave(content);
        throw e;
      }

      // 404 — file gone (deleted/moved) OR the live session account can't reach
      // it. Classify (finding 9): an account mismatch → reconnect banner for the
      // bound account; otherwise let the caller run missing-file recovery.
      if (e instanceof DriveApiError && e.status === 404) {
        this.reconnectIfAccountMismatch();
        throw e;
      }

      // 5xx — all retries exhausted, queue for offline flush
      if (e instanceof DriveApiError && e.status >= 500) {
        console.warn(
          `[GoogleDriveProvider] write failed after retries (${e.status}), queueing offline`
        );
        // Console-only until now — surface Drive instability to the firehose so
        // recurring 5xx waves are visible/queryable (not lost to the console).
        logEvent({
          level: 'warn',
          surface: 'drive-write',
          message: `Drive write failed after retries (${e.status}), queued offline`,
          error: e,
          context: { http_status: e.status, action: 'queue-offline' },
        });
        enqueueOfflineSave(content);
        return;
      }

      // Network error — queue for offline flush. Uses the shared classifier so
      // Safari/iOS `TypeError: Load failed` (no "fetch" substring) is caught
      // too; the old `.includes('fetch')` missed it and the save was LOST
      // instead of queued (2026-06-19, finding 6).
      if (isNetworkError(e)) {
        enqueueOfflineSave(content);
        return;
      }

      throw e;
    }
  }

  /**
   * Read file content from Google Drive.
   * On 401: try silent refresh first, then interactive auth (consistent with write()).
   * On 5xx: retry up to 3 times with exponential backoff.
   */
  async read(): Promise<string | null> {
    try {
      /* eslint-disable no-console -- init diagnostics */
      console.log('[GoogleDrive.read] getting token...');
      const token = await getValidTokenSilent();
      console.log('[GoogleDrive.read] token obtained, reading file...');
      const result = await withRetry(() => readFile(token, this.fileId));
      console.log('[GoogleDrive.read] read complete, length=', result?.length ?? 0);
      // Fire-and-forget: don't block the read on metadata migration. Internal
      // try/catch handles its own errors.
      void this.ensureCorrectMimeType(token);
      return result;
      /* eslint-enable no-console */
    } catch (e) {
      console.warn('[GoogleDrive.read] error:', (e as Error).message);
      if (e instanceof DriveApiError && e.status === 401) {
        // Server says the token is invalid. Try one silent refresh (in case
        // the in-memory token went stale between getValidTokenSilent's
        // isTokenValid check and the actual API call). On failure, signal
        // the caller to surface the reconnect banner — do NOT open an
        // unsolicited popup.
        const silentToken = await attemptSilentRefresh();
        if (silentToken) {
          return await withRetry(() => readFile(silentToken, this.fileId));
        }
        throw new TokenExpiredError('Drive read failed: token rejected and silent refresh failed');
      }
      // 404 — file gone OR the live session account can't reach it. Classify
      // (finding 9), mirroring write(): account mismatch → reconnect banner;
      // otherwise re-throw the raw 404 for missing-file recovery (today's path).
      if (e instanceof DriveApiError && e.status === 404) {
        this.reconnectIfAccountMismatch();
        throw e;
      }
      throw e;
    }
  }

  /**
   * Get last modified time from Drive metadata (lightweight polling check).
   * Re-throws 401 errors so callers can detect auth failures.
   * Swallows network/5xx errors (transient failures are expected).
   */
  async getLastModified(): Promise<string | null> {
    try {
      const token = await getValidTokenSilent();
      return await getFileModifiedTime(token, this.fileId);
    } catch (e) {
      // TokenExpiredError or 401 — auth failure, let caller surface reconnect banner.
      // 404 — file gone (deleted/moved), let caller handle (e.g., file-not-found banner).
      if (e instanceof TokenExpiredError) throw e;
      if (e instanceof DriveApiError && (e.status === 401 || e.status === 404)) {
        throw e;
      }
      // Network errors, 5xx, and other failures — non-critical for a metadata check
      return null;
    }
  }

  /**
   * Check if we have a valid OAuth token.
   */
  async isReady(): Promise<boolean> {
    return isTokenValid();
  }

  /**
   * Request OAuth access (shows Google sign-in prompt).
   */
  async requestAccess(): Promise<boolean> {
    try {
      await requestAccessToken();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Persist provider config to IndexedDB.
   * Also clears any stale local file handle for this family so that
   * syncService.initialize() won't fall back to a previous local file.
   */
  async persist(familyId: string): Promise<void> {
    await clearFileHandleForFamily(familyId);
    await storeProviderConfig(familyId, {
      type: 'google_drive',
      driveFileId: this.fileId,
      driveFileName: this.fileName,
      driveAccountEmail: this.accountEmail ?? undefined,
    });
  }

  /**
   * Clear persisted provider config.
   */
  async clearPersisted(familyId: string): Promise<void> {
    await clearProviderConfig(familyId);
  }

  /**
   * Revoke OAuth token and clear caches.
   */
  async disconnect(): Promise<void> {
    // B: a deliberate disconnect → also drop this account's beanpod-mirrored
    // refresh token. Done HERE (a deliberate caller), NOT inside
    // clearGoogleSessionState — that shared chokepoint is also hit by the
    // transient account-mismatch correction, where deleting the shared token
    // would be wrong ("park, don't delete"). Best-effort; never throws.
    if (this.accountEmail) {
      await clearDriveConnectionForAccount(this.accountEmail);
    }
    await clearGoogleSessionState();
    clearFolderCache();
  }

  getDisplayName(): string {
    return this.fileName;
  }

  getFileId(): string | null {
    return this.fileId;
  }

  getAccountEmail(): string | null {
    return this.accountEmail;
  }

  /**
   * Drive does NOT participate in the per-tick polling loop — an HTTP call
   * to Drive every 15s is the wrong shape (cost + API quota). Drive uses
   * save-time `fetchAndMergeRemote` triggered by the syncService's debounced
   * save path. Returning false here keeps the polling watcher inactive
   * while a Drive provider is mounted.
   */
  supportsLocalPolling(): boolean {
    return false;
  }

  // ─── ADR-032 Plan B aux change-log (sibling files in the app folder) ─────────
  //
  // Best-effort by contract — the incremental transport treats ANY aux failure as
  // a whole-doc fallback (the .beanpod base is always authoritative). So these
  // reuse the same token/retry path as read/write but do not add new recovery
  // beyond the account-bound guard; a throw simply degrades to whole-doc sync.

  /** The .beanpod's parent folder = where sibling change chunks live. Cached. */
  private async resolveAuxFolder(token: string): Promise<string> {
    if (this.auxFolderId) return this.auxFolderId;
    const meta = await getFileMetadata(token, this.fileId, 'parents');
    const parent = (meta.parents as string[] | undefined)?.[0];
    if (!parent) throw new Error('[GoogleDriveProvider] .beanpod has no parent folder for aux');
    this.auxFolderId = parent;
    return parent;
  }

  async listAux(): Promise<string[]> {
    const token = await getValidTokenSilent();
    const folderId = await this.resolveAuxFolder(token);
    const files = await withRetry(() => listFilesInFolder(token, folderId, '.beanchanges'));
    this.auxIdByName = new Map(files.map((f) => [f.name, f.id]));
    return files.map((f) => f.name);
  }

  async readAux(name: string): Promise<string | null> {
    const token = await getValidTokenSilent();
    let id = this.auxIdByName.get(name);
    if (!id) {
      await this.listAux(); // refresh the name→id map (e.g. after a reload)
      id = this.auxIdByName.get(name);
    }
    if (!id) return null; // absent (pruned/never-written) → transport falls back
    return withRetry(() => readFile(token, id));
  }

  async writeAux(name: string, content: string): Promise<void> {
    const token = await getValidTokenSilent();
    const folderId = await this.resolveAuxFolder(token);
    const { fileId } = await withRetry(() => createFile(token, folderId, name, content));
    this.auxIdByName.set(name, fileId);
  }

  async deleteAux(name: string): Promise<void> {
    const token = await getValidTokenSilent();
    let id = this.auxIdByName.get(name);
    if (!id) {
      await this.listAux();
      id = this.auxIdByName.get(name);
    }
    if (!id) return; // already gone — delete is idempotent
    await withRetry(() => deleteFile(token, id));
    this.auxIdByName.delete(name);
  }

  /**
   * Create a new .beanpod file on Google Drive.
   * Authenticates, creates/finds the app folder, and creates the file.
   *
   * `forceConsent` (default `true`) re-prompts the Google account chooser so
   * a brand-new family is created under an explicitly-picked account. Pass
   * `false` when an account is already established this session (e.g. moving
   * an existing pod to Drive) — that reuses the cached token, which avoids a
   * redirect-auth loop on standalone PWAs (`prompt=consent` forces the
   * redirect path even when a token is cached).
   */
  static async createNew(
    fileName: string,
    opts: { forceConsent?: boolean } = {}
  ): Promise<GoogleDriveProvider> {
    // Clear cached folder ID — prevents cross-account folder leak when switching Google accounts
    clearFolderCache();

    const token = await requestAccessToken({ forceConsent: opts.forceConsent ?? true });

    // Capture account email (best-effort, non-blocking for provider creation)
    const email = await fetchGoogleUserEmail(token);

    const folderId = await getOrCreateAppFolder(token);

    // Collision check before creating — Drive happily allows multiple files
    // with the same name in the same folder (different fileIds), which is
    // how the 2026-05-15 incident orphaned a real pod with an empty
    // duplicate. If a file with this name already exists, throw a typed
    // error carrying `ownedByMe` so the caller's adopt-existing recovery can
    // load the user's own orphan (2026-06-19, finding 1) or, for a different
    // account, surface the focused "duplicate name" message.
    //
    // A list FAILURE is NOT swallowed (2026-06-19, finding 5): we genuinely
    // don't know whether a same-name file exists, and creating blindly risks a
    // SECOND orphan `.beanpod`. Throw a typed `CollisionCheckUnavailableError`
    // so the caller surfaces a retryable "couldn't verify your Drive" message.
    let existing;
    try {
      existing = await listBeanpodFiles(token, folderId);
    } catch (e) {
      console.warn('[GoogleDriveProvider.createNew] pre-create collision check failed:', e);
      throw new CollisionCheckUnavailableError(
        'Could not verify your Google Drive for existing family files. Please try again.'
      );
    }
    const collision = existing.find((f) => f.name === fileName);
    if (collision) {
      throw new FileNameCollisionError(
        `A .beanpod file named "${fileName}" already exists in this Google Drive folder (fileId: ${collision.fileId})`,
        collision.fileId,
        fileName,
        collision.ownedByMe
      );
    }

    const { fileId, name } = await createFile(token, folderId, fileName, '{}');
    // Flush-provider registration is owned by `syncService.setProvider` (the
    // single write-intent install seam, 2026-06-19 finding 11) — NOT here, so
    // a read-only build can never auto-flush stale bytes into a file it only
    // meant to inspect. Every createNew caller calls setProvider immediately.
    return new GoogleDriveProvider(fileId, name, email);
  }

  /**
   * Create a provider for an existing Drive file (e.g. restored from config or file picker).
   * Token is acquired on demand when read/write are called.
   */
  static fromExisting(
    fileId: string,
    fileName: string,
    accountEmail?: string | null
  ): GoogleDriveProvider {
    // Use persisted email, or fall back to in-memory cache from current session
    const email = accountEmail ?? getGoogleAccountEmail();
    if (email) setGoogleAccountEmail(email);
    // No `setFlushProvider` here (2026-06-19, finding 11): `fromExisting` is used
    // by READ-only resume/recovery paths (loadFromGoogleDrive, recoverFromMissingFile)
    // that must NOT register a flush target — otherwise inspecting a file could
    // auto-flush stale queued bytes INTO it. Write-intent callers go through
    // `syncService.setProvider`, which owns flush registration.
    return new GoogleDriveProvider(fileId, fileName, email);
  }
}
