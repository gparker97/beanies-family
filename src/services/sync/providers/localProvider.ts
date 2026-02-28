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
   */
  async write(content: string): Promise<void> {
    const writable = await this.handle.createWritable({ keepExistingData: false });
    const contentBytes = new TextEncoder().encode(content);
    await writable.write({ type: 'seek', position: 0 });
    await writable.write(contentBytes);
    await writable.truncate(contentBytes.byteLength);
    await writable.close();
  }

  /**
   * Read content from the local file.
   * Returns null if file is empty or missing.
   */
  async read(): Promise<string | null> {
    const file = await this.handle.getFile();
    const text = await file.text();
    if (!text.trim()) return null;
    return text;
  }

  /**
   * Get the file's last-modified timestamp (lightweight polling check).
   * Uses File.lastModified (OS metadata, no I/O) instead of reading
   * and parsing the full JSON content on every poll cycle.
   */
  async getLastModified(): Promise<string | null> {
    try {
      const hasPermission = await this.isReady();
      if (!hasPermission) return null;

      const file = await this.handle.getFile();
      if (file.size === 0) return null;

      // file.lastModified is a Unix timestamp in milliseconds (OS metadata)
      return new Date(file.lastModified).toISOString();
    } catch {
      return null;
    }
  }

  /**
   * Check if we have readwrite permission on the file handle.
   */
  async isReady(): Promise<boolean> {
    try {
      const permission = await this.handle.queryPermission({ mode: 'readwrite' });
      return permission === 'granted';
    } catch {
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
