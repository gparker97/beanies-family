import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { wrapAsync } from '@/composables/useStoreActions';
import * as repo from '@/services/automerge/repositories/recipeRepository';
import type { Recipe, CookLogEntry } from '@/types/models';

type RecipeCreate = Omit<Recipe, 'id' | 'createdAt' | 'updatedAt'>;
type RecipeUpdate = Partial<RecipeCreate>;
type CookLogCreate = Omit<CookLogEntry, 'id' | 'createdAt' | 'updatedAt'>;
type CookLogUpdate = Partial<CookLogCreate>;

export const useRecipesStore = defineStore('recipes', () => {
  const recipes = ref<Recipe[]>([]);
  const cookLogs = ref<CookLogEntry[]>([]);
  const isLoading = ref(false);
  const error = ref<string | null>(null);

  function cookLogsByRecipe(recipeId: string) {
    return computed(() =>
      cookLogs.value
        .filter((c) => c.recipeId === recipeId)
        .sort((a, b) => b.cookedOn.localeCompare(a.cookedOn))
    );
  }

  function cookStatsForRecipe(recipeId: string) {
    return computed(() => {
      const entries = cookLogs.value.filter((c) => c.recipeId === recipeId);
      const count = entries.length;
      if (count === 0) return { count: 0, avgRating: 0, lastCookedOn: null };
      const avgRating = entries.reduce((sum, c) => sum + c.rating, 0) / count;
      const lastCookedOn = entries.map((c) => c.cookedOn).sort((a, b) => b.localeCompare(a))[0];
      return { count, avgRating, lastCookedOn };
    });
  }

  async function loadRecipes() {
    await wrapAsync(isLoading, error, async () => {
      recipes.value = await repo.getAllRecipes();
      cookLogs.value = await repo.getAllCookLogs();
    });
  }

  async function createRecipe(input: RecipeCreate): Promise<Recipe | null> {
    const result = await wrapAsync(isLoading, error, async () => {
      const created = await repo.createRecipe(input);
      recipes.value = [...recipes.value, created];
      return created;
    });
    return result ?? null;
  }

  async function updateRecipe(id: string, input: RecipeUpdate): Promise<Recipe | null> {
    const result = await wrapAsync(isLoading, error, async () => {
      const updated = await repo.updateRecipe(id, input);
      if (updated) recipes.value = recipes.value.map((r) => (r.id === id ? updated : r));
      return updated;
    });
    return result ?? null;
  }

  /**
   * Delete a recipe. Callers are responsible for confirming with the user
   * first if `cookStatsForRecipe(id).count > 0` — the cascade is destructive.
   */
  async function deleteRecipeCascade(id: string): Promise<void> {
    await wrapAsync(isLoading, error, async () => {
      await repo.deleteRecipeCascade(id);
      recipes.value = recipes.value.filter((r) => r.id !== id);
      cookLogs.value = cookLogs.value.filter((c) => c.recipeId !== id);
    });
  }

  async function createCookLog(input: CookLogCreate): Promise<CookLogEntry | null> {
    const result = await wrapAsync(isLoading, error, async () => {
      const created = await repo.createCookLog(input);
      cookLogs.value = [...cookLogs.value, created];
      return created;
    });
    return result ?? null;
  }

  async function updateCookLog(id: string, input: CookLogUpdate): Promise<CookLogEntry | null> {
    const result = await wrapAsync(isLoading, error, async () => {
      const updated = await repo.updateCookLog(id, input);
      if (updated) cookLogs.value = cookLogs.value.map((c) => (c.id === id ? updated : c));
      return updated;
    });
    return result ?? null;
  }

  async function deleteCookLog(id: string): Promise<void> {
    await wrapAsync(isLoading, error, async () => {
      await repo.deleteCookLog(id);
      cookLogs.value = cookLogs.value.filter((c) => c.id !== id);
    });
  }

  return {
    recipes,
    cookLogs,
    isLoading,
    error,
    cookLogsByRecipe,
    cookStatsForRecipe,
    loadRecipes,
    createRecipe,
    updateRecipe,
    deleteRecipeCascade,
    createCookLog,
    updateCookLog,
    deleteCookLog,
  };
});
