/**
 * ADR-032 — photo-collection hooks, relocated into the worker-shared layer.
 *
 * These are PURE doc-walking functions (no Automerge/vue/pinia imports — only
 * types, which erase). That purity is load-bearing: `photoStore` (a pinia
 * module) imports from here, so this file must NOT drag Automerge into the main
 * bundle. The named-op REGISTRATION (which needs `registerNamedOp` from
 * `docOps`) is done by `applyAndProject`, not here — this file only exports the
 * handler function + the registry.
 *
 * Ownership moved here from `photoStore.ts` (interface/registry/flatHooks) and
 * `photoCollectionHooks.ts` (avatar/vacation hooks). The doc-walking attach runs
 * inside the worker's `Automerge.change` via the `attachPhotoToEntity` named op;
 * `collectReferencedPhotoIds` runs on the worker doc for `gcOrphans`.
 */
import type { FamilyDocument, CollectionName } from '@/types/automerge';
import type {
  FamilyVacation,
  UUID,
  VacationAccommodation,
  VacationTransportation,
  VacationTravelSegment,
} from '@/types/models';
import type { NamedOpHandler } from './docOps';
import type { ProjectionDelta } from './protocol';

/** JSON round-trip to a plain, structured-clone-safe object (no Automerge dep). */
function toPlain<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

// ─── Hook contract + registry ────────────────────────────────────────────────

export interface PhotoCollectionHooks {
  attach: (doc: FamilyDocument, entityId: string, photoId: UUID) => void;
  collect: (doc: FamilyDocument) => Iterable<UUID>;
}

/** Thrown when a registered `collect` hook fails. Signals `gcOrphans` to abort
 *  the sweep (fail-safe: never delete photos we couldn't prove orphaned). */
export class PhotoCollectHookError extends Error {
  readonly collection: string;
  readonly cause: unknown;
  constructor(collection: string, cause: unknown) {
    super(`photo collect hook failed for "${collection}"`);
    this.name = 'PhotoCollectHookError';
    this.collection = collection;
    this.cause = cause;
  }
}

/** The standard flat shape: `doc[collection][entityId].photoIds`. */
export function flatHooks(collection: string): PhotoCollectionHooks {
  type FlatEntities = Record<string, { photoIds?: UUID[] }>;
  return {
    attach(doc, entityId, photoId) {
      const entities = (doc as unknown as Record<string, FlatEntities>)[collection];
      const entity = entities?.[entityId];
      if (!entity) return;
      entity.photoIds = [...(entity.photoIds ?? []), photoId];
    },
    *collect(doc) {
      const entities = (doc as unknown as Record<string, FlatEntities>)[collection];
      if (!entities) return;
      for (const entity of Object.values(entities)) {
        for (const pid of entity?.photoIds ?? []) yield pid;
      }
    },
  };
}

const photoCollections = new Map<string, PhotoCollectionHooks>();

export function registerPhotoCollection(name: string, hooks?: PhotoCollectionHooks): void {
  photoCollections.set(name, hooks ?? flatHooks(name));
}

// ─── Vacation (nested booking segments) + avatar (scalar) hooks ──────────────

const BOOKING_SEGMENT_KEYS = ['travelSegments', 'accommodations', 'transportation'] as const;
type BookingSegment = VacationTravelSegment | VacationAccommodation | VacationTransportation;

/** Composite entity id for a vacation-segment attachment: `${vacationId}/${segmentId}`.
 * Segment ids are UUIDs (no '/'), so it round-trips unambiguously. Pure — safe to
 * import on the main thread (re-exported by `photoCollectionHooks.ts`). */
export function vacationSegmentEntityId(vacationId: UUID, segmentId: UUID): string {
  return `${vacationId}/${segmentId}`;
}

function vacationSegmentArrays(vac: FamilyVacation): BookingSegment[][] {
  return BOOKING_SEGMENT_KEYS.map((k) => (vac[k] ?? []) as BookingSegment[]);
}

export function forEachBookingSegment(
  doc: FamilyDocument,
  fn: (segment: BookingSegment) => void
): void {
  for (const vac of Object.values(doc.vacations ?? {})) {
    for (const arr of vacationSegmentArrays(vac)) {
      for (const seg of arr) fn(seg);
    }
  }
}

export const vacationPhotoHooks: PhotoCollectionHooks = {
  attach(doc, entityId, photoId) {
    const slash = entityId.indexOf('/');
    if (slash < 0) return; // not a composite key — nothing to do
    const vacationId = entityId.slice(0, slash);
    const segmentId = entityId.slice(slash + 1);
    const vac = (doc.vacations ?? {})[vacationId];
    if (!vac) return; // vacation not in the doc yet (mid-wizard) — expected no-op
    for (const arr of vacationSegmentArrays(vac)) {
      const seg = arr.find((s) => s.id === segmentId);
      if (seg) {
        seg.photoIds = [...(seg.photoIds ?? []), photoId];
        return;
      }
    }
    console.warn(
      `[photoOps] vacation ${vacationId} has no segment ${segmentId} to attach photo ${photoId}`
    );
  },
  *collect(doc) {
    const ids: UUID[] = [];
    forEachBookingSegment(doc, (seg) => {
      for (const pid of seg.photoIds ?? []) ids.push(pid);
    });
    yield* ids;
  },
};

export const avatarPhotoHooks: PhotoCollectionHooks = {
  // Avatars are attached by familyStore setting the scalar FamilyMember.avatarPhotoId —
  // they never flow through attachPhotoToEntity, so attach is a deliberate no-op.
  attach() {
    /* no-op by design */
  },
  *collect(doc) {
    for (const member of Object.values(doc.familyMembers ?? {})) {
      if (member.avatarPhotoId) yield member.avatarPhotoId;
    }
  },
};

// ─── Attach / collect (doc-walking) ──────────────────────────────────────────

/** Attach a photo to an entity via its registered hook (flat fallback for
 * unregistered). A throwing hook is logged, NEVER thrown — a benign miss (e.g. a
 * mid-wizard vacation) must not fail the upload batch or trigger a Drive rollback. */
export function attachPhotoToEntity(
  doc: FamilyDocument,
  entityCollection: string,
  entityId: string,
  photoId: UUID
): void {
  const hooks = photoCollections.get(entityCollection) ?? flatHooks(entityCollection);
  try {
    hooks.attach(doc, entityId, photoId);
  } catch (e) {
    console.error(`[photoOps] attach hook failed for "${entityCollection}"/${entityId}`, e);
  }
}

/** Every photoId referenced by any registered collection. Throws
 * `PhotoCollectHookError` if a hook fails (→ `gcOrphans` aborts the sweep). */
export function collectReferencedPhotoIds(doc: FamilyDocument): Set<UUID> {
  const ids = new Set<UUID>();
  for (const [name, hooks] of photoCollections) {
    try {
      for (const pid of hooks.collect(doc)) ids.add(pid);
    } catch (e) {
      console.error(
        `[photoOps] collect hook failed for "${name}" — aborting GC sweep to avoid deleting referenced photos`,
        e
      );
      throw new PhotoCollectHookError(name, e);
    }
  }
  return ids;
}

/** True once at least one photo host is registered (gates `gcOrphans`). */
export function hasPhotoCollections(): boolean {
  return photoCollections.size > 0;
}

// ─── The `attachPhotoToEntity` named-op handler ──────────────────────────────
//
// Registered with `docOps` by `applyAndProject` (which owns `registerNamedOp`).
// Emits the projection delta for the HOST entity whose `photoIds` changed:
// vacations → the parent vacation (composite id); familyMembers avatar → none;
// flat → the entity itself.

function attachHostDelta(
  draft: FamilyDocument,
  collection: string,
  entityId: string
): ProjectionDelta | null {
  if (collection === 'familyMembers') return null; // avatar attach is a no-op
  if (collection === 'vacations') {
    const slash = entityId.indexOf('/');
    const vacationId = slash >= 0 ? entityId.slice(0, slash) : entityId;
    const vac = (draft.vacations ?? {})[vacationId];
    return vac
      ? { kind: 'upsert', collection: 'vacations', id: vacationId, entity: toPlain(vac) }
      : null;
  }
  const entity = (draft as unknown as Record<string, Record<string, unknown>>)[collection]?.[
    entityId
  ];
  return entity
    ? {
        kind: 'upsert',
        collection: collection as CollectionName,
        id: entityId,
        entity: toPlain(entity),
      }
    : null;
}

export const attachPhotoNamedHandler: NamedOpHandler = (draft, args) => {
  const entityCollection = args.entityCollection as string;
  const entityId = args.entityId as string;
  const photoId = args.photoId as UUID;
  attachPhotoToEntity(draft, entityCollection, entityId, photoId); // catches internally
  const delta = attachHostDelta(draft, entityCollection, entityId);
  return { deltas: delta ? [delta] : [] };
};

// ─── Static registration (was the runtime App.vue:111-117 block) ─────────────

registerPhotoCollection('familyMembers', avatarPhotoHooks);
registerPhotoCollection('medications');
registerPhotoCollection('recipes');
registerPhotoCollection('cookLogs');
registerPhotoCollection('milestones');
registerPhotoCollection('activities');
registerPhotoCollection('vacations', vacationPhotoHooks);
