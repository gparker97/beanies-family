import { getDatabase } from '../database';
import type {
  FamilyActivity,
  CreateFamilyActivityInput,
  UpdateFamilyActivityInput,
} from '@/types/models';
import { toISODateString } from '@/utils/date';
import { generateUUID } from '@/utils/id';

export async function getAllActivities(): Promise<FamilyActivity[]> {
  const db = await getDatabase();
  return db.getAll('activities');
}

export async function getActivityById(id: string): Promise<FamilyActivity | undefined> {
  const db = await getDatabase();
  return db.get('activities', id);
}

export async function getActivitiesByDate(date: string): Promise<FamilyActivity[]> {
  const db = await getDatabase();
  return db.getAllFromIndex('activities', 'by-date', date);
}

export async function getActivitiesByAssignee(assigneeId: string): Promise<FamilyActivity[]> {
  const db = await getDatabase();
  return db.getAllFromIndex('activities', 'by-assigneeId', assigneeId);
}

export async function getActivitiesByCategory(category: string): Promise<FamilyActivity[]> {
  const db = await getDatabase();
  return db.getAllFromIndex('activities', 'by-category', category);
}

export async function createActivity(input: CreateFamilyActivityInput): Promise<FamilyActivity> {
  const db = await getDatabase();
  const now = toISODateString(new Date());

  const activity: FamilyActivity = {
    ...input,
    id: generateUUID(),
    createdAt: now,
    updatedAt: now,
  };

  await db.add('activities', activity);
  return activity;
}

export async function updateActivity(
  id: string,
  input: UpdateFamilyActivityInput
): Promise<FamilyActivity | undefined> {
  const db = await getDatabase();
  const existing = await db.get('activities', id);

  if (!existing) {
    return undefined;
  }

  const updated: FamilyActivity = {
    ...existing,
    ...input,
    updatedAt: toISODateString(new Date()),
  };

  await db.put('activities', updated);
  return updated;
}

export async function deleteActivity(id: string): Promise<boolean> {
  const db = await getDatabase();
  const existing = await db.get('activities', id);

  if (!existing) {
    return false;
  }

  await db.delete('activities', id);
  return true;
}
