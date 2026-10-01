// Shared test helper (NOT a spec: no `.test`/`.spec` suffix, so vitest ignores it).
//
// The two-device merge harness for #117 (plan `docs/plans/2026-10-01-crdt-merge-safe-writes.md`
// §H). Every fine-grained-write fix proves itself the same way: fork one document onto two
// devices, write on both, merge both ways, and assert both edits survived. This module is that
// pattern, once, so the merge tests (and Phase 2's Counter tests) cannot drift apart.
//
// It drives the REAL worker doc layer (`docOps`): `migrateDoc`, `applyMutation`, `mergeDocs`.
//
// ⚠️ `mergeDocs` merges INTO its first argument's handle, which Automerge then treats as
// outdated. After `converge`, use the docs it RETURNS; the ones passed in are spent.
import { expect } from 'vitest';
import * as Automerge from '@automerge/automerge';
import type { FamilyDocument } from '@/types/automerge';
import { migrateDoc, applyMutation, mergeDocs, buildFullProjection } from '../docOps';
import type { MutationOp } from '../protocol';

export type Doc = Automerge.Doc<FamilyDocument>;

/** Two devices holding the same document, each with its own actor. */
export interface Devices {
  a: Doc;
  b: Doc;
}

/** Apply `ops` in order, each as its own change (one `applyMutation` per op). */
export function apply(doc: Doc, ...ops: MutationOp[]): Doc {
  return ops.reduce((d, op) => applyMutation(d, op).doc, doc);
}

/** A freshly migrated document with `ops` applied: the common ancestor of a test. */
export function seeded(ops: MutationOp[] = []): Doc {
  return apply(migrateDoc(Automerge.init<FamilyDocument>()), ...ops);
}

/**
 * Put `origin` on two devices. `Automerge.clone` forks with a fresh random actor, so the two
 * devices' writes are genuinely concurrent (the `docOps.test.ts` merge model). `origin` stays
 * usable.
 */
export function fork(origin: Doc): Devices {
  const a = Automerge.clone(origin);
  const b = Automerge.clone(origin);
  expect(Automerge.getActorId(a)).not.toBe(Automerge.getActorId(b));
  return { a, b };
}

/** What a device would show: the full projection, the same materialisation the worker streams. */
export function materialise(doc: Doc): unknown {
  return buildFullProjection(doc);
}

/**
 * Sync the two devices both ways through the production `mergeDocs`, then assert they converged:
 * the same heads and the same materialisation. Each returned doc keeps its own device's actor,
 * so a test can keep writing on `a` and `b` afterwards.
 */
export function converge(a: Doc, b: Doc): Devices {
  const mergedA = mergeDocs(a, b).doc;
  const mergedB = mergeDocs(b, mergedA).doc;
  expect([...Automerge.getHeads(mergedA)].sort()).toEqual([...Automerge.getHeads(mergedB)].sort());
  expect(materialise(mergedA)).toEqual(materialise(mergedB));
  return { a: mergedA, b: mergedB };
}
