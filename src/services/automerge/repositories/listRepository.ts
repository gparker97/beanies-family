import { createAutomergeRepository } from '../automergeRepository';
import type { FamilyList, CreateFamilyListInput, UpdateFamilyListInput } from '@/types/models';

const repo = createAutomergeRepository<
  'lists',
  FamilyList,
  CreateFamilyListInput,
  UpdateFamilyListInput
>('lists');

export const getAllLists = repo.getAll;
export const getListById = repo.getById;
export const createList = repo.create;
export const updateList = repo.update;
export const deleteList = repo.remove;
