/**
 * ADR-032 — the worker-side encrypted document cache.
 *
 * Post-migration the Automerge doc + IndexedDB cache live ONLY in the worker
 * (IDB connections aren't transferable; two openers on one DB deadlock on a
 * future `onblocked`). This is the persistenceService cache CRUD, moved into the
 * worker and made state-explicit:
 *   - the binary/familyKey are passed in (no `saveDoc()` singleton reach),
 *   - `loadCachedDoc` adds the same `CorruptPayloadError` + materialize sanity
 *     check the Drive path has, so a materialize-corrupt cache is detected
 *     BEFORE it's installed (today it slips past `Automerge.load` and throws
 *     later, invisible + looping corrupt→re-persist-corrupt),
 *   - `clearCache` closes THEN deletes (a live connection makes
 *     `deleteDatabase` fire `onblocked` and silently never delete → privacy
 *     break + stale-cache hazard).
 *
 * Reuses the worker-safe `familyKeyService` crypto, `encoding`, and
 * `idbTransient` retry helpers verbatim. `idb`'s `openDB` and `IndexedDB` are
 * both available in a Web Worker.
 */
import { openDB, type IDBPDatabase } from 'idb';
import { encryptPayload, decryptPayload } from '@/services/crypto/familyKeyService';
import { bufferToBase64, base64ToBuffer } from '@/utils/encoding';
import { withIdbRetry } from '@/utils/idbTransient';
import { loadAndVerify } from './docOps';
import * as Automerge from '@automerge/automerge';
import type { FamilyDocument } from '@/types/automerge';
import type { BeanpodFileV4 } from '@/types/syncFileV4';

type Doc = Automerge.Doc<FamilyDocument>;

const STORE_NAME = 'doc';
const DOC_KEY = 'current';
const ENVELOPE_KEY = 'envelope';
const DB_PREFIX = 'beanies-automerge-';

interface CacheDB {
  doc: {
    key: string;
    value: { id: string; payload: string; updatedAt: string };
  };
}

let cacheDb: IDBPDatabase<CacheDB> | null = null;
let cacheDbFamilyId: string | null = null;

/** Open (or reuse) the cache IndexedDB for the given family. */
export async function initPersistenceDB(familyId: string): Promise<void> {
  if (cacheDbFamilyId === familyId && cacheDb) return;

  // A switch to another family must close the previous connection first.
  if (cacheDb) {
    cacheDb.close();
    cacheDb = null;
  }

  const dbName = `${DB_PREFIX}${familyId}`;
  cacheDb = await openDB<CacheDB>(dbName, 1, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    },
  });
  cacheDbFamilyId = familyId;
}

/** Persist an already-serialized doc binary to the cache, encrypted. */
export async function persistDocBinary(familyKey: CryptoKey, binary: Uint8Array): Promise<void> {
  if (!cacheDb) throw new Error('Cache DB not initialized. Call initPersistenceDB() first.');
  const encrypted = await encryptPayload(familyKey, binary);
  const payload = bufferToBase64(encrypted);
  const db = cacheDb;

  await withIdbRetry('persistDoc', () =>
    db.put(STORE_NAME, { id: DOC_KEY, payload, updatedAt: nowIso() })
  );
}

/**
 * Load + decrypt + verify the cached doc. Returns null if no cache row exists.
 * Throws `CorruptPayloadError` (via `loadAndVerify`) if the bytes decrypt but
 * won't load/materialize — the worker caller clears-and-rebuilds rather than
 * installing a corrupt doc.
 */
export async function loadCachedDoc(
  familyKey: CryptoKey,
  familyId: string | null
): Promise<Doc | null> {
  if (!cacheDb) throw new Error('Cache DB not initialized. Call initPersistenceDB() first.');
  const db = cacheDb;

  const entry = await withIdbRetry('loadCachedDoc', () => db.get(STORE_NAME, DOC_KEY));
  if (!entry) return null;

  const encrypted = new Uint8Array(base64ToBuffer(entry.payload));
  const binary = await decryptPayload(familyKey, encrypted);
  return loadAndVerify(binary, familyId);
}

/** Cache the V4 envelope so the cache can be decrypted on refresh without the file. */
export async function persistEnvelope(envelope: BeanpodFileV4): Promise<void> {
  if (!cacheDb) return; // silently skip if not initialized (matches legacy behaviour)
  const db = cacheDb;

  await withIdbRetry('persistEnvelope', () =>
    db.put(STORE_NAME, { id: ENVELOPE_KEY, payload: JSON.stringify(envelope), updatedAt: nowIso() })
  );
}

/** Load the cached V4 envelope, or null if absent/unparseable. */
export async function loadCachedEnvelope(): Promise<BeanpodFileV4 | null> {
  if (!cacheDb) return null;
  const db = cacheDb;

  const entry = await withIdbRetry('loadCachedEnvelope', () => db.get(STORE_NAME, ENVELOPE_KEY));
  if (!entry) return null;
  try {
    return JSON.parse(entry.payload) as BeanpodFileV4;
  } catch {
    return null;
  }
}

/** True if the cache DB is open and ready. */
export function isCacheReady(): boolean {
  return cacheDb !== null;
}

/**
 * Delete the cache IndexedDB for a family. Closes our own connection FIRST so
 * `deleteDatabase` isn't blocked by it (a blocked delete `resolve()`s as if it
 * worked but never deletes → the encrypted cache survives sign-out).
 */
export async function clearCache(familyId: string): Promise<void> {
  if (cacheDbFamilyId === familyId && cacheDb) {
    cacheDb.close();
    cacheDb = null;
    cacheDbFamilyId = null;
  }

  const dbName = `${DB_PREFIX}${familyId}`;
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(dbName);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    // `onblocked` should not happen now we've closed our own connection, but if
    // another context still holds one, resolve rather than hang — matches legacy.
    request.onblocked = () => resolve();
  });
}

/** Close the cache DB connection (sign-out) without deleting it. */
export function closeCacheDB(): void {
  if (cacheDb) {
    cacheDb.close();
    cacheDb = null;
    cacheDbFamilyId = null;
  }
}

/** ISO timestamp. Isolated so tests with a fixed clock can spy if needed. */
function nowIso(): string {
  return new Date().toISOString();
}

/** Test-only: force-close + forget the cache handle between cases. */
export function __resetCacheForTesting(): void {
  if (cacheDb) cacheDb.close();
  cacheDb = null;
  cacheDbFamilyId = null;
}
