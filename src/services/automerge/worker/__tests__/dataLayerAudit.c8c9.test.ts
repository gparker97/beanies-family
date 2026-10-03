// @vitest-environment node
/**
 * C8, C9 and C10's restore item (data-layer audit 2026-10-03): one pin per fixed-now defect in
 * the rebase composer, the Counter fold and the restore adopt.
 */
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as Automerge from '@automerge/automerge';
import { PodLineageError } from '@/services/sync/podLineage';
import type { FamilyDocument } from '@/types/automerge';
import type { MutationOp } from '../protocol';

const { generateFamilyKey, encryptPayload } = await import('@/services/crypto/familyKeyService');
const { bufferToBase64 } = await import('@/utils/encoding');
const ap = await import('../applyAndProject');
const { buildRebaseOps, applyMutation, materializeCollection } = await import('../docOps');
const cf = await import('../counterFields');
const { SNAPSHOT_VERSION } = await import('../cache');
const { attachPhotoToEntity } = await import('../photoOps');
const { seeded, apply, onDevice, useTestDevices, resetTestDevices } = await import('./twoDevices');

type Doc = Automerge.Doc<FamilyDocument>;
type Any = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/** The compaction source exactly as `compactDoc` builds it, as a new lineage. */
const compact = (doc: Doc): Doc =>
  Automerge.from({ ...cf.foldDoc(doc), podLineage: { id: 'L-NEW', seq: 1 } }) as unknown as Doc;
const js = (doc: Doc) => Automerge.toJS(doc) as Any;
const shown = (doc: Doc, collection: 'goals' | 'accounts', id: string) =>
  materializeCollection(doc, collection, cf.foldIndex(doc)).find(([k]) => k === id)![1] as Any;

async function envelopeFor(doc: Doc, key: CryptoKey) {
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

const contribute = (goalId: string, entryId: string, delta: number): MutationOp => ({
  op: 'named',
  name: 'applyGoalContribution',
  args: {
    id: goalId,
    delta,
    contribution: { id: entryId, amount: delta, at: '2026-10-03', updatedBy: 'm1' },
  },
});

let key: CryptoKey;
beforeEach(async () => {
  key = await generateFamilyKey();
  ap.__resetApplyAndProjectForTesting();
  ap.configure({ pushChunk() {}, perf() {}, cachePersistFailed() {}, cacheReleased() {} });
  await ap.setKey(key);
  useTestDevices();
});
afterEach(() => {
  cf.__setCounterWritesForTesting(cf.COUNTER_WRITES_ENABLED);
  resetTestDevices();
});

describe('C8: the rebase never splits a paired write', () => {
  const TX = { id: 'T', accountId: 'A', amount: 10, description: 'groceries', type: 'expense' };
  const origin = () =>
    seeded([
      { op: 'set', collection: 'accounts', id: 'A', entity: { id: 'A', balance: 100 } },
      { op: 'set', collection: 'transactions', id: 'T', entity: TX },
    ]);

  it('a transaction conflict makes the WHOLE rebase unavailable (blockedBy), never partial', async () => {
    const o = origin();
    const baseline = Automerge.getHeads(o);
    const peer = apply(
      Automerge.clone(o),
      { op: 'patch', collection: 'transactions', id: 'T', patch: { amount: 20 } },
      { op: 'increment', collection: 'accounts', id: 'A', field: 'balance', delta: -10 }
    );
    const target = apply(compact(o), {
      op: 'patch',
      collection: 'transactions',
      id: 'T',
      patch: { amount: 30 },
    });
    const ops = buildRebaseOps(peer, baseline, target);
    expect(ops).toMatchObject({ op: null, blockedBy: 'transactions', conflicts: 1 });

    // End to end: the merge raises the block, flagged, and the peer keeps its document.
    ap.loadSnapshot(Automerge.save(peer));
    const err = await ap
      .mergeRemoteEnvelope(await envelopeFor(target, key), 'fam', {
        kind: 'baseline',
        heads: baseline,
      })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PodLineageError);
    expect(err).toMatchObject({ rebaseUnavailable: true, conflictKind: 'transactions' });
    expect(js(Automerge.load(ap.exportSnapshot().binary)).transactions.T.amount).toBe(20);
  });

  it("a goal's contribution history UNIONS (both entries kept) and its Counter growth crosses with it", () => {
    cf.__setCounterWritesForTesting(true);
    const o = seeded([
      {
        op: 'set',
        collection: 'goals',
        id: 'G',
        entity: { id: 'G', currentAmount: 0, targetAmount: 1000, manualContributions: [] },
      },
    ]);
    const baseline = Automerge.getHeads(o);
    const peer = apply(onDevice('device-peer', Automerge.clone(o)), contribute('G', 'c-peer', 5));
    const target = apply(compact(o), contribute('G', 'c-saved', 7));

    const ops = buildRebaseOps(peer, baseline, target)!;
    expect(ops.conflicts).toBe(0);
    const out = applyMutation(target, ops.op as MutationOp).doc;
    const goal = shown(out, 'goals', 'G');
    expect((goal.manualContributions as Any[]).map((c) => c.id).sort()).toEqual([
      'c-peer',
      'c-saved',
    ]);
    expect(goal.currentAmount).toBe(12);
  });

  it('a goal whose history could NOT cross keeps its Counter growth back too (no money without a receipt)', () => {
    cf.__setCounterWritesForTesting(true);
    const o = seeded([
      {
        op: 'set',
        collection: 'goals',
        id: 'G',
        entity: { id: 'G', currentAmount: 0, targetAmount: 1000, manualContributions: [] },
      },
    ]);
    const baseline = Automerge.getHeads(o);
    const peer = apply(onDevice('device-peer', Automerge.clone(o)), contribute('G', 'c-peer', 5));
    // The saved copy holds an entry with no identity: the list cannot be unioned.
    const target = Automerge.change(compact(o), (d) => {
      (d.goals as Any).G.manualContributions.push({ amount: 3, at: 'x', updatedBy: 'm2' });
    });
    const ops = buildRebaseOps(peer, baseline, target)!;
    expect(ops.conflicts).toBe(1);
    expect(ops.counterIncrements).toBe(0);
    // Nothing else changed, so nothing replays at all: the +5 stays on the peer with its entry.
    expect(ops.op).toBeNull();
  });
});

describe('C9: Counter hardening', () => {
  const goalWith = (raw: number, keyed: number) => {
    cf.__setCounterWritesForTesting(true);
    let d = seeded([
      {
        op: 'set',
        collection: 'goals',
        id: 'G',
        entity: { id: 'G', currentAmount: raw, targetAmount: 1000 },
      },
    ]);
    if (keyed !== 0) {
      d = apply(d, {
        op: 'increment',
        collection: 'goals',
        id: 'G',
        field: 'currentAmount',
        delta: keyed,
      });
    }
    return d;
  };

  it('(a) the dormant floor clamps the FOLDED value: a withdrawal in a mixed fleet lands', () => {
    const d = goalWith(0, 50); // raw 0, a peer's Counter +50: folded 50
    cf.__setCounterWritesForTesting(false);
    const out = apply(d, {
      op: 'increment',
      collection: 'goals',
      id: 'G',
      field: 'currentAmount',
      delta: -30,
    });
    expect(js(out).goals.G.currentAmount).toBe(-30); // raw
    expect(shown(out, 'goals', 'G').currentAmount).toBe(20); // what the family sees
  });

  it('(b) foldDoc stores the UNFLOORED sum; the read floor still holds after the fold', () => {
    const d = goalWith(10, -15); // two decrements crossed 0: folded max(0, -5) = 0
    expect(shown(d, 'goals', 'G').currentAmount).toBe(0);
    expect(cf.foldDoc(d).goals.G!.currentAmount).toBe(-5);
    const after = compact(d);
    expect(shown(after, 'goals', 'G').currentAmount).toBe(0);
    // And a later +8 reads 3 (the true sum), not 8.
    cf.__setCounterWritesForTesting(false);
    const later = apply(after, {
      op: 'increment',
      collection: 'goals',
      id: 'G',
      field: 'currentAmount',
      delta: 8,
    });
    expect(shown(later, 'goals', 'G').currentAmount).toBe(3);
    // The real compactDoc's materialised-view verify accepts it.
    ap.loadSnapshot(Automerge.save(d));
    expect(ap.compactDoc().changesAfter).toBe(1);
  });

  it('(c) a no-op adjustment writes nothing: no updatedAt stamp, the heads do not move', () => {
    const d = goalWith(0, 0);
    cf.__setCounterWritesForTesting(false);
    const res = applyMutation(d, {
      op: 'increment',
      collection: 'goals',
      id: 'G',
      field: 'currentAmount',
      delta: -5, // clamped at the floor onto the value already stored
      updatedAt: '2026-10-03T00:00:00.000Z',
    });
    expect(Automerge.getHeads(res.doc)).toEqual(Automerge.getHeads(d));
    expect(js(res.doc).goals.G.updatedAt).toBeUndefined();
  });

  it('(d) updatedAt is never a conflict, and only the NEWER stamp crosses beside a real field', () => {
    const o = seeded([
      {
        op: 'set',
        collection: 'todos',
        id: 'T',
        entity: { id: 'T', title: 'a', notes: '', updatedAt: '2026-10-01T00:00:00.000Z' },
      },
    ]);
    const baseline = Automerge.getHeads(o);
    const patch = (p: Any): MutationOp => ({ op: 'patch', collection: 'todos', id: 'T', patch: p });
    const peerOlder = apply(
      Automerge.clone(o),
      patch({ title: 'b', updatedAt: '2026-10-02T00:00:00.000Z' })
    );
    const target = apply(compact(o), patch({ notes: 'n', updatedAt: '2026-10-03T00:00:00.000Z' }));
    const older = buildRebaseOps(peerOlder, baseline, target)!;
    expect(older.conflicts).toBe(0);
    expect((older.op as Any).patch).toEqual({ title: 'b' });

    const peerNewer = apply(
      Automerge.clone(o),
      patch({ title: 'b', updatedAt: '2026-10-04T00:00:00.000Z' })
    );
    const newer = buildRebaseOps(peerNewer, baseline, target)!;
    expect((newer.op as Any).patch).toEqual({ title: 'b', updatedAt: '2026-10-04T00:00:00.000Z' });
  });

  it('(f) attachPhotoToEntity refuses a Counter collection and an unregistered one', () => {
    const doc = js(seeded()) as FamilyDocument;
    expect(() => attachPhotoToEntity(doc, 'accounts', 'A', 'p')).toThrow(/Counter-backed/);
    expect(() => attachPhotoToEntity(doc, 'todos', 'T', 'p')).toThrow(
      /not a registered photo host/
    );
  });

  it('(h) rounding is half AWAY from zero, so a deposit and a withdrawal agree', () => {
    expect(cf.toMinor(0.5, 0)).toBe(1);
    expect(cf.toMinor(-0.5, 0)).toBe(-1); // Math.round gave -0 → 0
    expect(cf.roundTo(-0.125, 2)).toBe(-0.13);
    expect(cf.roundTo(0.125, 2)).toBe(0.13);
  });

  it('(i) the snapshot manual rev is bumped (a pre-audit snapshot may hold a floored value)', () => {
    expect(SNAPSHOT_VERSION.startsWith('2:')).toBe(true);
  });
});

describe('C10: a restore cannot un-remove a member', () => {
  it('unions removedMembers into the adopted file and deletes the matching rows', async () => {
    const tomb = {
      id: 'm1',
      removedAt: '2026-10-02',
      removedByMemberId: 'm0',
      createdAt: '2026-10-02',
      updatedAt: '2026-10-02',
    };
    // The chosen file: an older generation, from before m1 was removed.
    const older = Automerge.change(
      seeded([
        { op: 'set', collection: 'familyMembers', id: 'm1', entity: { id: 'm1', name: 'x' } },
        { op: 'set', collection: 'familyMembers', id: 'm2', entity: { id: 'm2', name: 'y' } },
      ]),
      (d) => {
        (d as Any).podLineage = { id: 'L1', seq: 1 };
      }
    );
    // This device: a newer generation where m1 has been removed.
    const mine = Automerge.change(Automerge.clone(older), (d) => {
      delete (d.familyMembers as Any).m1;
      (d.removedMembers as Any).m1 = tomb;
      (d as Any).podLineage = { id: 'L2', seq: 2 };
    });
    ap.loadSnapshot(Automerge.save(mine));
    const res = await ap.mergeRemoteEnvelope(await envelopeFor(older, key), 'fam', {
      kind: 'user-file',
      heads: null,
    });
    expect(res.action).toBe('adopted');
    expect(res.removedMembers).toEqual({ carried: 1, rowsDeleted: 1 });
    const out = js(Automerge.load(ap.exportSnapshot().binary));
    expect(Object.keys(out.familyMembers)).toEqual(['m2']);
    expect(out.removedMembers.m1).toEqual(tomb);
    expect(out.podLineage.seq).toBe(3); // still a new generation
  });
});
