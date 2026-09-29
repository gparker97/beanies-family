import type { CollectionName, CollectionEntity } from '@/types/automerge';
import { list, getById as projectionGetById } from './projection';
import { mutate } from './worker/docClient';
import type { MutationOp } from './worker/protocol';
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

  /** The stored shape of a new entity: input + id + both timestamps, plain and undefined-free. */
  function stampNew(id: string, input: CreateInput, now: string): Entity {
    return toPlain(
      stripUndefined({
        ...(input as Record<string, unknown>),
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
   */
  async function createManyWithIds(
    items: readonly { id: string; input: CreateInput }[]
  ): Promise<Entity[]> {
    if (!items.length) return [];
    const now = toISODateString(new Date());
    const entities = items.map(({ id, input }) => stampNew(id, input, now));
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
   * so it can never travel in the patch itself. Shared by `update` and `patchMany` so a
   * batched clear behaves exactly like a single one.
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
    const ops: MutationOp[] = ids.map((id) => ({
      op: 'patch',
      collection: collectionName,
      id,
      patch: cleanPatch,
      deleteKeys,
      updatedAt: now,
      onMissing: options.onMissing,
    }));
    await mutate({ op: 'batch', ops });
    return ids
      .map((id) => projectionGetById(collectionName, id) as Entity | undefined)
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

  async function update(id: string, input: UpdateInput): Promise<Entity | undefined> {
    // Existence check up front (fast path). Returning undefined preserves the
    // repository contract.
    if (!projectionGetById(collectionName, id)) return undefined;

    const now = toISODateString(new Date());
    const { patch: cleanInput, deleteKeys: keysToDelete } = splitPatch(input);
    // `onMissing:'skip'` tolerates the concurrent-delete TOCTOU race: the up-front
    // check passed, but a poll-merge on another device may have deleted the entity
    // before the worker applies this patch. Rather than a rejected RPC + spurious
    // critical toast, the worker no-ops and echoes undefined; we return undefined
    // (the old graceful contract) but leave a warning breadcrumb so a genuine
    // worker/projection divergence is diagnosable (never a silent success).
    const result = await mutate<Entity | undefined>({
      op: 'patch',
      collection: collectionName,
      id,
      patch: cleanInput,
      deleteKeys: keysToDelete,
      updatedAt: now,
      onMissing: 'skip',
    });
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
    remove,
    removeMany,
  };
}
