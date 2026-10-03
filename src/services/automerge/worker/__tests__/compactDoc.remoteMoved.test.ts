// @vitest-environment node
/**
 * C1 (data-layer audit 2026-10-03): a compaction must never be published over edits a peer
 * made to the OLD lineage after the compaction's source was captured.
 *
 * The area-L probe shape: the compactor holds `compact(origin)`, a peer wrote a todo to
 * `origin` on Drive in the meantime. The lineage verdict is `ours-newer`, whose policy cell is
 * `publish-local`, so before the fix the worker answered `kept-local` and the caller uploaded
 * the compacted document straight over the peer's todo, for every device that then adopted it.
 */
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import * as Automerge from '@automerge/automerge';
import { PodLineageError } from '@/services/sync/podLineage';
import { reconstructError, serializeError } from '../protocol';

const { generateFamilyKey, encryptPayload } = await import('@/services/crypto/familyKeyService');
const { bufferToBase64 } = await import('@/utils/encoding');
const ap = await import('../applyAndProject');

type Doc = Record<string, unknown>;
type Coll = Record<string, Record<string, unknown>>;

async function envelopeFor(doc: Automerge.Doc<Doc>, key: CryptoKey) {
  return {
    version: '4.0' as const,
    familyId: 'fam',
    familyName: 'F',
    keyId: 'k',
    wrappedKeys: {},
    passkeyWrappedKeys: {},
    inviteKeys: {},
    encryptedPayload: bufferToBase64(await encryptPayload(key, Automerge.save(doc))),
  };
}

let key: CryptoKey;
beforeEach(async () => {
  key = await generateFamilyKey();
  ap.__resetApplyAndProjectForTesting();
  ap.configure({ pushChunk() {}, perf() {}, cachePersistFailed() {}, cacheReleased() {} });
  await ap.setKey(key);
});

/** The origin both sides share: a family with one todo, installed in the worker realm. */
function seedOrigin(): { binary: Uint8Array; heads: string[] } {
  ap.initDoc();
  ap.mutate({ op: 'set', collection: 'todos', id: 'origin', entity: { id: 'origin', t: 'o' } });
  return { binary: ap.exportSnapshot().binary, heads: ap.getHeads().heads };
}

/** A peer on the OLD lineage writes a todo to `origin`. */
function peerWrites(originBinary: Uint8Array): Automerge.Doc<Doc> {
  const peer = Automerge.load<Doc>(originBinary);
  return Automerge.change(peer, (d) => {
    (d.todos as Coll).peer = { id: 'peer', t: 'written after the compaction' };
  });
}

const todosOf = (binary: Uint8Array) =>
  Object.keys((Automerge.toJS(Automerge.load<Doc>(binary)) as { todos: Coll }).todos).sort();

describe('C1: ours-newer with a remote that moved after the compaction', () => {
  it('BLOCKS instead of keeping (and publishing) the compacted document', async () => {
    const origin = seedOrigin();
    ap.compactDoc();
    const compacted = ap.exportSnapshot().binary;
    const remote = peerWrites(origin.binary);
    const env = await envelopeFor(remote, key);

    const err = await ap
      .mergeRemoteEnvelope(env, 'fam', { kind: 'baseline', heads: origin.heads })
      .then(
        () => null,
        (e: unknown) => e
      );
    expect(err).toBeInstanceOf(PodLineageError);
    expect((err as PodLineageError).verdict).toBe('ours-newer');
    expect((err as PodLineageError).remoteMovedAfterCompaction).toBe(true);
    // The flag survives the worker boundary (main logs on it).
    const wire = reconstructError(serializeError(err)) as PodLineageError;
    expect(wire.remoteMovedAfterCompaction).toBe(true);

    // Nothing was touched: the worker still holds exactly the compacted document, and the
    // peer's todo is still on the remote (nothing was cleared to publish over it).
    expect(ap.exportSnapshot().binary).toEqual(compacted);
    expect(todosOf(Automerge.save(remote))).toEqual(['origin', 'peer']);
  });

  it('a dirty basis blocks too (the policy cell is the same)', async () => {
    const origin = seedOrigin();
    ap.compactDoc();
    const env = await envelopeFor(peerWrites(origin.binary), key);
    await expect(
      ap.mergeRemoteEnvelope(env, 'fam', { kind: 'baseline', heads: null })
    ).rejects.toMatchObject({ verdict: 'ours-newer', remoteMovedAfterCompaction: true });
  });

  it('control: a remote that is exactly the compacted source still keeps local', async () => {
    const origin = seedOrigin();
    ap.compactDoc();
    const env = await envelopeFor(Automerge.load<Doc>(origin.binary), key);
    const res = await ap.mergeRemoteEnvelope(env, 'fam', {
      kind: 'baseline',
      heads: origin.heads,
    });
    expect(res.action).toBe('kept-local');
  });

  it('a user-file choice still adopts (the rollback route never blocks)', async () => {
    const origin = seedOrigin();
    ap.compactDoc();
    const env = await envelopeFor(peerWrites(origin.binary), key);
    const res = await ap.mergeRemoteEnvelope(env, 'fam', { kind: 'user-file', heads: null });
    expect(res.action).toBe('adopted');
    expect(todosOf(ap.exportSnapshot().binary)).toEqual(['origin', 'peer']);
  });

  it("a legacy stamp (no fromHeads) keeps today's behaviour: kept-local", async () => {
    const origin = seedOrigin();
    const plain = Automerge.toJS(Automerge.load<Doc>(origin.binary));
    ap.loadSnapshot(
      Automerge.save(Automerge.from<Doc>({ ...plain, podLineage: { id: 'L', seq: 1 } }))
    );
    const env = await envelopeFor(peerWrites(origin.binary), key);
    const res = await ap.mergeRemoteEnvelope(env, 'fam', {
      kind: 'baseline',
      heads: origin.heads,
    });
    expect(res.action).toBe('kept-local');
  });

  it('compactDoc records the heads it compacted from', () => {
    const origin = seedOrigin();
    ap.compactDoc();
    const lineage = (
      Automerge.toJS(Automerge.load<Doc>(ap.exportSnapshot().binary)) as {
        podLineage: { fromHeads?: string[] };
      }
    ).podLineage;
    expect(lineage.fromHeads).toEqual(origin.heads);
  });
});
