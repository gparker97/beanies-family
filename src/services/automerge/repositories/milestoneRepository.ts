import { createAutomergeRepository } from '../automergeRepository';
import type { Milestone } from '@/types/models';

const repo = createAutomergeRepository<'milestones', Milestone>('milestones');

export const getAllMilestones = repo.getAll;
export const getMilestoneById = repo.getById;
export const createMilestone = repo.create;
export const updateMilestone = repo.update;
export const deleteMilestone = repo.remove;

export async function getMilestonesByMember(memberId: string): Promise<Milestone[]> {
  const all = await getAllMilestones();
  return all.filter((m) => m.memberId === memberId);
}

export async function getFamilyWideMilestones(): Promise<Milestone[]> {
  const all = await getAllMilestones();
  return all.filter((m) => m.memberId === null);
}
