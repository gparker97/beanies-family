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
 *   - `clearCache` closes THEN deletes, and waits (bounded) for the delete to
 *     actually finish rather than treating `onblocked` as an answer,
 *   - every connection answers `versionchange` by closing (#100). Each tab has
 *     its own worker and its own connection, so a delete issued by another tab
 *     is blocked until THIS one lets go; holding on left the encrypted cache on
 *     disk after "sign out and clear data" and queued every later open behind a
 *     delete that could never finish.
 *
 * Reuses the worker-safe `familyKeyService` crypto, `encoding`, and
 * `idbTransient` retry helpers verbatim. `idb`'s `openDB` and `IndexedDB` are
 * both available in a Web Worker.
 */
import { openDB, deleteDB, type IDBPDatabase } from 'idb';
import { withoutPayload } from '@/services/sync/envelopeMerge';
import { encryptPayload, decryptPayload } from '@/services/crypto/familyKeyService';
import { bufferToBase64, base64ToBuffer } from '@/utils/encoding';
import { withIdbRetry } from '@/utils/idbTransient';
import { withTimeout } from '@/utils/timing';
import { generateUUID } from '@/utils/id';
import { setDeviceWriterId } from './docActor';
import type { RemoteBaselineRow } from '@/services/sync/remoteBaseline';
import type { CacheClearResult, CacheReplay } from './protocol';
import {
  loadAndVerify,
  applyChanges,
  unframeChanges,
  payloadFailure,
  decodedSizeOf,
} from './docOps';
import { isAllocationFailure } from '@/utils/isAllocationFailure';
import { PayloadLoadError, type PayloadLoadStep } from '@/types/sync';
import * as Automerge from '@automerge/automerge';
import { COLLECTION_NAMES, type FamilyDocument } from '@/types/automerge';
import type { BeanpodFileV4 } from '@/types/syncFileV4';
import type { ProjectionDelta } from './protocol';

type Doc = Automerge.Doc<FamilyDocument>;

const STORE_NAME = 'doc';
/** ADR-032 Plan B B1 — the whole-doc base snapshot row (encrypted `Automerge.save`). */
const BASE_KEY = 'base';
/** Pre-B1 whole-doc row. Read as a base fallback so an in-flight upgrade loses no data. */
const LEGACY_DOC_KEY = 'current';
const ENVELOPE_KEY = 'envelope';
/**
 * The materialized-projection snapshot row (encrypted `buildFullProjection` deltas).
 * Display-only fast first paint on open; the Automerge base/increments remain the
 * source of truth. Dropped with everything else by `clearCache`'s whole-DB delete.
 */
const SNAPSHOT_KEY = 'projection-snapshot';
/**
 * The open-guard baseline row (#61/#65): the remote `version` counter our cached
 * doc provably contains — plus, since #65, a fingerprint of the heads DRIVE
 * HOLDS at that revision — stored as ONE opaque string in `payload` whose format
 * is owned by `@/services/sync/remoteBaseline` (never parsed in this file), with
 * `updatedAt` reused AS the trust clock (`checkedAt`). This row is
 * PLAINTEXT where every other payload is ciphertext — deliberately, because an
 * opaque counter plus a local clock reading carries no family data. It sorts
 * outside every read/clear key range here (`'r' > 'i'`, and the base/legacy/
 * envelope/snapshot reads are exact-key `get`s), so `persistDocBinary`'s
 * increment sweep and `loadCachedDoc` never touch it. `writeRemoteBaseline` is
 * the row's ONLY writer — nothing else may refresh `updatedAt`, or it would
 * silently extend trust. Dropped with everything else by `clearCache`.
 */
const REMOTE_BASELINE_KEY = 'remote-baseline';
/**
 * This device's Counter writer id (#117 Phase 2): an opaque random id, minted ONCE per family
 * cache by `initPersistenceDB` and posted into the realm (`docActor.setDeviceWriterId`). Every
 * Counter key this device writes carries it, and the rebase replays only keys that do, so it
 * must outlive a reload (the Automerge actor does not) and die with the cache (a signed-out or
 * cleared device is a new device). PLAINTEXT like the baseline row beside it: a random id
 * carries no family data. Outside every read/clear key range (`'d' < 'i'`). Dropped with
 * everything else by `clearCache`'s whole-DB delete.
 */
const DEVICE_WRITER_KEY = 'device-writer';
/**
 * Increment rows key on `inc:<zero-padded seq>:<realm>` so IDB's lexical key order == seq order.
 * Rows written before C5 (data-layer audit 2026-10-03) carry no realm suffix and still parse.
 */
const INC_PREFIX = 'inc:';
/** The char after ':' — upper bound (exclusive) for the `inc:*` key range. */
const INC_UPPER = 'inc;';
const INC_PAD = 12;

/**
 * This realm's increment-key suffix (C5h). Two tabs of one device share one cache DB, each with
 * its own worker, and both counted `incSeq` from the same max: their `put`s landed on the same
 * key and the later one silently replaced the earlier tab's increment. A per-realm suffix makes
 * the keys disjoint, and `add()` (never `put`) makes any residual collision a loud
 * `ConstraintError` instead of a clobber. Interim: a single elected writer is the follow-up.
 */
const REALM_ID = generateUUID().replace(/-/g, '').slice(0, 12);

const incKey = (seq: number): string =>
  `${INC_PREFIX}${String(seq).padStart(INC_PAD, '0')}:${REALM_ID}`;
const parseIncKey = (key: string): number => {
  const rest = key.slice(INC_PREFIX.length);
  const colon = rest.indexOf(':');
  return Number(colon < 0 ? rest : rest.slice(0, colon));
};

const DB_PREFIX = 'beanies-automerge-';

/**
 * How long to wait for the cache DB to open before giving up on it.
 *
 * ⚠️ THE ONLY BOUND ON THIS CALL, and the reason it exists: an `openDB` queued
 * behind a still-pending `deleteDatabase` fires NO event at all. `blocked` only
 * fires for a version change, and this DB is opened at version 1 forever, so
 * there is nothing to listen for. Without a deadline the promise simply never
 * settles, and `initAndLoadCache` awaits it for the life of the tab.
 *
 * 10s: a healthy open is sub-100ms, so this is ~100x headroom. It mirrors
 * `READY_TIMEOUT_MS` in `docClient.ts`, and it must stay far below that file's
 * `HEAVY_RPC_TIMEOUT_MS` (120s) so the WORKER classifies the failure rather than
 * the RPC ceiling tearing the worker down around it. It is also the only bound
 * anywhere on the inline path, which has none.
 *
 * Exported so the tests advance by exactly this and cannot drift from a literal.
 */
export const CACHE_OPEN_TIMEOUT_MS = 10_000;

/**
 * How long `clearCache` waits for its `deleteDatabase` to finish (#100).
 *
 * A peer tab answers `versionchange` by closing within milliseconds, and a
 * transaction still draining on it takes well under a second, so a healthy
 * delete never comes near this. It is reached only when a peer cannot answer at
 * all, which in practice is a frozen background tab. The caller then reports the
 * cache as kept rather than hanging sign-out, and the queued delete completes
 * on its own once that tab thaws and closes.
 *
 * Far below `DEFAULT_RPC_TIMEOUT_MS` (45s, `docClient.ts`), so the worker
 * classifies the outcome rather than the RPC layer tearing it down.
 *
 * Exported so the tests advance by exactly this and cannot drift from a literal.
 */
export const CACHE_DELETE_TIMEOUT_MS = 5_000;

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
 * reset past the highest KEPT row whenever a fresh base is written. */
let incSeq = 0;
/** How many `inc:*` rows are on disk (the re-compaction trigger, `incrementCount`). */
let incRowCount = 0;
/**
 * The increment rows the in-memory document provably CONTAINS (C5h): every row this realm
 * replayed cleanly at load, plus every row it wrote since. A base write that is not a
 * supersede deletes ONLY these. A row another tab wrote after our load, a row that would not
 * decrypt, and a row whose deps are missing are KEPT, because the base being written does not
 * hold them and deleting them was silent loss.
 */
let containedRows = new Set<string>();

/** Who hears about a release. Registered once by `applyAndProject.configure()`. */
type CacheReleasedListener = (reason: 'deleted' | 'upgrade') => void;
let releasedListener: CacheReleasedListener | null = null;

export function setCacheReleasedListener(fn: CacheReleasedListener | null): void {
  releasedListener = fn;
}

/** Close the current handle and forget it. The ONE place the handle is nulled. */
function closeHandle(): void {
  cacheDb?.close();
  cacheDb = null;
  cacheDbFamilyId = null;
  incSeq = 0;
  incRowCount = 0;
  containedRows = new Set();
  // The id belongs to the DB it was read from: a write after the handle closed (sign-out, a
  // family switch, another tab's delete) must not key a Counter with another family's device.
  setDeviceWriterId(null);
}

/** Open (or reuse) the cache IndexedDB for the given family. */
export async function initPersistenceDB(familyId: string): Promise<void> {
  if (cacheDbFamilyId === familyId && cacheDb) return;

  // A switch to another family must close the previous connection first.
  if (cacheDb) closeHandle();

  const dbName = `${DB_PREFIX}${familyId}`;
  // This open's own handle, so `blocking` can tell the live connection from a
  // stale late-open. Safe as a plain closure variable because `versionchange` is
  // delivered as an event task, never a microtask: it cannot run before the
  // assignment below, which happens before this function's next task boundary.
  let handle: IDBPDatabase<CacheDB> | null = null;
  const opening = openDB<CacheDB>(dbName, 1, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    },
    // ⚠️ ANOTHER CONTEXT WANTS THIS DATABASE GONE (or, impossibly today, at a
    // new version). Per spec its request cannot proceed while we hold a
    // connection, and an open queued behind that delete fires NO event at all
    // (see `CACHE_OPEN_TIMEOUT_MS`), so holding on is what stranded every later
    // sign-in in a timeout (#100). Close whichever connection got this, then, if
    // it was the live one, stop using the cache and tell the listener, which ends
    // this tab's session.
    //
    // ⚠️ KNOWN LIMIT, deliberately accepted (greg, 2026-09-24): nothing here REFUSES
    // a reopen in the seconds before that teardown finishes, so a pending save or a
    // recovery can recreate an (encrypted) cache. A refusal was built and reviewed
    // three times and never held, because worker restarts and session identity are
    // owned on the main thread. The other tab's clear has already removed the key
    // that would open it, and `authStore.endSessionClearedElsewhere` logs the case
    // (`cache-present-after-eviction`). See the #100 plan's Outcome.
    blocking(_current, newVersion, event) {
      (event.target as IDBDatabase).close();
      if (cacheDb === null || cacheDb !== handle) {
        console.warn(`[cache] versionchange on a stale ${dbName} connection; closed it`);
        return;
      }
      closeHandle();
      releasedListener?.(newVersion === null ? 'deleted' : 'upgrade');
    },
  });

  let db: IDBPDatabase<CacheDB>;
  try {
    db = await withTimeout(
      opening,
      CACHE_OPEN_TIMEOUT_MS,
      `cache open timed out after ${CACHE_OPEN_TIMEOUT_MS}ms: ${dbName} is queued behind another connection or a pending delete`,
      // The one site that knows this deadline is a cache open. Main classifies
      // the failure by this name; `'Error'` told it nothing.
      'CacheOpenTimeoutError'
    );
  } catch (e) {
    // ⚠️ `withTimeout` STOPS WAITING; IT CANNOT CANCEL THE REQUEST. A timed-out
    // open stays queued, and if it later succeeds nobody holds the handle and
    // nobody closes it. An orphan connection to this name blocks EVERY future
    // `deleteDatabase` on it, which is the privacy invariant in this file's
    // header comment. Close it on arrival, whenever that is.
    void opening.then((late) => late.close()).catch(() => {});
    throw e;
  }

  // #117 Phase 2: read (or mint, once) this device's Counter writer id BEFORE the handle is
  // installed, so an open that cannot read its own id is an open that failed. Once posted, it
  // supersedes any ephemeral id a cacheless stretch of this session minted (`docActor.ts`).
  // C5b: EVERY read the handle depends on runs before ANY of it is installed. The increment
  // scan used to run after `cacheDb` was assigned, so a scan that failed left a live handle
  // with `incSeq = 0`, and the next persist overwrote `inc:000000000000`.
  let writerId: string;
  let scan: { next: number; count: number };
  try {
    writerId = await ensureDeviceWriterId(db);
    scan = await scanIncrements(db);
  } catch (e) {
    db.close();
    throw e;
  }

  // ⚠️ ASSIGNED ONLY ON SUCCESS, TOGETHER, and load-bearing twice. `isCacheReady()` is
  // exactly `cacheDb !== null`, so a timeout must leave it null or a write will
  // target a DB we do not hold; and a late open cannot install itself as another
  // family's handle minutes later.
  handle = db;
  cacheDb = db;
  cacheDbFamilyId = familyId;
  setDeviceWriterId(writerId);
  incSeq = scan.next;
  incRowCount = scan.count;
  containedRows = new Set();
}

/** The family whose cache DB is open, or `null`. */
export function cacheFamilyId(): string | null {
  return cacheDbFamilyId;
}

/**
 * The live handle, or a throw naming the call. Every write captures it BEFORE its first
 * `await` (C5g) and re-checks with `assertSameHandle` after: a family switch, a sign-out or
 * another tab's delete during an encrypt used to send the write to whatever handle was open
 * by then, which could be another family's database.
 */
function requireHandle(): IDBPDatabase<CacheDB> {
  if (!cacheDb) throw new Error('Cache DB not initialized. Call initPersistenceDB() first.');
  return cacheDb;
}

function assertSameHandle(db: IDBPDatabase<CacheDB>, op: string): void {
  if (cacheDb === db) return;
  const err = new Error(`cache handle changed during ${op}; the write was abandoned`);
  // Literal: the prod build minifies class names. `applyAndProject.persistOnce` keys on it.
  err.name = 'CacheHandleChangedError';
  throw err;
}

/**
 * This cache's device writer id, minted on first open (#117 Phase 2, `DEVICE_WRITER_KEY`).
 * Read and create-if-absent in ONE readwrite transaction: two tabs opening a fresh cache at once
 * serialise on the store, so the second reads the first's id instead of minting a rival one
 * (which would orphan the first tab's keys from this device after a reload). `generateUUID`,
 * never a bare `crypto.randomUUID()` (undefined on a non-secure origin; see `docOps.ts`).
 */
async function ensureDeviceWriterId(db: IDBPDatabase<CacheDB>): Promise<string> {
  return withIdbRetry('ensureDeviceWriterId', async () => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const existing = ((await store.get(DEVICE_WRITER_KEY)) as { payload?: string } | undefined)
      ?.payload;
    const id = existing || generateUUID();
    if (!existing) await store.put({ id: DEVICE_WRITER_KEY, payload: id, updatedAt: nowIso() });
    await tx.done;
    return id;
  });
}

/** This cache's device writer id row, or `null` when absent (never, after an open). */
export async function readDeviceWriterId(): Promise<string | null> {
  if (!cacheDb) throw new Error('Cache DB not initialized. Call initPersistenceDB() first.');
  const entry = (await withIdbRetry('readDeviceWriterId', () =>
    cacheDb!.get(STORE_NAME, DEVICE_WRITER_KEY)
  )) as { payload?: string } | undefined;
  return entry?.payload || null;
}

/** The next free increment seq (= max existing `inc:*` seq + 1, or 0) and the row count. */
async function scanIncrements(db: IDBPDatabase<CacheDB>): Promise<{ next: number; count: number }> {
  const keys = (await withIdbRetry('maxIncSeq', () =>
    db.getAllKeys(STORE_NAME, IDBKeyRange.bound(INC_PREFIX, INC_UPPER, false, true))
  )) as string[];
  let max = -1;
  for (const k of keys) max = Math.max(max, parseIncKey(k));
  return { next: max + 1, count: keys.length };
}

/**
 * Write the whole-doc BASE snapshot (encrypted) and drop the legacy row, deleting the
 * increments the new base makes redundant, in the same transaction.
 *
 * Which increments that is depends on what the base IS (C5h):
 *  - `supersede: true` (a NEW document generation was installed: a fresh family, an adopt, a
 *    rebase, a compaction): every increment. They describe a history the new base replaces,
 *    and replaying them over it would only buffer changes whose deps never arrive.
 *  - otherwise (a re-compaction or a recovery of the SAME document): only the rows the
 *    in-memory document provably contains (`containedRows`). A row another tab wrote, a row
 *    that would not decrypt and a row waiting on missing deps are KEPT.
 * (Kept named `persistDocBinary` — tests seed a base doc through it.)
 */
export async function persistDocBinary(
  familyKey: CryptoKey,
  binary: Uint8Array,
  opts?: { supersede?: boolean }
): Promise<void> {
  const db = requireHandle(); // C5g: before the first await
  const supersede = opts?.supersede === true;
  const encrypted = await encryptPayload(familyKey, binary);
  const payload = bufferToBase64(encrypted);
  assertSameHandle(db, 'persistBase');
  const deletable = containedRows;

  const kept = await withIdbRetry('persistBase', async () => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    await store.put({ id: BASE_KEY, payload, updatedAt: nowIso() });
    // Clear redundant increments + any legacy whole-doc row in the same tx so a
    // reader never sees a base without its matching increment set.
    const keptKeys: string[] = [];
    let cursor = await store.openCursor(IDBKeyRange.bound(INC_PREFIX, INC_UPPER, false, true));
    while (cursor) {
      const k = String(cursor.key);
      if (supersede || deletable.has(k)) await cursor.delete();
      else keptKeys.push(k);
      cursor = await cursor.continue();
    }
    await store.delete(LEGACY_DOC_KEY);
    await tx.done;
    return keptKeys;
  });
  if (cacheDb !== db) return; // closed meanwhile: the counters belong to the next open
  let max = -1;
  for (const k of kept) max = Math.max(max, parseIncKey(k));
  incSeq = max + 1;
  incRowCount = kept.length;
  containedRows = new Set();
}

/**
 * Append one encrypted increment (a framed change chunk) under this realm's own key, with
 * `add()`, so a collision fails loudly instead of replacing another tab's row (C5h).
 */
export async function persistIncrement(familyKey: CryptoKey, framed: Uint8Array): Promise<void> {
  const db = requireHandle(); // C5g: before the first await
  const id = incKey(incSeq++); // reserved now: a concurrent writer can never take it
  const encrypted = await encryptPayload(familyKey, framed);
  const payload = bufferToBase64(encrypted);
  assertSameHandle(db, 'persistIncrement');
  await withIdbRetry('persistIncrement', () =>
    db.add(STORE_NAME, { id, payload, updatedAt: nowIso() })
  );
  if (cacheDb !== db) return;
  containedRows.add(id);
  incRowCount += 1;
}

/** How many increments sit on top of the current base (the re-compaction trigger). */
export function incrementCount(): number {
  return incRowCount;
}

// ─── Projection snapshot (display-only fast first paint) ──────────────────────

/**
 * `SNAPSHOT_VERSION` guards a stored projection snapshot against a shape it can no
 * longer be rendered into. It is `<manual-rev>:<collections-fingerprint>`:
 *   - the fingerprint is a stable hash of `COLLECTION_NAMES`, so ADD/REMOVE/RENAME
 *     of a collection changes the version AUTOMATICALLY (a stale snapshot naming an
 *     unknown collection can never be applied), and
 *   - `SNAPSHOT_MANUAL_REV` is bumped BY HAND on any change to a persisted ENTITY
 *     shape that a stale snapshot would render wrong even though collection names
 *     are unchanged.
 * On any mismatch the snapshot is ignored and the authoritative rebuild is the sole
 * source — so a forgotten manual bump only costs a one-open fallback, never a crash.
 */
// 2 (data-layer audit C9, 2026-10-03): `foldDoc` now stores the UNFLOORED absolute, so a
// snapshot written by an earlier build can hold a floored value a fresh rebuild would not.
const SNAPSHOT_MANUAL_REV = 2;
function collectionsFingerprint(): number {
  const s = [...COLLECTION_NAMES].sort().join(',');
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
export const SNAPSHOT_VERSION = `${SNAPSHOT_MANUAL_REV}:${collectionsFingerprint()}`;

/** The stored snapshot: the `buildFullProjection` delta array + its shape version. */
export interface ProjectionSnapshot {
  version: string;
  deltas: ProjectionDelta[];
}

/**
 * Persist the materialized-projection snapshot (encrypted with the family key, same
 * primitive as `persistDocBinary`). Single-row `put` (atomic per record — a torn
 * payload simply fails the next decrypt and falls back). NOT the source of truth.
 */
export async function persistProjectionSnapshot(
  familyKey: CryptoKey,
  snapshot: ProjectionSnapshot
): Promise<void> {
  const db = requireHandle(); // C5g: before the first await
  const bytes = new TextEncoder().encode(JSON.stringify(snapshot));
  const encrypted = await encryptPayload(familyKey, bytes);
  const payload = bufferToBase64(encrypted);
  assertSameHandle(db, 'persistSnapshot');
  await withIdbRetry('persistSnapshot', () =>
    db.put(STORE_NAME, { id: SNAPSHOT_KEY, payload, updatedAt: nowIso() })
  );
}

/**
 * Load + decrypt the stored projection snapshot. Returns `null` when absent (a clean
 * miss); **throws** on a decrypt/parse failure so the caller logs + falls back (never
 * a silent empty). Does NOT validate `version` — that is the caller's gate, so the
 * caller can telemeter version-mismatch distinctly from a hard decrypt failure.
 */
export async function loadProjectionSnapshot(
  familyKey: CryptoKey
): Promise<ProjectionSnapshot | null> {
  if (!cacheDb) throw new Error('Cache DB not initialized. Call initPersistenceDB() first.');
  const entry = (await withIdbRetry('loadSnapshot', () =>
    cacheDb!.get(STORE_NAME, SNAPSHOT_KEY)
  )) as { payload: string } | undefined;
  if (!entry) return null;
  const bytes = await decryptPayload(familyKey, new Uint8Array(base64ToBuffer(entry.payload)));
  return JSON.parse(new TextDecoder().decode(bytes)) as ProjectionSnapshot;
}

/**
 * Read the open-guard baseline row (#61/#65) VERBATIM, plus its `checkedAt`
 * (the row's `updatedAt`, reused as the trust clock). Returns null when absent.
 * Plaintext — no decrypt.
 *
 * `payload` is OPAQUE here by design: the format (revision + the #65 Drive-heads
 * fingerprint) is owned entirely by `@/services/sync/remoteBaseline`, which
 * decodes it main-side. Do NOT parse it here — a second owner of the format
 * would move the branchy compatibility logic out of that module's pure,
 * zero-mock test coverage.
 */
export async function readRemoteBaseline(): Promise<RemoteBaselineRow | null> {
  if (!cacheDb) throw new Error('Cache DB not initialized. Call initPersistenceDB() first.');
  const entry = (await withIdbRetry('loadRemoteBaseline', () =>
    cacheDb!.get(STORE_NAME, REMOTE_BASELINE_KEY)
  )) as { payload: string; updatedAt: string } | undefined;
  if (!entry || !entry.payload) return null;
  return { payload: entry.payload, checkedAt: entry.updatedAt };
}

/**
 * Write the open-guard baseline row (#61/#65). This is the row's ONLY writer,
 * because `updatedAt` doubles as the trust clock — nothing else may refresh it.
 * `payload` is the already-encoded opaque string from `remoteBaseline`'s
 * `encodeBaselinePayload`; this function never inspects it.
 */
export async function writeRemoteBaseline(payload: string): Promise<void> {
  const db = requireHandle(); // C5g: a retry must not re-read a handle that moved
  await withIdbRetry('writeRemoteBaseline', () =>
    db.put(STORE_NAME, { id: REMOTE_BASELINE_KEY, payload, updatedAt: nowIso() })
  );
}

/** Delete the open-guard baseline row (#61). No-op if the DB is closed/absent. */
export async function clearRemoteBaseline(): Promise<void> {
  if (!cacheDb) return;
  await withIdbRetry('clearRemoteBaseline', () => cacheDb!.delete(STORE_NAME, REMOTE_BASELINE_KEY));
}

/**
 * Reconstruct the cached doc: load the base (`loadAndVerify`) then apply the
 * increments in seq order. Returns `null` if no base/legacy row exists.
 *
 * Fast path applies all increments in one `applyChanges` call. On ANY increment
 * failure (decrypt / unframe / apply) it falls back to applying increments one at
 * a time and SKIPS each bad one (C5c: it used to STOP there, and the caller's base
 * rewrite then deleted every good row after it). Either way it then asks
 * `getMissingDeps`: Automerge buffers a change whose deps are absent without
 * throwing, so a replay can "succeed" while holding work it cannot show. The answer
 * rides back in the `CacheReplay` fields; `recovered:true` covers both.
 *
 * Also records which rows the reconstructed document provably CONTAINS
 * (`containedRows`), which is all a later non-superseding base write may delete.
 * A base that decrypts but won't materialize still throws `CorruptPayloadError` (the
 * caller clears-and-rebuilds) — a corrupt BASE is unrecoverable, unlike a corrupt tail.
 */
export async function loadCachedDoc(
  familyKey: CryptoKey,
  familyId: string | null
): Promise<({ doc: Doc } & CacheReplay) | null> {
  const db = requireHandle();

  const baseEntry =
    (await withIdbRetry('loadBase', () => db.get(STORE_NAME, BASE_KEY))) ??
    (await withIdbRetry('loadLegacyDoc', () => db.get(STORE_NAME, LEGACY_DOC_KEY)));
  if (!baseEntry) return null;

  // Classified because an unclassified throw here reaches `initAndLoadCache`
  // looking like corruption, and that branch DELETES the cache — which cannot
  // help a device that simply had no room for the buffer.
  let baseBinary: Uint8Array;
  try {
    baseBinary = await decryptPayload(familyKey, new Uint8Array(base64ToBuffer(baseEntry.payload)));
  } catch (e) {
    throw payloadFailure('decrypt', e, familyId, decodedSizeOf(baseEntry.payload));
  }
  const baseDoc = loadAndVerify(baseBinary, familyId); // throws CorruptPayloadError on a bad base

  const incEntries = (await withIdbRetry('loadIncrements', () =>
    db.getAll(STORE_NAME, IDBKeyRange.bound(INC_PREFIX, INC_UPPER, false, true))
  )) as Array<{ id: string; payload: string }>;
  const finish = (
    doc: Doc,
    applied: Map<string, Uint8Array[]>,
    dropped: number
  ): { doc: Doc } & CacheReplay => {
    const missingDeps = Automerge.getMissingDeps(doc, []).length;
    const contained = new Set<string>();
    for (const [id, changes] of applied) {
      // With nothing missing every applied row is in the history. Otherwise check each change:
      // a buffered change is NOT in it (`hasHeads` answers false), and its row must survive.
      if (
        missingDeps === 0 ||
        changes.every((c) => Automerge.hasHeads(doc, [Automerge.decodeChange(c).hash!]))
      ) {
        contained.add(id);
      }
    }
    if (cacheDb === db) containedRows = contained;
    return {
      doc,
      recovered: dropped > 0 || missingDeps > 0,
      droppedIncrements: dropped,
      missingDeps,
      incrementCount: incEntries.length,
    };
  };
  if (incEntries.length === 0) return finish(baseDoc, new Map(), 0);

  /** Decrypt one increment, classifying an allocation failure as `decrypt`. */
  const openIncrement = async (payload: string): Promise<Uint8Array> => {
    try {
      return await decryptPayload(familyKey, new Uint8Array(base64ToBuffer(payload)));
    } catch (e) {
      // Classified HERE rather than in the outer catch, which also covers
      // `applyChanges`: labelling an increment-decode failure `materialize` is
      // wrong in the field a triager reads first.
      if (isAllocationFailure(e)) throw oomDuringReplay('decrypt', e, familyId, baseBinary);
      throw e;
    }
  };

  // Fast path: decrypt + unframe every increment, apply in one call.
  try {
    const applied = new Map<string, Uint8Array[]>();
    const all: Uint8Array[] = [];
    for (const entry of incEntries) {
      const changes = unframeChanges(await openIncrement(entry.payload));
      applied.set(entry.id, changes);
      all.push(...changes);
    }
    return finish(applyChanges(baseDoc, all).doc, applied, 0);
  } catch (fastErr) {
    // Already classified by `openIncrement` — do not relabel it below.
    if (fastErr instanceof PayloadLoadError) throw fastErr;
    // ⚠️ OUT OF MEMORY IS NOT CORRUPTION, AND THE SLOW PATH DESTROYS DATA FOR IT.
    //
    // If the fast path failed because the device could not allocate, EVERY
    // single-increment apply below fails the same way, so replay would drop EVERY
    // increment and return `recovered: true`. The increments are fine; this device
    // just couldn't inflate them. Surface it so `initAndLoadCache` takes its
    // preserve-the-cache branch and the bytes survive for a device (or a
    // reload) that can.
    if (isAllocationFailure(fastErr)) {
      throw oomDuringReplay('materialize', fastErr, familyId, baseBinary);
    }

    // Slow path: apply increments one at a time from a fresh base, SKIP each bad one, keep
    // everything else. Never a silent partial: the counts ride back to main.
    console.warn(
      '[cache] increment apply failed — replaying one at a time and skipping the bad rows.',
      fastErr
    );
    let doc = loadAndVerify(baseBinary, familyId);
    const applied = new Map<string, Uint8Array[]>();
    let dropped = 0;
    for (const entry of incEntries) {
      try {
        const changes = unframeChanges(await openIncrement(entry.payload));
        doc = applyChanges(doc, changes).doc;
        applied.set(entry.id, changes);
      } catch (incErr) {
        // Same reasoning as above: running out of memory partway through replay
        // must not be recorded as "this row is corrupt".
        if (incErr instanceof PayloadLoadError) throw incErr;
        if (isAllocationFailure(incErr)) {
          throw oomDuringReplay('materialize', incErr, familyId, baseBinary);
        }
        console.warn(`[cache] skipping increment ${entry.id} (corrupt/unapplyable).`, incErr);
        dropped++;
      }
    }
    return finish(doc, applied, dropped);
  }
}

/**
 * Increment replay's allocation failure, as the typed error the load path
 * branches on.
 *
 * The guarded blocks wrap `base64ToBuffer` + `decryptPayload` as well as
 * `applyChanges`, so the step is NOT always `materialize` — hardcoding it
 * mislabelled an increment-decode failure in the field a triager reads first.
 * Callers pass the step their block actually reached.
 *
 * The size is the BASE's, which is the useful number either way: the increments
 * are individually small; the base is what had to fit in memory alongside them.
 */
function oomDuringReplay(
  step: PayloadLoadStep,
  cause: unknown,
  familyId: string | null,
  base: Uint8Array
) {
  return payloadFailure(step, cause, familyId, base.byteLength);
}

/** Cache the V4 envelope so the cache can be decrypted on refresh without the file. */
export async function persistEnvelope(envelope: BeanpodFileV4): Promise<void> {
  if (!cacheDb) return; // silently skip if not initialized (matches legacy behaviour)
  const db = cacheDb;

  // Strip the payload HERE, not at the callers: `createNewFile` reaches this
  // through `docClient.persistEnvelope` directly, bypassing `syncService`
  // entirely, so a caller-side strip would leave a payload-bearing row behind.
  // Without this, every key change JSON.stringify'd a multi-megabyte base64
  // string into IndexedDB — on the poll path.
  //
  // Safe because the cached envelope is only ever a key-material carrier: the
  // document itself comes from `loadCachedDoc`, and the one reader bails unless
  // that doc-cache hit too.
  const withoutBytes = withoutPayload(envelope);
  await withIdbRetry('persistEnvelope', () =>
    db.put(STORE_NAME, {
      id: ENVELOPE_KEY,
      payload: JSON.stringify(withoutBytes),
      updatedAt: nowIso(),
    })
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
 * Delete the cache IndexedDB for a family, and wait (bounded) for it to go.
 *
 * Closes our own connection FIRST so the delete isn't blocked by it; every
 * other tab's connection answers the resulting `versionchange` by closing (see
 * `blocking` above). `onblocked` is therefore NOT an answer any more: it fires
 * briefly whenever a peer is still draining a transaction, and `onsuccess`
 * follows. Only a peer that cannot answer at all (a frozen tab) runs out the
 * deadline, which resolves `{ deleted: false }`: the encrypted cache is still on
 * disk, the caller is told the truth and must not report it as clean, and the
 * queued delete completes by itself once that tab closes. It resolves rather
 * than rejects because a blocked delete must not fail sign-out. The one thing a
 * caller must not do after `false` is immediately re-open.
 */
export async function clearCache(familyId: string): Promise<CacheClearResult> {
  // Our own connection first, so it cannot block the delete.
  if (cacheDbFamilyId === familyId) closeHandle();

  const dbName = `${DB_PREFIX}${familyId}`;
  try {
    await withTimeout(
      deleteDB(dbName, {
        blocked: () => console.warn(`[cache] delete of ${dbName} is waiting on another connection`),
      }),
      CACHE_DELETE_TIMEOUT_MS,
      `cache delete still blocked after ${CACHE_DELETE_TIMEOUT_MS}ms: ${dbName} is held open by another tab, window or the installed app`,
      'CacheDeleteTimeoutError'
    );
    return { deleted: true };
  } catch (e) {
    if (e instanceof Error && e.name === 'CacheDeleteTimeoutError') return { deleted: false };
    throw e; // a real IDB error: the caller's step runner reports it
  }
}

/**
 * Close the cache DB connection without deleting it (sign-out, family switch, via
 * `applyAndProject.reset()`). A signed-out tab has no reason to hold a connection,
 * and holding one is what blocks another tab's delete (#100).
 */
export function closeCacheDB(): void {
  closeHandle();
}

/** ISO timestamp. Isolated so tests with a fixed clock can spy if needed. */
function nowIso(): string {
  return new Date().toISOString();
}

/** Test-only: force-close + forget the cache handle between cases. */
export function __resetCacheForTesting(): void {
  closeCacheDB();
  releasedListener = null;
}
