import { createAutomergeRepository } from '../automergeRepository';
import type { Recipe, CookLogEntry } from '@/types/models';
import { changeDoc, getDoc } from '../docService';

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
  changeDoc((doc) => {
    const cookLogs = doc.cookLogs ?? {};
    for (const [id, entry] of Object.entries(cookLogs)) {
      if (entry.recipeId === recipeId) {
        delete cookLogs[id];
      }
    }
    const recipes = doc.recipes ?? {};
    delete recipes[recipeId];
  }, `recipes: cascade-delete ${recipeId}`);
}

/**
 * Count of cook logs for a given recipe — used in the delete-confirm
 * prompt so users see how much history they're about to remove.
 */
export function countCookLogsForRecipe(recipeId: string): number {
  try {
    const doc = getDoc();
    const logs = Object.values(doc.cookLogs ?? {});
    return logs.filter((c) => c.recipeId === recipeId).length;
  } catch {
    return 0;
  }
}
