/**
 * THE three recipe fields a model is allowed to infer — named once (#93).
 *
 * `prepTime`, `cookTime` and `servings` are the fields that came back empty far more often
 * than they should have, and not because they were missing from the prompt. The extraction
 * rule forbids emitting a time the source does not state, and the `inferred` escape hatch
 * that lets the model supply an uncertain value AND declare it existed only for ingredients
 * and steps. For these three the model could only copy verbatim or return `""`, so it
 * returned `""`.
 *
 * The list now appears in the prompt's `inferredTimes` description, in the mapper's
 * validation filter, and in the form's hints. This file is what stops those becoming three
 * copies that quietly disagree — a sync test asserts the shipped prompt names exactly these.
 */

export type RecipeTimeField = 'prepTime' | 'cookTime' | 'servings';

export const RECIPE_TIME_FIELDS: readonly RecipeTimeField[] = [
  'prepTime',
  'cookTime',
  'servings',
] as const;

export function isRecipeTimeField(value: unknown): value is RecipeTimeField {
  return typeof value === 'string' && (RECIPE_TIME_FIELDS as readonly string[]).includes(value);
}
