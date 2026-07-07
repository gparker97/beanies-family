// @vitest-environment node
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import * as Automerge from '@automerge/automerge';
import type { FamilyDocument } from '@/types/automerge';
import { generateFamilyKey } from '@/services/crypto/familyKeyService';
import {
  migrateDoc,
  applyMutation,
  saveDoc,
  loadDoc,
  encryptDocPayload,
  encryptChunk,
  decryptToDoc,
  applyChanges as docApplyChanges,
  getHeads as docHeads,
  getChangesSince as docChangesSince,
} from '@/services/automerge/worker/docOps';
import {
  configure,
  setKey,
  mutate,
  mergeRemoteEnvelope,
  exportEncryptedPayload,
  applyRemoteChunks,
  exportIncrementalPayload,
  getHeads,
  getActorId,
  __resetApplyAndProjectForTesting,
  type WorkerSink,
} from '@/services/automerge/worker/applyAndProject';
import * as cache from '@/services/automerge/worker/cache';
import type { AuxStore } from '../storageProvider';
import {
  chunkName,
  isChunkName,
  parseChunkName,
  pullIncremental,
  publishIncremental,
  newTransportSession,
  type TransportDeps,
} from '../incrementalTransport';
import type { BeanpodFileV4 } from '@/types/syncFileV4';

type Doc = Automerge.Doc<FamilyDocument>;
const FAMILY_ID = 'transport-test-family';
const base = (): Doc => migrateDoc(Automerge.init<FamilyDocument>());
const acct = (doc: Doc, id: string, bal: number): Doc =>
  applyMutation(doc, { op: 'set', collection: 'accounts', id, entity: { id, balance: bal } }).doc;
const copy = (doc: Doc): Doc => loadDoc(saveDoc(doc));

const envelopeFor = async (doc: Doc, key: CryptoKey): Promise<BeanpodFileV4> =>
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

function fakeAux(): AuxStore & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    list: async () => [...map.keys()],
    read: async (n) => map.get(n) ?? null,
    write: async (n, c) => {
      map.set(n, c);
    },
    delete: async (n) => {
      map.delete(n);
    },
  };
}

describe('incrementalTransport — chunk naming', () => {
  it('chunkName / parseChunkName round-trip; isChunkName filters; lexical == seq order', () => {
    const name = chunkName('actor-xyz', 7);
    expect(isChunkName(name)).toBe(true);
    expect(isChunkName('family.beanpod')).toBe(false);
    expect(parseChunkName(name)).toEqual({ actorId: 'actor-xyz', seq: 7 });
    expect(chunkName('a', 2) < chunkName('a', 10)).toBe(true);
  });
});

describe('incrementalTransport — two-device convergence (device A = worker)', () => {
  let key: CryptoKey;
  let depsA: TransportDeps;

  beforeEach(async () => {
    __resetApplyAndProjectForTesting();
    cache.__resetCacheForTesting();
    const sink: WorkerSink = { pushChunk() {}, perf() {}, cachePersistFailed() {} };
    configure(sink);
    key = await generateFamilyKey();
    depsA = {
      applyRemoteChunks: (p) => applyRemoteChunks(p),
      exportIncrementalPayload: (h) => exportIncrementalPayload(h),
      getHeads: async () => getHeads(),
      getActorId: async () => getActorId(),
    };
  });

  /** Adopt `doc` into the worker (device A) as its currentDoc (shared history). */
  const adoptA = async (doc: Doc) => {
    setKey(key);
    await mergeRemoteEnvelope(await envelopeFor(copy(doc), key), FAMILY_ID);
  };

  /** Read device A's current doc back (decrypt the worker's exported payload). */
  const readA = async (): Promise<Doc> => {
    const { payload } = await exportEncryptedPayload();
    return decryptToDoc(
      { encryptedPayload: payload, familyId: FAMILY_ID } as unknown as BeanpodFileV4,
      key
    );
  };

  /** Write device B's delta (fromDoc → toDoc) into the aux store as a chunk. */
  const publishB = async (aux: AuxStore, seq: number, fromDoc: Doc, toDoc: Doc) => {
    const payload = await encryptChunk(
      { frontierHeads: docHeads(toDoc), changes: docChangesSince(toDoc, docHeads(fromDoc)) },
      key
    );
    await aux.write(chunkName('deviceB', seq), payload);
  };

  it('A publishes a delta chunk that device B applies → both converge; then B → A', async () => {
    const shared = acct(base(), 'a1', 1);
    await adoptA(shared);
    const aux = fakeAux();
    const sessionA = newTransportSession();

    // First publish this session is base-only (no chunk).
    await publishIncremental(aux, depsA, sessionA);
    expect(aux.map.size).toBe(0);

    // A mutates locally, publishes again → a real delta chunk lands in aux.
    mutate({ op: 'set', collection: 'accounts', id: 'a2', entity: { id: 'a2', balance: 2 } });
    await publishIncremental(aux, depsA, sessionA);
    const aChunks = [...aux.map.keys()].filter(isChunkName);
    expect(aChunks).toHaveLength(1);

    // Device B (starts from shared) applies A's chunk and converges.
    let bDoc = copy(shared);
    const aChunk = await decryptChunkRaw(aux, aChunks[0]!, key);
    bDoc = docApplyChanges(bDoc, aChunk).doc;
    expect((bDoc.accounts as Record<string, unknown>).a2).toEqual({ id: 'a2', balance: 2 });

    // Device B makes its own change and publishes; A pulls and converges.
    const bDoc2 = acct(bDoc, 'b1', 9);
    await publishB(aux, 0, bDoc, bDoc2);
    const pull = await pullIncremental(aux, depsA, sessionA);
    expect(pull.outcome).toBe('applied');
    const aFinal = await readA();
    expect(Object.keys(aFinal.accounts).sort()).toEqual(['a1', 'a2', 'b1']);
  });

  it('pull applies TWO concurrent peer chunks in one batch and converges', async () => {
    const shared = acct(base(), 'a1', 1);
    await adoptA(shared);
    const aux = fakeAux();
    const sessionA = newTransportSession();

    // Two peers, each a concurrent child of `shared`.
    await publishB(aux, 0, shared, acct(copy(shared), 'x1', 2));
    // A second distinct device writes its own chunk name.
    const y = acct(copy(shared), 'y1', 3);
    await aux.write(
      chunkName('deviceC', 0),
      await encryptChunk(
        { frontierHeads: docHeads(y), changes: docChangesSince(y, docHeads(shared)) },
        key
      )
    );

    const pull = await pullIncremental(aux, depsA, sessionA);
    expect(pull.outcome).toBe('applied');
    const aFinal = await readA();
    expect(Object.keys(aFinal.accounts).sort()).toEqual(['a1', 'x1', 'y1']);
  });

  it('a chunk with absent causal deps → fallback (missing-deps), NOT marked fetched', async () => {
    const shared = acct(base(), 'a1', 1);
    await adoptA(shared);
    const aux = fakeAux();
    const sessionA = newTransportSession();

    // Chunk carries only a3 (depends on a2, which A lacks).
    const peerA2 = acct(copy(shared), 'a2', 2);
    const peerA3 = acct(copy(peerA2), 'a3', 3);
    await aux.write(
      chunkName('deviceB', 0),
      await encryptChunk(
        { frontierHeads: docHeads(peerA3), changes: docChangesSince(peerA3, docHeads(peerA2)) },
        key
      )
    );

    const pull = await pullIncremental(aux, depsA, sessionA);
    expect(pull).toEqual({ outcome: 'fallback', reason: 'missing-deps' });
    // Not marked fetched → a later pull retries it (after the whole-doc reconcile).
    expect(sessionA.fetched.size).toBe(0);
  });

  it('pull reports dirty=true when A has a local change the peer chunk lacks', async () => {
    const shared = acct(base(), 'a1', 1);
    await adoptA(shared);
    mutate({ op: 'set', collection: 'accounts', id: 'w1', entity: { id: 'w1', balance: 5 } });
    const aux = fakeAux();
    const sessionA = newTransportSession();
    await publishB(aux, 0, shared, acct(copy(shared), 'a2', 2));

    const pull = await pullIncremental(aux, depsA, sessionA);
    expect(pull).toEqual({ outcome: 'applied', dirty: true });
  });

  it('a missing (pruned) chunk body → fallback (read-failed / chunk-missing)', async () => {
    const shared = acct(base(), 'a1', 1);
    await adoptA(shared);
    const aux = fakeAux();
    const sessionA = newTransportSession();
    // A chunk name is listed but its body is gone (raced prune).
    const throwingAux: AuxStore = {
      list: async () => [chunkName('deviceB', 0)],
      read: async () => null, // pruned
      write: aux.write,
      delete: aux.delete,
    };
    const pull = await pullIncremental(throwingAux, depsA, sessionA);
    expect(pull.outcome).toBe('fallback');
  });
});

describe('incrementalTransport — own-chunk pruning', () => {
  it('prunes this device own chunks older than the keep-window; keeps others', async () => {
    const aux = fakeAux();
    // Pre-populate 60 of our own chunks + one from another device.
    for (let i = 0; i < 60; i++) await aux.write(chunkName('me', i), 'x');
    await aux.write(chunkName('other', 0), 'y');

    const session = newTransportSession();
    session.actorId = 'me';
    session.publishSeq = 60;
    session.lastPublishedHeads = ['h']; // non-null + heads unchanged → no new chunk, prune only

    const deps: TransportDeps = {
      applyRemoteChunks: async () => ({ heads: [], landed: true, dirty: false }),
      exportIncrementalPayload: async () => ({ payload: '' }),
      getHeads: async () => ({ heads: ['h'] }),
      getActorId: async () => ({ actorId: 'me' }),
    };

    await publishIncremental(aux, deps, session);

    // cutoff = 60 - 12 = 48 → own seq 0..47 pruned, 48..59 kept, other untouched.
    const ownSeqs = [...aux.map.keys()]
      .map((n) => parseChunkName(n))
      .filter((p): p is { actorId: string; seq: number } => !!p && p.actorId === 'me')
      .map((p) => p.seq)
      .sort((a, b) => a - b);
    expect(ownSeqs[0]).toBe(48);
    expect(ownSeqs).toHaveLength(12);
    expect(aux.map.has(chunkName('other', 0))).toBe(true);
  });
});

/** Decrypt a chunk body from the aux store back to its raw changes (device B side). */
async function decryptChunkRaw(aux: AuxStore, name: string, key: CryptoKey): Promise<Uint8Array[]> {
  const body = await aux.read(name);
  if (!body) throw new Error('missing chunk');
  const { decryptChunk } = await import('@/services/automerge/worker/docOps');
  return (await decryptChunk(body, key)).changes;
}
