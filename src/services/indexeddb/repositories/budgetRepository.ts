import { createRepository } from '../createRepository';
import type { Budget, CreateBudgetInput, UpdateBudgetInput } from '@/types/models';

const repo = createRepository<'budgets', Budget, CreateBudgetInput, UpdateBudgetInput>('budgets');

export const getAllBudgets = repo.getAll;
export const getBudgetById = repo.getById;
export const createBudget = repo.create;
export const updateBudget = repo.update;
export const deleteBudget = repo.remove;

export async function getActiveBudget(): Promise<Budget | undefined> {
  const budgets = await getAllBudgets();
  return budgets.find((b) => b.isActive);
}
