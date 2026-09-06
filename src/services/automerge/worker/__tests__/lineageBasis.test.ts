/**
 * The basis is an INSTRUCTION, not a hint — behaviour, not source text.
 *
 * ⚠️ WHY THIS FILE EXISTS. Stage 1 shipped with `no-local-document` mapped only
 * to a `clean` CONTEXT, and `same` × `clean` resolves to `merge`. So the three
 * store paths that pass it — all of which do so because the worker may be
 * holding a DIFFERENT family's document — CRDT-merged the remote into that
 * foreign document, persisted the union to the wrong family's cache and
 * uploaded it to the wrong family's file. No lineage stamp was needed: it was
 * live for every user. It shipped green because every existing worker test
 * passes `{kind:'baseline', heads:null}`, so no test ever exercised the arm.
 */
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import * as Automerge from '@automerge/automerge';
import { PodLineageError } from '@/services/sync/podLineage';

const { generateFamilyKey, encryptPayload } = await import('@/services/crypto/familyKeyService');
const { bufferToBase64 } = await import('@/utils/encoding');
const ap = await import('../applyAndProject');

type Doc = Record<string, unknown>;

function docWith(collection: string, id: string, entity: unknown, lineage?: unknown): Uint8Array {
  const seed: Doc = { familyMembers: {}, todos: {}, settings: null };
  seed[collection] = { [id]: entity };
  if (lineage) seed.podLineage = lineage;
  return Automerge.save(Automerge.from(seed));
}

async function envelopeFor(binary: Uint8Array, key: CryptoKey) {
  return {
    version: '4.0' as const,
    familyId: 'fam',
    familyName: 'F',
    keyId: 'k',
    wrappedKeys: {},
    passkeyWrappedKeys: {},
    inviteKeys: {},
    encryptedPayload: bufferToBase64(await encryptPayload(key, binary)),
  };
}

let key: CryptoKey;
beforeEach(async () => {
  key = await generateFamilyKey();
  ap.reset();
  ap.configure({ pushChunk() {}, perf() {}, cachePersistFailed() {} });
  ap.setKey(key);
});

describe('no-local-document INSTALLS, and never merges', () => {
  it('does not union a foreign family document into the remote', async () => {
    // Family A resident (the shape `initAndLoadCache` leaves on a cache MISS —
    // it resets the cursors but does NOT drop the document).
    ap.loadSnapshot(docWith('todos', 'a1', { id: 'a1', title: 'A only' }));
    const remote = await envelopeFor(docWith('todos', 'b1', { id: 'b1', title: 'B only' }), key);

    const res = await ap.mergeRemoteEnvelope(remote, 'fam-B', { kind: 'no-local-document' });

    expect(res.action).toBe('adopted');
    const installed = Automerge.toJS(Automerge.load(ap.exportSnapshot().binary)) as {
      todos: Record<string, unknown>;
    };
    // The whole point: A's entity must be GONE, not merged alongside B's.
    expect(Object.keys(installed.todos)).toEqual(['b1']);
  });

  it('still installs when a document is resident AND the remote carries a lineage', async () => {
    // A respawn rehydrates a document, so a replayed `no-local-document` finds
    // one. The instruction must still hold.
    ap.loadSnapshot(docWith('todos', 'a1', { id: 'a1', title: 'A only' }));
    const remote = await envelopeFor(
      docWith('todos', 'b1', { id: 'b1', title: 'B only' }, { id: 'L1', seq: 1 }),
      key
    );

    const res = await ap.mergeRemoteEnvelope(remote, 'fam-B', { kind: 'no-local-document' });
    expect(res.action).toBe('adopted');
  });
});

describe('a baseline basis still merges same-lineage documents', () => {
  it('merges rather than installing, so today fleet is unchanged', async () => {
    // ⚠️ BOTH SIDES MUST SHARE ANCESTRY. Two independent `Automerge.from` calls
    // produce documents with NO common history, and merging those is precisely
    // the map-level conflict this whole tier is about — one side's collection
    // wins wholesale. A fixture built that way would "prove" a merge behaves
    // like an install, which is how you talk yourself into the wrong model.
    const base = Automerge.save(
      Automerge.from<Doc>({ familyMembers: {}, todos: {}, settings: null })
    );
    let mine = Automerge.load<Doc>(base);
    mine = Automerge.change(mine, (d) => {
      (d.todos as Record<string, unknown>).a1 = { id: 'a1', title: 'mine' };
    });
    let theirs = Automerge.load<Doc>(base);
    theirs = Automerge.change(theirs, (d) => {
      (d.todos as Record<string, unknown>).b1 = { id: 'b1', title: 'theirs' };
    });

    ap.loadSnapshot(Automerge.save(mine));
    const remote = await envelopeFor(Automerge.save(theirs), key);

    const res = await ap.mergeRemoteEnvelope(remote, 'fam', { kind: 'baseline', heads: null });

    expect(res.action).toBe('merged');
    const merged = Automerge.toJS(Automerge.load(ap.exportSnapshot().binary)) as {
      todos: Record<string, unknown>;
    };
    expect(Object.keys(merged.todos).sort()).toEqual(['a1', 'b1']);
  });
});

describe("a 'rebase' verdict refuses until Stage 3 implements it", () => {
  it('never silently falls through to a cross-lineage merge', async () => {
    // Stage 3 flips ONE POLICY cell to `'rebase'`, in another file, with no
    // compile error here. Falling through would be the merge in which the old
    // lineage wins deterministically — the whole failure this tier prevents.
    const { lineageAction } = await import('@/services/sync/podLineage');
    if (lineageAction('adopt-remote', 'dirty') !== 'rebase') {
      // Stage 1: the cell still blocks, so the guard throws before we get here.
      ap.loadSnapshot(docWith('todos', 'a1', { id: 'a1', title: 'mine' }, null));
      const remote = await envelopeFor(
        docWith('todos', 'b1', { id: 'b1', title: 'theirs' }, { id: 'L1', seq: 1 }),
        key
      );
      await expect(
        ap.mergeRemoteEnvelope(remote, 'fam', { kind: 'baseline', heads: null })
      ).rejects.toBeInstanceOf(PodLineageError);
    }
  });
});

describe('the retired ENVELOPE stamp is honoured once, then written into the document', () => {
  /**
   * ⚠️ THE TRANSITIONAL CASE THAT IS ALREADY IN THE FIELD. Files compacted by
   * the Tier-2 code recorded their lineage ONLY on the envelope, because the
   * document field did not exist yet. Stage 1 deleted that field from the type,
   * so without the fallback such a file reads as never-compacted — and a peer
   * still on the pre-compaction history CRDT-merges across lineages, which is
   * the one thing this whole tier exists to stop.
   */
  async function legacyEnvelope(binary: Uint8Array, lineage: unknown) {
    // The retired field, exactly as `reEncryptEnvelope`'s spread carries it
    // forward in a real pre-Stage-1 file.
    return { ...(await envelopeFor(binary, key)), podLineage: lineage };
  }

  it('blocks a cross-lineage merge that would otherwise look same-lineage', async () => {
    ap.loadSnapshot(docWith('todos', 'a1', { id: 'a1', title: 'unsynced' }));
    const remote = await legacyEnvelope(docWith('todos', 'b1', { id: 'b1', title: 'compacted' }), {
      id: 'L9',
      seq: 1,
    });

    // `heads: null` => dirty => `adopt-remote` × `dirty` blocks. Without the
    // fallback both sides read `null`, compare `same`, and MERGE.
    await expect(
      ap.mergeRemoteEnvelope(remote, 'fam', { kind: 'baseline', heads: null })
    ).rejects.toBeInstanceOf(PodLineageError);
  });

  it('stamps the adopted document so the next sync needs no envelope at all', async () => {
    const remote = await legacyEnvelope(docWith('todos', 'b1', { id: 'b1', title: 'compacted' }), {
      id: 'L9',
      seq: 3,
    });

    const res = await ap.mergeRemoteEnvelope(remote, 'fam', { kind: 'no-local-document' });

    expect(res.action).toBe('adopted');
    const installed = Automerge.toJS(Automerge.load(ap.exportSnapshot().binary)) as {
      podLineage: { id: string; seq: number } | null;
    };
    expect(installed.podLineage).toEqual({ id: 'L9', seq: 3 });
    // Self-extinguishing: the stamp moves us past the bytes Drive holds, so the
    // publish that follows writes it into the file and the reader is done with
    // this family. (`dirty` is not the assertion — `migrateDoc` seeds missing
    // collections on this fixture and would set it either way.)
    expect(res.remoteHeads).not.toEqual(res.heads);
  });

  it('leaves an unstamped pod unstamped — no churn for the whole existing fleet', async () => {
    const remote = await envelopeFor(docWith('todos', 'b1', { id: 'b1', title: 'plain' }), key);

    const res = await ap.mergeRemoteEnvelope(remote, 'fam', { kind: 'no-local-document' });

    const installed = Automerge.toJS(Automerge.load(ap.exportSnapshot().binary)) as {
      podLineage?: unknown;
    };
    expect(installed.podLineage ?? null).toBeNull();
    expect(res.action).toBe('adopted');
  });

  it('ignores a malformed stamp rather than making seq comparisons NaN', async () => {
    // JSON off a decrypted file, no longer covered by the type.
    for (const junk of [{ id: 'L1' }, { seq: 2 }, 'L1', 42, {}]) {
      ap.reset();
      ap.setKey(key);
      const remote = await legacyEnvelope(docWith('todos', 'b1', { id: 'b1' }), junk);
      const res = await ap.mergeRemoteEnvelope(remote, 'fam', { kind: 'no-local-document' });
      const installed = Automerge.toJS(Automerge.load(ap.exportSnapshot().binary)) as {
        podLineage?: unknown;
      };
      expect(res.action).toBe('adopted');
      expect(installed.podLineage ?? null).toBeNull();
    }
  });
});
