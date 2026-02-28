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
}

export type StorageProviderType = StorageProvider['type'];
