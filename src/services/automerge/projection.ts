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

/** True once a document has been loaded/created (a full projection pushed).
 * Re-backs `docService.isDocLoaded()`. Flipped true in `bumpDocVersion` (the
 * "final chunk applied" hook that initDoc/initAndLoadCache/merge all end with),
 * false in `resetProjection`. Pinned to `bumpDocVersion` — NOT `applyDelta` — so
 * a stray first `mutate` (which bumps `docVersion` directly) can't flip it. */
let loaded = false;
export function isLoaded(): boolean {
  return loaded;
}

function mapFor(collection: CollectionName): ShallowRef<EntityMap> {
  const ref = maps.get(collection);
  if (!ref) throw new Error(`[projection] unknown collection: ${collection}`);
  return ref;
}

/**
 * The per-collection reactive ref, for a computed that must re-derive ONLY when
 * THAT collection changes (not on every unrelated `docVersion` bump). The ref
 * `triggerRef`s on each of its own deltas, so a consumer reading `.value` re-runs
 * precisely. Read-only usage — never mutate the returned Map. Used by
 * `photoStore.photos` to avoid an O(n) rebuild on every unrelated mutation (F9).
 */
export function collectionRef(collection: CollectionName): ShallowRef<EntityMap> {
  return mapFor(collection);
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

/**
 * Apply one streamed projection chunk WITHOUT bumping `docVersion`. First-load /
 * remote-merge pushes arrive as many chunks (one per collection slice); bumping
 * per-chunk would let a `docVersion`-subscribed computed observe a half-applied
 * projection (e.g. a transaction referencing an account whose chunk hasn't
 * landed). `docClient` calls `bumpDocVersion()` exactly once after the final
 * chunk — see the merge/load barrier in ADR-032. */
export function applyChunk(delta: ProjectionDelta): void {
  applyOne(delta);
}

/** Bump the coarse change trigger. Called once after a chunked load/merge, so
 * this is where `loaded` flips true (a full projection has landed). */
export function bumpDocVersion(): void {
  loaded = true;
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
  loaded = false;
  docVersion.value += 1;
}
