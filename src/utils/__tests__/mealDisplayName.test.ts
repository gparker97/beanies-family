import { describe, expect, it } from 'vitest';
import { mealDisplayName } from '@/utils/mealDisplayName';
import type { MealPlanEntry } from '@/types/models';

const t = (key: string) =>
  ({ 'mealPlanner.kind.other': 'Other', 'mealPlanner.kind.eat_out': 'Eat out' })[key] ?? key;
const meal = (over: Partial<MealPlanEntry>) => ({ kind: 'other', ...over }) as MealPlanEntry;

describe('mealDisplayName', () => {
  it('shows a named "other" meal by its name alone', () => {
    expect(mealDisplayName(meal({ label: 'Fish tacos' }), [], t)).toBe('Fish tacos');
  });

  it('keeps the kind for an unnamed "other" meal and for the other kinds', () => {
    expect(mealDisplayName(meal({}), [], t)).toBe('Other');
    expect(mealDisplayName(meal({ kind: 'eat_out', label: 'Nandos' }), [], t)).toBe(
      'Eat out · Nandos'
    );
  });
});
