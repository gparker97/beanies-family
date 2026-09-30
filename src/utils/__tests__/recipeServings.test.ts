import { describe, expect, it } from 'vitest';
import {
  formatServes,
  normalizeServings,
  parseServings,
  SERVINGS_MAX,
  servingsOf,
} from '../recipeServings';
import type { UIStringKey } from '@/services/translation/uiStrings';

describe('parseServings', () => {
  it.each<[unknown, number | undefined]>([
    // Bare counts and ranges take the first number.
    ['4', 4],
    ['4-6', 4],
    ['4–6', 4],
    ['4 to 6', 4],
    // A people keyword BEFORE the number.
    ['Serves 4', 4],
    ['Serves 4-6', 4],
    ['serves: 6', 6],
    ['feeds 6', 6],
    ['makes 4', 4],
    ['Servings: 4', 4],
    ['Servings 4', 4],
    ['Portions: 6', 6],
    ['People: 5', 5],
    ['persons 3', 3],
    ['serves 4 people', 4],
    ['Serves 4.', 4],
    ['Serves 4 (as a main)', 4],
    ['serves 1 person', 1],
    ['Feeds 6 guests', 6],
    // A keyword-before count followed by another word is ambiguous.
    ['Serves 2 adults and 2 children', undefined],
    ['Serves 4 as a main', 4],
    ['Serves 4 adults', 4],
    // Singular "serving" is nutrition, never a headcount.
    ['Serving size 1 cup', undefined],
    ['Per serving: 350 kcal', undefined],
    // Every match is tried; the first VALID one wins.
    ['Per serving: 350 kcal. Serves 4', 4],
    ['Serves 0, serves 8', 8],
    ['Serves 150. Serves 6.', 6],
    // A people keyword AFTER the number.
    ['8 servings', 8],
    ['4 people', 4],
    ['6 portions', 6],
    ['4-6 persons', 4],
    ['Serves 4 to 6 people', 4],
    // Only a count of PEOPLE counts.
    ['Makes 2 loaves (16 servings)', 16],
    ['Makes 2 loaves', undefined],
    ['12 muffins', undefined],
    ['yields: 2 cups', undefined],
    ['Makes 4.', 4],
    ['Makes 4, serves 2 adults', 2],
    // A people keyword anywhere wins over an earlier makes/yield.
    ['Makes 24 cookies, serves 12', 12],
    ['Yield: 2 loaves, 16 servings', 16],
    ['Makes 24 cookies', undefined],
    // Empty, zero, out of range, non-integers.
    ['', undefined],
    ['   ', undefined],
    ['0', undefined],
    ['100', undefined],
    [String(SERVINGS_MAX), SERVINGS_MAX],
    ['Serves 1.5', undefined],
    ['serves 12.5', undefined],
    ['1.5 servings', undefined],
    // Numbers are accepted defensively (no writer emits one today).
    [4, 4],
    [0, undefined],
    [4.5, undefined],
    [100, undefined],
    // Anything else.
    [null, undefined],
    [undefined, undefined],
    [{ n: 4 }, undefined],
  ])('%j → %j', (raw, expected) => {
    expect(parseServings(raw)).toBe(expected);
  });
});

describe('servingsOf', () => {
  it('reads the recipe servings through the parser', () => {
    expect(servingsOf({ servings: 'Serves 4-6' })).toBe(4);
    expect(servingsOf({ servings: '12 muffins' })).toBeUndefined();
    expect(servingsOf({})).toBeUndefined();
    expect(servingsOf(undefined)).toBeUndefined();
  });
});

describe('normalizeServings', () => {
  it('returns the digit string of the people count', () => {
    expect(normalizeServings('Serves 4-6')).toBe('4');
    expect(normalizeServings('8 servings')).toBe('8');
    expect(normalizeServings('4')).toBe('4');
    expect(normalizeServings(6)).toBe('6');
  });

  it('returns undefined (never "" or "0") when there is no count', () => {
    for (const raw of ['12 muffins', '', '0', null, undefined, 0]) {
      expect(normalizeServings(raw)).toBeUndefined();
    }
  });

  it('always returns a string, never a number', () => {
    expect(typeof normalizeServings(4)).toBe('string');
  });
});

describe('formatServes', () => {
  const t = (key: UIStringKey) => (key === 'recipes.servesN' ? 'Serves {n}' : key);

  it('fills the count into the translated template', () => {
    expect(formatServes(4, t)).toBe('Serves 4');
  });

  it('returns an empty string when the count is unknown', () => {
    expect(formatServes(undefined, t)).toBe('');
  });
});
