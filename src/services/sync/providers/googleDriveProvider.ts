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
import {
  readFile,
  updateFile,
  getFileModifiedTime,
  getOrCreateAppFolder,
  createFile,
  clearFolderCache,
  DriveApiError,
} from '@/services/google/driveService';
import { enqueueOfflineSave, setFlushProvider } from '../offlineQueue';

/** Retry a Drive API call with exponential backoff on 5xx errors. */
async function withRetry<T>(fn: () => Promise<T>, maxRetries = 3): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastError = e;
      const isRetryable = e instanceof DriveApiError && (e.status >= 500 || e.status === 408);
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

  constructor(fileId: string, fileName: string, accountEmail?: string | null) {
    this.fileId = fileId;
    this.fileName = fileName;
    this.accountEmail = accountEmail ?? null;
  }

  /**
   * Write content to Google Drive.
   * On 401: try silent refresh first, then interactive auth, then throw.
   * On 5xx: retry up to 3 times with exponential backoff.
   * On network error: queue for offline flush.
   */
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

      // 404 — file gone (deleted/moved), let caller handle
      if (e instanceof DriveApiError && e.status === 404) {
        throw e;
      }

      // 5xx — all retries exhausted, queue for offline flush
      if (e instanceof DriveApiError && e.status >= 500) {
        console.warn(
          `[GoogleDriveProvider] write failed after retries (${e.status}), queueing offline`
        );
        enqueueOfflineSave(content);
        return;
      }

      // Network error — queue for offline flush
      if (e instanceof TypeError && e.message.includes('fetch')) {
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
   * Check if Google account email has become available (e.g. after token acquisition)
   * and update the in-memory state. Returns true if email changed.
   */
  updateAccountEmailIfAvailable(): boolean {
    const email = getGoogleAccountEmail();
    if (email && email !== this.accountEmail) {
      this.accountEmail = email;
      return true;
    }
    return false;
  }

  /**
   * Create a new .beanpod file on Google Drive.
   * Authenticates, creates/finds the app folder, and creates the file.
   */
  static async createNew(fileName: string): Promise<GoogleDriveProvider> {
    // Clear cached folder ID — prevents cross-account folder leak when switching Google accounts
    clearFolderCache();

    // Always force fresh consent for new family creation to ensure all scopes are granted
    const token = await requestAccessToken({ forceConsent: true });

    // Capture account email (best-effort, non-blocking for provider creation)
    const email = await fetchGoogleUserEmail(token);

    const folderId = await getOrCreateAppFolder(token);
    const { fileId, name } = await createFile(token, folderId, fileName, '{}');
    const provider = new GoogleDriveProvider(fileId, name, email);

    // Register as flush target for offline queue
    setFlushProvider(provider);

    return provider;
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
    const provider = new GoogleDriveProvider(fileId, fileName, email);
    setFlushProvider(provider);
    return provider;
  }
}
