import { createAutomergeRepository } from '../automergeRepository';
import type { Medication } from '@/types/models';

const repo = createAutomergeRepository<'medications', Medication>('medications');

export const getAllMedications = repo.getAll;
export const getMedicationById = repo.getById;
export const createMedication = repo.create;
export const updateMedication = repo.update;
export const deleteMedication = repo.remove;

export async function getMedicationsByMember(memberId: string): Promise<Medication[]> {
  const all = await getAllMedications();
  return all.filter((m) => m.memberId === memberId);
}
