/**
 * StorageProvider interface — abstracts file storage backends.
 *
 * Both local filesystem (File System Access API) and Google Drive
 * implement this interface, making the sync engine backend-agnostic.
 */
export interface StorageProvider {
  /** Provider type identifier */
  readonly type: 'local' | 'google_drive';

  /** Write content to the storage backend */
  write(content: string): Promise<void>;

  /** Read content from the storage backend. Returns null if file is empty or missing. */
  read(): Promise<string | null>;

  /** Get last-modified timestamp (lightweight check for polling). Returns ISO string or null. */
  getLastModified(): Promise<string | null>;

  /** Check if the provider is ready (has permission / valid token) */
  isReady(): Promise<boolean>;

  /** Request access from the user (permission prompt or OAuth). Must be called from user gesture. */
  requestAccess(): Promise<boolean>;

  /** Persist provider config to IndexedDB for session restore */
  persist(familyId: string): Promise<void>;

  /** Clear persisted provider config from IndexedDB */
  clearPersisted(familyId: string): Promise<void>;

  /** Clean up provider resources */
  disconnect(): Promise<void>;

  /** Human-readable display name (filename or "Google Drive") */
  getDisplayName(): string;

  /** Google Drive file ID, or null for local provider */
  getFileId(): string | null;

  /** Cloud account email (e.g. Google account), or null for local/unknown */
  getAccountEmail(): string | null;

  /**
   * Whether this provider can detect external changes via inexpensive local
   * polling. Implementations returning `true` opt into the per-tick
   * `fetchAndMergeRemote` loop — the sync engine wires up a
   * `usePollWhileVisible` watcher when such a provider becomes active.
   *
   * `LocalStorageProvider` returns true (FSA `getLastModified()` is O(1) OS
   * metadata, cheap to poll). `GoogleDriveProvider` returns false (an HTTP
   * call every 15s is the wrong shape for Drive — it uses save-time
   * `fetchAndMergeRemote` instead). Optional method; treat absent as false.
   */
  supportsLocalPolling?(): boolean;

  // ─── Plan B (ADR-032) incremental change-log — optional multi-object API ─────
  //
  // A provider that can store sibling objects beside the `.beanpod` (Google Drive
  // app-folder files, a local sibling directory) implements ALL FOUR to opt into
  // incremental delta sync. A provider missing any of them stays whole-doc-only
  // (graceful, logged degradation) — `getAuxStore()` returns null for it.

  /** List the names of every aux object (change-log chunks) for this family. */
  listAux?(): Promise<string[]>;
  /** Read one aux object's content, or null if absent (pruned/never-written). */
  readAux?(name: string): Promise<string | null>;
  /** Create/overwrite one aux object (chunks are immutable — name never reused). */
  writeAux?(name: string, content: string): Promise<void>;
  /** Delete one aux object (compaction). A no-op if already absent. */
  deleteAux?(name: string): Promise<void>;
}

export type StorageProviderType = StorageProvider['type'];

/** The four aux methods bound together, or null if the provider is whole-doc-only. */
export interface AuxStore {
  list(): Promise<string[]>;
  read(name: string): Promise<string | null>;
  write(name: string, content: string): Promise<void>;
  delete(name: string): Promise<void>;
}

/** Bind a provider's optional aux methods into an `AuxStore`, or null if it
 * doesn't implement the full set (→ the family stays on the whole-doc path). */
export function getAuxStore(p: StorageProvider): AuxStore | null {
  if (p.listAux && p.readAux && p.writeAux && p.deleteAux) {
    return {
      list: () => p.listAux!(),
      read: (name) => p.readAux!(name),
      write: (name, content) => p.writeAux!(name, content),
      delete: (name) => p.deleteAux!(name),
    };
  }
  return null;
}
