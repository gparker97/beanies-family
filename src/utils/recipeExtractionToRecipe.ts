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
import type { MealSlot, Recipe, RecipeCourse } from '@/types/models';
import type { RecipeExtractionResult, RecipeFieldConfidence } from '@/services/ai/types';
import type { JsonLdRecipe } from '@/services/ai/recipeFetchService';
import { isRecipeCourse } from '@/constants/recipeCourses';
import { isMealSlot, sortSlots } from '@/constants/mealSlots';
import type { DishImagePrefill } from '@/types/magicPayload';

/** What the form is opened with. One object, because it always travels as a unit. */
export interface RecipePrefill {
  /** Field values to seed the form with. Nothing is persisted until the user saves. */
  fields: Partial<Pick<Recipe, 'name' | 'subtitle' | 'prepTime' | 'cookTime' | 'servings'>> & {
    ingredients: string[];
    steps: string[];
    notes?: string;
    sourceUrl?: string;
    /** Course and meal slots the model inferred (#87), already validated. */
    course?: RecipeCourse;
    mealSlots?: MealSlot[];
  };
  /** Ingredient texts the model filled in itself — shown for checking, never persisted. */
  inferredIngredients: string[];
  /** Step texts the model filled in itself. */
  inferredSteps: string[];
  /**
   * The candidate dish photos and the fact that a source page existed, or null when there was
   * no page at all (a document, a photo, or a hand-typed recipe).
   *
   * ⚠️ NULLABLE OBJECT, NOT A BARE ARRAY, and that distinction is the whole point (#86). An
   * empty array means "we read a page and it declared no images" — which must be logged as
   * `image_none / no_candidates`, the single event this issue exists to add. `null` means
   * "there was no page", which must log nothing at all or the hit-rate denominator is
   * meaningless. A bare array cannot tell those two apart.
   */
  dishImage: DishImagePrefill | null;
  /**
   * Which taxonomy axes the model answered with something we could not use (#87).
   *
   * REQUIRED, not optional, so both construction sites must state their answer rather than
   * inherit `undefined`. It is the difference between "the model declined" and "the model
   * drifted to 'Main Course' / 'brunch'" — two failure modes that look identical in the UI
   * (the field is blank either way) and would otherwise be indistinguishable in CloudWatch.
   */
  taxonomyRejected: ('course' | 'meal')[];
  confidence: RecipeFieldConfidence;
}

/**
 * Map an extraction result to a prefill, or `null` when the source was not a recipe or
 * carried nothing worth showing. Returning null (rather than an empty prefill) keeps the
 * "nothing is created, nothing is invented" guarantee at the type level.
 */
/**
 * Validate the model's taxonomy answers, dropping anything unrecognised.
 *
 * Modelled directly on `extractionToActivity.validatedModelCategory`: validation belongs in the
 * MAPPER, not in the pure prompt parser, which deliberately knows nothing about enums.
 *
 * ⚠️ Never COERCE a near-miss. A model can return "Main Course", "brunch", "pudding" or an
 * object; mapping "Main Course" → `main` looks helpful right up to the day it maps "Main
 * Course Salad" → `main` and files a starter under mains. Blank is honest; wrong is not.
 */
export function validatedTaxonomy(result: RecipeExtractionResult): {
  course?: RecipeCourse;
  mealSlots?: MealSlot[];
  rejected: ('course' | 'meal')[];
} {
  const rejected: ('course' | 'meal')[] = [];

  let course: RecipeCourse | undefined;
  if (result.course) {
    if (isRecipeCourse(result.course)) {
      course = result.course;
    } else {
      rejected.push('course');
      console.warn(
        '[recipe-extract] model returned an unknown course; leaving it blank. ' +
          'Add it to RECIPE_COURSES if it is a course we want, or ignore this.',
        { got: result.course }
      );
    }
  }

  // De-duplicated and canonically ordered here, so the form's diffPayload sides agree.
  const valid = result.mealSlots.filter(isMealSlot);
  const mealSlots = valid.length > 0 ? sortSlots(valid) : undefined;
  if (result.mealSlots.length > valid.length) {
    rejected.push('meal');
    console.warn(
      '[recipe-extract] model returned unknown meal slot(s); dropping them. ' +
        'The four slots are breakfast, lunch, dinner, snack — there is deliberately no brunch.',
      { got: result.mealSlots }
    );
  }

  return { ...(course ? { course } : {}), ...(mealSlots ? { mealSlots } : {}), rejected };
}

export function recipeExtractionToPrefill(result: RecipeExtractionResult): RecipePrefill | null {
  if (!result.isRecipe) return null;

  const ingredients = result.ingredients.map((l) => l.text);
  const steps = result.steps.map((l) => l.text);
  // The test is SOMETHING TO COOK, not a name.
  //
  // The `&&` this replaced required the result to be entirely empty, so a name-only
  // extraction — common on roundup and category pages — opened a form containing nothing but
  // a dish title, with no "not a recipe" toast, logged as a successful capture. That made the
  // failure class unmeasurable.
  //
  // But requiring a NAME as well (as the Lambda's `normalizeRecipeNode` does) over-corrects
  // here: that guard exists to reject JSON-LD stub nodes, where a missing name signals a
  // false positive. On this path the model has already said isRecipe and handed back real
  // ingredients — throwing those away because it could not name the dish loses genuine work,
  // and the form requires a name before saving anyway, so the user simply types one.
  if (ingredients.length === 0 && steps.length === 0) return null;

  const taxonomy = validatedTaxonomy(result);

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
      ...(taxonomy.course ? { course: taxonomy.course } : {}),
      ...(taxonomy.mealSlots ? { mealSlots: taxonomy.mealSlots } : {}),
    },
    taxonomyRejected: taxonomy.rejected,
    inferredIngredients: result.ingredients.filter((l) => l.inferred).map((l) => l.text),
    inferredSteps: result.steps.filter((l) => l.inferred).map((l) => l.text),
    // NO IMAGE CONCERN ON THIS PATH ANY MORE (#86). The model never had a real URL to give:
    // `htmlToText` strips every tag before it sees the page, so anything it returned here was
    // necessarily invented — which is precisely why the old same-registrable-domain screen
    // existed. Candidates now come from the server's reading of the page's own markup, and
    // the caller attaches them; the model's `imageUrl` is gone from the prompt entirely.
    dishImage: null,
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
    // Course and meal are deliberately left blank on this rung. schema.org's `recipeCategory`
    // is free text ("Dessert", "Main Course", "Weeknight"), and mapping it is a guessing
    // exercise — on the one path whose whole point is that nothing is invented. Nothing was
    // offered, so nothing was rejected.
    taxonomyRejected: [],
    inferredSteps: [],
    // The JSON-LD `image` now arrives as candidate #1 from the server's ladder rather than
    // being re-derived here, so this mapper carries no image concern on either path.
    dishImage: null,
    // Structured data is exact, so confidence is 1 across the board — not a guess we are
    // dressing up, but the honest reading of "we read this from the publisher's own markup".
    confidence: { name: 1, ingredients: 1, steps: 1 },
  };
}
