import { openDB, type IDBPDatabase } from 'idb';
import { getActiveFamilyId } from '@/services/indexeddb/database';
import type { StorageProviderType } from './storageProvider';

const HANDLE_DB_NAME = 'gp-finance-file-handles';
const HANDLE_DB_VERSION = 1;
const HANDLE_STORE = 'handles';
const LEGACY_SYNC_FILE_KEY = 'syncFile';

// Provider config persistence — stores which backend a family uses
export interface PersistedProviderConfig {
  type: StorageProviderType;
  driveFileId?: string;
  driveFileName?: string;
}

interface HandleDB {
  handles: {
    key: string;
    value: FileSystemFileHandle;
  };
}

let handleDb: IDBPDatabase<HandleDB> | null = null;

async function getHandleDatabase(): Promise<IDBPDatabase<HandleDB>> {
  if (handleDb) {
    return handleDb;
  }

  handleDb = await openDB<HandleDB>(HANDLE_DB_NAME, HANDLE_DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(HANDLE_STORE)) {
        db.createObjectStore(HANDLE_STORE);
      }
    },
  });

  return handleDb;
}

/**
 * Get the storage key for the current family's sync file handle.
 * Falls back to legacy key if no family is active.
 */
function getSyncFileKey(): string {
  const familyId = getActiveFamilyId();
  return familyId ? `syncFile-${familyId}` : LEGACY_SYNC_FILE_KEY;
}

/**
 * Store a file handle for later retrieval
 */
export async function storeFileHandle(handle: FileSystemFileHandle): Promise<void> {
  const db = await getHandleDatabase();
  await db.put(HANDLE_STORE, handle, getSyncFileKey());
}

/**
 * Retrieve the stored file handle for the current family.
 * Only returns a handle stored under the family-specific key.
 */
export async function getFileHandle(): Promise<FileSystemFileHandle | null> {
  try {
    const db = await getHandleDatabase();
    const key = getSyncFileKey();
    const handle = await db.get(HANDLE_STORE, key);
    console.log('[fileHandleStore] getFileHandle key:', key, 'found:', !!handle);
    return handle ?? null;
  } catch {
    return null;
  }
}

/**
 * Migrate the legacy sync file handle to a specific family.
 * Called during legacy DB migration only.
 */
export async function migrateLegacyFileHandle(familyId: string): Promise<void> {
  try {
    const db = await getHandleDatabase();
    const legacyHandle = await db.get(HANDLE_STORE, LEGACY_SYNC_FILE_KEY);
    if (legacyHandle) {
      await db.put(HANDLE_STORE, legacyHandle, `syncFile-${familyId}`);
      await db.delete(HANDLE_STORE, LEGACY_SYNC_FILE_KEY);
    }
  } catch {
    // Non-critical — sync can be reconfigured manually
  }
}

/**
 * Clear the stored file handle
 */
export async function clearFileHandle(): Promise<void> {
  const db = await getHandleDatabase();
  await db.delete(HANDLE_STORE, getSyncFileKey());
}

/**
 * Clear the stored file handle for a specific family by ID.
 * Used when switching providers (e.g. local → Google Drive) to prevent
 * stale local handles from being restored on page refresh.
 */
export async function clearFileHandleForFamily(familyId: string): Promise<void> {
  const db = await getHandleDatabase();
  await db.delete(HANDLE_STORE, `syncFile-${familyId}`);
}

/**
 * Check if we have permission to read/write the file
 */
export async function verifyPermission(
  handle: FileSystemFileHandle,
  mode: 'read' | 'readwrite' = 'readwrite'
): Promise<boolean> {
  const options = { mode };

  // Check if permission is already granted
  if ((await handle.queryPermission(options)) === 'granted') {
    return true;
  }

  // Request permission from user
  if ((await handle.requestPermission(options)) === 'granted') {
    return true;
  }

  return false;
}

/**
 * Check if we have a stored handle and permission to use it
 */
export async function hasValidFileHandle(): Promise<boolean> {
  const handle = await getFileHandle();
  if (!handle) {
    return false;
  }

  // Just check if permission is granted (don't request)
  try {
    const permission = await handle.queryPermission({ mode: 'readwrite' });
    return permission === 'granted';
  } catch {
    return false;
  }
}

// --- Provider config persistence ---

/**
 * Store provider config for a family (e.g. google_drive with fileId)
 */
export async function storeProviderConfig(
  familyId: string,
  config: PersistedProviderConfig
): Promise<void> {
  const db = await getHandleDatabase();
  await db.put(
    HANDLE_STORE,
    config as unknown as FileSystemFileHandle,
    `providerConfig-${familyId}`
  );
}

/**
 * Retrieve the stored provider config for a family
 */
export async function getProviderConfig(familyId: string): Promise<PersistedProviderConfig | null> {
  try {
    const db = await getHandleDatabase();
    const config = await db.get(HANDLE_STORE, `providerConfig-${familyId}`);
    if (config && typeof config === 'object' && 'type' in config) {
      return config as unknown as PersistedProviderConfig;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Clear the stored provider config for a family
 */
export async function clearProviderConfig(familyId: string): Promise<void> {
  const db = await getHandleDatabase();
  await db.delete(HANDLE_STORE, `providerConfig-${familyId}`);
}
