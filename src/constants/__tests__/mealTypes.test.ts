/**
 * The shared meal-type style map.
 *
 * This module exists because the emoji lived only in `RecipeRail` and the tint only in
 * `MealCard`, so a type dragged off the rail arrived on the board with no icon. These tests
 * pin the properties that were actually wrong, not the constant's contents.
 */
import { describe, it, expect } from 'vitest';
import { MEAL_TYPE_STYLE, mealTypeEmoji } from '@/constants/mealTypes';
import type { MealKind } from '@/types/models';

const NON_RECIPE: Exclude<MealKind, 'recipe'>[] = ['eat_out', 'leftovers', 'skip', 'other'];

describe('MEAL_TYPE_STYLE', () => {
  it('covers every non-recipe kind — a missing one renders a card with no icon', () => {
    for (const kind of NON_RECIPE) {
      expect(MEAL_TYPE_STYLE[kind]?.emoji, kind).toBeTruthy();
      expect(MEAL_TYPE_STYLE[kind]?.tint, kind).toBeTruthy();
    }
  });

  it('gives every kind a DISTINCT glyph', () => {
    const glyphs = NON_RECIPE.map((k) => MEAL_TYPE_STYLE[k].emoji);
    expect(new Set(glyphs).size).toBe(glyphs.length);
  });

  /**
   * `other` used to be 🍽️, which is also `SLOT_EMOJI.dinner`, on `MealThumb`'s default
   * tint — so in the dinner row an `other` meal and a recipe with no photo rendered an
   * identical medallion on identical chrome.
   */
  it('does not reuse the dinner slot glyph for `other`', () => {
    expect(MEAL_TYPE_STYLE.other.emoji).not.toBe('🍽️');
  });

  it('returns null for a recipe, so the caller falls back to the slot glyph', () => {
    expect(mealTypeEmoji('recipe')).toBeNull();
  });

  /**
   * Cross-version CRDT merge is supported, so an older client can meet a kind it has never
   * heard of. It must render something rather than throw inside a computed.
   */
  it('degrades to `other` for an unknown kind rather than throwing', () => {
    expect(() => mealTypeEmoji('brunch' as MealKind)).not.toThrow();
    expect(mealTypeEmoji('brunch' as MealKind)).toBe(MEAL_TYPE_STYLE.other.emoji);
  });
});
