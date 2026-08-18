import { createAutomergeRepository } from '../automergeRepository';
import type { MealPlanEntry } from '@/types/models';
import { list } from '../projection';
import { mutate } from '../worker/docClient';
import type { MutationOp } from '../worker/protocol';

const mealRepo = createAutomergeRepository<'mealPlans', MealPlanEntry>('mealPlans');

export const getAllMealPlans = mealRepo.getAll;
export const getMealPlanById = mealRepo.getById;
export const createMealPlan = mealRepo.create;
export const updateMealPlan = mealRepo.update;
export const deleteMealPlan = mealRepo.remove;

/** Strip `undefined` values — Automerge rejects them (mirrors the repo factory). */
function clean(entity: MealPlanEntry): MealPlanEntry {
  return JSON.parse(
    JSON.stringify(Object.fromEntries(Object.entries(entity).filter(([, v]) => v !== undefined)))
  ) as MealPlanEntry;
}

/**
 * Overwrite an entire week in ONE atomic batch (single Automerge.change): delete
 * every existing entry whose `date` is in `weekDates`, then set the supplied
 * `entries`. Used by copy-week. Because the worker applies a batch atomically, a
 * failure leaves the target week's prior entries untouched — not partially
 * destroyed. Caller MUST pass fully-formed entries (with fresh ids + timestamps).
 */
export async function replaceWeek(weekDates: string[], entries: MealPlanEntry[]): Promise<void> {
  const weekSet = new Set(weekDates);
  const toDelete = list('mealPlans')
    .filter((m) => weekSet.has(m.date))
    .map((m) => m.id);
  const ops: MutationOp[] = [
    ...toDelete.map((id): MutationOp => ({ op: 'delete', collection: 'mealPlans', id })),
    ...entries.map((e): MutationOp => ({
      op: 'set',
      collection: 'mealPlans',
      id: e.id,
      entity: clean(e),
    })),
  ];
  await mutate({ op: 'batch', ops });
}

/** Meal-plan entries (ids) that reference a given recipe — for the recipe-delete deref. */
export function mealIdsForRecipe(recipeId: string): string[] {
  return list('mealPlans')
    .filter((m) => m.recipeId === recipeId)
    .map((m) => m.id);
}

/** Count of meal-plan entries referencing a recipe — feeds the delete-confirm prompt. */
export function countMealsForRecipe(recipeId: string): number {
  return list('mealPlans').filter((m) => m.recipeId === recipeId).length;
}
