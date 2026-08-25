/**
 * Pure mapper: an AI recipe extraction → the prefill `RecipeFormModal` opens with (#72).
 *
 * Pure on purpose — no Vue, no stores, no network — so the mapping rules are unit-testable
 * without a component harness, mirroring `travelExtractionToSegments`.
 *
 * DESIGN NOTE — inferred values travel as TEXT LISTS, not indices. `RecipeFormModal` edits
 * ingredients and steps as newline-separated textareas, so an index is stale the moment the
 * user inserts or reorders a line, and would then point the "check this" hint at the wrong
 * row. Texts stay meaningful under editing.
 */
import { safeHttpsUrl } from '@/utils/url';
import type { Recipe } from '@/types/models';
import type { RecipeExtractionResult, RecipeFieldConfidence } from '@/services/ai/types';
import type { JsonLdRecipe } from '@/services/ai/recipeFetchService';

/** What the form is opened with. One object, because it always travels as a unit. */
export interface RecipePrefill {
  /** Field values to seed the form with. Nothing is persisted until the user saves. */
  fields: Partial<Pick<Recipe, 'name' | 'subtitle' | 'prepTime' | 'cookTime' | 'servings'>> & {
    ingredients: string[];
    steps: string[];
    notes?: string;
    sourceUrl?: string;
  };
  /** Ingredient texts the model filled in itself — shown for checking, never persisted. */
  inferredIngredients: string[];
  /** Step texts the model filled in itself. */
  inferredSteps: string[];
  /**
   * A screened, storable URL for a photo of the finished dish, or null. Already through
   * `safeHttpsUrl` — the caller may fetch it, but must still validate the BYTES.
   */
  dishImageUrl: string | null;
  confidence: RecipeFieldConfidence;
}

/**
 * Map an extraction result to a prefill, or `null` when the source was not a recipe or
 * carried nothing worth showing. Returning null (rather than an empty prefill) keeps the
 * "nothing is created, nothing is invented" guarantee at the type level.
 */
export function recipeExtractionToPrefill(result: RecipeExtractionResult): RecipePrefill | null {
  if (!result.isRecipe) return null;

  const ingredients = result.ingredients.map((l) => l.text);
  const steps = result.steps.map((l) => l.text);
  // A "recipe" with a name but neither ingredients nor steps is not usable; treat it the
  // same as isRecipe=false rather than opening an all-but-empty form.
  if (!result.name.trim() && ingredients.length === 0 && steps.length === 0) return null;

  return {
    fields: {
      name: result.name,
      ...(result.subtitle ? { subtitle: result.subtitle } : {}),
      ...(result.prepTime ? { prepTime: result.prepTime } : {}),
      ...(result.cookTime ? { cookTime: result.cookTime } : {}),
      ...(result.servings ? { servings: result.servings } : {}),
      ingredients,
      steps,
      ...(result.notes ? { notes: result.notes } : {}),
    },
    inferredIngredients: result.ingredients.filter((l) => l.inferred).map((l) => l.text),
    inferredSteps: result.steps.filter((l) => l.inferred).map((l) => l.text),
    // SECURITY: the model's imageUrl is untrusted — a hostile source can steer it. Screen
    // the scheme here so a `javascript:`/`data:` value can never reach a fetch or an
    // element. The bytes are validated separately, wherever it is actually fetched.
    dishImageUrl: safeHttpsUrl(result.imageUrl),
    confidence: result.confidence,
  };
}

/**
 * Map a site's own schema.org/Recipe data straight to a prefill.
 *
 * The model is NEVER invoked on this path, which is the entire point: quantities, steps and
 * times are PARSED from the page's structured data rather than inferred, so they cannot be
 * hallucinated. That is also why `inferredIngredients`/`inferredSteps` are empty here by
 * construction — nothing on this path was guessed, and marking it as such would be a lie.
 */
export function jsonLdToPrefill(recipe: JsonLdRecipe, sourceUrl: string): RecipePrefill {
  return {
    fields: {
      name: recipe.name,
      ...(recipe.subtitle ? { subtitle: recipe.subtitle } : {}),
      ...(recipe.prepTime ? { prepTime: recipe.prepTime } : {}),
      ...(recipe.cookTime ? { cookTime: recipe.cookTime } : {}),
      ...(recipe.servings ? { servings: recipe.servings } : {}),
      ingredients: recipe.ingredients,
      steps: recipe.steps,
      sourceUrl,
    },
    inferredIngredients: [],
    inferredSteps: [],
    dishImageUrl: safeHttpsUrl(recipe.imageUrl),
    // Structured data is exact, so confidence is 1 across the board — not a guess we are
    // dressing up, but the honest reading of "we read this from the publisher's own markup".
    confidence: { name: 1, ingredients: 1, steps: 1 },
  };
}
