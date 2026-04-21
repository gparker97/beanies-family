import { createAutomergeRepository } from '../automergeRepository';
import type {
  MedicationLogEntry,
  CreateMedicationLogEntryInput,
  UpdateMedicationLogEntryInput,
} from '@/types/models';

/**
 * Medication administration log — one entry per dose given.
 *
 * Parent relationship is `medicationId`; cascade-delete on medication
 * removal is handled by `deleteMedicationCascade` in medicationRepository
 * (single atomic changeDoc, mirrors the recipe/cookLog pattern).
 *
 * Photo-less by design (v1) — do NOT call `registerPhotoCollection`
 * for this collection. See plan 2026-04-21 §1.9.
 */
const repo = createAutomergeRepository<
  'medicationLogs',
  MedicationLogEntry,
  CreateMedicationLogEntryInput,
  UpdateMedicationLogEntryInput
>('medicationLogs');

export const getAllMedicationLogs = repo.getAll;
export const getMedicationLogById = repo.getById;
export const createMedicationLog = repo.create;
export const updateMedicationLog = repo.update;
export const deleteMedicationLog = repo.remove;
