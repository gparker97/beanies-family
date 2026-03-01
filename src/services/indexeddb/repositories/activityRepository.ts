import { createRepository } from '../createRepository';
import { getDatabase } from '../database';
import type {
  FamilyActivity,
  CreateFamilyActivityInput,
  UpdateFamilyActivityInput,
} from '@/types/models';

const repo = createRepository<
  'activities',
  FamilyActivity,
  CreateFamilyActivityInput,
  UpdateFamilyActivityInput
>('activities');

export const getAllActivities = repo.getAll;
export const getActivityById = repo.getById;
export const createActivity = repo.create;
export const updateActivity = repo.update;
export const deleteActivity = repo.remove;

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
