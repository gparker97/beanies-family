import { computed, type Ref } from 'vue';
import { byRecipeName } from '@/utils/recipeOrdering';
import type { Recipe } from '@/types/models';

/**
 * Search + alpha-sort a recipe list by a query (name or subtitle). Shared by the
 * meal-planner recipe rail and the picker sheet so the two surfaces filter
 * identically. The cookbook page has no search of its own to reuse, so this is
 * the single home for recipe filtering going forward.
 */
export function useRecipeSearch(recipes: Ref<Recipe[]>, query: Ref<string>) {
  const results = computed<Recipe[]>(() => {
    const sorted = [...recipes.value].sort(byRecipeName);
    const q = query.value.trim().toLowerCase();
    if (!q) return sorted;
    return sorted.filter(
      (r) => r.name.toLowerCase().includes(q) || (r.subtitle?.toLowerCase().includes(q) ?? false)
    );
  });

  return { results };
}
