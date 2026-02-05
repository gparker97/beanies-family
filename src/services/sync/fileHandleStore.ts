import { openDB, type IDBPDatabase } from 'idb';

const HANDLE_DB_NAME = 'gp-finance-file-handles';
const HANDLE_DB_VERSION = 1;
const HANDLE_STORE = 'handles';
const SYNC_FILE_KEY = 'syncFile';

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
 * Store a file handle for later retrieval
 */
export async function storeFileHandle(handle: FileSystemFileHandle): Promise<void> {
  const db = await getHandleDatabase();
  await db.put(HANDLE_STORE, handle, SYNC_FILE_KEY);
}

/**
 * Retrieve the stored file handle
 */
export async function getFileHandle(): Promise<FileSystemFileHandle | null> {
  try {
    const db = await getHandleDatabase();
    const handle = await db.get(HANDLE_STORE, SYNC_FILE_KEY);
    return handle ?? null;
  } catch {
    return null;
  }
}

/**
 * Clear the stored file handle
 */
export async function clearFileHandle(): Promise<void> {
  const db = await getHandleDatabase();
  await db.delete(HANDLE_STORE, SYNC_FILE_KEY);
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
