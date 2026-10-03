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
import { logEvent } from '@/services/telemetry/logEvent';

const STORAGE_DIRECTORY = Directory.Data;

/**
 * Is this a COMPLETE envelope, as far as a cheap structural check can tell? Used only to
 * decide whether a leftover `.tmp` is a finished write that never got renamed (prefer it)
 * or a torn one (ignore it). The real validation is `parseBeanpodV4`, downstream.
 */
function isCompleteEnvelope(text: string): boolean {
  try {
    const obj = JSON.parse(text) as { encryptedPayload?: unknown; familyId?: unknown };
    return (
      typeof obj === 'object' &&
      obj !== null &&
      typeof obj.familyId === 'string' &&
      typeof obj.encryptedPayload === 'string' &&
      obj.encryptedPayload.length > 0
    );
  } catch {
    return false;
  }
}

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

  private get tmpPath(): string {
    return `${this.path}.tmp`;
  }

  /**
   * Write content to the app-private file (creates parent dirs if needed).
   *
   * ⚠️ WRITE-THEN-RENAME (audit C13). A single `writeFile` over the pod is not atomic: an
   * app kill or a full disk mid-write leaves a TORN file, which the next read parses as
   * corrupt — and the corrupt-payload refusal then blocks the very save that would repair
   * it. Writing the whole envelope to `<path>.tmp` and renaming it over the target means
   * the target is always either the old complete file or the new complete file.
   */
  async write(content: string): Promise<void> {
    try {
      await Filesystem.writeFile({
        path: this.tmpPath,
        directory: STORAGE_DIRECTORY,
        data: content,
        encoding: Encoding.UTF8,
        recursive: true,
      });
      try {
        await Filesystem.rename({
          from: this.tmpPath,
          to: this.path,
          directory: STORAGE_DIRECTORY,
        });
      } catch (renameErr) {
        // Some platform versions refuse to rename over an existing file. Remove the target
        // and rename again; the `.tmp` is complete, and `read()` prefers it if we die in
        // between, so no window here loses the write.
        logEvent({
          level: 'info',
          surface: 'local-file',
          message: 'rename over the pod refused; replacing the target',
          context: {
            action: 'tmp-rename-retry',
            error_code: renameErr instanceof Error ? renameErr.name : 'unknown',
          },
        });
        await Filesystem.deleteFile({ path: this.path, directory: STORAGE_DIRECTORY }).catch(
          (delErr: unknown) => {
            if (!isFileNotFound(delErr)) throw delErr;
          }
        );
        await Filesystem.rename({
          from: this.tmpPath,
          to: this.path,
          directory: STORAGE_DIRECTORY,
        });
      }
    } catch (e) {
      this.reportFileError(e, 'write');
      throw e;
    }
  }

  /** One file's text; null when it does not exist or is blank. Throws other failures. */
  private async readText(path: string): Promise<string | null> {
    try {
      const res = await Filesystem.readFile({
        path,
        directory: STORAGE_DIRECTORY,
        encoding: Encoding.UTF8,
      });
      // With an encoding set, `data` is a string (Blob only when omitted).
      const text = typeof res.data === 'string' ? res.data : await res.data.text();
      return text.trim() ? text : null;
    } catch (e) {
      if (isFileNotFound(e)) return null;
      throw e;
    }
  }

  /**
   * A leftover `.tmp` is a write that never got renamed. Complete: it is the NEWEST data
   * (every later write would have replaced and renamed it), so prefer it and promote it.
   * Torn: the target is the last complete write; ignore the `.tmp`. Never throws.
   */
  private async readLeftoverTmp(): Promise<string | null> {
    let tmp: string | null;
    try {
      tmp = await this.readText(this.tmpPath);
    } catch (e) {
      logEvent({
        level: 'warn',
        surface: 'local-file',
        message: 'leftover .tmp could not be read; using the pod file',
        context: { action: 'tmp-read-failed', error_code: e instanceof Error ? e.name : 'unknown' },
      });
      return null;
    }
    if (tmp === null) return null;
    if (!isCompleteEnvelope(tmp)) {
      logEvent({
        level: 'warn',
        surface: 'local-file',
        message: 'torn .tmp ignored; using the last complete pod file',
        context: { action: 'tmp-torn-ignored' },
      });
      return null;
    }
    logEvent({
      level: 'warn',
      surface: 'local-file',
      message: 'complete .tmp preferred over the pod file (write was not renamed)',
      context: { action: 'tmp-preferred' },
    });
    // Best-effort promotion; the next write renames over it anyway.
    await Filesystem.rename({
      from: this.tmpPath,
      to: this.path,
      directory: STORAGE_DIRECTORY,
    }).catch((e: unknown) =>
      logEvent({
        level: 'info',
        surface: 'local-file',
        message: 'could not promote the .tmp; it is still preferred on read',
        context: {
          action: 'tmp-promote-failed',
          error_code: e instanceof Error ? e.name : 'unknown',
        },
      })
    );
    return tmp;
  }

  /** Read content; null if the file doesn't exist yet (new pod) or is empty. */
  async read(): Promise<string | null> {
    const fromTmp = await this.readLeftoverTmp();
    if (fromTmp !== null) return fromTmp;
    try {
      return await this.readText(this.path); // null: brand-new pod, no file written yet
    } catch (e) {
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
