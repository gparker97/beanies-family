import { describe, it, expect } from 'vitest';
import {
  byRecipeName,
  recipeComparator,
  buildShelves,
  countByCourse,
  COOKBOOK_GROUPS,
  type CookbookGroup,
} from '../recipeOrdering';
import type { Recipe } from '@/types/models';

function recipe(partial: Partial<Recipe> & { id: string; name: string }): Recipe {
  return {
    ingredients: [],
    steps: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...partial,
  } as Recipe;
}

describe('byRecipeName', () => {
  it('sorts alphabetically', () => {
    const list = [recipe({ id: '2', name: 'Zuppa' }), recipe({ id: '1', name: 'Aioli' })];
    expect([...list].sort(byRecipeName).map((r) => r.name)).toEqual(['Aioli', 'Zuppa']);
  });
});

describe('recipeComparator', () => {
  const older = recipe({ id: 'o', name: 'Zebra', createdAt: '2026-01-01T00:00:00.000Z' });
  const newer = recipe({ id: 'n', name: 'Apple', createdAt: '2026-06-01T00:00:00.000Z' });

  it('recent puts the newest first', () => {
    expect([older, newer].sort(recipeComparator('recent', new Map())).map((r) => r.id)).toEqual([
      'n',
      'o',
    ]);
  });

  it('cooked puts the most-cooked first', () => {
    const counts = new Map([
      ['o', 5],
      ['n', 1],
    ]);
    expect([newer, older].sort(recipeComparator('cooked', counts)).map((r) => r.id)).toEqual([
      'o',
      'n',
    ]);
  });

  it('treats a recipe with no cook logs as zero rather than dropping it', () => {
    const never = recipe({ id: 'x', name: 'Never' });
    const sorted = [never, older].sort(recipeComparator('cooked', new Map([['o', 2]])));
    expect(sorted.map((r) => r.id)).toEqual(['o', 'x']);
  });

  // The device-stability guard: Automerge does not promise identical iteration order, so a
  // comparator returning 0 for ties would show two family devices a different grid.
  it('tie-breaks recent on name', () => {
    const a = recipe({ id: 'a', name: 'Beta', createdAt: '2026-01-01T00:00:00.000Z' });
    const b = recipe({ id: 'b', name: 'Alpha', createdAt: '2026-01-01T00:00:00.000Z' });
    expect([a, b].sort(recipeComparator('recent', new Map())).map((r) => r.name)).toEqual([
      'Alpha',
      'Beta',
    ]);
    expect([b, a].sort(recipeComparator('recent', new Map())).map((r) => r.name)).toEqual([
      'Alpha',
      'Beta',
    ]);
  });

  it('tie-breaks cooked on name, including the all-uncooked case', () => {
    const a = recipe({ id: 'a', name: 'Beta' });
    const b = recipe({ id: 'b', name: 'Alpha' });
    expect([a, b].sort(recipeComparator('cooked', new Map())).map((r) => r.name)).toEqual([
      'Alpha',
      'Beta',
    ]);
    expect([b, a].sort(recipeComparator('cooked', new Map())).map((r) => r.name)).toEqual([
      'Alpha',
      'Beta',
    ]);
  });
});

describe('buildShelves', () => {
  const breakfast = recipe({ id: 'b', name: 'Pancakes', mealSlots: ['breakfast'] });
  const dinner = recipe({ id: 'd', name: 'Stew', mealSlots: ['dinner'], course: 'main' });
  const both = recipe({ id: 'x', name: 'Soup', mealSlots: ['lunch', 'dinner'], course: 'starter' });
  const bare = recipe({ id: 'u', name: 'Mystery' });
  const all = [breakfast, dinner, both, bare];

  it('returns exactly one untitled shelf when ungrouped', () => {
    const shelves = buildShelves(all, 'none');
    expect(shelves).toHaveLength(1);
    expect(shelves[0]!.titleKey).toBeNull();
    expect(shelves[0]!.items).toHaveLength(4);
  });

  it('groups by meal in declared order, snacks last', () => {
    const keys = buildShelves(all, 'meal').map((s) => s.key);
    expect(keys).toEqual(['breakfast', 'lunch', 'dinner', 'unfiled']);
  });

  it('skips empty groups', () => {
    const keys = buildShelves([breakfast], 'meal').map((s) => s.key);
    expect(keys).toEqual(['breakfast']);
  });

  it('puts a multi-slot recipe under each of its slots', () => {
    const shelves = buildShelves(all, 'meal');
    const lunch = shelves.find((s) => s.key === 'lunch')!;
    const din = shelves.find((s) => s.key === 'dinner')!;
    expect(lunch.items.map((r) => r.id)).toContain('x');
    expect(din.items.map((r) => r.id)).toContain('x');
  });

  it('appends the unfiled bucket LAST and only when non-empty', () => {
    const withUnfiled = buildShelves(all, 'meal');
    expect(withUnfiled.at(-1)!.key).toBe('unfiled');
    expect(buildShelves([breakfast], 'meal').some((s) => s.key === 'unfiled')).toBe(false);
  });

  it('groups by course in declared order', () => {
    expect(buildShelves(all, 'course').map((s) => s.key)).toEqual(['starter', 'main', 'unfiled']);
  });

  it('carries an emoji on real groups and none on the unfiled bucket', () => {
    const shelves = buildShelves(all, 'meal');
    expect(shelves[0]!.emoji).toBe('🍳');
    expect(shelves.at(-1)!.emoji).toBeUndefined();
  });

  // The never-vanish invariant. An unrecognised stored value is reachable from a corrupt doc
  // or a downgrade; losing the recipe from the page would read as data loss.
  it('buckets an unrecognised course rather than dropping the recipe', () => {
    const weird = recipe({ id: 'w', name: 'Weird', course: 'pudding' as never });
    const shelves = buildShelves([weird], 'course');
    expect(shelves.flatMap((s) => s.items.map((r) => r.id))).toContain('w');
    expect(shelves.at(-1)!.key).toBe('unfiled');
  });

  it('buckets an unrecognised meal slot rather than dropping the recipe', () => {
    const weird = recipe({ id: 'w', name: 'Weird', mealSlots: ['brunch'] as never });
    const shelves = buildShelves([weird], 'meal');
    expect(shelves.flatMap((s) => s.items.map((r) => r.id))).toContain('w');
    expect(shelves.at(-1)!.key).toBe('unfiled');
  });

  // The invariant guards bad ELEMENTS; these guard a bad CONTAINER. A non-array reaching the
  // doc (a downgrade, a hand-merged .beanpod, a future writer storing one slot bare) would make
  // `.filter` throw and render NOTHING — losing every recipe, strictly worse than the
  // wrong-bucket outcome this function is written to prefer.
  it('buckets a non-array mealSlots rather than throwing and losing the whole cookbook', () => {
    const corrupt = recipe({ id: 'c', name: 'Corrupt', mealSlots: 'dinner' as never });
    expect(() => buildShelves([corrupt], 'meal')).not.toThrow();
    const shelves = buildShelves([corrupt, breakfast], 'meal');
    expect(shelves.flatMap((s) => s.items.map((r) => r.id))).toContain('c');
    expect(shelves.flatMap((s) => s.items.map((r) => r.id))).toContain('b');
  });

  it.each([[null], [42], [{}], ['dinner']])(
    'survives mealSlots = %p without dropping the recipe',
    (bad) => {
      const corrupt = recipe({ id: 'c', name: 'Corrupt', mealSlots: bad as never });
      const shelves = buildShelves([corrupt], 'meal');
      expect(shelves.flatMap((s) => s.items.map((r) => r.id))).toEqual(['c']);
    }
  );

  it('treats an EMPTY array as unset, not as a group', () => {
    const empty = recipe({ id: 'e', name: 'Empty', mealSlots: [], tags: [] });
    expect(buildShelves([empty], 'meal').map((s) => s.key)).toEqual(['unfiled']);
  });

  it.each(COOKBOOK_GROUPS)('shows every recipe at least once when grouped by %s', (group) => {
    const seen = new Set(
      buildShelves(all, group as CookbookGroup).flatMap((s) => s.items.map((r) => r.id))
    );
    for (const r of all) expect(seen.has(r.id)).toBe(true);
  });

  it('handles an empty cookbook', () => {
    expect(buildShelves([], 'meal')).toEqual([]);
    expect(buildShelves([], 'none')[0]!.items).toEqual([]);
  });

  it('preserves the incoming sort within each shelf', () => {
    const a = recipe({ id: 'a', name: 'Aaa', mealSlots: ['dinner'] });
    const z = recipe({ id: 'z', name: 'Zzz', mealSlots: ['dinner'] });
    const shelf = buildShelves([z, a], 'meal')[0]!;
    expect(shelf.items.map((r) => r.id)).toEqual(['z', 'a']);
  });
});

describe('countByCourse', () => {
  it('counts each course and the unset bucket', () => {
    const counts = countByCourse([
      recipe({ id: '1', name: 'A', course: 'main' }),
      recipe({ id: '2', name: 'B', course: 'main' }),
      recipe({ id: '3', name: 'C', course: 'dessert' }),
      recipe({ id: '4', name: 'D' }),
    ]);
    expect(counts.main).toBe(2);
    expect(counts.dessert).toBe(1);
    expect(counts.unset).toBe(1);
    expect(counts.starter).toBe(0);
  });

  it('counts an unrecognised course as unset rather than losing it', () => {
    const counts = countByCourse([recipe({ id: 'w', name: 'W', course: 'pudding' as never })]);
    expect(counts.unset).toBe(1);
  });

  it('returns a zero for every course on an empty cookbook', () => {
    const counts = countByCourse([]);
    expect(counts.main).toBe(0);
    expect(counts.unset).toBe(0);
  });
});
