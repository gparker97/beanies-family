import type { MealPlanEntry, Recipe } from '@/types/models';
import type { UIStringKey } from '@/services/translation/uiStrings';

/**
 * The single source of truth for a planned meal's display name — a recipe's name
 * (or "Recipe removed" when its recipe was deleted), or the non-recipe type label
 * with an optional ` · label`. Shared by the board card, the nook card, and the
 * share text so all three render a meal identically.
 */
export function mealDisplayName(
  meal: MealPlanEntry,
  recipes: Recipe[],
  t: (key: UIStringKey) => string
): string {
  if (meal.kind === 'recipe') {
    return recipes.find((r) => r.id === meal.recipeId)?.name ?? t('mealPlanner.card.recipeRemoved');
  }
  const label = t(`mealPlanner.kind.${meal.kind}` as 'mealPlanner.kind.other');
  return meal.label ? `${label} · ${meal.label}` : label;
}
