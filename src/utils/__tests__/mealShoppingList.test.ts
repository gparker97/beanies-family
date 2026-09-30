import { describe, it, expect } from 'vitest';
import {
  batchesFor,
  buildShoppingLines,
  buildWeekShoppingSections,
  countWeekShoppingRecipes,
  eaterIdsToStore,
  eatingCount,
  hasShoppableIngredients,
  isUneditedLine,
  linesToTitles,
  rebatchLines,
  seedEaterIds,
  withBatchSuffix,
  type ChecklistLine,
} from '../mealShoppingList';
import type { MealPlanEntry, Recipe } from '@/types/models';

function recipe(over: Partial<Recipe> & Pick<Recipe, 'id'>): Recipe {
  return {
    name: over.id,
    ingredients: ['500 g ground beef', 'Salt, to taste'],
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    ...over,
  } as Recipe;
}

let seq = 0;
function meal(over: Partial<MealPlanEntry>): MealPlanEntry {
  seq += 1;
  return {
    id: `meal-${seq}`,
    date: '2026-09-28',
    slot: 'dinner',
    position: 0,
    kind: 'recipe',
    cooked: false,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    ...over,
  };
}

/** A family of five humans: m0…m4. */
const HUMANS = ['m0', 'm1', 'm2', 'm3', 'm4'];
const members = (n: number) => HUMANS.slice(0, n);

describe('hasShoppableIngredients', () => {
  it('is true only when the split yields at least one item', () => {
    expect(hasShoppableIngredients({ ingredients: ['2 eggs'] })).toBe(true);
    expect(hasShoppableIngredients({ ingredients: ['For the sauce:', '  '] })).toBe(false);
    expect(hasShoppableIngredients({ ingredients: [] })).toBe(false);
    expect(hasShoppableIngredients(undefined)).toBe(false);
    // Automerge docs are not schema-validated.
    expect(hasShoppableIngredients({} as Pick<Recipe, 'ingredients'>)).toBe(false);
  });
});

describe('the everyone rule', () => {
  it.each([
    ['nobody stored', undefined, HUMANS],
    ['empty array', [], HUMANS],
    ['a subset', ['m1', 'm3'], ['m1', 'm3']],
    ['only removed members', ['gone'], HUMANS],
    ['a removed member among current ones', ['m1', 'gone'], ['m1']],
  ])('seedEaterIds: %s', (_label, stored, expected) => {
    expect(seedEaterIds(stored, HUMANS)).toEqual(expected);
  });

  it.each([
    ['nobody picked', [], undefined],
    ['everyone picked', [...HUMANS], undefined],
    ['everyone picked, any order', ['m4', 'm3', 'm2', 'm1', 'm0'], undefined],
    ['a subset', ['m0', 'm2'], ['m0', 'm2']],
  ])('eaterIdsToStore: %s', (_label, picked, expected) => {
    expect(eaterIdsToStore(picked, HUMANS)).toEqual(expected);
  });

  it('eatingCount: picked members + guests', () => {
    expect(eatingCount({ eaterMemberIds: members(3), guestNames: ['Nan', 'Pop'] }, HUMANS)).toEqual(
      { eating: 5, everyone: false }
    );
    expect(eatingCount({ eaterMemberIds: members(4) }, HUMANS)).toEqual({
      eating: 4,
      everyone: false,
    });
  });

  it('eatingCount: nobody picked = every human (+ guests)', () => {
    expect(eatingCount({}, HUMANS)).toEqual({ eating: 5, everyone: true });
    expect(eatingCount({ eaterMemberIds: [] }, HUMANS)).toEqual({ eating: 5, everyone: true });
    expect(eatingCount({ guestNames: ['Nan', 'Pop'] }, HUMANS)).toEqual({
      eating: 7,
      everyone: true,
    });
  });

  it('eatingCount uses the SAME filter as seedEaterIds (a removed member)', () => {
    const stored = ['m1', 'gone'];
    expect(eatingCount({ eaterMemberIds: stored }, HUMANS).eating).toBe(
      seedEaterIds(stored, HUMANS).length
    );
    expect(eatingCount({ eaterMemberIds: ['gone'] }, HUMANS)).toEqual({
      eating: 5,
      everyone: true,
    });
  });
});

describe('batchesFor', () => {
  it.each([
    [5, 4, 2],
    [4, 4, 1],
    [3, 4, 1],
    [8, 4, 2],
    [9, 4, 3],
    [5, undefined, 1],
    [undefined, 4, 1],
    [0, 4, 1],
    [5, 0, 1],
    [Number.NaN, 4, 1],
  ])('eating %s, serves %s → %s', (eating, servings, expected) => {
    expect(batchesFor(eating, servings)).toBe(expected);
  });
});

describe('withBatchSuffix', () => {
  it('adds (×N) only when N > 1', () => {
    expect(withBatchSuffix('8 taco shells', 3)).toBe('8 taco shells (×3)');
    expect(withBatchSuffix('Salt, to taste', 2)).toBe('Salt, to taste (×2)');
    expect(withBatchSuffix('8 taco shells', 1)).toBe('8 taco shells');
  });
});

describe('buildShoppingLines', () => {
  it('lines as written, suffixed, headings dropped (counted), every line ticked', () => {
    const { lines, headingsSkipped } = buildShoppingLines(
      { id: 'r1', ingredients: ['For the sauce:', '1/2 cup sour cream', 'Two eggs', ''] },
      3
    );
    expect(headingsSkipped).toBe(1);
    expect(lines.map((l) => [l.source, l.text, l.batches, l.recipeId])).toEqual([
      ['1/2 cup sour cream', '1/2 cup sour cream (×3)', 3, 'r1'],
      ['Two eggs', 'Two eggs (×3)', 3, 'r1'],
    ]);
    expect(lines.every((l) => l.checked && isUneditedLine(l))).toBe(true);
    expect(new Set(lines.map((l) => l.id)).size).toBe(2);
  });

  it('×1 keeps every line exactly as written', () => {
    const { lines } = buildShoppingLines({ ingredients: ['500 g beef', 'Two eggs'] }, 1);
    expect(lines.map((l) => l.text)).toEqual(['500 g beef', 'Two eggs']);
  });
});

describe('rebatchLines', () => {
  it('×2 → ×1 → ×3 re-suffixes untouched lines and keeps ids', () => {
    const { lines: x2 } = buildShoppingLines({ ingredients: ['500 g beef', 'Two eggs'] }, 2);
    expect(x2.map((l) => l.text)).toEqual(['500 g beef (×2)', 'Two eggs (×2)']);
    const x1 = rebatchLines(x2, 1);
    expect(x1.map((l) => l.text)).toEqual(['500 g beef', 'Two eggs']);
    const x3 = rebatchLines(x1, 3);
    expect(x3.map((l) => l.text)).toEqual(['500 g beef (×3)', 'Two eggs (×3)']);
    expect(x3.map((l) => l.id)).toEqual(x2.map((l) => l.id));
  });

  it('leaves hand-edited and user-added lines alone and keeps every tick', () => {
    const { lines } = buildShoppingLines({ ingredients: ['500 g beef', '2 onions'] }, 2);
    const edited: ChecklistLine[] = [
      { ...lines[0]!, text: '800 g beef', checked: false },
      { ...lines[1]!, checked: false },
      { id: 'mine', text: 'Paper towels', checked: true, batches: 1 },
    ];

    const out = rebatchLines(edited, 3);

    expect(out[0]).toBe(edited[0]); // hand edit kept, untouched
    expect(out[1]).toMatchObject({ text: '2 onions (×3)', checked: false });
    expect(out[2]).toBe(edited[2]); // user-added, no source
  });
});

describe('linesToTitles', () => {
  it('writes ticked lines only, drops emptied ones, splits pasted multi-line text', () => {
    const base = { source: 'x', batches: 1 };
    const lines: ChecklistLine[] = [
      { ...base, id: 'a', text: '2 eggs', checked: true },
      { ...base, id: 'b', text: 'butter', checked: false },
      { ...base, id: 'c', text: '   ', checked: true },
      { ...base, id: 'd', text: 'milk\n\n  bread ', checked: true },
    ];
    expect(linesToTitles(lines)).toEqual(['2 eggs', 'milk', 'bread']);
  });

  it('skips parts standing behind a merged line', () => {
    const lines: ChecklistLine[] = [
      { id: 'a', source: 'rice', text: 'rice', checked: true, batches: 1, mergedInto: 'm' },
      { id: 'm', source: 'rice', text: 'rice (×2)', checked: true, batches: 2, merged: 'exact' },
    ];
    expect(linesToTitles(lines)).toEqual(['rice (×2)']);
  });
});

describe('buildWeekShoppingSections — the acceptance-criteria week', () => {
  const tikka = recipe({ id: 'tikka', name: 'Tikka', servings: '4' });
  const tacos = recipe({
    id: 'tacos',
    name: 'Tacos',
    servings: 'Serves 4',
    ingredients: ['500 g ground beef', '8 taco shells', 'Salt, to taste'],
  });
  const stirFry = recipe({ id: 'stirfry', name: 'Stir-fry', servings: '4' });
  const pie = recipe({ id: 'pie', name: 'Pie' }); // no servings
  const headingsOnly = recipe({ id: 'empty', ingredients: ['For the sauce:'] });
  const recipes = new Map(
    [tikka, tacos, stirFry, pie, headingsOnly].map((r) => [r.id, r] as const)
  );

  const week: MealPlanEntry[] = [
    meal({ date: '2026-09-28', recipeId: 'tikka', eaterMemberIds: members(4) }),
    meal({
      date: '2026-09-29',
      recipeId: 'tacos',
      eaterMemberIds: members(3),
      guestNames: ['Nan', 'Pop'],
    }),
    meal({ date: '2026-09-29', slot: 'lunch', kind: 'eat_out' }),
    meal({ date: '2026-10-01', recipeId: 'stirfry' }), // nobody picked: everyone (5)
    meal({ date: '2026-10-01', slot: 'lunch', kind: 'recipe', recipeId: undefined }), // deleted
    meal({ date: '2026-10-01', slot: 'breakfast', recipeId: 'gone' }), // not in the map
    meal({ date: '2026-10-02', recipeId: 'tacos', eaterMemberIds: members(3) }),
    meal({ date: '2026-10-02', slot: 'lunch', recipeId: 'pie', eaterMemberIds: members(2) }),
    meal({ date: '2026-10-03', recipeId: 'pie' }),
    meal({ date: '2026-10-03', slot: 'lunch', recipeId: 'empty', eaterMemberIds: members(2) }),
    meal({ date: '2026-10-04', kind: 'leftovers' }),
  ];

  const sections = buildWeekShoppingSections(week, recipes, HUMANS);
  const byId = Object.fromEntries(sections.map((s) => [s.recipeId, s]));

  it('one section per distinct recipe, ordered by first meal; others ignored', () => {
    expect(sections.map((s) => s.recipeId)).toEqual(['tikka', 'tacos', 'stirfry', 'pie']);
  });

  it('Tikka: 4 eating, serves 4 → Cook Once, lines as written with no suffix', () => {
    expect(byId.tikka).toMatchObject({ servings: 4, batches: 1 });
    expect(byId.tikka!.meals).toEqual([
      { date: '2026-09-28', slot: 'dinner', eating: 4, everyone: false, batches: 1 },
    ]);
    expect(byId.tikka!.lines.map((l) => l.text)).toEqual(['500 g ground beef', 'Salt, to taste']);
  });

  it('Tacos: Tue 3 + 2 guests, Fri 3, serves "Serves 4" → 2 + 1 = Cook ×3, one section', () => {
    expect(byId.tacos).toMatchObject({ recipeName: 'Tacos', servings: 4, batches: 3 });
    expect(byId.tacos!.meals.map((m) => [m.date, m.eating, m.batches])).toEqual([
      ['2026-09-29', 5, 2],
      ['2026-10-02', 3, 1],
    ]);
    expect(byId.tacos!.lines.map((l) => l.text)).toEqual([
      '500 g ground beef (×3)',
      '8 taco shells (×3)',
      'Salt, to taste (×3)',
    ]);
  });

  it('Thu stir-fry with nobody picked → everyone (5), serves 4 → Cook ×2', () => {
    expect(byId.stirfry!.meals[0]).toMatchObject({ eating: 5, everyone: true, batches: 2 });
    expect(byId.stirfry!.batches).toBe(2);
  });

  it('a recipe with no servings is one batch per meal', () => {
    expect(byId.pie).toMatchObject({ servings: undefined, batches: 2 });
    expect(byId.pie!.meals.map((m) => m.batches)).toEqual([1, 1]);
  });

  it('the header badge count equals the drawer’s section count, without building lines', () => {
    expect(countWeekShoppingRecipes(week, recipes)).toBe(sections.length);
    expect(countWeekShoppingRecipes(week, recipes)).toBe(4);
    expect(countWeekShoppingRecipes(week, { tikka } as Record<string, Recipe>)).toBe(1);
    expect(countWeekShoppingRecipes([], recipes)).toBe(0);
  });

  it('accepts a plain record of recipes too', () => {
    const out = buildWeekShoppingSections(week, { tikka } as Record<string, Recipe>, HUMANS);
    expect(out.map((s) => s.recipeId)).toEqual(['tikka']);
  });

  it('counts headings skipped per section', () => {
    const r = recipe({ id: 'h', ingredients: ['Sauce:', '2 eggs', 'Topping:', 'cheese'] });
    const [s] = buildWeekShoppingSections([meal({ recipeId: 'h' })], new Map([['h', r]]), HUMANS);
    expect(s!.headingsSkipped).toBe(2);
  });
});
