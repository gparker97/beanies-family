/**
 * Persistence Service — encrypted local cache of the Automerge document.
 *
 * Stores the Automerge binary in a per-family IndexedDB, encrypted with
 * the family key (AES-256-GCM). Provides fast app startup from local cache
 * without re-reading the .beanpod file from disk/Drive.
 *
 * The cache DB is separate from the old per-family entity databases.
 * Name: `beanies-automerge-{familyId}`
 */

import { openDB, type IDBPDatabase } from 'idb';
import { encryptPayload, decryptPayload } from '@/services/crypto/familyKeyService';
import { saveDoc, loadDoc } from './docService';
import { bufferToBase64, base64ToBuffer } from '@/utils/encoding';
import type * as Automerge from '@automerge/automerge';
import type { FamilyDocument } from '@/types/automerge';
import type { BeanpodFileV4 } from '@/types/syncFileV4';

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

/**
 * Open (or reuse) the cache IndexedDB for the given family.
 */
export async function initPersistenceDB(familyId: string): Promise<void> {
  if (cacheDbFamilyId === familyId && cacheDb) return;

  // Close previous connection
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

/**
 * Persist the current Automerge document to the local cache, encrypted.
 */
export async function persistDoc(familyKey: CryptoKey): Promise<void> {
  if (!cacheDb) throw new Error('Cache DB not initialized. Call initPersistenceDB() first.');

  const binary = saveDoc();
  const encrypted = await encryptPayload(familyKey, binary);
  const payload = bufferToBase64(encrypted);

  await cacheDb.put(STORE_NAME, {
    id: DOC_KEY,
    payload,
    updatedAt: new Date().toISOString(),
  });
}

/**
 * Load the cached Automerge document from the local cache, decrypting it.
 * Returns null if no cache exists.
 */
export async function loadCachedDoc(
  familyKey: CryptoKey
): Promise<Automerge.Doc<FamilyDocument> | null> {
  if (!cacheDb) throw new Error('Cache DB not initialized. Call initPersistenceDB() first.');

  const entry = await cacheDb.get(STORE_NAME, DOC_KEY);
  if (!entry) return null;

  const encrypted = new Uint8Array(base64ToBuffer(entry.payload));
  const binary = await decryptPayload(familyKey, encrypted);
  return loadDoc(binary);
}

/**
 * Cache the V4 envelope so the persistence cache can be decrypted on refresh
 * without re-reading the beanpod file (which may need permission).
 */
export async function persistEnvelope(envelope: BeanpodFileV4): Promise<void> {
  if (!cacheDb) return; // Silently skip if not initialized

  await cacheDb.put(STORE_NAME, {
    id: ENVELOPE_KEY,
    payload: JSON.stringify(envelope),
    updatedAt: new Date().toISOString(),
  });
}

/**
 * Load the cached V4 envelope. Returns null if no cache exists.
 */
export async function loadCachedEnvelope(): Promise<BeanpodFileV4 | null> {
  if (!cacheDb) return null;

  const entry = await cacheDb.get(STORE_NAME, ENVELOPE_KEY);
  if (!entry) return null;

  try {
    return JSON.parse(entry.payload) as BeanpodFileV4;
  } catch {
    return null;
  }
}

/**
 * Check if the persistence DB is initialized and ready.
 */
export function isCacheReady(): boolean {
  return cacheDb !== null;
}

/**
 * Delete the cache IndexedDB for the given family.
 */
export async function clearCache(familyId: string): Promise<void> {
  // Close connection if it belongs to this family
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
    request.onblocked = () => resolve();
  });
}

/**
 * Close the cache DB connection (e.g. on sign-out).
 */
export function closeCacheDB(): void {
  if (cacheDb) {
    cacheDb.close();
    cacheDb = null;
    cacheDbFamilyId = null;
  }
}
