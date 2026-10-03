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
import { __setDeviceWriterResolverForTesting } from '../docActor';

export type Doc = Automerge.Doc<FamilyDocument>;

/** Two devices holding the same document, each with its own actor. */
export interface Devices {
  a: Doc;
  b: Doc;
}

// ─── Simulated devices (#117 Phase 2) ────────────────────────────────────────
//
// In production every handle in a realm belongs to ONE device (the id `cache.ts` mints), and a
// Counter key's writer is `${deviceWriterId}:${actorId}`. A test puts several devices in one
// realm, so it maps each handle's ACTOR to a device instead: `fork` registers its two forks, a
// test registers any other handle with `onDevice`, and every unregistered actor (a plain
// `clone`, a fresh `load` inside `applyAndProject`) is `TEST_DEVICE`, the test's own device.

/** The device every unregistered actor belongs to. */
export const TEST_DEVICE = 'device-test';

const deviceOfActor = new Map<string, string>();

/** Install the actor → device resolver with an empty registry. Call in a `beforeEach` of any
 *  test that writes Counters through `applyMutation`; pair with `resetTestDevices`. */
export function useTestDevices(): void {
  deviceOfActor.clear();
  __setDeviceWriterResolverForTesting((actor) => deviceOfActor.get(actor) ?? TEST_DEVICE);
}

/** Remove the resolver (the realm's single id applies again) and forget every registration. */
export function resetTestDevices(): void {
  deviceOfActor.clear();
  __setDeviceWriterResolverForTesting(null);
}

/** Put the handle `doc` (or the raw `actor`) on `device` and return it. A merge keeps the
 *  receiving handle's actor, so the device follows the handle through `converge`. */
export function onDevice<D extends Doc | string>(device: string, docOrActor: D): D {
  const actor = typeof docOrActor === 'string' ? docOrActor : Automerge.getActorId(docOrActor);
  deviceOfActor.set(actor, device);
  return docOrActor;
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
 * devices' writes are genuinely concurrent (the `docOps.test.ts` merge model), and each fork is
 * registered as its own device (`device-a`, `device-b`) for the Counter writer id (effective
 * once `useTestDevices` installed the resolver). `origin` stays usable.
 */
export function fork(origin: Doc): Devices {
  const a = onDevice('device-a', Automerge.clone(origin));
  const b = onDevice('device-b', Automerge.clone(origin));
  expect(Automerge.getActorId(a)).not.toBe(Automerge.getActorId(b));
  return { a, b };
}

/**
 * What a device would show: the full projection, the same materialisation the worker streams,
 * with each collection's entities sorted by id.
 *
 * ⚠️ SORTED because entity ORDER is not converged state: on 3.4.1 two devices holding identical
 * documents can enumerate a map's keys in different orders (observed: one device's merged map
 * lists `e1, e2`, the other's `e2, e1`). The projection is keyed by id on main, so the order
 * carries no meaning, and comparing it would fail any test where both devices add an entity.
 */
export function materialise(doc: Doc): unknown {
  return buildFullProjection(doc).map((d) =>
    d.kind === 'bulk'
      ? { ...d, entities: [...d.entities].sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0)) }
      : d
  );
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
