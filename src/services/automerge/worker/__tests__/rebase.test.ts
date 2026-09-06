// @vitest-environment node
/**
 * Stage 3 — replaying a peer's unsynced work onto a compacted lineage.
 *
 * This is the change that removes the dead end: a device that was offline while
 * the family compacted no longer has to give its work up. It is also the most
 * dangerous code in the tier, because it writes a peer's edits into a document
 * that shares no ancestry with theirs.
 *
 * The invariant every test here defends: THE REBASE MUST NEVER LOSE MORE THAN
 * THE BLOCK IT REPLACED. Every way it can fail leaves the document untouched
 * and raises the same block as before.
 */
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as Automerge from '@automerge/automerge';
import { PodLineageError } from '@/services/sync/podLineage';

// An ESM namespace property is not configurable, so `vi.spyOn(Automerge, …)`
// throws. Mock the module and drive it through a hook — the same shape
// `compactDoc.test.ts` uses for the same reason.
const changeHook = vi.hoisted(() => ({ throws: null as Error | null }));
vi.mock('@automerge/automerge', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@automerge/automerge')>();
  return {
    ...actual,
    change: (...args: unknown[]) => {
      if (changeHook.throws) throw changeHook.throws;
      return (actual.change as (...a: unknown[]) => unknown)(...args);
    },
  };
});

const { generateFamilyKey, encryptPayload } = await import('@/services/crypto/familyKeyService');
const { bufferToBase64 } = await import('@/utils/encoding');
const ap = await import('../applyAndProject');
const { buildRebaseOps: buildRebaseOpsRaw } = await import('../docOps');
// The composer is typed on `FamilyDocument`; these fixtures are deliberately a
// minimal subset, so the cast is at the boundary rather than inside the tests.
const buildRebaseOps = buildRebaseOpsRaw as unknown as (
  local: Automerge.Doc<Doc>,
  heads: string[],
  target: Automerge.Doc<Doc>
) => { op: unknown; count: number } | null;

type Doc = Record<string, unknown>;
type Coll = Record<string, Record<string, unknown>>;

function base(): Automerge.Doc<Doc> {
  return Automerge.from<Doc>({
    familyMembers: {},
    todos: {},
    accounts: {},
    settings: { baseCurrency: 'GBP', theme: 'light' },
  });
}

/**
 * The compacted document: same data, brand-new history and object ids, and the
 * lineage stamp `compactDoc` writes into the rebuild. Without the stamp both
 * sides read `null`, the verdict is `same`, and the guard merges — so a fixture
 * that omits it silently tests nothing about the rebase.
 */
function compact(doc: Automerge.Doc<Doc>, id = 'L-NEW'): Automerge.Doc<Doc> {
  return Automerge.from<Doc>({ ...Automerge.toJS(doc), podLineage: { id, seq: 1 } });
}

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
  changeHook.throws = null;
  key = await generateFamilyKey();
  ap.reset();
  ap.configure({ pushChunk() {}, perf() {}, cachePersistFailed() {} });
  ap.setKey(key);
});

describe('the peer keeps its offline work', () => {
  it('replays an add, an edit and a delete onto the compacted lineage', async () => {
    // The shared starting point both sides agree on.
    let shared = base();
    shared = Automerge.change(shared, (d) => {
      (d.todos as Coll).keep = { id: 'keep', title: 'shared' };
      (d.todos as Coll).doomed = { id: 'doomed', title: 'to be deleted' };
    });
    const baselineHeads = Automerge.getHeads(shared);

    // The peer, offline, does three different things.
    let peer = Automerge.load<Doc>(Automerge.save(shared));
    peer = Automerge.change(peer, (d) => {
      (d.todos as Coll).added = { id: 'added', title: 'made while offline' };
      (d.todos as Coll).keep!.title = 'edited while offline';
      delete (d.todos as Coll).doomed;
    });

    // Meanwhile the family compacted, and someone added a todo after.
    let remote = compact(shared);
    remote = Automerge.change(remote, (d) => {
      (d.todos as Coll).theirs = { id: 'theirs', title: 'added after compacting' };
    });

    ap.loadSnapshot(Automerge.save(peer));
    const res = await ap.mergeRemoteEnvelope(await envelopeFor(remote, key), 'fam', {
      kind: 'baseline',
      heads: baselineHeads,
    });

    expect(res.action).toBe('rebased');
    const out = Automerge.toJS(Automerge.load(ap.exportSnapshot().binary)) as { todos: Coll };
    // The peer's work survived...
    expect(out.todos.added?.title).toBe('made while offline');
    expect(out.todos.keep?.title).toBe('edited while offline');
    expect(out.todos.doomed).toBeUndefined();
    // ...and so did the compactor's.
    expect(out.todos.theirs?.title).toBe('added after compacting');
    // And it is published, because the replay moved us past Drive.
    expect(res.dirty).toBe(true);
  });

  it('MERGES settings field by field, never replacing the whole object', async () => {
    // ⚠️ `setSettings` replaces the singleton. Emitting the peer's entire
    // settings object would silently revert a currency or theme the compactor
    // changed — a whole-object write dressed as a merge.
    const shared = base();
    const baselineHeads = Automerge.getHeads(shared);

    let peer = Automerge.load<Doc>(Automerge.save(shared));
    peer = Automerge.change(peer, (d) => {
      (d.settings as Record<string, unknown>).theme = 'dark';
    });

    let remote = compact(shared);
    remote = Automerge.change(remote, (d) => {
      (d.settings as Record<string, unknown>).baseCurrency = 'EUR';
    });

    ap.loadSnapshot(Automerge.save(peer));
    await ap.mergeRemoteEnvelope(await envelopeFor(remote, key), 'fam', {
      kind: 'baseline',
      heads: baselineHeads,
    });

    const out = Automerge.toJS(Automerge.load(ap.exportSnapshot().binary)) as {
      settings: Record<string, unknown>;
    };
    expect(out.settings.theme).toBe('dark'); // the peer's change
    expect(out.settings.baseCurrency).toBe('EUR'); // the compactor's, NOT reverted
  });

  it('takes the compacted lineage, not the peer own', async () => {
    // The whole point: after a rebase this device is ON the new lineage, so the
    // next sync is an ordinary same-lineage merge rather than another block.
    const shared = base();
    const baselineHeads = Automerge.getHeads(shared);
    let peer = Automerge.load<Doc>(Automerge.save(shared));
    peer = Automerge.change(peer, (d) => {
      (d.todos as Coll).mine = { id: 'mine', title: 'offline' };
    });
    const remote = compact(shared);

    ap.loadSnapshot(Automerge.save(peer));
    await ap.mergeRemoteEnvelope(await envelopeFor(remote, key), 'fam', {
      kind: 'baseline',
      heads: baselineHeads,
    });

    const out = Automerge.toJS(Automerge.load(ap.exportSnapshot().binary)) as {
      podLineage: { id: string };
      todos: Coll;
    };
    expect(out.podLineage.id).toBe('L-NEW');
    expect(out.todos.mine?.title).toBe('offline');
  });
});

describe('every failure loses no more than the block did', () => {
  async function peerAndRemote() {
    const shared = base();
    const baselineHeads = Automerge.getHeads(shared);
    let peer = Automerge.load<Doc>(Automerge.save(shared));
    peer = Automerge.change(peer, (d) => {
      (d.todos as Coll).mine = { id: 'mine', title: 'offline work' };
    });
    return { peer, remote: compact(shared), baselineHeads };
  }

  it('blocks, keeping the document, when the baseline is unknown', async () => {
    const { peer, remote } = await peerAndRemote();
    ap.loadSnapshot(Automerge.save(peer));
    const before = ap.getHeads().heads;

    await expect(
      ap.mergeRemoteEnvelope(await envelopeFor(remote, key), 'fam', {
        kind: 'baseline',
        heads: null, // "we cannot prove what Drive held"
      })
    ).rejects.toBeInstanceOf(PodLineageError);

    // ⚠️ UNTOUCHED. The peer's work is still here, which is the entire promise.
    expect(ap.getHeads().heads).toEqual(before);
    const out = Automerge.toJS(Automerge.load(ap.exportSnapshot().binary)) as { todos: Coll };
    expect(out.todos.mine?.title).toBe('offline work');
  });

  it('blocks when the baseline is not in this document history', async () => {
    const { peer, remote } = await peerAndRemote();
    ap.loadSnapshot(Automerge.save(peer));
    const before = ap.getHeads().heads;

    await expect(
      ap.mergeRemoteEnvelope(await envelopeFor(remote, key), 'fam', {
        kind: 'baseline',
        heads: ['0'.repeat(64)], // a hash this history never saw
      })
    ).rejects.toBeInstanceOf(PodLineageError);

    expect(ap.getHeads().heads).toEqual(before);
  });

  it('blocks when anything in the replay throws, leaving nothing half-applied', async () => {
    // ⚠️ THE ORDERING TEST, and the most important one in this file. The rebase
    // composes and applies BEFORE it installs, so a throw anywhere inside it —
    // the migrate, the compose, the apply — cannot leave the worker holding an
    // adopted-but-un-rebased document with the peer's work silently gone.
    // Getting that order wrong is a defect this tier has committed twice
    // already, and it is invisible without this assertion.
    const { peer, remote, baselineHeads } = await peerAndRemote();
    const envelope = await envelopeFor(remote, key);
    ap.loadSnapshot(Automerge.save(peer));
    const before = ap.getHeads().heads;
    changeHook.throws = new Error('replay exploded');

    await expect(
      ap.mergeRemoteEnvelope(envelope, 'fam', { kind: 'baseline', heads: baselineHeads })
    ).rejects.toBeInstanceOf(PodLineageError);

    changeHook.throws = null;
    expect(ap.getHeads().heads).toEqual(before);
    const out = Automerge.toJS(Automerge.load(ap.exportSnapshot().binary)) as { todos: Coll };
    expect(out.todos.mine?.title).toBe('offline work');
  });
});

describe('the composer cannot corrupt the lineage it lands on', () => {
  it('never emits an op that writes podLineage', async () => {
    // ⚠️ Structural: `MutationOp`'s `collection` is typed `CollectionName`,
    // which excludes the singletons, and the only op that writes one is
    // `named:setSettings`. Worth a test anyway — an op stamping the OLD lineage
    // onto the NEW document is self-inflicted corruption with no external cause.
    const shared = base();
    const baselineHeads = Automerge.getHeads(shared);
    let peer = Automerge.load<Doc>(Automerge.save(shared));
    peer = Automerge.change(peer, (d) => {
      d.podLineage = { id: 'L-OLD', seq: 1 };
      (d.todos as Coll).mine = { id: 'mine', title: 'work' };
    });

    const built = buildRebaseOps(peer, baselineHeads, compact(shared));

    expect(built).not.toBeNull();
    expect(JSON.stringify(built)).not.toContain('podLineage');
    expect(JSON.stringify(built)).not.toContain('L-OLD');
  });

  it('refuses outright when the baseline is not in this history', () => {
    // ⚠️ THE COMPOSER'S OWN GUARD. "What changed since the baseline" has no
    // meaning if this document never contained that baseline, and the answer
    // must be "cannot compose" rather than a diff against something arbitrary.
    // Covered here at the unit level because the worker-level test passes
    // either way — `Automerge.view` happens to throw, so the outer try catches
    // it — which would let the guard be deleted silently.
    const shared = base();
    expect(buildRebaseOps(shared, ['0'.repeat(64)], compact(shared))).toBeNull();
  });

  it('emits PLAIN payloads, never Automerge proxies', () => {
    // ⚠️ Reading out of a document yields a PROXY. Assigning one into another
    // document's draft is not supported, and the op also crosses a
    // `postMessage` boundary on some paths, where a proxy is not cloneable.
    const shared = base();
    const baselineHeads = Automerge.getHeads(shared);
    let peer = Automerge.load<Doc>(Automerge.save(shared));
    peer = Automerge.change(peer, (d) => {
      (d.todos as Coll).mine = { id: 'mine', title: 'work', tags: ['a', 'b'] };
    });

    const built = buildRebaseOps(peer, baselineHeads, compact(shared));

    expect(built?.op).toBeTruthy();
    // A proxy throws here; a plain object does not.
    expect(() => structuredClone(built!.op)).not.toThrow();
  });

  it('reports nothing to replay when the peer is level with its baseline', async () => {
    const shared = base();
    const built = buildRebaseOps(shared, Automerge.getHeads(shared), compact(shared));
    expect(built).toEqual({ op: null, count: 0 });
  });
});
