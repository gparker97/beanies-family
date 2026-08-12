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
import { describe, it, expect } from 'vitest';
import * as AmNew from '@automerge/automerge';
import * as AmOld from '@automerge/automerge-legacy';
import { migrateDoc, applyMutation, saveDoc, buildFullProjection } from '../worker/docOps';
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
});
