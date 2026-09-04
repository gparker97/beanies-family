/**
 * Recipe list order and shelf construction (#87) — pure, Vue-free, store-free.
 *
 * Lives here rather than in `useCookbookView` because the hardest thing to get right in this
 * feature is the NEVER-VANISH invariant (every recipe appears at least once in every mode),
 * and an invariant is only worth having if it can be tested without mounting a component.
 * `useRecipeSearch` imports `byRecipeName` from here too, so alphabetical recipe order has
 * exactly one definition.
 */
import { MEAL_SLOTS, SLOT_EMOJI, SLOT_LABEL_KEYS, isMealSlot } from '@/constants/mealSlots';
import { COURSE_DEFS, isRecipeCourse } from '@/constants/recipeCourses';
import type { Recipe, RecipeCourse } from '@/types/models';
import type { UIStringKey } from '@/services/translation/uiStrings';

export const RECIPE_SORTS = ['name', 'recent', 'cooked'] as const;
export type RecipeSort = (typeof RECIPE_SORTS)[number];

export const COOKBOOK_GROUPS = ['none', 'meal', 'course'] as const;
export type CookbookGroup = (typeof COOKBOOK_GROUPS)[number];

/** THE definition of alphabetical recipe order. Requirement 9. */
export function byRecipeName(a: Recipe, b: Recipe): number {
  return a.name.localeCompare(b.name);
}

type Comparator = (a: Recipe, b: Recipe) => number;

/**
 * Build the comparator for a sort mode.
 *
 * Cook counts are passed IN — no store access, no Vue. `cookStatsForRecipe(id)` returns a
 * fresh `computed` per call, so reaching for it inside a comparator would allocate one per
 * comparison; the caller builds one Map in a single pass instead.
 *
 * ⚠️ `recent` and `cooked` tie-break on `byRecipeName`, and must. Automerge does not guarantee
 * identical map-iteration order across devices, so a comparator returning 0 for equal values —
 * every uncooked recipe, every same-day import — would leave the tied run in whatever order
 * the doc happened to yield, and two family devices would show a different grid.
 */
export function recipeComparator(sort: RecipeSort, cookCounts: Map<string, number>): Comparator {
  if (sort === 'recent') {
    return (a, b) => b.createdAt.localeCompare(a.createdAt) || byRecipeName(a, b);
  }
  if (sort === 'cooked') {
    return (a, b) =>
      (cookCounts.get(b.id) ?? 0) - (cookCounts.get(a.id) ?? 0) || byRecipeName(a, b);
  }
  return byRecipeName;
}

export interface Shelf {
  key: string;
  /** `null` for the single shelf of an ungrouped view — the component renders no heading. */
  titleKey: UIStringKey | null;
  emoji?: string;
  items: Recipe[];
}

/**
 * Group an ALREADY-SORTED list into shelves.
 *
 * Invariants, each pinned by a test:
 * - Every input recipe appears at least once, in every mode. A recipe with an UNRECOGNISED
 *   stored value — a `mealSlots` entry that is not a `MealSlot`, a `course` that is not a
 *   `RecipeCourse`, both reachable from a corrupt doc or a downgrade — lands in the trailing
 *   "not filed" bucket rather than disappearing. Losing a recipe from the page reads as data
 *   loss; showing it in the wrong bucket does not.
 * - Headings come out in declared order (`MEAL_SLOTS` / `COURSE_DEFS`), never insertion order.
 * - Empty groups are skipped; the unset bucket is appended LAST and only when non-empty.
 * - `'none'` returns exactly ONE shelf with `titleKey: null`, so the page has a single
 *   rendering path and no `v-if` fork between "flat" and "grouped".
 * - A recipe in several meal slots appears under each — deliberate, and why the invariant is
 *   "at least once" rather than "exactly once".
 *
 * Returns `titleKey`, not a resolved title: there is no `t()` in a pure module.
 */
export function buildShelves(recipes: Recipe[], groupBy: CookbookGroup): Shelf[] {
  if (groupBy === 'none') {
    return [{ key: 'all', titleKey: null, items: recipes }];
  }

  const shelves: Shelf[] = [];
  const unfiled: Recipe[] = [];

  if (groupBy === 'meal') {
    const buckets = new Map(MEAL_SLOTS.map((slot) => [slot, [] as Recipe[]]));
    for (const recipe of recipes) {
      const slots = (recipe.mealSlots ?? []).filter(isMealSlot);
      if (slots.length === 0) {
        unfiled.push(recipe);
        continue;
      }
      for (const slot of slots) buckets.get(slot)!.push(recipe);
    }
    for (const slot of MEAL_SLOTS) {
      const items = buckets.get(slot)!;
      if (items.length > 0) {
        shelves.push({
          key: slot,
          titleKey: SLOT_LABEL_KEYS[slot],
          emoji: SLOT_EMOJI[slot],
          items,
        });
      }
    }
    if (unfiled.length > 0) {
      shelves.push({ key: 'unfiled', titleKey: 'cookbook.shelf.unfiledMeal', items: unfiled });
    }
    return shelves;
  }

  const buckets = new Map<RecipeCourse, Recipe[]>(COURSE_DEFS.map((c) => [c.id, []]));
  for (const recipe of recipes) {
    if (recipe.course && isRecipeCourse(recipe.course)) buckets.get(recipe.course)!.push(recipe);
    else unfiled.push(recipe);
  }
  for (const course of COURSE_DEFS) {
    const items = buckets.get(course.id)!;
    if (items.length > 0) {
      shelves.push({ key: course.id, titleKey: course.labelKey, emoji: course.emoji, items });
    }
  }
  if (unfiled.length > 0) {
    shelves.push({ key: 'unfiled', titleKey: 'cookbook.shelf.unfiledCourse', items: unfiled });
  }
  return shelves;
}

/**
 * How many recipes carry each course, for the filter pills' counts.
 *
 * ⚠️ Called with the UNFILTERED list, always. Counting after filtering would zero every other
 * pill the moment one is selected, and the control would look broken. The order of operations
 * is fixed: count (unfiltered) → filter → sort → group.
 */
export function countByCourse(recipes: readonly Recipe[]): Record<RecipeCourse | 'unset', number> {
  const counts = Object.fromEntries(COURSE_DEFS.map((c) => [c.id, 0])) as Record<
    RecipeCourse | 'unset',
    number
  >;
  counts.unset = 0;
  for (const recipe of recipes) {
    if (recipe.course && isRecipeCourse(recipe.course)) counts[recipe.course] += 1;
    else counts.unset += 1;
  }
  return counts;
}
