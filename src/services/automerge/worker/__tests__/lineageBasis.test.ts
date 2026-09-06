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
import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as Automerge from '@automerge/automerge';
import { PodLineageError } from '@/services/sync/podLineage';

// The `rebase` verdict is UNREACHABLE in Stage 1 (POLICY says `block`), so the
// refusal that guards it cannot be exercised without forcing the verdict. This
// hook is the only way to test the line before Stage 3 flips the cell — and the
// line is precisely the one that must not be allowed to become a merge.
const guardHook = vi.hoisted(() => ({ force: null as string | null }));
vi.mock('@/services/sync/podLineage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/sync/podLineage')>();
  return {
    ...actual,
    guardLineage: (...args: Parameters<typeof actual.guardLineage>) =>
      guardHook.force ?? actual.guardLineage(...args),
  };
});

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
  guardHook.force = null;
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
  it('never falls through to a cross-lineage merge', async () => {
    // ⚠️ THE VERDICT IS FORCED, and it has to be. Stage 3 flips ONE POLICY cell
    // to `'rebase'`, in another file, with no compile error and no failing test
    // here — and falling through to `mergeDocs` would be the cross-lineage merge
    // in which the OLD lineage wins deterministically. The previous version of
    // this test branched on the live POLICY value, so today it re-ran the
    // `block` path and asserted nothing about the refusal; deleting the refusal
    // left the whole suite green. Verified by mutation.
    guardHook.force = 'rebase';
    // Same-ancestry documents, so a fall-through would genuinely MERGE (and
    // return `'merged'`) rather than fail for some unrelated reason.
    const base = Automerge.save(
      Automerge.from<Doc>({ familyMembers: {}, todos: {}, settings: null })
    );
    let mine = Automerge.load<Doc>(base);
    mine = Automerge.change(mine, (d) => {
      (d.todos as Record<string, unknown>).a1 = { id: 'a1', title: 'mine' };
    });
    ap.loadSnapshot(Automerge.save(mine));
    const remote = await envelopeFor(base, key);

    await expect(
      ap.mergeRemoteEnvelope(remote, 'fam', { kind: 'baseline', heads: null })
    ).rejects.toBeInstanceOf(PodLineageError);
  });
});

describe('a retired ENVELOPE stamp is deliberately NOT read', () => {
  /**
   * ⚠️ THIS PINS A DECISION, NOT AN OVERSIGHT — read the long comment in
   * `mergeRemoteEnvelope` before "fixing" it.
   *
   * A pod compacted by the retired Tier-2 code recorded its lineage only on the
   * envelope. A reader for that field was written and removed the same day: the
   * LOCAL side has no sound equivalent (our envelope copy drifts from our
   * document — that drift IS ADR-036), so reading only the remote half answers
   * `adopt-remote` even when the truth is `same`. The device that RAN the
   * compaction then blocked on its own file, and the block's only recovery
   * ADOPTS, destroying real same-lineage edits a plain merge would have kept.
   */
  async function legacyEnvelope(binary: Uint8Array, lineage: unknown) {
    return { ...(await envelopeFor(binary, key)), podLineage: lineage };
  }

  it('MERGES with a legacy-stamped remote instead of blocking on it', async () => {
    // The compactor's own device: a compacted-but-unstamped document beside its
    // own legacy-stamped file. Reading the envelope made this `adopt-remote`
    // × `dirty` → block. It is `same` → merge, and the unsynced todo survives.
    const base = Automerge.save(
      Automerge.from<Doc>({ familyMembers: {}, todos: {}, settings: null })
    );
    let mine = Automerge.load<Doc>(base);
    mine = Automerge.change(mine, (d) => {
      (d.todos as Record<string, unknown>).unsynced = { id: 'unsynced', title: 'mine' };
    });
    let theirs = Automerge.load<Doc>(base);
    theirs = Automerge.change(theirs, (d) => {
      (d.todos as Record<string, unknown>).shared = { id: 'shared', title: 'theirs' };
    });

    ap.loadSnapshot(Automerge.save(mine));
    const remote = await legacyEnvelope(Automerge.save(theirs), { id: 'L9', seq: 1 });

    // `heads: null` => dirty. With the reader this threw `PodLineageError`.
    const res = await ap.mergeRemoteEnvelope(remote, 'fam', { kind: 'baseline', heads: null });

    expect(res.action).toBe('merged');
    const merged = Automerge.toJS(Automerge.load(ap.exportSnapshot().binary)) as {
      todos: Record<string, unknown>;
    };
    expect(Object.keys(merged.todos).sort()).toEqual(['shared', 'unsynced']);
  });

  it('never invents a lineage for a document it installs', async () => {
    // The stamper went with the reader. A document adopted from a legacy-stamped
    // envelope must stay unstamped — a minted or borrowed id here would make
    // unrelated pods compare `same`.
    const remote = await legacyEnvelope(docWith('todos', 'b1', { id: 'b1' }), {
      id: 'L9',
      seq: 3,
    });
    const res = await ap.mergeRemoteEnvelope(remote, 'fam', { kind: 'no-local-document' });
    const installed = Automerge.toJS(Automerge.load(ap.exportSnapshot().binary)) as {
      podLineage?: unknown;
    };
    expect(res.action).toBe('adopted');
    expect(installed.podLineage ?? null).toBeNull();
  });
});
