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
  getValidToken,
  isTokenValid,
  revokeToken,
  loadGIS,
  requestAccessToken,
  fetchGoogleUserEmail,
  getGoogleAccountEmail,
  setGoogleAccountEmail,
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
   * On 401: refresh token and retry once.
   * On network error: queue for offline flush.
   */
  async write(content: string): Promise<void> {
    try {
      const token = await getValidToken();
      await updateFile(token, this.fileId, content);
    } catch (e) {
      // 401 — token expired, refresh and retry
      if (e instanceof DriveApiError && e.status === 401) {
        const newToken = await requestAccessToken();
        await updateFile(newToken, this.fileId, content);
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
   */
  async read(): Promise<string | null> {
    try {
      const token = await getValidToken();
      return await readFile(token, this.fileId);
    } catch (e) {
      if (e instanceof DriveApiError && e.status === 401) {
        const newToken = await requestAccessToken();
        return await readFile(newToken, this.fileId);
      }
      throw e;
    }
  }

  /**
   * Get last modified time from Drive metadata (lightweight polling check).
   */
  async getLastModified(): Promise<string | null> {
    try {
      const token = await getValidToken();
      return await getFileModifiedTime(token, this.fileId);
    } catch {
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
      await loadGIS();
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
    revokeToken();
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
   * Create a new .beanpod file on Google Drive.
   * Authenticates, creates/finds the app folder, and creates the file.
   */
  static async createNew(fileName: string): Promise<GoogleDriveProvider> {
    await loadGIS();
    const token = await requestAccessToken();

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
