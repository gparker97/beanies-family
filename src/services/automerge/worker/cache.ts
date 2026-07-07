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
import { loadAndVerify, applyChanges, unframeChanges } from './docOps';
import * as Automerge from '@automerge/automerge';
import type { FamilyDocument } from '@/types/automerge';
import type { BeanpodFileV4 } from '@/types/syncFileV4';

type Doc = Automerge.Doc<FamilyDocument>;

const STORE_NAME = 'doc';
/** ADR-032 Plan B B1 — the whole-doc base snapshot row (encrypted `Automerge.save`). */
const BASE_KEY = 'base';
/** Pre-B1 whole-doc row. Read as a base fallback so an in-flight upgrade loses no data. */
const LEGACY_DOC_KEY = 'current';
const ENVELOPE_KEY = 'envelope';
/** Increment rows key on `inc:<zero-padded seq>` so IDB's lexical key order == seq order. */
const INC_PREFIX = 'inc:';
/** The char after ':' — upper bound (exclusive) for the `inc:*` key range. */
const INC_UPPER = 'inc;';
const INC_PAD = 12;

const incKey = (seq: number): string => `${INC_PREFIX}${String(seq).padStart(INC_PAD, '0')}`;
const parseIncKey = (key: string): number => Number(key.slice(INC_PREFIX.length));

const DB_PREFIX = 'beanies-automerge-';

interface CacheDB {
  doc: {
    key: string;
    value: { id: string; payload: string; updatedAt: string };
  };
}

let cacheDb: IDBPDatabase<CacheDB> | null = null;
let cacheDbFamilyId: string | null = null;
/** Next increment seq to write. Initialized from the max existing `inc:*` key on
 * open (a respawn must NOT reuse a seq and clobber a not-yet-superseded increment);
 * reset to 0 whenever a fresh base is written (which clears all increments). */
let incSeq = 0;

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
  incSeq = await maxIncSeq(cacheDb);
}

/** Read the next free increment seq (= max existing `inc:*` index + 1, or 0). */
async function maxIncSeq(db: IDBPDatabase<CacheDB>): Promise<number> {
  const keys = (await withIdbRetry('maxIncSeq', () =>
    db.getAllKeys(STORE_NAME, IDBKeyRange.bound(INC_PREFIX, INC_UPPER, false, true))
  )) as string[];
  if (keys.length === 0) return 0;
  return parseIncKey(keys[keys.length - 1]!) + 1;
}

/**
 * Write the whole-doc BASE snapshot (encrypted), clearing every existing increment
 * and the legacy row. This is both the first persist for a doc and a re-compaction:
 * afterwards the base alone reconstructs the doc, and increments resume from seq 0.
 * (Kept named `persistDocBinary` — tests seed a base doc through it.)
 */
export async function persistDocBinary(familyKey: CryptoKey, binary: Uint8Array): Promise<void> {
  if (!cacheDb) throw new Error('Cache DB not initialized. Call initPersistenceDB() first.');
  const encrypted = await encryptPayload(familyKey, binary);
  const payload = bufferToBase64(encrypted);
  const db = cacheDb;

  await withIdbRetry('persistBase', async () => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    await store.put({ id: BASE_KEY, payload, updatedAt: nowIso() });
    // Clear superseded increments + any legacy whole-doc row in the same tx so a
    // reader never sees a base without its matching (empty) increment set.
    let cursor = await store.openCursor(IDBKeyRange.bound(INC_PREFIX, INC_UPPER, false, true));
    while (cursor) {
      await cursor.delete();
      cursor = await cursor.continue();
    }
    await store.delete(LEGACY_DOC_KEY);
    await tx.done;
  });
  incSeq = 0;
}

/** Append one encrypted increment (a framed change chunk). */
export async function persistIncrement(familyKey: CryptoKey, framed: Uint8Array): Promise<void> {
  if (!cacheDb) throw new Error('Cache DB not initialized. Call initPersistenceDB() first.');
  const encrypted = await encryptPayload(familyKey, framed);
  const payload = bufferToBase64(encrypted);
  const db = cacheDb;
  const id = incKey(incSeq);
  await withIdbRetry('persistIncrement', () =>
    db.put(STORE_NAME, { id, payload, updatedAt: nowIso() })
  );
  incSeq += 1;
}

/** How many increments sit on top of the current base (the re-compaction trigger). */
export function incrementCount(): number {
  return incSeq;
}

/**
 * Reconstruct the cached doc: load the base (`loadAndVerify`) then apply the
 * increments in seq order. Returns `null` if no base/legacy row exists.
 *
 * Fast path applies all increments in one `applyChanges` call. On ANY increment
 * failure (decrypt / unframe / apply) it falls back to applying increments one at
 * a time and STOPS at the first bad one — recovering base + `[0..k-1]` rather than
 * discarding every persisted mutation after a single mid-log corruption (a finances
 * doc). `recovered:true` tells the caller to rewrite a clean base. A base that
 * decrypts but won't materialize still throws `CorruptPayloadError` (the caller
 * clears-and-rebuilds) — a corrupt BASE is unrecoverable, unlike a corrupt tail.
 */
export async function loadCachedDoc(
  familyKey: CryptoKey,
  familyId: string | null
): Promise<{ doc: Doc; recovered: boolean } | null> {
  if (!cacheDb) throw new Error('Cache DB not initialized. Call initPersistenceDB() first.');
  const db = cacheDb;

  const baseEntry =
    (await withIdbRetry('loadBase', () => db.get(STORE_NAME, BASE_KEY))) ??
    (await withIdbRetry('loadLegacyDoc', () => db.get(STORE_NAME, LEGACY_DOC_KEY)));
  if (!baseEntry) return null;

  const baseBinary = await decryptPayload(
    familyKey,
    new Uint8Array(base64ToBuffer(baseEntry.payload))
  );
  const baseDoc = loadAndVerify(baseBinary, familyId); // throws CorruptPayloadError on a bad base

  const incEntries = (await withIdbRetry('loadIncrements', () =>
    db.getAll(STORE_NAME, IDBKeyRange.bound(INC_PREFIX, INC_UPPER, false, true))
  )) as Array<{ id: string; payload: string }>;
  if (incEntries.length === 0) return { doc: baseDoc, recovered: false };

  // Fast path: decrypt + unframe every increment, apply in one call.
  try {
    const all: Uint8Array[] = [];
    for (const entry of incEntries) {
      const framed = await decryptPayload(familyKey, new Uint8Array(base64ToBuffer(entry.payload)));
      all.push(...unframeChanges(framed));
    }
    return { doc: applyChanges(baseDoc, all).doc, recovered: false };
  } catch (fastErr) {
    // Slow path: apply increments one at a time from a fresh base, stop at the
    // first failure, keep the prefix. Never a silent partial (breadcrumb below).
    console.warn(
      '[cache] increment apply failed — recovering base + increments before the first bad one.',
      fastErr
    );
    let doc = loadAndVerify(baseBinary, familyId);
    for (const entry of incEntries) {
      try {
        const framed = await decryptPayload(
          familyKey,
          new Uint8Array(base64ToBuffer(entry.payload))
        );
        doc = applyChanges(doc, unframeChanges(framed)).doc;
      } catch (incErr) {
        console.warn(
          `[cache] stopping increment replay at ${entry.id} (corrupt/unapplyable).`,
          incErr
        );
        break;
      }
    }
    return { doc, recovered: true };
  }
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
    incSeq = 0;
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
    incSeq = 0;
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
  incSeq = 0;
}
