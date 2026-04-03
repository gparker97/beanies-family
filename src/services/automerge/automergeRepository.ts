import type { CollectionName, CollectionEntity } from '@/types/automerge';
import { getDoc, changeDoc } from './docService';
import { toISODateString } from '@/utils/date';
import { generateUUID } from '@/utils/id';

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
 * Key differences from IndexedDB:
 * - getAll() → Object.values() on the in-memory CRDT map
 * - create() → changeDoc(d => { d[collection][id] = entity })
 * - update() → changeDoc(d => { Object.assign(...) }) — property-level CRDT merge
 * - remove() → changeDoc(d => { delete d[collection][id] })
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
    const doc = getDoc();
    const collection = (doc[collectionName] ?? {}) as Record<string, Entity>;
    return Object.values(collection).map(transform);
  }

  async function getById(id: string): Promise<Entity | undefined> {
    const doc = getDoc();
    const collection = (doc[collectionName] ?? {}) as Record<string, Entity>;
    const item = collection[id];
    return item ? transform(item) : undefined;
  }

  async function create(input: CreateInput): Promise<Entity> {
    const now = toISODateString(new Date());
    const entity = toPlain(
      stripUndefined({
        ...(input as Record<string, unknown>),
        id: generateUUID(),
        createdAt: now,
        updatedAt: now,
      })
    ) as unknown as Entity;

    const id = (entity as unknown as { id: string }).id;
    changeDoc((d) => {
      const collection = d[collectionName] as Record<string, Entity>;
      collection[id] = entity;
    });

    return transform(entity);
  }

  async function update(id: string, input: UpdateInput): Promise<Entity | undefined> {
    const doc = getDoc();
    const collection = doc[collectionName] as Record<string, Entity>;
    const existing = collection[id];

    if (!existing) return undefined;

    const now = toISODateString(new Date());
    const rawInput = input as Record<string, unknown>;

    // Collect keys explicitly set to undefined — these should be deleted
    // from the Automerge doc (e.g., clearing goalId to unlink a goal).
    // Keys NOT present in the input are left untouched.
    const keysToDelete: string[] = [];
    for (const key of Object.keys(rawInput)) {
      if (rawInput[key] === undefined) keysToDelete.push(key);
    }

    const cleanInput = toPlain(stripUndefined(rawInput));
    changeDoc((d) => {
      const col = d[collectionName] as Record<string, Entity>;
      const target = col[id];
      if (target) {
        Object.assign(target, cleanInput, { updatedAt: now });
        for (const key of keysToDelete) {
          delete (target as Record<string, unknown>)[key];
        }
      }
    });

    // Return the updated entity from the new doc state
    const updated = getDoc()[collectionName] as Record<string, Entity>;
    const result = updated[id];
    return result ? transform(result) : undefined;
  }

  async function remove(id: string): Promise<boolean> {
    const doc = getDoc();
    const collection = doc[collectionName] as Record<string, Entity>;

    if (!collection[id]) return false;

    changeDoc((d) => {
      const col = d[collectionName] as Record<string, Entity>;
      delete col[id];
    });

    return true;
  }

  return { getAll, getById, create, update, remove };
}
