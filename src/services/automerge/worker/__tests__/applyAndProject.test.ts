// @vitest-environment node
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as Automerge from '@automerge/automerge';
import type { FamilyDocument } from '@/types/automerge';
import { generateFamilyKey } from '@/services/crypto/familyKeyService';
import { migrateDoc, applyMutation, saveDoc, encryptDocPayload } from '../docOps';
import * as cache from '../cache';
import {
  configure,
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
    const sink: WorkerSink = {
      pushChunk: (delta, final) => chunks.push({ delta, final }),
      perf: (label) => perf.push(label),
      cachePersistFailed: (f) => failed.push(f),
    };
    configure(sink);
    key = await generateFamilyKey();
  });

  afterEach(async () => {
    await cache.clearCache(FAMILY_ID).catch(() => {});
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
    expect(reloaded!.accounts.a1).toEqual({ id: 'a1', balance: 7 });
    expect(perf).toContain('automerge.save'); // save timing relayed
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

  it('mergeRemoteEnvelope with an unsynced local change reports dirty:true and keeps both', async () => {
    // Local and remote must share ancestry (as they do in production — both
    // descend from the same created doc), else the two independently-migrated
    // `todos` maps conflict on merge and one side's entry is dropped. Prime the
    // cache with a shared origin, load it as local, derive remote from the same.
    const originBin = saveDoc(base());
    await cache.initPersistenceDB(FAMILY_ID);
    await cache.persistDocBinary(key, originBin);

    setKey(key);
    await initAndLoadCache(FAMILY_ID); // currentDoc = origin
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
    const todos = bulkFor('todos').at(-1)!;
    const ids = todos.entities.map(([id]) => id).sort();
    expect(ids).toEqual(['l1', 'r1']);
    expect(perf).toContain('automerge.remoteLoad');
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
