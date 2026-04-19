import { createAutomergeRepository } from '../automergeRepository';
import type { Allergy } from '@/types/models';

const repo = createAutomergeRepository<'allergies', Allergy>('allergies');

export const getAllAllergies = repo.getAll;
export const getAllergyById = repo.getById;
export const createAllergy = repo.create;
export const updateAllergy = repo.update;
export const deleteAllergy = repo.remove;

export async function getAllergiesByMember(memberId: string): Promise<Allergy[]> {
  const all = await getAllAllergies();
  return all.filter((a) => a.memberId === memberId);
}
