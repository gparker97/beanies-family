import type { CollectionName, CollectionEntity } from '@/types/automerge';
import { list, getById as projectionGetById } from './projection';
import { mutate } from './worker/docClient';
import { toISODateString } from '@/utils/date';
import { generateUUID } from '@/utils/id';
import { reportError } from '@/utils/errorReporter';

/**
 * Strip keys whose value is `undefined` from a plain object.
 * Automerge rejects `undefined` — only valid JSON types are allowed.
 */
function stripUndefined<T extends Record<string, unknown>>(obj: T): T {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as T;
}

/**
 * Deep-clone a value to a plain JS object, stripping Vue reactive proxies.
 * Automerge change functions fail if they receive Vue proxy-wrapped objects.
 */
function toPlain<T>(obj: T): T {
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
    const now = toISODateString(new Date());
    const entity = toPlain(
      stripUndefined({
        ...(input as Record<string, unknown>),
        id,
        createdAt: now,
        updatedAt: now,
      })
    ) as unknown as Entity;

    // The worker echoes the stored entity; its delta lands in the projection
    // before this resolves (read-after-write is safe).
    await mutate({ op: 'set', collection: collectionName, id, entity });
    return transform(entity);
  }

  async function update(id: string, input: UpdateInput): Promise<Entity | undefined> {
    // Existence check up front (fast path). Returning undefined preserves the
    // repository contract.
    if (!projectionGetById(collectionName, id)) return undefined;

    const now = toISODateString(new Date());
    const rawInput = input as Record<string, unknown>;

    // Keys explicitly set to undefined are deleted from the doc (e.g. clearing
    // goalId to unlink a goal). Keys NOT present in the input are left untouched.
    const keysToDelete: string[] = [];
    for (const key of Object.keys(rawInput)) {
      if (rawInput[key] === undefined) keysToDelete.push(key);
    }

    const cleanInput = toPlain(stripUndefined(rawInput));
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

  return { getAll, getById, create, createWithId, update, remove };
}
