/**
 * Cross-version .beanpod compatibility guard (Notion tracker #59, ADR-032).
 *
 * WHY THIS EXISTS: `Automerge.save()` output IS the durable `.beanpod` payload.
 * When we bump the CRDT engine, a family mid-rollout has some devices on the new
 * version and some on the previous one, exchanging bytes. This test proves those
 * bytes round-trip and merge in BOTH directions so an engine bump cannot silently
 * break `.beanpod` interop. It is the permanent, checked-in form of the 2026-08-11
 * compat spike.
 *
 * TWO RULES — read before editing:
 *
 * 1. ENGINE BINDING. `AmOld` is a SEPARATE wasm instance from the current engine
 *    (`@automerge/automerge`). Never pass an `AmOld` doc handle into a `docOps`
 *    helper (`migrateDoc`/`applyMutation`/`buildFullProjection`/`saveDoc`) — those
 *    are bound to the current engine, and mixing instances can throw OR silently
 *    return a wrong-but-equal projection (a silent failure in the very test meant
 *    to catch one). The ONLY thing that crosses the version boundary is BYTES.
 *    Every assertion projects through the CURRENT engine via `projectBytes()`.
 *
 * 2. ALIAS UPKEEP. `AmOld` is the `@automerge/automerge-legacy` devDependency,
 *    pinned in package.json to the version we upgraded FROM. On every future
 *    engine bump, advance that alias to the immediately-prior shipped version in
 *    the same commit, so this test always guards the real N-1 -> N migration a
 *    family actually performs, not a frozen historical baseline.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import * as AmNew from '@automerge/automerge';
import * as AmOld from '@automerge/automerge-legacy';
import {
  migrateDoc,
  applyMutation,
  saveDoc,
  buildFullProjection,
  docLineage,
  nextLineage,
  buildRebaseOps as buildRebaseOpsCurrent,
} from '../worker/docOps';
import { foldDoc } from '../worker/counterFields';
import type { ProjectionDelta } from '../worker/protocol';
import type { FamilyDocument } from '@/types/automerge';

// ─── Helpers (all bound to the CURRENT engine) ──────────────────────────────

/** Seed a small doc mirroring real FamilyDocument shape, on the current engine. */
function seed(): AmNew.Doc<FamilyDocument> {
  let d = migrateDoc(AmNew.init<FamilyDocument>());
  d = applyMutation(d, {
    op: 'set',
    collection: 'accounts',
    id: 'a1',
    entity: { id: 'a1', name: 'Checking', balance: 100 },
  }).doc;
  d = applyMutation(d, {
    op: 'set',
    collection: 'todos',
    id: 't1',
    entity: { id: 't1', title: 'buy beans' },
  }).doc;
  return d;
}

/** Project ANY bytes (from either engine) through the CURRENT engine — Rule 1. */
function projectBytes(bytes: Uint8Array): ProjectionDelta[] {
  return normalize(buildFullProjection(AmNew.load<FamilyDocument>(bytes)));
}

/** Project a CURRENT-engine doc handle directly. */
function projectDoc(doc: AmNew.Doc<FamilyDocument>): ProjectionDelta[] {
  return normalize(buildFullProjection(doc));
}

/**
 * Sort each bulk collection's entities by id so state comparison is insensitive
 * to Automerge map iteration order, which can legitimately differ across engine
 * versions. The outer delta order is deterministic (COLLECTION_NAMES), so only
 * the per-collection entity arrays need sorting.
 */
function normalize(deltas: ProjectionDelta[]): ProjectionDelta[] {
  return deltas.map((d) => {
    if (d.kind !== 'bulk') return d;
    const entities = [...d.entities].sort((a, b) => String(a[0]).localeCompare(String(b[0])));
    return { ...d, entities };
  });
}

describe('cross-version .beanpod compatibility (current engine <-> automerge-legacy)', () => {
  it('snapshot round-trips new -> old (old engine reads new-authored bytes)', () => {
    const doc = seed();
    const onOld = AmOld.load(saveDoc(doc)); // old engine reads new bytes
    // Funnel the old-side result back as bytes and project through the new engine.
    expect(projectBytes(AmOld.save(onOld))).toEqual(projectDoc(doc));
  });

  it('snapshot round-trips old -> new (new engine reads old-authored bytes)', () => {
    // Old engine AUTHORS an extra entity, then the current engine loads it.
    const onOld = AmOld.change(AmOld.load<FamilyDocument>(saveDoc(seed())), (d) => {
      (d.accounts as Record<string, unknown>)['a2'] = { id: 'a2', name: 'Savings', balance: 50 };
    });
    const expected = projectDoc(
      applyMutation(seed(), {
        op: 'set',
        collection: 'accounts',
        id: 'a2',
        entity: { id: 'a2', name: 'Savings', balance: 50 },
      }).doc
    );
    expect(projectBytes(AmOld.save(onOld))).toEqual(expected);
  });

  it('incremental delta applies new -> old (saveIncremental on new, loadIncremental on old)', () => {
    const baseBytes = saveDoc(seed());
    const newDoc = applyMutation(AmNew.load<FamilyDocument>(baseBytes), {
      op: 'set',
      collection: 'todos',
      id: 't2',
      entity: { id: 't2', title: 'plant' },
    }).doc;
    const incr = AmNew.saveIncremental(newDoc); // just the change since load
    const oldDoc = AmOld.loadIncremental(AmOld.load(baseBytes), incr);
    expect(projectBytes(AmOld.save(oldDoc))).toEqual(projectDoc(newDoc));
  });

  it('incremental delta applies old -> new (saveIncremental on old, loadIncremental on new)', () => {
    const baseBytes = saveDoc(seed());
    const oldDoc = AmOld.change(AmOld.load<FamilyDocument>(baseBytes), (d) => {
      (d.goals as Record<string, unknown>)['g1'] = { id: 'g1', name: 'Trip', targetAmount: 1000 };
    });
    const incr = AmOld.saveIncremental(oldDoc);
    const newDoc = AmNew.loadIncremental(AmNew.load<FamilyDocument>(baseBytes), incr);
    const expected = projectDoc(
      applyMutation(AmNew.load<FamilyDocument>(baseBytes), {
        op: 'set',
        collection: 'goals',
        id: 'g1',
        entity: { id: 'g1', name: 'Trip', targetAmount: 1000 },
      }).doc
    );
    expect(projectDoc(newDoc)).toEqual(expected);
  });

  it('cross-version concurrent merge converges (disjoint edits, exchanged as bytes)', () => {
    const baseBytes = saveDoc(seed());
    // Old side applies a disjoint edit.
    const oldDoc = AmOld.change(AmOld.load<FamilyDocument>(baseBytes), (d) => {
      (d.accounts as Record<string, unknown>)['old1'] = { id: 'old1', name: 'OldSide', balance: 1 };
    });
    // New side applies a disjoint edit.
    const newDoc = applyMutation(AmNew.load<FamilyDocument>(baseBytes), {
      op: 'set',
      collection: 'accounts',
      id: 'new1',
      entity: { id: 'new1', name: 'NewSide', balance: 2 },
    }).doc;
    // Merge via exchanged BYTES (never live handles across the boundary).
    const mergedOnNew = AmNew.merge(
      AmNew.clone(newDoc),
      AmNew.load<FamilyDocument>(AmOld.save(oldDoc))
    );
    const mergedOnOldBytes = AmOld.save(
      AmOld.merge(AmOld.clone(oldDoc), AmOld.load<FamilyDocument>(saveDoc(newDoc)))
    );

    // Both converge to the same projected state...
    expect(projectBytes(mergedOnOldBytes)).toEqual(projectDoc(mergedOnNew));
    // ...and the same heads (compared on one engine, as sets — order-insensitive).
    const headsNew = new Set(AmNew.getHeads(mergedOnNew));
    const headsOld = new Set(AmNew.getHeads(AmNew.load<FamilyDocument>(mergedOnOldBytes)));
    expect(headsOld).toEqual(headsNew);
  });

  it('a str (ImmutableString) value written on new loads and reads on old (#124)', () => {
    const doc = AmNew.change(seed(), (d) => {
      (d.todos as unknown as Record<string, Record<string, unknown>>)['t1']!.status =
        new AmNew.ImmutableString('open');
    });
    const onOld = AmOld.load<FamilyDocument>(saveDoc(doc));
    const v = (onOld.todos as unknown as Record<string, Record<string, unknown>>)['t1']!.status;
    // The legacy engine's own predicate recognises it, and it reads as the plain string.
    expect(AmOld.isImmutableString(v)).toBe(true);
    expect(String(v)).toBe('open');
    expect((v as AmOld.ImmutableString).toJSON()).toBe('open');
    // Back through the bytes, the projection (a JSON copy) is the plain string on both sides.
    expect(projectBytes(AmOld.save(onOld))).toEqual(projectDoc(doc));
  });
});

// ─── A build that does not know a collection (#146 choreboard rollout) ──────
//
// Not an engine boundary but a SCHEMA one: a device still on the build before the choreboard
// meets a family file that a newer device has written `chores` / `choreMarks` into, and keeps
// meeting new marks many times a day. The older build is simulated faithfully: the SAME
// `docOps` source, loaded fresh with `COLLECTION_NAMES` / `MIGRATED_ROOT_KEYS` as that build
// had them (without the two keys). Same Automerge instance (node_modules is not reloaded), so
// documents cross freely; the only difference is what the build believes the doc shape is.
//
// What it must prove (plan Assumption 2, the package-1 stop point):
//  (a) the older build projects the merged doc (unknown roots ignored for display), its delta
//      path falls back to a full rebuild on a diff carrying a mark, and it can still write;
//  (b) it gets through a compaction rebase: its since-baseline window, under the real merge
//      terminus (the Drive baseline is the merged remote's own heads), holds only its own
//      edits, so `touchedBetween` does not answer `null` and its offline work is replayed.

const CHORE_ROOTS = ['chores', 'choreMarks'];
type OldDocOps = typeof import('../worker/docOps');

/** `docOps` as the build before the choreboard had it. See the block comment above. */
async function loadPreChoreboardDocOps(): Promise<OldDocOps> {
  vi.resetModules();
  vi.doMock('@/types/automerge', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/types/automerge')>();
    const COLLECTION_NAMES = actual.COLLECTION_NAMES.filter((n) => !CHORE_ROOTS.includes(n));
    return {
      ...actual,
      COLLECTION_NAMES,
      MIGRATED_ROOT_KEYS: [...COLLECTION_NAMES, 'counterDeltas'],
    };
  });
  const ops = await import('../worker/docOps');
  vi.doUnmock('@/types/automerge');
  vi.resetModules();
  return ops;
}

type AnyDoc = AmNew.Doc<FamilyDocument>;
const set = (doc: AnyDoc, collection: string, id: string, entity: Record<string, unknown>) =>
  applyMutation(doc, { op: 'set', collection: collection as 'todos', id, entity }).doc;

function choreMark(memberId: string, date: string, ref: string) {
  const id = `done:${memberId}:${date}:${ref}`;
  return { id, kind: 'done', memberId, date, ref, by: memberId, createdAt: date, updatedAt: date };
}

/** The compacted document exactly as `compactDoc` builds it: folded source, new lineage, stamp. */
function compact(doc: AnyDoc): AnyDoc {
  const lineage = nextLineage(docLineage(doc));
  const folded = foldDoc(doc, lineage.seq);
  return AmNew.from({
    ...folded,
    podLineage: { ...lineage, fromHeads: AmNew.getHeads(doc) },
  }) as unknown as AnyDoc;
}

describe('a build that does not know chores / choreMarks (#146 rollout)', () => {
  let oldOps: OldDocOps;
  beforeAll(async () => {
    oldOps = await loadPreChoreboardDocOps();
  });

  /** An older pod: written by the pre-choreboard build, so it has no chore maps at all. */
  function olderPodBytes(): Uint8Array {
    let d = oldOps.migrateDoc(AmNew.init<FamilyDocument>()) as AnyDoc;
    d = oldOps.applyMutation(d, {
      op: 'set',
      collection: 'todos',
      id: 't1',
      entity: { id: 't1', title: 'buy beans' },
    }).doc as AnyDoc;
    expect(d.chores).toBeUndefined();
    return saveDoc(d);
  }

  /** A newer device opens the pod, migrates the chore maps in, writes a chore and two ticks. */
  function newerDeviceWrites(podBytes: Uint8Array): AnyDoc {
    let d = migrateDoc(AmNew.load<FamilyDocument>(podBytes));
    d = set(d, 'chores', 'c1', { id: 'c1', title: 'Make bed', assigneeIds: ['kid'] });
    d = set(d, 'choreMarks', 'done:kid:2026-11-13:c1', choreMark('kid', '2026-11-13', 'c1'));
    d = set(d, 'choreMarks', 'done:kid:2026-11-12:c1', choreMark('kid', '2026-11-12', 'c1'));
    return d;
  }

  const withoutChoreRoots = (deltas: ProjectionDelta[]) =>
    deltas.filter((x) => !(x.kind === 'bulk' && CHORE_ROOTS.includes(x.collection)));

  it('the simulated older build really does not know the two collections', () => {
    const projected = oldOps.buildFullProjection(newerDeviceWrites(olderPodBytes()));
    const names = projected.flatMap((x) => (x.kind === 'bulk' ? [x.collection] : []));
    expect(names).not.toContain('chores');
    expect(names).not.toContain('choreMarks');
    expect(names).toContain('todos');
  });

  it('(a) projects a merged doc holding chores, falls back to a full rebuild on a mark, and can still write', () => {
    const podBytes = olderPodBytes();
    let onOld = AmNew.load<FamilyDocument>(podBytes) as AnyDoc;
    const beforeMerge = AmNew.getHeads(onOld);

    // The older device merges the newer device's file.
    const fromNewer = newerDeviceWrites(podBytes);
    onOld = oldOps.mergeDocs(onOld, AmNew.load<FamilyDocument>(saveDoc(fromNewer))).doc as AnyDoc;
    // Every known collection projects exactly as the current build projects it; the unknown
    // roots are simply absent from the older build's projection.
    expect(normalize(oldOps.buildFullProjection(onOld))).toEqual(
      withoutChoreRoots(projectDoc(onOld))
    );
    // A diff carrying a mark: the delta path answers null (the caller does a full rebuild).
    expect(oldOps.projectionDeltasBetween(onOld, beforeMerge, AmNew.getHeads(onOld))).toBeNull();

    // Further ticks keep arriving, and the older build keeps writing its own data on top.
    const afterFirstMerge = AmNew.getHeads(onOld);
    const moreTicks = set(
      AmNew.load<FamilyDocument>(saveDoc(fromNewer)),
      'choreMarks',
      'done:kid:2026-11-14:c1',
      choreMark('kid', '2026-11-14', 'c1')
    );
    onOld = oldOps.mergeDocs(onOld, AmNew.load<FamilyDocument>(saveDoc(moreTicks))).doc as AnyDoc;
    expect(
      oldOps.projectionDeltasBetween(onOld, afterFirstMerge, AmNew.getHeads(onOld))
    ).toBeNull();
    const ownEditFrom = AmNew.getHeads(onOld);
    onOld = oldOps.applyMutation(onOld, {
      op: 'set',
      collection: 'todos',
      id: 't2',
      entity: { id: 't2', title: 'water plants' },
    }).doc as AnyDoc;
    // Its own edit still takes the delta path (only a chore-carrying diff falls back).
    expect(
      oldOps.projectionDeltasBetween(onOld, ownEditFrom, AmNew.getHeads(onOld))
    ).not.toBeNull();

    // It saves, and the bytes it writes keep every chore and mark for the newer devices.
    const saved = AmNew.load<FamilyDocument>(oldOps.saveDoc(onOld));
    expect(Object.keys(saved.choreMarks ?? {}).sort()).toEqual([
      'done:kid:2026-11-12:c1',
      'done:kid:2026-11-13:c1',
      'done:kid:2026-11-14:c1',
    ]);
    expect(saved.chores?.c1?.title).toBe('Make bed');
    expect(saved.todos?.t2?.title).toBe('water plants');
  });

  it('(b) an older build that merged chore marks gets through a compaction rebase (touchedBetween is not null)', () => {
    const podBytes = olderPodBytes();
    let onOld = AmNew.load<FamilyDocument>(podBytes) as AnyDoc;
    // Offline work BEFORE it next merges: an edit Drive does not have yet.
    onOld = oldOps.applyMutation(onOld, {
      op: 'set',
      collection: 'todos',
      id: 't-offline',
      entity: { id: 't-offline', title: 'pack lunch' },
    }).doc as AnyDoc;

    // A newer device writes chores and ticks; then more ticks. The older device merges the
    // file each time. At a merge terminus the Drive baseline is the heads of exactly the
    // bytes Drive held (`syncService.commitRemoteBaseline(remoteHeads)`, unmigrated remote).
    const first = newerDeviceWrites(podBytes);
    const firstBytes = saveDoc(first);
    onOld = oldOps.mergeDocs(onOld, AmNew.load<FamilyDocument>(firstBytes)).doc as AnyDoc;
    const drive = set(
      AmNew.load<FamilyDocument>(firstBytes),
      'choreMarks',
      'done:kid:2026-11-14:c1',
      choreMark('kid', '2026-11-14', 'c1')
    );
    const driveBytes = saveDoc(drive);
    onOld = oldOps.mergeDocs(onOld, AmNew.load<FamilyDocument>(driveBytes)).doc as AnyDoc;
    const baseline = AmNew.getHeads(AmNew.load<FamilyDocument>(driveBytes));
    // ...and one more edit of its own after the merge.
    onOld = oldOps.applyMutation(onOld, {
      op: 'set',
      collection: 'todos',
      id: 't-after',
      entity: { id: 't-after', title: 'call grandma' },
    }).doc as AnyDoc;

    // Meanwhile the newer device compacts what Drive holds (chores and all) into a new lineage.
    const target = compact(AmNew.load<FamilyDocument>(driveBytes));
    expect(Object.keys(target.choreMarks ?? {})).toHaveLength(3);

    // The older build's window since its baseline holds only its own edits.
    const scan = oldOps.touchedBetween(onOld, baseline, AmNew.getHeads(onOld));
    expect(scan).not.toBeNull();
    expect([...scan!.touched.keys()]).toEqual(['todos']);

    const built = oldOps.buildRebaseOps(onOld, baseline, target);
    expect(built).not.toBeNull();
    expect(built!.blockedBy).toBeUndefined();
    expect(built!.op).not.toBeNull();
    expect(built!.count).toBe(2);
    expect(built!.conflicts).toBe(0);

    const rebased = oldOps.applyMutation(target, built!.op!).doc as AnyDoc;
    const after = AmNew.load<FamilyDocument>(oldOps.saveDoc(rebased));
    // The offline work survived, and so did every chore and mark the compactor carried.
    expect(after.todos?.['t-offline']?.title).toBe('pack lunch');
    expect(after.todos?.['t-after']?.title).toBe('call grandma');
    expect(Object.keys(after.choreMarks ?? {})).toHaveLength(3);
    expect(after.chores?.c1?.title).toBe('Make bed');
    expect(() => oldOps.buildFullProjection(rebased)).not.toThrow();
  });

  it('residual, pinned: a chore change NEWER than the older build’s baseline makes the rebase fall back to the block', () => {
    // Reachable only when the older device holds chore writes its Drive baseline does not
    // cover, i.e. a merge whose baseline commit did not land (the commit is advisory). The
    // answer is the block the rebase replaced, which keeps this device's work: it never loses
    // more than blocking would. Same rule as for every collection added since compaction.
    const podBytes = olderPodBytes();
    let onOld = AmNew.load<FamilyDocument>(podBytes) as AnyDoc;
    const staleBaseline = AmNew.getHeads(onOld);
    onOld = oldOps.mergeDocs(
      onOld,
      AmNew.load<FamilyDocument>(saveDoc(newerDeviceWrites(podBytes)))
    ).doc as AnyDoc;
    const target = compact(onOld);
    expect(oldOps.touchedBetween(onOld, staleBaseline, AmNew.getHeads(onOld))).toBeNull();
    expect(oldOps.buildRebaseOps(onOld, staleBaseline, target)).toBeNull();
    // The CURRENT build, which knows the collections, composes the same rebase.
    expect(
      buildRebaseOpsCurrent(AmNew.load<FamilyDocument>(saveDoc(onOld)), staleBaseline, target)
    ).not.toBeNull();
  });
});
