/**
 * ADR-032 — the main-thread reactive projection: a read-only mirror of the
 * Automerge document's materialized collections, kept in sync by entity-level
 * deltas the worker sends with each response. Pinia stores read from here
 * (synchronously); all mutations go to the worker via `docClient`.
 *
 * Reactivity model: one `shallowRef<Map<id, entity>>` per collection. A delta
 * mutates the Map in place then `triggerRef`s it (O(1) per edit — no
 * whole-collection re-clone), and bumps `docVersion` once per apply so the
 * `docVersion`-subscribed computeds (photos/calendar/overlap/notifications) also
 * re-derive. `list()` reads `ref.value`, so Vue tracks the dependency and a
 * `triggerRef` invalidates dependent computeds precisely.
 */
import { shallowRef, triggerRef, type ShallowRef } from 'vue';
import { COLLECTION_NAMES, type CollectionName, type CollectionEntity } from '@/types/automerge';
import type { Settings } from '@/types/models';
import type { ProjectionDelta } from './worker/protocol';

type EntityMap = Map<string, unknown>;

const maps = new Map<CollectionName, ShallowRef<EntityMap>>(
  COLLECTION_NAMES.map((name) => [name, shallowRef<EntityMap>(new Map())])
);
const settingsRef = shallowRef<Settings | null>(null);

/** Coarse "something changed" trigger. Bumped once per `applyDelta`. The single
 * reactivity source for `docVersion`-subscribed consumers post-ADR-032. */
export const docVersion = shallowRef(0);

function mapFor(collection: CollectionName): ShallowRef<EntityMap> {
  const ref = maps.get(collection);
  if (!ref) throw new Error(`[projection] unknown collection: ${collection}`);
  return ref;
}

/** Apply one delta (recurses for `multi`) WITHOUT bumping the version — the
 * public `applyDelta` bumps once at the end so a multi-collection merge triggers
 * reactivity a single time. */
function applyOne(delta: ProjectionDelta): void {
  switch (delta.kind) {
    case 'upsert': {
      const ref = mapFor(delta.collection);
      ref.value.set(delta.id, delta.entity);
      triggerRef(ref);
      break;
    }
    case 'remove': {
      const ref = mapFor(delta.collection);
      if (ref.value.delete(delta.id)) triggerRef(ref);
      break;
    }
    case 'settings': {
      settingsRef.value = delta.settings as Settings | null;
      break;
    }
    case 'bulk': {
      const ref = mapFor(delta.collection);
      if (delta.reset) {
        ref.value = new Map(delta.entities);
      } else {
        for (const [id, entity] of delta.entities) ref.value.set(id, entity);
        triggerRef(ref);
      }
      break;
    }
    case 'multi': {
      for (const d of delta.deltas) applyOne(d);
      break;
    }
  }
}

/** Apply a delta to the projection and bump `docVersion` once. */
export function applyDelta(delta: ProjectionDelta): void {
  applyOne(delta);
  docVersion.value += 1;
}

/** All entities in a collection, as an array (order is insertion order). */
export function list<K extends CollectionName>(collection: K): CollectionEntity<K>[] {
  return Array.from(mapFor(collection).value.values()) as CollectionEntity<K>[];
}

/** One entity by id, or undefined. */
export function getById<K extends CollectionName>(
  collection: K,
  id: string
): CollectionEntity<K> | undefined {
  return mapFor(collection).value.get(id) as CollectionEntity<K> | undefined;
}

/** Number of entities in a collection (cheap; for tests + empty-state checks). */
export function count(collection: CollectionName): number {
  return mapFor(collection).value.size;
}

/** The settings singleton (or null before load). */
export function getSettings(): Settings | null {
  return settingsRef.value;
}

/** Clear the entire projection (sign-out / family-switch). Bumps `docVersion`. */
export function resetProjection(): void {
  for (const name of COLLECTION_NAMES) mapFor(name).value = new Map();
  settingsRef.value = null;
  docVersion.value += 1;
}
