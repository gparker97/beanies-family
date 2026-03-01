import { createRepository } from '../createRepository';
import { getDatabase } from '../database';
import type {
  RecurringItem,
  CreateRecurringItemInput,
  UpdateRecurringItemInput,
  ISODateString,
} from '@/types/models';

const repo = createRepository<
  'recurringItems',
  RecurringItem,
  CreateRecurringItemInput,
  UpdateRecurringItemInput
>('recurringItems');

export const getAllRecurringItems = repo.getAll;
export const getRecurringItemById = repo.getById;
export const createRecurringItem = repo.create;
export const updateRecurringItem = repo.update;
export const deleteRecurringItem = repo.remove;

export async function getRecurringItemsByAccountId(accountId: string): Promise<RecurringItem[]> {
  const db = await getDatabase();
  return db.getAllFromIndex('recurringItems', 'by-accountId', accountId);
}

export async function getRecurringItemsByType(
  type: 'income' | 'expense'
): Promise<RecurringItem[]> {
  const db = await getDatabase();
  return db.getAllFromIndex('recurringItems', 'by-type', type);
}

export async function getActiveRecurringItems(): Promise<RecurringItem[]> {
  const items = await getAllRecurringItems();
  return items.filter((item) => item.isActive);
}

export async function updateLastProcessedDate(
  id: string,
  date: ISODateString
): Promise<RecurringItem | undefined> {
  return updateRecurringItem(id, { lastProcessedDate: date });
}

export async function toggleRecurringItemActive(id: string): Promise<RecurringItem | undefined> {
  const existing = await getRecurringItemById(id);
  if (!existing) return undefined;
  return updateRecurringItem(id, { isActive: !existing.isActive });
}
