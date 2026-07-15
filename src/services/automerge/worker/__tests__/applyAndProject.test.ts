// @vitest-environment node
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as Automerge from '@automerge/automerge';
import type { FamilyDocument } from '@/types/automerge';
import { generateFamilyKey } from '@/services/crypto/familyKeyService';
import {
  migrateDoc,
  applyMutation,
  saveDoc,
  encryptDocPayload,
  getHeads,
  getChangesSince,
  frameChanges,
} from '../docOps';
import * as cache from '../cache';
import {
  configure,
  dispatch,
  setKey,
  initDoc,
  initAndLoadCache,
  openCache,
  mutate,
  mergeRemoteEnvelope,
  exportEncryptedPayload,
  flush,
  reset,
  __resetApplyAndProjectForTesting,
  __hasDocForTesting,
  type WorkerSink,
} from '../applyAndProject';
import type { ProjectionDelta } from '../protocol';
import type { BeanpodFileV4 } from '@/types/syncFileV4';

const FAMILY_ID = 'aap-test-family';
const base = () => migrateDoc(Automerge.init<FamilyDocument>());

const envelopeFor = async (
  doc: Automerge.Doc<FamilyDocument>,
  key: CryptoKey
): Promise<BeanpodFileV4> =>
  ({
    version: '4.0',
    familyId: FAMILY_ID,
    familyName: 'Test',
    keyId: 'k1',
    wrappedKeys: {},
    passkeyWrappedKeys: {},
    inviteKeys: {},
    encryptedPayload: await encryptDocPayload(doc, key),
  }) as unknown as BeanpodFileV4;

describe('worker/applyAndProject', () => {
  let key: CryptoKey;
  let chunks: Array<{ delta: ProjectionDelta; final: boolean }>;
  let perf: string[];
  let failed: boolean[];
  let failedDetails: Array<unknown>;

  const bulkFor = (collection: string) =>
    chunks
      .map((c) => c.delta)
      .filter((d): d is Extract<ProjectionDelta, { kind: 'bulk' }> => d.kind === 'bulk')
      .filter((d) => d.collection === collection);

  beforeEach(async () => {
    __resetApplyAndProjectForTesting();
    cache.__resetCacheForTesting();
    chunks = [];
    perf = [];
    failed = [];
    failedDetails = [];
    const sink: WorkerSink = {
      pushChunk: (delta, final) => chunks.push({ delta, final }),
      perf: (label) => perf.push(label),
      cachePersistFailed: (f, detail) => {
        failed.push(f);
        failedDetails.push(detail);
      },
    };
    configure(sink);
    key = await generateFamilyKey();
  });

  afterEach(async () => {
    await cache.clearCache(FAMILY_ID).catch(() => {});
  });

  it('dispatch(ping) returns { ok: true } with no doc loaded and no key set', async () => {
    // beforeEach resets all state — no doc, no key. Ping must still answer (it is a
    // pure liveness probe, so docClient can use it before/without unlock).
    expect(__hasDocForTesting()).toBe(false);
    await expect(dispatch('ping', undefined)).resolves.toEqual({ result: { ok: true } });
  });

  it('initDoc pushes a full projection with exactly one final chunk, all bulks reset', () => {
    initDoc();
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.filter((c) => c.final)).toHaveLength(1);
    expect(chunks[chunks.length - 1]!.final).toBe(true);
    // Every collection bulk is a reset (fresh full projection), + a settings delta.
    const bulks = chunks.map((c) => c.delta).filter((d) => d.kind === 'bulk');
    expect(bulks.every((d) => (d as { reset: boolean }).reset)).toBe(true);
    expect(chunks.some((c) => c.delta.kind === 'settings')).toBe(true);
  });

  it('mutate returns { result, delta } and a flush persists the doc to cache', async () => {
    setKey(key);
    await initAndLoadCache(FAMILY_ID); // opens the DB; empty → loaded:false
    initDoc();

    const { result, delta } = mutate({
      op: 'set',
      collection: 'accounts',
      id: 'a1',
      entity: { id: 'a1', balance: 7 },
    });
    expect(result).toEqual({ id: 'a1', balance: 7 });
    expect(delta).toEqual({
      kind: 'upsert',
      collection: 'accounts',
      id: 'a1',
      entity: { id: 'a1', balance: 7 },
    });

    await flush();
    const reloaded = await cache.loadCachedDoc(key, FAMILY_ID);
    expect(reloaded!.doc.accounts.a1).toEqual({ id: 'a1', balance: 7 });
    // First persist of a fresh doc writes a whole-doc base (B1); timing relayed.
    expect(perf).toContain('automerge.saveBase');
  });

  it('#50: a cache-persist WRITE failure signals cachePersistFailed(true, {kind, errorName}) and recovers', async () => {
    setKey(key);
    await initAndLoadCache(FAMILY_ID);
    initDoc();
    mutate({ op: 'set', collection: 'accounts', id: 'a1', entity: { id: 'a1', balance: 1 } });

    // First flush = a whole-doc BASE write (lastPersistedHeads === null) → force it to fail.
    const quota = new Error('quota'); // name it like a real IDB quota error
    quota.name = 'QuotaExceededError';
    const spy = vi.spyOn(cache, 'persistDocBinary').mockRejectedValueOnce(quota);

    await flush();

    expect(failed).toEqual([true]);
    // `kind` is 'base' via the explicit writeKind — proves it is NOT inferred wrong.
    expect(failedDetails[0]).toEqual({ kind: 'base', errorName: 'QuotaExceededError' });
    spy.mockRestore();

    // The next successful persist emits the recovery signal (false) on the edge.
    mutate({ op: 'set', collection: 'accounts', id: 'a2', entity: { id: 'a2', balance: 2 } });
    await flush();
    expect(failed).toEqual([true, false]);
  });

  it('#50: an INCREMENT write failure reports kind:"increment"', async () => {
    setKey(key);
    await initAndLoadCache(FAMILY_ID);
    initDoc();
    // A successful base first so lastPersistedHeads is set → the next write is an increment.
    mutate({ op: 'set', collection: 'accounts', id: 'a1', entity: { id: 'a1', balance: 1 } });
    await flush();
    expect(failed).toEqual([]);

    mutate({ op: 'set', collection: 'accounts', id: 'a2', entity: { id: 'a2', balance: 2 } });
    const err = new Error('boom');
    err.name = 'InvalidStateError';
    const spy = vi.spyOn(cache, 'persistIncrement').mockRejectedValueOnce(err);
    await flush();

    expect(failed).toEqual([true]);
    expect(failedDetails[0]).toEqual({ kind: 'increment', errorName: 'InvalidStateError' });
    spy.mockRestore();
  });

  it('initAndLoadCache streams a large collection as multiple bulk chunks (chunking)', async () => {
    // Prime the cache with a >1000-entity doc (one atomic batch → one change).
    const ops = Array.from({ length: 1001 }, (_, i) => ({
      op: 'set' as const,
      collection: 'transactions' as const,
      id: `t${i}`,
      entity: { id: `t${i}`, amount: i },
    }));
    const doc = applyMutation(base(), { op: 'batch', ops }).doc;
    await cache.initPersistenceDB(FAMILY_ID);
    await cache.persistDocBinary(key, saveDoc(doc));

    setKey(key);
    const res = await initAndLoadCache(FAMILY_ID);
    expect(res.loaded).toBe(true);

    const txnBulks = bulkFor('transactions');
    expect(txnBulks).toHaveLength(2); // 1000 + 1
    expect(txnBulks[0]!.reset).toBe(true);
    expect(txnBulks[0]!.entities).toHaveLength(1000);
    expect(txnBulks[1]!.reset).toBe(false); // continuation slice does NOT reset
    expect(txnBulks[1]!.entities).toHaveLength(1);
    // Exactly one final across the whole streamed projection.
    expect(chunks.filter((c) => c.final)).toHaveLength(1);
  });

  it('mergeRemoteEnvelope with no local doc adopts the remote (dirty:false)', async () => {
    setKey(key);
    await initAndLoadCache(FAMILY_ID); // no doc yet
    expect(__hasDocForTesting()).toBe(false);

    const remote = applyMutation(base(), {
      op: 'set',
      collection: 'todos',
      id: 'r1',
      entity: { id: 'r1', title: 'remote' },
    }).doc;
    const res = await mergeRemoteEnvelope(await envelopeFor(remote, key), FAMILY_ID);

    expect(res.dirty).toBe(false);
    expect(res.heads.length).toBeGreaterThan(0);
    const todos = bulkFor('todos').at(-1);
    expect(todos!.entities).toContainEqual(['r1', { id: 'r1', title: 'remote' }]);
  });

  it('poll-merge reports dirty:true, streams a DELTA (not a full rebuild), and keeps both', async () => {
    // Local and remote must share ancestry (as they do in production — both
    // descend from the same created doc), else the two independently-migrated
    // `todos` maps conflict on merge and one side's entry is dropped. Prime the
    // cache with a shared origin, load it as local, derive remote from the same.
    const originBin = saveDoc(base());
    await cache.initPersistenceDB(FAMILY_ID);
    await cache.persistDocBinary(key, originBin);

    setKey(key);
    await initAndLoadCache(FAMILY_ID); // currentDoc = origin (poll-merge path)
    mutate({ op: 'set', collection: 'todos', id: 'l1', entity: { id: 'l1', title: 'local' } });

    const remote = applyMutation(Automerge.load<FamilyDocument>(originBin), {
      op: 'set',
      collection: 'todos',
      id: 'r1',
      entity: { id: 'r1', title: 'remote' },
    }).doc;
    chunks = [];
    const res = await mergeRemoteEnvelope(await envelopeFor(remote, key), FAMILY_ID);

    expect(res.dirty).toBe(true); // local l1 is not in remote → must push back
    // A poll-merge now streams a DELTA (only the entity the merge brought in),
    // NOT a full 27-collection rebuild: an upsert for r1, and NO bulk reset.
    expect(bulkFor('todos')).toHaveLength(0);
    const todoUpserts = chunks
      .map((c) => c.delta)
      .filter((d): d is Extract<ProjectionDelta, { kind: 'upsert' }> => d.kind === 'upsert')
      .filter((d) => d.collection === 'todos');
    expect(todoUpserts.map((d) => d.id)).toEqual(['r1']);
    expect(todoUpserts[0]!.entity).toEqual({ id: 'r1', title: 'remote' });
    expect(perf).toContain('automerge.remoteLoad');

    // No data loss at the doc level: the merged doc keeps BOTH l1 and r1 even
    // though only r1 was streamed (l1 was already projected by the earlier mutate).
    const { payload } = await exportEncryptedPayload();
    const merged = await mergeReadBack(payload, key);
    expect(Object.keys(merged.todos).sort()).toEqual(['l1', 'r1']);
  });

  it('poll-merge falls back to a COMPLETE full projection (never a partial) when the delta cannot be derived', async () => {
    const originBin = saveDoc(base());
    await cache.initPersistenceDB(FAMILY_ID);
    await cache.persistDocBinary(key, originBin);

    setKey(key);
    await initAndLoadCache(FAMILY_ID); // currentDoc = origin (poll-merge path)
    mutate({ op: 'set', collection: 'todos', id: 'l1', entity: { id: 'l1' } });

    // Remote adds an UNKNOWN top-level key → projectionDeltasBetween returns null
    // → the merge must fall back to a full projection.
    const remote = Automerge.change(Automerge.load<FamilyDocument>(originBin), (d) => {
      (d as unknown as Record<string, Record<string, unknown>>).bogus = { x: { id: 'x' } };
    });
    chunks = [];
    await mergeRemoteEnvelope(await envelopeFor(remote, key), FAMILY_ID);

    // Half-update safety: the sink sees a COMPLETE full rebuild — every todos delta
    // is a bulk reset, NO partial upsert/remove leaked, a settings delta is present,
    // exactly one final chunk. Never a partial delta prefix followed by a reset.
    const todoBulks = bulkFor('todos');
    expect(todoBulks.length).toBeGreaterThan(0);
    expect(todoBulks.every((d) => d.reset)).toBe(true);
    expect(todoBulks.at(-1)!.entities.map(([id]) => id)).toContain('l1'); // full state kept
    const partial = chunks
      .map((c) => c.delta)
      .filter((d) => (d.kind === 'upsert' || d.kind === 'remove') && d.collection === 'todos');
    expect(partial).toHaveLength(0);
    expect(chunks.some((c) => c.delta.kind === 'settings')).toBe(true);
    expect(chunks.filter((c) => c.final)).toHaveLength(1);
  });

  it('mutate reports changed:false for a no-op (skipped op) and changed:true for a real write (F10)', () => {
    setKey(key);
    initDoc();
    // A skipped patch on an absent entity writes nothing → no-op.
    const noop = mutate({
      op: 'patch',
      collection: 'accounts',
      id: 'gone',
      patch: { name: 'X' },
      onMissing: 'skip',
    });
    expect(noop.changed).toBe(false);
    // A genuine write advances the doc heads → changed.
    const real = mutate({
      op: 'set',
      collection: 'accounts',
      id: 'a',
      entity: { id: 'a', balance: 1 },
    });
    expect(real.changed).toBe(true);
  });

  it('openCache opens the DB WITHOUT loading a cached doc — create keeps the fresh owner doc (F1)', async () => {
    // A stale cache row exists for this family (a prior/interrupted create attempt).
    const staleBin = saveDoc(
      applyMutation(base(), {
        op: 'set',
        collection: 'todos',
        id: 'stale',
        entity: { id: 'stale', title: 'old' },
      }).doc
    );
    await cache.initPersistenceDB(FAMILY_ID);
    await cache.persistDocBinary(key, staleBin);

    // Build a FRESH owner doc (as createNewFile does), then openCache.
    setKey(key);
    initDoc();
    mutate({ op: 'set', collection: 'accounts', id: 'fresh', entity: { id: 'fresh', balance: 1 } });
    chunks = [];
    const res = await openCache(FAMILY_ID);

    // openCache returns loaded:false and installs NOTHING (no projection push), so
    // the fresh doc survives — initAndLoadCache WOULD have clobbered it with `stale`.
    expect(res.loaded).toBe(false);
    expect(chunks).toEqual([]);
    expect(__hasDocForTesting()).toBe(true);
    // The current doc is still the fresh one: its encrypted export round-trips to a
    // doc containing `fresh`, not the stale cache's `stale`.
    const { payload } = await exportEncryptedPayload();
    const { decryptToDoc } = await import('../docOps');
    const current = await decryptToDoc(
      { ...(await envelopeFor(base(), key)), encryptedPayload: payload },
      key
    );
    expect(Object.keys(current.accounts)).toEqual(['fresh']);
    expect(Object.keys(current.todos)).toEqual([]);
  });

  it('guards: mutate without a doc throws; crypto op without a key throws', async () => {
    expect(() => mutate({ op: 'set', collection: 'goals', id: 'g', entity: { id: 'g' } })).toThrow(
      /no document/
    );
    initDoc(); // doc now exists, but no key set
    await expect(exportEncryptedPayload()).rejects.toThrow(/family key/);
  });

  it('reset drops the in-memory doc', () => {
    initDoc();
    expect(__hasDocForTesting()).toBe(true);
    reset();
    expect(__hasDocForTesting()).toBe(false);
    expect(() => mutate({ op: 'set', collection: 'goals', id: 'g', entity: { id: 'g' } })).toThrow(
      /no document/
    );
  });

  it('exportEncryptedPayload returns a payload that decrypts back to the same doc', async () => {
    setKey(key);
    initDoc();
    mutate({ op: 'set', collection: 'accounts', id: 'a1', entity: { id: 'a1', balance: 99 } });

    const { payload } = await exportEncryptedPayload();
    // Decrypt it back through the same crypto the Drive read path uses.
    const roundTripped = await mergeReadBack(payload, key);
    expect(roundTripped.accounts.a1).toEqual({ id: 'a1', balance: 99 });
  });

  // ─── B1: incremental cache persistence ─────────────────────────────────────

  it('B1: first persist writes a base, subsequent persists write increments; reload reconstructs', async () => {
    setKey(key);
    await initAndLoadCache(FAMILY_ID); // miss → loaded:false
    initDoc(); // lastPersistedHeads = null → next persist is a base

    mutate({ op: 'set', collection: 'accounts', id: 'a1', entity: { id: 'a1', balance: 1 } });
    await flush(); // base write
    mutate({ op: 'set', collection: 'accounts', id: 'a2', entity: { id: 'a2', balance: 2 } });
    await flush(); // increment (delta only)

    expect(perf).toContain('automerge.saveBase');
    expect(perf).toContain('automerge.saveIncremental');
    expect(cache.incrementCount()).toBe(1);

    const reloaded = await cache.loadCachedDoc(key, FAMILY_ID);
    expect(reloaded!.recovered).toBe(false);
    expect(reloaded!.doc.accounts.a1).toEqual({ id: 'a1', balance: 1 });
    expect(reloaded!.doc.accounts.a2).toEqual({ id: 'a2', balance: 2 });
  });

  it('B1: concurrent flushes are single-flighted — one pending delta → exactly one increment', async () => {
    setKey(key);
    await initAndLoadCache(FAMILY_ID);
    initDoc();
    mutate({ op: 'set', collection: 'accounts', id: 'a1', entity: { id: 'a1', balance: 1 } });
    await flush(); // base
    mutate({ op: 'set', collection: 'accounts', id: 'a2', entity: { id: 'a2', balance: 2 } });

    // Fire two flushes for the single pending delta without awaiting the first.
    // Serialized: the second sees an empty `getChangesSince` → no second row, and
    // the cursor never regresses (no duplicate `inc:` key).
    await Promise.all([flush(), flush()]);

    expect(cache.incrementCount()).toBe(1);
    const reloaded = await cache.loadCachedDoc(key, FAMILY_ID);
    expect(reloaded!.doc.accounts.a2).toEqual({ id: 'a2', balance: 2 });
  });

  it('B1: a no-op flush (no changes since last persist) writes nothing', async () => {
    setKey(key);
    await initAndLoadCache(FAMILY_ID);
    initDoc();
    mutate({ op: 'set', collection: 'accounts', id: 'a1', entity: { id: 'a1', balance: 1 } });
    await flush(); // base
    expect(cache.incrementCount()).toBe(0);
    await flush(); // nothing changed → no increment
    expect(cache.incrementCount()).toBe(0);
  });

  it('over-threshold increments COMPACT ONCE on load (self-heals an already-deployed device)', async () => {
    // Seed a cache with a base + MORE than INCREMENT_COMPACTION_THRESHOLD (50) valid
    // increments, bypassing the mutate-path auto-compaction — this mimics a device
    // that accumulated increments under the OLD 200 threshold before this build
    // lowered it. Without the compaction-on-load fix such a device would replay all
    // of them on EVERY cold load until it happened to edit.
    const OVER = 52; // > INCREMENT_COMPACTION_THRESHOLD (50)
    setKey(key);
    await initAndLoadCache(FAMILY_ID);
    initDoc();
    mutate({ op: 'set', collection: 'accounts', id: 'a0', entity: { id: 'a0', balance: 0 } });
    await flush(); // base write; incrementCount = 0
    // Directly append > threshold valid increments (derived from the base's lineage).
    let seedDoc = (await cache.loadCachedDoc(key, FAMILY_ID))!.doc;
    for (let i = 1; i <= OVER; i++) {
      const before = getHeads(seedDoc);
      seedDoc = applyMutation(seedDoc, {
        op: 'set',
        collection: 'accounts',
        id: `a${i}`,
        entity: { id: `a${i}`, balance: i },
      }).doc;
      await cache.persistIncrement(key, frameChanges(getChangesSince(seedDoc, before)));
    }
    expect(cache.incrementCount()).toBe(OVER);

    // Fresh session: reset in-memory state, then load. Over-threshold + not-recovered
    // → the else-branch schedules a one-time compaction (debounced).
    reset();
    setKey(key);
    perf.length = 0;
    const res = await initAndLoadCache(FAMILY_ID);
    expect(res.loaded).toBe(true);

    // The scheduled compaction fires on flush and rewrites a fresh base, clearing all increments.
    await flush();
    expect(cache.incrementCount()).toBe(0);
    expect(perf).toContain('automerge.saveBase');
    // Data intact after compaction.
    const reloaded = await cache.loadCachedDoc(key, FAMILY_ID);
    expect(reloaded!.recovered).toBe(false);
    expect(reloaded!.doc.accounts.a0).toEqual({ id: 'a0', balance: 0 });
    expect(reloaded!.doc.accounts[`a${OVER}`]).toEqual({ id: `a${OVER}`, balance: OVER });
  });
});

// Helper: decrypt an exported payload back into a doc (mirrors decryptToDoc).
async function mergeReadBack(
  payload: string,
  key: CryptoKey
): Promise<Automerge.Doc<FamilyDocument>> {
  const { decryptToDoc } = await import('../docOps');
  return decryptToDoc(
    { encryptedPayload: payload, familyId: FAMILY_ID } as unknown as BeanpodFileV4,
    key
  );
}
