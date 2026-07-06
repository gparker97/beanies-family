import { createAutomergeRepository } from '../automergeRepository';
import type { Medication } from '@/types/models';
import { list } from '../projection';
import { mutate } from '../worker/docClient';
import type { MutationOp } from '../worker/protocol';

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

/**
 * Delete a medication AND cascade-delete its log entries in a single
 * atomic Automerge change. Mirrors `deleteRecipeCascade` in
 * recipeRepository. Photos attached to the medication are left to
 * photoStore.gcOrphans for Drive cleanup.
 */
export async function deleteMedicationCascade(medicationId: string): Promise<void> {
  const childIds = list('medicationLogs')
    .filter((entry) => entry.medicationId === medicationId)
    .map((entry) => entry.id);
  const ops: MutationOp[] = [
    ...childIds.map((id): MutationOp => ({ op: 'delete', collection: 'medicationLogs', id })),
    { op: 'delete', collection: 'medications', id: medicationId },
  ];
  await mutate({ op: 'batch', ops });
}
