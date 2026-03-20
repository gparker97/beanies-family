import { createAutomergeRepository } from '../automergeRepository';
import type {
  FamilyVacation,
  CreateFamilyVacationInput,
  UpdateFamilyVacationInput,
} from '@/types/models';

const repo = createAutomergeRepository<
  'vacations',
  FamilyVacation,
  CreateFamilyVacationInput,
  UpdateFamilyVacationInput
>('vacations');

export const getAllVacations = repo.getAll;
export const getVacationById = repo.getById;
export const createVacation = repo.create;
export const updateVacation = repo.update;
export const deleteVacation = repo.remove;
