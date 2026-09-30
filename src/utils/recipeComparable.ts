/**
 * The saved recipe as a comparable payload — ONE definition (#93).
 *
 * Hoisted unchanged out of `RecipeFormModal.baselinePayload`, which is now one of two
 * callers: the edit form diffs the user's typing against it, and the re-fetch diffs the
 * site's new reading against it. The file it came from carries "🚨 SITES 2 AND 5 OF 5" and
 * "🚨 THESE MUST BE SEEDED AND SAVED IN ALL FOUR PLACES" warnings for a reason — a second
 * copy of "the recipe as a payload" is exactly the shape of the bug those warnings describe.
 *
 * Built from the STORED recipe, never from form refs, so it reflects what is saved rather
 * than what is on screen.
 */
import { sortSlots } from '@/constants/mealSlots';
import { normalizeServings } from '@/utils/recipeServings';
import type { Recipe } from '@/types/models';

export function recipeComparable(r: Recipe) {
  return {
    name: r.name,
    subtitle: r.subtitle,
    prepTime: r.prepTime,
    cookTime: r.cookTime,
    // ⚠️ NORMALISED, like `mealSlots` below, and for the same reason (#116). The form sends
    // the stepper's digit string and capture prefill is normalised too, so the stored side
    // must be compared the same way: "Serves 4" vs "4" is not a change, and an old "12
    // muffins" recipe (no people count, the stepper is blank) diffs as unchanged, so an
    // unrelated edit never rewrites or clears its text.
    servings: normalizeServings(r.servings),
    sourceUrl: r.sourceUrl,
    ingredients: r.ingredients ?? [],
    steps: r.steps ?? [],
    notes: r.notes,
    // ⚠️ `mealSlots` is canonicalised on BOTH sides because `diffPayload`'s array equality is
    // by INDEX — ['dinner','lunch'] and ['lunch','dinner'] would otherwise read as a change
    // and make a no-op save write.
    course: r.course,
    mealSlots: sortSlots(r.mealSlots ?? []),
    tags: Array.isArray(r.tags) ? r.tags : [],
  };
}

export type RecipeComparable = ReturnType<typeof recipeComparable>;
