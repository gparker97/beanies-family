import type { StoreNames, StoreValue } from 'idb';
import { getDatabase, type FinanceDB } from './database';
import { toISODateString } from '@/utils/date';
import { generateUUID } from '@/utils/id';

type EntityStoreName = Exclude<StoreNames<FinanceDB>, 'settings' | 'syncQueue' | 'translations'>;

/**
 * Generic IndexedDB repository factory.
 * Generates standard CRUD operations for any entity store.
 *
 * @param storeName - The IndexedDB object store name
 * @param options.transform - Optional post-read transform (e.g. applying legacy defaults)
 */
export function createRepository<
  S extends EntityStoreName,
  Entity extends StoreValue<FinanceDB, S> = StoreValue<FinanceDB, S>,
  CreateInput = Omit<Entity, 'id' | 'createdAt' | 'updatedAt'>,
  UpdateInput = Partial<Omit<Entity, 'id' | 'createdAt' | 'updatedAt'>>,
>(
  storeName: S,
  options?: {
    transform?: (entity: Entity) => Entity;
  }
) {
  const transform = options?.transform ?? ((e: Entity) => e);

  async function getAll(): Promise<Entity[]> {
    const db = await getDatabase();
    const items = (await db.getAll(storeName)) as Entity[];
    return items.map(transform);
  }

  async function getById(id: string): Promise<Entity | undefined> {
    const db = await getDatabase();
    const item = (await db.get(storeName, id)) as Entity | undefined;
    return item ? transform(item) : undefined;
  }

  async function create(input: CreateInput): Promise<Entity> {
    const db = await getDatabase();
    const now = toISODateString(new Date());

    const entity = {
      ...input,
      id: generateUUID(),
      createdAt: now,
      updatedAt: now,
    } as Entity;

    await db.add(storeName, entity as StoreValue<FinanceDB, S>);
    return entity;
  }

  async function update(id: string, input: UpdateInput): Promise<Entity | undefined> {
    const db = await getDatabase();
    const existing = (await db.get(storeName, id)) as Entity | undefined;

    if (!existing) {
      return undefined;
    }

    const updated = {
      ...existing,
      ...input,
      updatedAt: toISODateString(new Date()),
    } as Entity;

    await db.put(storeName, updated as StoreValue<FinanceDB, S>);
    return updated;
  }

  async function remove(id: string): Promise<boolean> {
    const db = await getDatabase();
    const existing = await db.get(storeName, id);

    if (!existing) {
      return false;
    }

    await db.delete(storeName, id);
    return true;
  }

  return { getAll, getById, create, update, remove };
}
