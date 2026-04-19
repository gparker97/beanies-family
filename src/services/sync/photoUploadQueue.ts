/**
 * Offline queue for photo uploads.
 *
 * Distinct from `offlineQueue.ts` (which is a single-slot `.beanpod`
 * replacement): this queue holds multiple independent upload operations,
 * each with its own compressed Blob and target entity metadata.
 *
 * Storage: IndexedDB `beanies-photo-queue-{familyId}`, store `uploads`,
 * keyPath `id`. Survives tab close. Cleared on sign-out via
 * `deletePhotoQueueDatabase` (called from `database.ts:deleteFamilyDatabase`).
 *
 * Flush: registers a single `window.addEventListener('online', ...)` per
 * module lifetime. On online, iterates pending entries and invokes the
 * handler photoStore registered via `setFlushHandler`. Entries are removed
 * only on successful handler completion; failures stay queued for the
 * next online event.
 */

const DB_PREFIX = 'beanies-photo-queue-';
const STORE_NAME = 'uploads';
const DB_VERSION = 1;

/** Soft cap — photoStore warns via toast when the queue hits this depth. */
export const QUEUE_SOFT_CAP = 20;

export interface QueuedPhotoUpload {
  id: string; // random UUID for the queue entry
  photoId: string; // the eventual PhotoAttachment.id
  entityCollection: string; // e.g. 'activities', 'familyMembers'
  entityId: string; // the entity whose photoIds we'll push to
  blob: Blob;
  filename: string; // e.g. 'beanies-photo-<photoId>.jpg'
  mime: string;
  width: number;
  height: number;
  sizeBytes: number;
  createdBy?: string;
  createdAt: number; // epoch ms
}

type FlushHandler = (entry: QueuedPhotoUpload) => Promise<void>;

let currentFamilyId: string | null = null;
let dbPromise: Promise<IDBDatabase> | null = null;
let flushHandler: FlushHandler | null = null;
let isListening = false;
let retryTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Bind the queue to a family. Opens the IDB database and attaches the
 * online listener. Call on sign-in after the Automerge doc is loaded.
 */
export function setActiveFamily(familyId: string): void {
  currentFamilyId = familyId;
  dbPromise = openDB(familyId);
  startListening();
  // Attempt an immediate flush in case entries are already pending.
  if (navigator.onLine && flushHandler) {
    void flushQueue();
  }
}

/**
 * Clear the active family reference (e.g. on sign-out).
 * Does NOT delete the database — call `deletePhotoQueueDatabase` for that.
 */
export function clearActiveFamily(): void {
  stopListening();
  dbPromise = null;
  currentFamilyId = null;
}

/**
 * Register the handler that drains a queued entry (photoStore provides this).
 * Must successfully complete Drive upload + Automerge mutation before resolving.
 */
export function setFlushHandler(handler: FlushHandler): void {
  flushHandler = handler;
  // If entries are already pending and we're online, flush immediately.
  if (navigator.onLine && currentFamilyId) {
    void flushQueue();
  }
}

/**
 * Enqueue a photo upload. Returns the queue entry id.
 */
export async function enqueueUpload(
  entry: Omit<QueuedPhotoUpload, 'id' | 'createdAt'>
): Promise<string> {
  const id = crypto.randomUUID();
  const full: QueuedPhotoUpload = { ...entry, id, createdAt: Date.now() };
  const db = await requireDB();
  await withStore(db, 'readwrite', (store) => store.put(full));
  return id;
}

/**
 * List all pending entries (optionally scoped to one entity).
 */
export async function getPending(
  entityCollection?: string,
  entityId?: string
): Promise<QueuedPhotoUpload[]> {
  if (!dbPromise) return [];
  const db = await dbPromise;
  const all = await withStore<QueuedPhotoUpload[]>(db, 'readonly', (store) => store.getAll());
  if (!entityCollection || !entityId) return all;
  return all.filter((e) => e.entityCollection === entityCollection && e.entityId === entityId);
}

/**
 * Remove a single entry (e.g. after successful flush or manual cancel).
 */
export async function removeFromQueue(id: string): Promise<void> {
  if (!dbPromise) return;
  const db = await dbPromise;
  await withStore(db, 'readwrite', (store) => store.delete(id));
}

/**
 * Attempt to drain every pending entry through the registered handler.
 * Successful entries are removed; failures stay queued.
 */
export async function flushQueue(): Promise<void> {
  if (!flushHandler || !dbPromise) return;
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
  const entries = await getPending();
  if (entries.length === 0) return;

  console.warn(`[photoUploadQueue] Draining ${entries.length} pending upload(s)`);
  let anyFailed = false;
  for (const entry of entries) {
    try {
      await flushHandler(entry);
      await removeFromQueue(entry.id);
    } catch (e) {
      console.warn('[photoUploadQueue] Flush failed for entry', entry.id, e);
      anyFailed = true;
    }
  }

  // If anything failed (typically because we're offline again), schedule a
  // short retry so we don't sit idle until the next online event.
  if (anyFailed) {
    retryTimer = setTimeout(() => {
      retryTimer = null;
      if (navigator.onLine) void flushQueue();
    }, 5000);
  }
}

/**
 * Delete the entire queue database (sign-out cleanup).
 */
export async function deletePhotoQueueDatabase(familyId: string): Promise<void> {
  // Close any open handle for this family before deleting.
  if (currentFamilyId === familyId && dbPromise) {
    try {
      const db = await dbPromise;
      db.close();
    } catch {
      // ignore
    }
    dbPromise = null;
  }
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase(DB_PREFIX + familyId);
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
    req.onblocked = () => resolve();
  });
}

// --- internals ---

function openDB(familyId: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_PREFIX + familyId, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function requireDB(): Promise<IDBDatabase> {
  if (!dbPromise) {
    throw new Error(
      'photoUploadQueue: no active family. Call setActiveFamily() before enqueueing.'
    );
  }
  return dbPromise;
}

function withStore<T = void>(
  db: IDBDatabase,
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, mode);
    const store = tx.objectStore(STORE_NAME);
    const req = fn(store);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    tx.onerror = () => reject(tx.error);
  });
}

function handleOnline(): void {
  void flushQueue();
}

function startListening(): void {
  if (isListening) return;
  window.addEventListener('online', handleOnline);
  isListening = true;
}

function stopListening(): void {
  if (!isListening) return;
  window.removeEventListener('online', handleOnline);
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
  isListening = false;
}

// Exported for tests only.
export const __internals = {
  async reset(): Promise<void> {
    stopListening();
    if (dbPromise) {
      try {
        const db = await dbPromise;
        db.close();
      } catch {
        // ignore
      }
    }
    dbPromise = null;
    currentFamilyId = null;
    flushHandler = null;
  },
};
