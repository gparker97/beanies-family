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

import { logEvent } from '@/services/telemetry';

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
  filename: string; // the Drive object name, e.g. 'beanies-photo-<photoId>.jpg'
  mime: string;
  width: number;
  height: number;
  sizeBytes: number;
  fileName?: string; // original user filename (PDFs) — preserved across the offline path
  createdBy?: string;
  createdAt: number; // epoch ms
}

/**
 * Drains one entry. `familyId` is the family the drain was started for: the handler must
 * refuse (throw, so the entry stays queued) when that is no longer the active family.
 */
type FlushHandler = (entry: QueuedPhotoUpload, familyId: string) => Promise<void>;

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
  // Round 3: re-binding the SAME family keeps its handle (a drain in flight holds it); a
  // different family closes the old one, which would otherwise block that queue's delete.
  if (currentFamilyId !== familyId || !dbPromise) {
    retireHandle(currentFamilyId, dbPromise);
    dbPromise = openDB(familyId);
  }
  currentFamilyId = familyId;
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
  // Close, not just forget: a leaked connection blocks `deletePhotoQueueDatabase` (sign-out,
  // forget family) for as long as the tab lives. A drain still running on it finishes its
  // current entry, then stops at the family check.
  retireHandle(currentFamilyId, dbPromise);
  dbPromise = null;
  currentFamilyId = null;
}

/**
 * Close a handle the module no longer names. A drain still running for that family holds it
 * to remove the entry it is finishing, so the close waits for that drain to settle.
 */
function retireHandle(familyId: string | null, handle: Promise<IDBDatabase> | null): void {
  const running = familyId ? inFlightFlush.get(familyId) : undefined;
  if (running) void running.finally(() => closeHandle(handle));
  else closeHandle(handle);
}

/** Close a queue handle once it opens; an open that failed has nothing to close. */
function closeHandle(handle: Promise<IDBDatabase> | null): void {
  if (!handle) return;
  handle.then(
    (db) => db.close(),
    () => {}
  );
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

/** The drain in progress PER FAMILY, so overlapping triggers share one pass (`flushQueue`). */
const inFlightFlush = new Map<string, Promise<void>>();

/**
 * Attempt to drain every pending entry through the registered handler.
 * Successful entries are removed; failures stay queued.
 *
 * Single-flight (C11): `setActiveFamily`, `setFlushHandler`, the `online` event, the retry
 * timer and `photoStore.activate` can all fire within the same tick, and two concurrent
 * drains handed the SAME entry to the handler twice — two Drive files for one photo. A call
 * that lands while a drain is running joins that drain's promise instead.
 */
export function flushQueue(): Promise<void> {
  const familyId = currentFamilyId;
  const db = dbPromise;
  if (!familyId || !db || !flushHandler) return Promise.resolve();
  // Keyed by family (round 3): a drain still finishing for the PREVIOUS family must not be
  // joined by a flush for the new one (it would stop at its next entry and drain nothing).
  const running = inFlightFlush.get(familyId);
  if (running) return running;
  const run = drainOnce(familyId, db).finally(() => {
    if (inFlightFlush.get(familyId) === run) inFlightFlush.delete(familyId);
  });
  inFlightFlush.set(familyId, run);
  return run;
}

/**
 * One pass over `familyId`'s queue, against the database handle captured when it started
 * (round 3). The family can change mid-drain (a switch, a sign-out): every entry is checked
 * against the ACTIVE family before it is handed over, the drain stops at the first mismatch,
 * and removal goes to the captured database, never to whatever `dbPromise` names by then.
 */
async function drainOnce(familyId: string, dbHandle: Promise<IDBDatabase>): Promise<void> {
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
  const db = await dbHandle;
  const entries = await withStore<QueuedPhotoUpload[]>(db, 'readonly', (store) => store.getAll());
  if (entries.length === 0) return;

  logEvent({
    level: 'info',
    surface: 'photo-upload-flush',
    message: 'draining pending photo uploads',
    context: { action: 'drain-start', file_count: entries.length },
  });
  let anyFailed = false;
  for (const entry of entries) {
    const handler = flushHandler;
    if (currentFamilyId !== familyId || !handler) {
      logEvent({
        level: 'info',
        surface: 'photo-upload-flush',
        message: 'drain stopped: the active family changed',
        context: { action: 'drain-stopped-family-changed' },
      });
      return;
    }
    try {
      await handler(entry, familyId);
      await withStore(db, 'readwrite', (store) => store.delete(entry.id));
    } catch (e) {
      console.warn('[photoUploadQueue] Flush failed for entry', entry.id, e);
      anyFailed = true;
      // Previously console-only — a genuine silent-failure gap. Surface to the
      // diagnostic firehose so stuck photo uploads are visible/queryable.
      logEvent({
        level: 'warn',
        surface: 'photo-upload-flush',
        message: `photo upload flush failed: ${e instanceof Error ? e.message : String(e)}`,
        error: e,
        context: { action: 'photo-upload-flush' },
      });
    }
  }

  // If anything failed (typically because we're offline again), schedule a
  // short retry so we don't sit idle until the next online event.
  if (anyFailed && currentFamilyId === familyId) {
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
    } catch (e) {
      // The open itself failed (quota, private mode): nothing to close, but the delete below
      // still runs. Logged, because a queue that cannot be opened is also one that cannot drain.
      logEvent({
        level: 'warn',
        surface: 'photo-upload-flush',
        message: 'photo queue handle could not be closed before delete',
        error: e,
        context: { action: 'queue-close-failed' },
      });
    }
    dbPromise = null;
  }
  // Never rejects: sign-out must not stall on queue cleanup. A refused or blocked delete is
  // reported so a queue that survives sign-out (and would flush under the next sign-in of a
  // DIFFERENT family on this device) is visible in the firehose.
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase(DB_PREFIX + familyId);
    req.onsuccess = () => resolve();
    req.onerror = () => {
      logEvent({
        level: 'warn',
        surface: 'photo-upload-flush',
        message: 'photo queue database delete failed',
        error: req.error,
        context: { action: 'queue-delete-failed', error_code: 'error' },
      });
      resolve();
    };
    req.onblocked = () => {
      logEvent({
        level: 'warn',
        surface: 'photo-upload-flush',
        message: 'photo queue database delete blocked by another tab',
        context: { action: 'queue-delete-failed', error_code: 'blocked' },
      });
      resolve();
    };
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
    inFlightFlush.clear();
  },
};
