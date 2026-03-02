import type { CollectionName, CollectionEntity } from '@/types/automerge';
import { getDoc, changeDoc } from './docService';
import { toISODateString } from '@/utils/date';
import { generateUUID } from '@/utils/id';

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
    const collection = doc[collectionName] as Record<string, Entity>;
    return Object.values(collection).map(transform);
  }

  async function getById(id: string): Promise<Entity | undefined> {
    const doc = getDoc();
    const collection = doc[collectionName] as Record<string, Entity>;
    const item = collection[id];
    return item ? transform(item) : undefined;
  }

  async function create(input: CreateInput): Promise<Entity> {
    const now = toISODateString(new Date());
    const entity = {
      ...input,
      id: generateUUID(),
      createdAt: now,
      updatedAt: now,
    } as unknown as Entity;

    const id = (entity as unknown as { id: string }).id;
    changeDoc((d) => {
      const collection = d[collectionName] as Record<string, Entity>;
      collection[id] = entity;
    });

    return entity;
  }

  async function update(id: string, input: UpdateInput): Promise<Entity | undefined> {
    const doc = getDoc();
    const collection = doc[collectionName] as Record<string, Entity>;
    const existing = collection[id];

    if (!existing) return undefined;

    const now = toISODateString(new Date());
    changeDoc((d) => {
      const col = d[collectionName] as Record<string, Entity>;
      const target = col[id];
      if (target) Object.assign(target, input, { updatedAt: now });
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
