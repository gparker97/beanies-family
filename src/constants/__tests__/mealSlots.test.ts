/**
 * Pins the consolidated slot constants to the literals every one of the fifteen call sites
 * carried BEFORE the consolidation.
 *
 * The consolidation is behaviour-identical by construction, and that is exactly the problem:
 * there is nothing to notice if a later "tidy" changes 🍽️ to 🍝 or moves snacks off the end.
 * Four surfaces would silently restyle — the week board, the wall, the nook, and the PRINTED
 * meal plan — with no error and no failing test. These assertions are that error.
 *
 * ⚠️ If you are here because this test failed: the change is not automatically wrong, but it
 * IS cross-surface. Check the planner, the wall, the nook and the PDF export before updating
 * the expectations.
 */
import { describe, it, expect } from 'vitest';
import {
  MEAL_SLOTS,
  SLOT_EMOJI,
  SLOT_INDEX,
  SLOT_LABEL_KEYS,
  isMealSlot,
  sortSlots,
} from '../mealSlots';
import { UI_STRINGS } from '@/services/translation/uiStrings';

describe('meal slot constants', () => {
  it('keeps the canonical order, snacks last', () => {
    expect(MEAL_SLOTS).toEqual(['breakfast', 'lunch', 'dinner', 'snack']);
  });

  it('keeps the emoji every surface shipped with', () => {
    expect(SLOT_EMOJI).toEqual({
      breakfast: '🍳',
      lunch: '🥪',
      dinner: '🍽️',
      snack: '🍎',
    });
  });

  it('derives SLOT_INDEX from MEAL_SLOTS so the two shapes cannot disagree', () => {
    expect(SLOT_INDEX).toEqual({ breakfast: 0, lunch: 1, dinner: 2, snack: 3 });
    MEAL_SLOTS.forEach((slot, i) => expect(SLOT_INDEX[slot]).toBe(i));
  });

  it('points at label keys that actually exist', () => {
    expect(SLOT_LABEL_KEYS).toEqual({
      breakfast: 'mealPlanner.slot.breakfast',
      lunch: 'mealPlanner.slot.lunch',
      dinner: 'mealPlanner.slot.dinner',
      snack: 'mealPlanner.slot.snack',
    });
    for (const key of Object.values(SLOT_LABEL_KEYS)) {
      expect(UI_STRINGS[key]).toBeDefined();
    }
  });

  it('covers every slot in every map', () => {
    for (const slot of MEAL_SLOTS) {
      expect(SLOT_EMOJI[slot]).toBeTruthy();
      expect(SLOT_LABEL_KEYS[slot]).toBeTruthy();
    }
    expect(Object.keys(SLOT_EMOJI)).toHaveLength(MEAL_SLOTS.length);
    expect(Object.keys(SLOT_LABEL_KEYS)).toHaveLength(MEAL_SLOTS.length);
  });

  describe('isMealSlot', () => {
    it.each(['breakfast', 'lunch', 'dinner', 'snack'])('accepts %s', (v) => {
      expect(isMealSlot(v)).toBe(true);
    });
    it.each([['brunch'], ['Breakfast'], [''], [null], [undefined], [3], [{}], [['lunch']]])(
      'rejects %p',
      (v) => {
        expect(isMealSlot(v)).toBe(false);
      }
    );
  });

  describe('sortSlots', () => {
    it('returns canonical order regardless of input order', () => {
      expect(sortSlots(['snack', 'breakfast', 'dinner'])).toEqual(['breakfast', 'dinner', 'snack']);
    });
    it('de-duplicates', () => {
      expect(sortSlots(['lunch', 'lunch'])).toEqual(['lunch']);
    });
    it('is idempotent — the property diffPayload relies on', () => {
      const once = sortSlots(['dinner', 'lunch']);
      expect(sortSlots(once)).toEqual(once);
    });
    it('handles empty', () => {
      expect(sortSlots([])).toEqual([]);
    });
  });
});
