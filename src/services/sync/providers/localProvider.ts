/**
 * LocalStorageProvider — wraps FileSystemFileHandle for local file storage.
 *
 * Extracts all filesystem-specific logic from syncService.ts so the sync
 * engine can work with any StorageProvider implementation.
 */
import type { StorageProvider } from '../storageProvider';
import {
  storeFileHandle,
  clearFileHandle,
  clearProviderConfig,
  verifyPermission,
} from '../fileHandleStore';
import { reportError } from '@/utils/errorReporter';

/**
 * Classify a raw error from the File System Access API into a structured
 * verdict so `read()` and `write()` handle errors identically. Single source
 * of truth for the mapping — adding a new error type means updating the
 * table here and the test table; no drift between read and write paths.
 *
 * Returns a discriminated union (kind + userMessageKey + clearHandle +
 * severity), not an Error subclass — easier to test, no `instanceof`
 * brittleness, and the original error still propagates to the caller via
 * the surrounding throw.
 */
export type FileErrorKind = 'permission' | 'quota' | 'stale' | 'corrupted' | 'unknown';

export interface FileErrorVerdict {
  kind: FileErrorKind;
  userMessageKey: string;
  clearHandle: boolean;
  severity: 'warning' | 'error';
}

export function classifyFileError(e: unknown): FileErrorVerdict {
  const name = e instanceof Error ? e.name : '';
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return {
        kind: 'permission',
        userMessageKey: 'storage.localFilePermissionLost',
        clearHandle: true,
        severity: 'error',
      };
    case 'QuotaExceededError':
      return {
        kind: 'quota',
        userMessageKey: 'storage.localFileDiskFull',
        clearHandle: false,
        severity: 'warning',
      };
    case 'InvalidStateError':
    case 'NotFoundError':
      // File moved, deleted, or renamed since the handle was acquired —
      // user-action is the same as permission (re-select file).
      return {
        kind: 'stale',
        userMessageKey: 'storage.localFilePermissionLost',
        clearHandle: true,
        severity: 'error',
      };
    case 'DataError':
      return {
        kind: 'corrupted',
        userMessageKey: 'storage.localFileCorrupted',
        clearHandle: false,
        severity: 'warning',
      };
    default:
      return {
        kind: 'unknown',
        userMessageKey: 'storage.localFileWriteFailed',
        clearHandle: false,
        severity: 'warning',
      };
  }
}

export class LocalStorageProvider implements StorageProvider {
  readonly type = 'local' as const;
  private handle: FileSystemFileHandle;

  constructor(handle: FileSystemFileHandle) {
    this.handle = handle;
  }

  /**
   * Write content to the local file atomically.
   * Mirrors the original doSave() write sequence:
   * 1. Seek to position 0
   * 2. Write full content
   * 3. Truncate to exact length (removes stale trailing bytes)
   *
   * Errors are classified via `classifyFileError` (permission/quota/stale/
   * corrupted/unknown) and reported via `reportError` so they surface in
   * Slack telemetry. The handle is cleared from IndexedDB when the verdict
   * says so (e.g. permission revoked, file deleted) so the next session
   * re-prompts the user instead of failing again. The original error is
   * re-thrown so upstream save logic can surface its toast.
   */
  async write(content: string): Promise<void> {
    try {
      const writable = await this.handle.createWritable({ keepExistingData: false });
      const contentBytes = new TextEncoder().encode(content);
      await writable.write({ type: 'seek', position: 0 });
      await writable.write(contentBytes);
      await writable.truncate(contentBytes.byteLength);
      await writable.close();
    } catch (e) {
      await this.handleFileError(e, 'write');
      throw e;
    }
  }

  /**
   * Read content from the local file.
   * Returns null if file is empty or missing.
   * Errors classified + reported identically to `write()` — see that doc.
   */
  async read(): Promise<string | null> {
    try {
      const file = await this.handle.getFile();
      const text = await file.text();
      if (!text.trim()) return null;
      return text;
    } catch (e) {
      await this.handleFileError(e, 'read');
      throw e;
    }
  }

  /**
   * Single error-handling path for read/write. Reports to Slack via
   * errorReporter (which also feeds the Slack `#beanies-errors` channel),
   * clears the IndexedDB handle when the verdict requires re-selection.
   */
  private async handleFileError(e: unknown, action: 'read' | 'write'): Promise<void> {
    const verdict = classifyFileError(e);
    const errName = e instanceof Error ? e.name : 'unknown';
    console.warn(`[LocalStorageProvider] ${action} failed (${verdict.kind}, ${errName})`, e);
    reportError({
      surface: 'local-file',
      message: `${action} failed (${verdict.kind})`,
      error: e,
      severity: verdict.severity,
      context: { action },
    });
    if (verdict.clearHandle) {
      try {
        await clearFileHandle();
      } catch (clearErr) {
        // Even handle-clear can fail (IndexedDB locked, quota). Log and
        // continue — the original error is more important to surface.
        console.warn('[LocalStorageProvider] clearFileHandle after error also failed', clearErr);
      }
    }
  }

  /**
   * Get the file's last-modified timestamp (lightweight polling check).
   * Uses File.lastModified (OS metadata, no I/O) instead of reading
   * and parsing the full JSON content on every poll cycle.
   *
   * Returns null on failure (caller treats null as "no change detected"
   * — safe default for polling). Failure is logged but NOT reported via
   * Slack: a poll-tick miss is uninteresting telemetry, and a transient
   * filesystem hiccup mid-poll would otherwise spam the channel.
   */
  async getLastModified(): Promise<string | null> {
    try {
      const hasPermission = await this.isReady();
      if (!hasPermission) return null;

      const file = await this.handle.getFile();
      if (file.size === 0) return null;

      // file.lastModified is a Unix timestamp in milliseconds (OS metadata)
      return new Date(file.lastModified).toISOString();
    } catch (e) {
      console.warn('[LocalStorageProvider] getLastModified failed (poll-tick)', e);
      return null;
    }
  }

  /**
   * Check if we have readwrite permission on the file handle.
   * Returns false on failure — caller treats this as "no permission yet"
   * and either re-prompts or skips the operation. Logged because a query
   * failing here usually means the handle is stale; surfacing it helps
   * debugging. Not reported to Slack: queryPermission is a hot path.
   */
  async isReady(): Promise<boolean> {
    try {
      const permission = await this.handle.queryPermission({ mode: 'readwrite' });
      return permission === 'granted';
    } catch (e) {
      console.warn('[LocalStorageProvider] queryPermission failed', e);
      return false;
    }
  }

  /**
   * Request readwrite permission from the user. Must be called from a user gesture.
   */
  async requestAccess(): Promise<boolean> {
    return verifyPermission(this.handle, 'readwrite');
  }

  /**
   * Store the file handle in IndexedDB for session restore.
   * Also clears any stale Google Drive provider config for this family
   * so that syncService.initialize() won't restore the wrong provider.
   */
  async persist(familyId: string): Promise<void> {
    await clearProviderConfig(familyId);
    await storeFileHandle(this.handle);
  }

  /**
   * Clear the stored file handle from IndexedDB.
   */
  async clearPersisted(_familyId: string): Promise<void> {
    await clearFileHandle();
  }

  /**
   * No cleanup needed for local provider.
   */
  async disconnect(): Promise<void> {
    // Nothing to clean up — handle is just released
  }

  /**
   * Return the file name.
   */
  getDisplayName(): string {
    return this.handle.name;
  }

  /**
   * Local files don't have a Drive file ID.
   */
  getFileId(): string | null {
    return null;
  }

  /**
   * Local files don't have an associated cloud account email.
   */
  getAccountEmail(): string | null {
    return null;
  }

  /**
   * Get the underlying FileSystemFileHandle.
   * Needed for passkey PRF flow (reads encrypted blob from file).
   */
  getHandle(): FileSystemFileHandle {
    return this.handle;
  }

  /**
   * Create a provider from the file open picker.
   */
  static async fromPicker(): Promise<LocalStorageProvider | null> {
    try {
      const handles = await window.showOpenFilePicker({ multiple: false });
      const handle = handles[0];
      if (!handle) return null;
      return new LocalStorageProvider(handle);
    } catch (e) {
      if ((e as Error).name === 'AbortError') return null;
      throw e;
    }
  }

  /**
   * Create a provider from the save file picker.
   */
  static async fromSavePicker(
    suggestedName = 'my-family.beanpod'
  ): Promise<LocalStorageProvider | null> {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName,
        types: [
          {
            description: 'beanies.family Data File',
            accept: { 'application/json': ['.beanpod', '.json'] },
          },
        ],
      });
      return new LocalStorageProvider(handle);
    } catch (e) {
      if ((e as Error).name === 'AbortError') return null;
      throw e;
    }
  }

  /**
   * Create a provider from an existing file handle (e.g., restored from IndexedDB or drag-drop).
   */
  static fromHandle(handle: FileSystemFileHandle): LocalStorageProvider {
    return new LocalStorageProvider(handle);
  }
}
