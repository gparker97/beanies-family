import { createAutomergeRepository } from '../automergeRepository';
import type { Medication } from '@/types/models';
import { changeDoc } from '../docService';

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
  changeDoc((doc) => {
    const logs = doc.medicationLogs ?? {};
    for (const [id, entry] of Object.entries(logs)) {
      if (entry.medicationId === medicationId) {
        delete logs[id];
      }
    }
    const medications = doc.medications ?? {};
    delete medications[medicationId];
  }, `medications: cascade-delete ${medicationId}`);
}
