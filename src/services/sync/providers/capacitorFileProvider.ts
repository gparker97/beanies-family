/**
 * CapacitorFileProvider — local `.beanpod` storage for the native (Capacitor)
 * app, via `@capacitor/filesystem`.
 *
 * The web `LocalStorageProvider` holds a `FileSystemFileHandle` (File System
 * Access API, Chromium-only — absent in a WebView). Native has no handle: it
 * reads/writes by path under an app-private directory (`Directory.Data`). Rather
 * than wedge two transports into one class, this is a sibling implementation of
 * the same `StorageProvider` contract, so the sync engine stays backend-agnostic
 * (no engine changes). Restore is config-based (the persisted `localPath`), not
 * handle-based. The `@capacitor/filesystem` import is confined to this module.
 * See ADR-029.
 *
 * v1 scope: one app-private local pod per install (Directory.Data). Multi-family
 * local pods on one device are an edge case — those users use Google Drive (which
 * also gives cross-device sync); documented as a follow-up.
 */
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import type { StorageProvider } from '../storageProvider';
import { storeProviderConfig, clearProviderConfig } from '../fileHandleStore';
import { classifyFileError } from './localProvider';
import { reportError } from '@/utils/errorReporter';

const STORAGE_DIRECTORY = Directory.Data;

/** Whether a Capacitor Filesystem error means "file isn't there yet" (a brand-new
 *  pod before its first write) — treated as empty, not an error. */
function isFileNotFound(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return /does not exist|not found|no such file|ENOENT/i.test(msg);
}

export class CapacitorFileProvider implements StorageProvider {
  readonly type = 'local' as const;
  private readonly path: string;

  constructor(path: string) {
    this.path = path;
  }

  /** Write content to the app-private file (creates parent dirs if needed). */
  async write(content: string): Promise<void> {
    try {
      await Filesystem.writeFile({
        path: this.path,
        directory: STORAGE_DIRECTORY,
        data: content,
        encoding: Encoding.UTF8,
        recursive: true,
      });
    } catch (e) {
      this.reportFileError(e, 'write');
      throw e;
    }
  }

  /** Read content; null if the file doesn't exist yet (new pod) or is empty. */
  async read(): Promise<string | null> {
    try {
      const res = await Filesystem.readFile({
        path: this.path,
        directory: STORAGE_DIRECTORY,
        encoding: Encoding.UTF8,
      });
      // With an encoding set, `data` is a string (Blob only when omitted).
      const text = typeof res.data === 'string' ? res.data : await res.data.text();
      return text.trim() ? text : null;
    } catch (e) {
      if (isFileNotFound(e)) return null; // brand-new pod — no file written yet
      this.reportFileError(e, 'read');
      throw e;
    }
  }

  /**
   * Report a read/write failure through the SAME classifier + Slack surface the
   * web provider uses, so telemetry stays one coherent `local-file` bucket. (No
   * handle to clear on native; the FSA-specific verdict.clearHandle is moot.)
   */
  private reportFileError(e: unknown, action: 'read' | 'write'): void {
    const verdict = classifyFileError(e);
    console.warn(`[CapacitorFileProvider] ${action} failed (${verdict.kind})`, e);
    reportError({
      surface: 'local-file',
      message: `${action} failed (${verdict.kind})`,
      error: e,
      severity: verdict.severity,
      context: { action, platform: 'native' },
    });
  }

  /** Last-modified for the poll loop; null on any failure (safe "no change"). */
  async getLastModified(): Promise<string | null> {
    try {
      const st = await Filesystem.stat({ path: this.path, directory: STORAGE_DIRECTORY });
      return new Date(st.mtime).toISOString();
    } catch (e) {
      console.warn('[CapacitorFileProvider] getLastModified failed (poll-tick)', e);
      return null;
    }
  }

  /** App-private storage is always accessible — no permission prompt. */
  async isReady(): Promise<boolean> {
    return true;
  }

  /** No permission to request for app-private storage. */
  async requestAccess(): Promise<boolean> {
    return true;
  }

  /** Persist the restore pointer: the path lives in the provider config (there
   *  is no `FileSystemFileHandle` to store on native). */
  async persist(familyId: string): Promise<void> {
    await storeProviderConfig(familyId, { type: 'local', localPath: this.path });
  }

  async clearPersisted(familyId: string): Promise<void> {
    await clearProviderConfig(familyId);
  }

  async disconnect(): Promise<void> {
    // Nothing to release — path-based, no open handle.
  }

  getDisplayName(): string {
    return this.path.split('/').pop() ?? this.path;
  }

  getFileId(): string | null {
    return null;
  }

  getAccountEmail(): string | null {
    return null;
  }

  /** No external writer for an app-private file → no poll loop needed. (The web
   *  provider polls because the file may be synced by Dropbox/iCloud/OneDrive.) */
  supportsLocalPolling(): boolean {
    return false;
  }

  /** Reconstruct from a persisted path (cold-boot restore in syncService). */
  static fromPath(path: string): CapacitorFileProvider {
    return new CapacitorFileProvider(path);
  }
}
