import type { CollectionName, CollectionEntity } from '@/types/automerge';
import { list, getById as projectionGetById } from './projection';
import { mutate, type RequestOpts } from './worker/docClient';
import type { MutationOp } from './worker/protocol';
// Pure (no Automerge import): the photo-host registry, so this stays the one list.
import { isFlatPhotoHost } from './worker/photoOps';
import { toISODateString } from '@/utils/date';
import { generateUUID } from '@/utils/id';
import { reportError } from '@/utils/errorReporter';

/**
 * Strip keys whose value is `undefined` from a plain object.
 * Automerge rejects `undefined` — only valid JSON types are allowed.
 */
export function stripUndefined<T extends object>(obj: T): T {
  // Record-shaped entities ONLY. `Object.fromEntries(Object.entries(...))` would silently
  // turn an array into `{ '0': …, '1': … }` and a Map/Set into `{}` with every entry
  // dropped. The bound was widened from `Record<string, unknown>` so interface-typed
  // entities (which lack an index signature) could be passed; that widening also let
  // arrays through, so they are returned untouched rather than mangled.
  if (Array.isArray(obj) || obj instanceof Map || obj instanceof Set) return obj;
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as T;
}

/**
 * Deep-clone a value to a plain JS object, stripping Vue reactive proxies.
 * Automerge change functions fail if they receive Vue proxy-wrapped objects.
 */
export function toPlain<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}

/** The `patch` variant of `MutationOp`. */
export type PatchMutationOp = Extract<MutationOp, { op: 'patch' }>;

/**
 * The values `source` holds for `keys`, as a plain (structured-clone-safe) copy: the `base` a
 * write sends (#117, ADR-039). A key `source` lacks stays ABSENT from the result rather than
 * `undefined`, because a key missing from a supplied base means "nothing known", which the
 * worker treats as additive (it inserts and overwrites, never deletes). A missing `source`
 * (an entity not yet in the projection, settings in the boot window) is therefore `{}`, the
 * all-additive base, never a base that could delete something it has not seen.
 */
export function pickBase(
  source: object | null | undefined,
  keys: readonly string[]
): Record<string, unknown> {
  const record = (source ?? {}) as Record<string, unknown>;
  const picked: Record<string, unknown> = {};
  for (const key of keys) {
    if (record[key] !== undefined) picked[key] = record[key];
  }
  return toPlain(picked);
}

/**
 * Build a `patch` op that carries its own `base` (#117, ADR-039): the projection's value of
 * every patched key, read at call time. The worker then reconciles three-way and writes only
 * what the caller changed, so a peer's edit merged in meanwhile (or an earlier queued write)
 * is kept instead of reverted, and arrays are edited per item rather than replaced.
 *
 * The base is RAW: no repository read `transform` is applied. A transform can derive values
 * (`familyMemberRepository.applyDefaults` derives the permission flags from `ageGroup`), and a
 * derived value in the base would make an explicit write of that same value look unchanged
 * and drop it. Only the keys of `patch` are picked, so main never inspects the shape.
 *
 * `patch` must already be plain and undefined-free (`splitPatch`); clears travel in
 * `deleteKeys`, outside the reconciler. `current` is the projection entity when the caller has
 * just read it (the factory `update`'s existence check), to avoid a second read.
 */
export function patchOp(
  collection: CollectionName,
  id: string,
  patch: Record<string, unknown>,
  opts: Pick<PatchMutationOp, 'deleteKeys' | 'updatedAt' | 'onMissing'> & {
    current?: object;
  } = {}
): PatchMutationOp {
  const { current, ...rest } = opts;
  const source = current ?? projectionGetById(collection, id);
  return {
    op: 'patch',
    collection,
    id,
    patch,
    base: pickBase(source, Object.keys(patch)),
    ...rest,
  };
}

/**
 * Generic Automerge repository factory.
 * Mirrors the IndexedDB `createRepository` API exactly:
 * same function signatures, same async return types, same auto-ID + timestamps.
 *
 * Post-ADR-032 the Automerge doc lives in the worker: reads come from the
 * main-thread `projection` (synchronous), writes go through `docClient.mutate`
 * (async RPC; the response delta is applied to the projection before it
 * resolves, so read-after-write is race-free). Public signatures are unchanged
 * (already `Promise`-returning). Array-ref stores keep their own surgical update
 * from the echoed return.
 */
/**
 * Optional arrays created empty with the entity so a first concurrent append on two devices
 * merges instead of racing on the key (#117). Photo hosts are handled by `isFlatPhotoHost`;
 * this table is for everything else.
 */
const SEEDED_ARRAYS: Partial<Record<CollectionName, readonly string[]>> = {
  goals: ['manualContributions'],
};

export function createAutomergeRepository<
  K extends CollectionName,
  Entity extends CollectionEntity<K> = CollectionEntity<K>,
  CreateInput = Omit<Entity, 'id' | 'createdAt' | 'updatedAt'>,
  UpdateInput = Partial<Omit<Entity, 'id' | 'createdAt' | 'updatedAt'>>,
>(
  collectionName: K,
  options?: {
    transform?: (entity: Entity) => Entity;
  }
) {
  const transform = options?.transform ?? ((e: Entity) => e);

  async function getAll(): Promise<Entity[]> {
    return (list(collectionName) as Entity[]).map(transform);
  }

  async function getById(id: string): Promise<Entity | undefined> {
    const item = projectionGetById(collectionName, id) as Entity | undefined;
    return item ? transform(item) : undefined;
  }

  async function create(input: CreateInput): Promise<Entity> {
    return createWithId(generateUUID(), input);
  }

  /**
   * Like `create()`, but uses a caller-supplied id instead of a fresh UUID.
   * Used when an entity must keep a specific id across a rebuild — e.g. the
   * owner member after a full-page-redirect-during-onboarding wiped the
   * in-memory Automerge doc, where the persisted `currentUser.memberId`
   * (and the `.beanpod` envelope's `wrappedKeys` keyed by it) must still
   * point at the recreated member.
   */
  async function createWithId(id: string, input: CreateInput): Promise<Entity> {
    const entity = stampNew(id, input, toISODateString(new Date()));

    // The worker echoes the stored entity; its delta lands in the projection
    // before this resolves (read-after-write is safe).
    await mutate({ op: 'set', collection: collectionName, id, entity });
    return transform(entity);
  }

  /**
   * The stored shape of a new entity: input + id + both timestamps, plain and undefined-free.
   *
   * Arrays that two devices may append to concurrently are BORN EMPTY (#117): the first append
   * is then a list insert that merges, not the creation of the key, which two devices would race
   * on and one side would lose. A flat photo host is born with `photoIds: []` (one device's photo
   * id lost, then the photo itself collected by the next GC); a goal is born with
   * `manualContributions: []` (Phase 2: two first contributions kept the amount but only one
   * history row, so the drawer's total did not add up to its rows). Add to `SEEDED_ARRAYS`
   * when a collection gains another concurrently-appended optional array.
   */
  function stampNew(id: string, input: CreateInput, now: string): Entity {
    const raw = input as Record<string, unknown>;
    const seeded: Record<string, unknown[]> = {};
    if (raw.photoIds === undefined && isFlatPhotoHost(collectionName)) seeded.photoIds = [];
    for (const field of SEEDED_ARRAYS[collectionName] ?? []) {
      if (raw[field] === undefined) seeded[field] = [];
    }
    return toPlain(
      stripUndefined({
        ...raw,
        ...seeded,
        id,
        createdAt: now,
        updatedAt: now,
      })
    ) as unknown as Entity;
  }

  /**
   * Create several entities with caller-minted ids in ONE Automerge change (all or nothing).
   * Each is stamped exactly like `createWithId`. Because the ids come from the caller, a retry
   * with the same ids rewrites the same entities rather than adding duplicates, so there is no
   * post-write projection check (unlike `commitStatementAdds`, whose fresh ids forbid a retry).
   *
   * `ifAbsent` drops every item whose id is already in the projection (the document's truth,
   * not a store array that may not have loaded it yet), so a deterministic id another device
   * already created is never overwritten by a whole-entity `set`. Returns only the entities
   * this call created; with nothing left to create it writes nothing.
   */
  async function createManyWithIds(
    items: readonly { id: string; input: CreateInput }[],
    opts?: { ifAbsent?: boolean }
  ): Promise<Entity[]> {
    const toCreate = opts?.ifAbsent
      ? items.filter(({ id }) => !projectionGetById(collectionName, id))
      : items;
    if (!toCreate.length) return [];
    const now = toISODateString(new Date());
    const entities = toCreate.map(({ id, input }) => stampNew(id, input, now));
    const ops: MutationOp[] = entities.map((entity) => ({
      op: 'set',
      collection: collectionName,
      id: (entity as { id: string }).id,
      entity,
    }));
    await mutate({ op: 'batch', ops });
    return entities.map(transform);
  }

  /**
   * Split an update input into the keys to write and the keys to delete. A key explicitly
   * set to `undefined` is DELETED from the stored entity (e.g. clearing `goalId` to unlink
   * a goal); a key absent from the input is left untouched. Automerge rejects `undefined`,
   * so it can never travel in the patch itself. Shared by `update`, `patchMany` and
   * `patchEach` so a batched clear behaves exactly like a single one.
   */
  function splitPatch(input: UpdateInput): {
    patch: Record<string, unknown>;
    deleteKeys: string[];
  } {
    const raw = input as Record<string, unknown>;
    const deleteKeys = Object.keys(raw).filter((key) => raw[key] === undefined);
    return { patch: toPlain(stripUndefined(raw)), deleteKeys };
  }

  /**
   * Apply the same patch to several entities in ONE Automerge change. An id that is absent
   * (deleted here or on another device) is skipped, never a failure. A key set to
   * `undefined` is deleted on every entity (see `splitPatch`). Returns the entities that
   * were patched, read back from the projection.
   */
  async function patchMany(
    ids: readonly string[],
    patch: UpdateInput,
    options: { onMissing: 'skip' }
  ): Promise<Entity[]> {
    if (!ids.length) return [];
    const now = toISODateString(new Date());
    const { patch: cleanPatch, deleteKeys } = splitPatch(patch);
    // One op per id, each with that entity's own base (see `patchOp`).
    const ops: MutationOp[] = ids.map((id) =>
      patchOp(collectionName, id, cleanPatch, {
        deleteKeys,
        updatedAt: now,
        onMissing: options.onMissing,
      })
    );
    await mutate({ op: 'batch', ops });
    return ids
      .map((id) => projectionGetById(collectionName, id) as Entity | undefined)
      .filter((e): e is Entity => e !== undefined)
      .map(transform);
  }

  /**
   * Apply a DIFFERENT patch to each of several entities in ONE Automerge change. Each item
   * becomes its own `patchOp`, with its own `splitPatch` (a key set to `undefined` is deleted
   * on that entity only) and its own base read from the projection at call time, so the
   * worker reconciles each three-way and a peer's concurrent edit is kept (ADR-039). An id
   * that is absent is skipped, never a failure. Returns the entities that were patched, read
   * back from the projection.
   */
  async function patchEach(
    items: readonly { id: string; patch: UpdateInput }[],
    options: { onMissing: 'skip' }
  ): Promise<Entity[]> {
    if (!items.length) return [];
    const now = toISODateString(new Date());
    // Every base is read here, synchronously, before the write is sent.
    const ops: MutationOp[] = items.map(({ id, patch }) => {
      const { patch: cleanPatch, deleteKeys } = splitPatch(patch);
      return patchOp(collectionName, id, cleanPatch, {
        deleteKeys,
        updatedAt: now,
        onMissing: options.onMissing,
      });
    });
    await mutate({ op: 'batch', ops });
    return items
      .map(({ id }) => projectionGetById(collectionName, id) as Entity | undefined)
      .filter((e): e is Entity => e !== undefined)
      .map(transform);
  }

  /**
   * Delete several entities in ONE Automerge change. A missing id is a no-op (a `delete` op
   * on an absent key changes nothing), so this never fails on a concurrent delete.
   */
  async function removeMany(ids: readonly string[]): Promise<void> {
    if (!ids.length) return;
    const ops: MutationOp[] = ids.map((id) => ({ op: 'delete', collection: collectionName, id }));
    await mutate({ op: 'batch', ops });
  }

  /** `opts.system` marks a write that passes the read-only gate (#95). Only
   *  `familyStore.updateMemberCredentials` sets it; see `MemberSystemPatch` for what may. */
  async function update(
    id: string,
    input: UpdateInput,
    opts?: Pick<RequestOpts, 'system'>
  ): Promise<Entity | undefined> {
    // Existence check up front (fast path). Returning undefined preserves the
    // repository contract. The same read is the write's base (`patchOp`).
    const current = projectionGetById(collectionName, id);
    if (!current) return undefined;

    const now = toISODateString(new Date());
    const { patch: cleanInput, deleteKeys: keysToDelete } = splitPatch(input);
    // `onMissing:'skip'` tolerates the concurrent-delete TOCTOU race: the up-front
    // check passed, but a poll-merge on another device may have deleted the entity
    // before the worker applies this patch. Rather than a rejected RPC + spurious
    // critical toast, the worker no-ops and echoes undefined; we return undefined
    // (the old graceful contract) but leave a warning breadcrumb so a genuine
    // worker/projection divergence is diagnosable (never a silent success).
    const result = await mutate<Entity | undefined>(
      patchOp(collectionName, id, cleanInput, {
        deleteKeys: keysToDelete,
        updatedAt: now,
        onMissing: 'skip',
        current,
      }),
      opts?.system ? { system: true } : undefined
    );
    if (!result) {
      reportError({
        surface: 'automergeRepository.update.concurrent-delete',
        message: `patch skipped: ${collectionName}/${id} vanished between the projection check and the worker write (concurrent delete)`,
        severity: 'warning',
      });
      return undefined;
    }
    return transform(result);
  }

  async function remove(id: string): Promise<boolean> {
    if (!projectionGetById(collectionName, id)) return false;
    await mutate({ op: 'delete', collection: collectionName, id });
    return true;
  }

  return {
    getAll,
    getById,
    create,
    createWithId,
    createManyWithIds,
    update,
    patchMany,
    patchEach,
    remove,
    removeMany,
  };
}
