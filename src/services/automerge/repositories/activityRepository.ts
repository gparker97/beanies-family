import { createAutomergeRepository } from '../automergeRepository';
import type {
  FamilyActivity,
  CreateFamilyActivityInput,
  UpdateFamilyActivityInput,
} from '@/types/models';

const repo = createAutomergeRepository<
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
  const activities = await getAllActivities();
  return activities.filter((a) => a.date === date);
}

export async function getActivitiesByAssignee(assigneeId: string): Promise<FamilyActivity[]> {
  const activities = await getAllActivities();
  return activities.filter((a) => a.assigneeId === assigneeId);
}

export async function getActivitiesByCategory(category: string): Promise<FamilyActivity[]> {
  const activities = await getAllActivities();
  return activities.filter((a) => a.category === category);
}
