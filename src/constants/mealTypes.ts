import type { MealPlanEntry } from '@/types/models';

/** The non-recipe meal kinds — everything a planned meal can be that is not a dish. */
export type MealTypeKind = Exclude<MealPlanEntry['kind'], 'recipe'>;

/**
 * How a non-recipe meal looks, in ONE place.
 *
 * The emoji lived only in `RecipeRail` and the tint only in `MealCard`, which is why a
 * meal dragged off the rail arrived on the board having lost its icon: the board had no
 * way to know what 🍜 belonged to `eat_out`. Two half-definitions of the same thing.
 *
 * `tint` colours the medallion, never the card. Eat-out, leftovers and skip now wear the
 * same white card chrome as a recipe so a row reads as one kind of object, and the
 * medallion carries what it is — the same division the calendar settled on, where the card
 * says whose and the emoji says what.
 */
export const MEAL_TYPE_STYLE: Record<MealTypeKind, { emoji: string; tint: string }> = {
  eat_out: { emoji: '🍜', tint: 'bg-[var(--tint-silk-20)]' },
  leftovers: { emoji: '♻️', tint: 'bg-[var(--tint-slate-10)]' },
  // A skipped meal is the one that means "nothing here", so it stays the quietest.
  skip: { emoji: '⊘', tint: 'bg-[var(--tint-slate-5)]' },
  // ✎ — the glyph the rail always used, kept deliberately. 🍽️ is `SLOT_EMOJI.dinner` and
  // the tint is `MealThumb`'s default, so an `other` meal in the dinner row rendered a
  // medallion byte-identical to a recipe with no photo.
  other: { emoji: '✎', tint: 'bg-[var(--tint-orange-8)]' },
};

/** The medallion emoji for any meal kind; recipes fall back to their slot's glyph. */
export function mealTypeEmoji(kind: MealPlanEntry['kind']): string | null {
  return kind === 'recipe' ? null : (MEAL_TYPE_STYLE[kind]?.emoji ?? MEAL_TYPE_STYLE.other.emoji);
}
