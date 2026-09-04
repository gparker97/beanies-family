/**
 * THE meal slot definition — order, emoji, and label keys, each in exactly one place.
 *
 * Before this file the same four slots were spelled out fifteen times: five order copies
 * (two of them different SHAPES — a `Record<MealSlot, number>` for comparators, an array for
 * rendering), five emoji copies, and five inline ``t(`mealPlanner.slot.${slot}`)`` template
 * literals. All fifteen agreed, which is exactly why the duplication was invisible: nothing
 * was broken, so nothing pointed at it. The failure mode only arrives the day someone
 * "tidies" one emoji and silently restyles the planner, the wall, the nook AND the printed
 * meal plan — four surfaces, no test, no error.
 *
 * This is the bug class `constants/mealTypes.ts` was written to prevent; its header documents
 * the same reasoning. Add a fifth slot here and every consumer picks it up.
 *
 * ⚠️ What deliberately does NOT live here:
 * - `MealWeekBoard`'s `band`/`ink` — per-ROW hues with their own long rationale, meaningful
 *   only to the week board's table layout.
 * - `MealPlanExportBody`'s `SLOT_BAND` — print alphas are deliberately stronger than screen.
 * - The WALL's slot labels. `useWallPeripherals` emits `wall.meals.slot.*`, and
 *   `wall.meals.slot.snack` is "Snack" where `mealPlanner.slot.snack` is "Snacks". The wall
 *   takes the emoji and the order from here; its labels stay its own.
 */
import type { MealSlot } from '@/types/models';
import type { UIStringKey } from '@/services/translation/uiStrings';

/** Canonical render order — snacks last. Every ordered list of slots derives from this one. */
export const MEAL_SLOTS: readonly MealSlot[] = ['breakfast', 'lunch', 'dinner', 'snack'] as const;

/** Shared across the planner, the wall, the nook and the printed plan. */
export const SLOT_EMOJI: Record<MealSlot, string> = {
  breakfast: '🍳',
  lunch: '🥪',
  dinner: '🍽️',
  snack: '🍎',
};

/**
 * Comparator lookup, DERIVED from `MEAL_SLOTS` so the two shapes can never disagree.
 *
 * Sorting sites need O(1) rank rather than `indexOf`; giving them their own literal is how
 * the two order copies drifted apart in shape in the first place.
 */
export const SLOT_INDEX: Record<MealSlot, number> = Object.fromEntries(
  MEAL_SLOTS.map((slot, i) => [slot, i])
) as Record<MealSlot, number>;

/**
 * The planner/nook label keys. Written out rather than built as a template literal so
 * `UIStringKey` actually type-checks them — a `${slot}` interpolation is just `string` to
 * TypeScript, which is how a renamed string key would reach production as a raw key on screen.
 */
export const SLOT_LABEL_KEYS: Record<MealSlot, UIStringKey> = {
  breakfast: 'mealPlanner.slot.breakfast',
  lunch: 'mealPlanner.slot.lunch',
  dinner: 'mealPlanner.slot.dinner',
  snack: 'mealPlanner.slot.snack',
};

/** Narrows an unknown (a stored value, a model response) to a real slot. */
export function isMealSlot(value: unknown): value is MealSlot {
  return typeof value === 'string' && (MEAL_SLOTS as readonly string[]).includes(value);
}

/**
 * Slots in canonical order, de-duplicated.
 *
 * ⚠️ Load-bearing for the recipe form's save path: `diffPayload`'s array equality is BY INDEX,
 * so `['dinner','lunch']` and `['lunch','dinner']` are different payloads and a no-op save
 * would write. Both `baselinePayload` and `buildPayload` canonicalise through THIS function so
 * they cannot disagree.
 */
export function sortSlots(slots: readonly MealSlot[] | undefined): MealSlot[] {
  // Guarded, not assumed: a corrupt stored value reaches this from the recipe form's seed and
  // baseline paths, and a bare string satisfies `.includes` while meaning something else.
  if (!Array.isArray(slots)) return [];
  return MEAL_SLOTS.filter((slot) => slots.includes(slot));
}
