import { createAutomergeRepository } from '../automergeRepository';
import type { Recipe, CookLogEntry } from '@/types/models';
import { list } from '../projection';
import { mutate } from '../worker/docClient';
import type { MutationOp } from '../worker/protocol';

const recipeRepo = createAutomergeRepository<'recipes', Recipe>('recipes');
const cookLogRepo = createAutomergeRepository<'cookLogs', CookLogEntry>('cookLogs');

export const getAllRecipes = recipeRepo.getAll;
export const getRecipeById = recipeRepo.getById;
export const createRecipe = recipeRepo.create;
export const updateRecipe = recipeRepo.update;

export const getAllCookLogs = cookLogRepo.getAll;
export const createCookLog = cookLogRepo.create;
export const updateCookLog = cookLogRepo.update;
export const deleteCookLog = cookLogRepo.remove;

export async function getCookLogsByRecipe(recipeId: string): Promise<CookLogEntry[]> {
  const all = await getAllCookLogs();
  return all.filter((c) => c.recipeId === recipeId);
}

/**
 * Delete a recipe AND cascade-delete its cook logs in a single Automerge
 * change. Photos attached to the recipe or its cook logs are left to
 * photoStore.gcOrphans for Drive cleanup (they become zero-reference
 * orphans once the records are gone).
 */
export async function deleteRecipeCascade(recipeId: string): Promise<void> {
  // Resolve the child cook-log ids from the projection, then delete children +
  // parent in one atomic batch (single Automerge.change in the worker).
  const childIds = list('cookLogs')
    .filter((c) => c.recipeId === recipeId)
    .map((c) => c.id);
  const ops: MutationOp[] = [
    ...childIds.map((id): MutationOp => ({ op: 'delete', collection: 'cookLogs', id })),
    { op: 'delete', collection: 'recipes', id: recipeId },
  ];
  await mutate({ op: 'batch', ops });
}

/**
 * Count of cook logs for a given recipe — used in the delete-confirm
 * prompt so users see how much history they're about to remove.
 */
export function countCookLogsForRecipe(recipeId: string): number {
  return list('cookLogs').filter((c) => c.recipeId === recipeId).length;
}
