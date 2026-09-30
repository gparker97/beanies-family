/**
 * Recipes → shopping-list checklist lines (#116). Pure: no store, no i18n, no clock.
 *
 * Shared by all three entry points (the recipe page, the edit-meal drawer and the week's
 * shopping list), so "which lines, how many batches" has exactly one answer.
 *
 * Ingredients are listed AS WRITTEN: nothing here parses, multiplies or rewrites an amount.
 * A recipe cooked N times in the week carries a Cook ×N count, and each of its lines ends
 * in ` (×N)` (`withBatchSuffix`) so the flat list still says how many lots to buy. Merging
 * duplicates across recipes is `shoppingMerge.ts`'s job; this file builds the sections.
 */
import { generateUUID } from './id';
import { parseDraftItems, splitRecipeIngredients } from './listSeed';
import { servingsOf } from './recipeServings';
import type { MealPlanEntry, MealSlot, Recipe } from '@/types/models';

/**
 * One editable row of an ingredient checklist. FLAT: a merged line refers to its parts by
 * id (`partIds`) and each part points back (`mergedInto`), so nothing nests and a Split
 * is two field changes.
 */
export interface ChecklistLine {
  /** Local, for list keys and merge bookkeeping only. Never written anywhere. */
  id: string;
  /**
   * The text the line was GENERATED from (the recipe's ingredient, or a merged line's
   * built text). Absent on a line the user added. A hand edit is
   * `text !== withBatchSuffix(source, batches)` (`isUneditedLine`).
   */
  source?: string;
  /** What the row shows and what gets written — the user may edit it. */
  text: string;
  checked: boolean;
  /** The recipe a generated line came from (absent on added and merged lines). */
  recipeId?: string;
  /** Batches this line's text was generated for (its ` (×N)` suffix). 1 = no suffix. */
  batches: number;
  /** Set on a part while it is merged: the id of the merged line standing in for it. */
  mergedInto?: string;
  /** Set on a merged line: identical text (`exact`) or grouped by magic beans (`ai`). */
  merged?: 'exact' | 'ai';
  /** A merged line's parts, in section order. */
  partIds?: string[];
  /** A merged line's source recipes, distinct, in section order. */
  recipeIds?: string[];
  /** Came back from a Split: never offered for merging again this open. */
  split?: true;
}

export interface ShoppingLines {
  lines: ChecklistLine[];
  /** Headings dropped from the recipe. SHOWN to the user, never silent (see `listSeed`). */
  headingsSkipped: number;
}

export interface ShoppingSectionMeal {
  date: string;
  slot: MealSlot;
  /** People eating (members + guests; nobody picked = every human, see `eatingCount`). */
  eating: number;
  /** Nobody was picked, so `eating` is the whole family (+ guests). */
  everyone: boolean;
  batches: number;
}

export interface ShoppingSection {
  recipeId: string;
  recipeName: string;
  /** The recipe's people count via `servingsOf`, when it has one. */
  servings?: number;
  /** In plan order. */
  meals: ShoppingSectionMeal[];
  /** Cook ×N: the sum of the meals' batches. */
  batches: number;
  lines: ChecklistLine[];
  headingsSkipped: number;
}

/**
 * Can this recipe produce at least one list item? Gated on the SPLIT's title count, not
 * `ingredients.length`: a recipe whose every line is "For the sauce:" would otherwise
 * offer an action that yields zero items. `?? []` because Automerge documents are not
 * schema-validated and this runs on every render.
 */
export function hasShoppableIngredients(
  recipe: Pick<Recipe, 'ingredients'> | null | undefined
): boolean {
  return splitRecipeIngredients(recipe?.ingredients ?? []).titles.length > 0;
}

// ── Who's eating: the "everyone" rule ────────────────────────────────────────────────
// `eaterMemberIds` absent (or naming nobody who is still a human member) has always meant
// "everyone". These three helpers apply that ONE filter, so the week drawer and the edit
// drawer can never disagree about, say, a removed member.

/** Stored ids that are still current humans. */
function currentEaters(stored: readonly string[] | undefined, humanIds: readonly string[]) {
  const humans = new Set(humanIds);
  return (stored ?? []).filter((id) => humans.has(id));
}

/** The ids the edit drawer shows picked: the stored ones, or EVERY human when none remain. */
export function seedEaterIds(
  stored: readonly string[] | undefined,
  humanIds: readonly string[]
): string[] {
  const current = currentEaters(stored, humanIds);
  return current.length > 0 ? current : [...humanIds];
}

/**
 * What the edit drawer saves: `undefined` (everyone) when nobody or every human is
 * picked, else the picked subset. So "Clear, then Save" also saves everyone.
 */
export function eaterIdsToStore(
  picked: readonly string[],
  humanIds: readonly string[]
): string[] | undefined {
  if (picked.length === 0) return undefined;
  if (humanIds.every((id) => picked.includes(id))) return undefined;
  return [...picked];
}

/**
 * People eating at a meal: the picked members still in the family (all humans when none)
 * + guests. Takes the two fields, not a meal, so the edit drawer can pass its live
 * (unsaved) picker state.
 */
export function eatingCount(
  who: { eaterMemberIds?: readonly string[]; guestNames?: readonly string[] },
  humanIds: readonly string[]
): { eating: number; everyone: boolean } {
  const current = currentEaters(who.eaterMemberIds, humanIds);
  const everyone = current.length === 0;
  const members = everyone ? humanIds.length : current.length;
  return { eating: members + (who.guestNames?.length ?? 0), everyone };
}

// ── Batches and the suffix ───────────────────────────────────────────────────────────

/** Whole batches for one meal: `ceil(eating / servings)` when both are ≥ 1, else 1. */
export function batchesFor(eating?: number, servings?: number): number {
  if (eating === undefined || servings === undefined) return 1;
  if (!(eating >= 1) || !(servings >= 1)) return 1;
  return Math.ceil(eating / servings);
}

/**
 * THE suffix rule: `8 taco shells (×3)`; nothing at 1. `(×N)` is notation, not copy, so
 * it is not translated and this stays pure. The suffix is part of the editable text, so
 * it travels into the flat list.
 */
export function withBatchSuffix(text: string, n: number): string {
  return n > 1 ? `${text} (×${n})` : text;
}

/** A generated line the user has not edited (its text is still exactly as generated). */
export function isUneditedLine(line: ChecklistLine): boolean {
  return line.source !== undefined && line.text === withBatchSuffix(line.source, line.batches);
}

/** A recipe's ingredients as checklist lines for `batches`, every line ticked. */
export function buildShoppingLines(
  recipe: Pick<Recipe, 'ingredients'> & Partial<Pick<Recipe, 'id'>>,
  batches: number
): ShoppingLines {
  const { titles, headingsSkipped } = splitRecipeIngredients(recipe.ingredients ?? []);
  const lines = titles.map((source): ChecklistLine => ({
    id: generateUUID(),
    source,
    text: withBatchSuffix(source, batches),
    checked: true,
    recipeId: recipe.id,
    batches,
  }));
  return { lines, headingsSkipped };
}

/**
 * Re-batch a checklist (the meal drawer, when who's eating changes), keeping everything
 * the user did: only unedited generated lines get the new suffix; hand-edited and
 * user-added lines are returned unchanged, and every `checked` is kept.
 */
export function rebatchLines(lines: readonly ChecklistLine[], n: number): ChecklistLine[] {
  return lines.map((line) =>
    isUneditedLine(line) && line.batches !== n
      ? { ...line, batches: n, text: withBatchSuffix(line.source!, n) }
      : line
  );
}

/**
 * The ticked lines → item titles. Parts standing behind a merged line (`mergedInto`) are
 * skipped: the merged line is written instead. `parseDraftItems` drops lines emptied by
 * editing and splits pasted multi-line text into several items; no second cleaner.
 */
export function linesToTitles(lines: readonly ChecklistLine[]): string[] {
  return lines
    .filter((l) => l.checked && l.mergedInto === undefined)
    .flatMap((l) => parseDraftItems(l.text));
}

type RecipeLookup = ReadonlyMap<string, Recipe> | Readonly<Record<string, Recipe>>;

function toRecipeMap(recipesById: RecipeLookup): ReadonlyMap<string, Recipe> {
  return recipesById instanceof Map ? recipesById : new Map(Object.entries(recipesById));
}

/**
 * The recipe a meal puts on the week's list, or undefined: non-recipe meals, meals whose
 * recipe was deleted and recipes with nothing shoppable are skipped. The ONE rule both
 * `buildWeekShoppingSections` and `countWeekShoppingRecipes` apply.
 */
function shoppableRecipeOf(
  meal: MealPlanEntry,
  recipes: ReadonlyMap<string, Recipe>
): Recipe | undefined {
  if (meal.kind !== 'recipe' || !meal.recipeId) return undefined;
  const recipe = recipes.get(meal.recipeId);
  return recipe && hasShoppableIngredients(recipe) ? recipe : undefined;
}

/**
 * How many sections `buildWeekShoppingSections` would return, without building any
 * lines: the distinct shoppable recipes among the week's meals. Cheap enough for a badge
 * that re-computes on every meal or recipe change.
 */
export function countWeekShoppingRecipes(
  meals: readonly MealPlanEntry[],
  recipesById: RecipeLookup
): number {
  const recipes = toRecipeMap(recipesById);
  const ids = new Set<string>();
  for (const meal of meals) {
    const recipe = shoppableRecipeOf(meal, recipes);
    if (recipe) ids.add(recipe.id);
  }
  return ids.size;
}

/**
 * A week's meals → one section per distinct recipe, ordered by the first meal it is
 * served at (`meals` arrive sorted by date, slot, position from `mealsForWeek`).
 *
 * Each meal needs `batchesFor(eating, servings)` whole batches; a section's Cook ×N is
 * the SUM ("per meal, then add": Tue 5 + Fri 3 eating, serves 4 → 2 + 1 = ×3). Nobody
 * picked counts as everyone (`eatingCount`).
 */
export function buildWeekShoppingSections(
  meals: readonly MealPlanEntry[],
  recipesById: RecipeLookup,
  humanIds: readonly string[]
): ShoppingSection[] {
  const recipes = toRecipeMap(recipesById);
  const byRecipe = new Map<string, { recipe: Recipe; meals: ShoppingSectionMeal[] }>();
  for (const meal of meals) {
    const recipe = shoppableRecipeOf(meal, recipes);
    if (!recipe) continue;
    const { eating, everyone } = eatingCount(meal, humanIds);
    const entry = byRecipe.get(recipe.id) ?? { recipe, meals: [] };
    entry.meals.push({
      date: meal.date,
      slot: meal.slot,
      eating,
      everyone,
      batches: batchesFor(eating, servingsOf(recipe)),
    });
    byRecipe.set(recipe.id, entry);
  }

  return [...byRecipe.values()].map(({ recipe, meals: sectionMeals }) => {
    const batches = sectionMeals.reduce((sum, m) => sum + m.batches, 0);
    const { lines, headingsSkipped } = buildShoppingLines(recipe, batches);
    return {
      recipeId: recipe.id,
      recipeName: recipe.name,
      servings: servingsOf(recipe),
      meals: sectionMeals,
      batches,
      lines,
      headingsSkipped,
    };
  });
}
