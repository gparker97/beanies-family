/**
 * The re-fetch diff, and specifically the rule that keeps a hand-edited recipe safe.
 *
 * A re-fetch may ADD or CHANGE. It may never EMPTY. Two separate mechanisms could empty a
 * field — a present-`undefined` key (a delete) and an empty array (a wipe by assignment) —
 * and both are reachable from a real capture, so both are tested here.
 */
import { describe, it, expect } from 'vitest';
import { diffRecipe } from '../recipeDiff';
import type { RecipePrefill } from '../recipeExtractionToRecipe';
import type { Recipe } from '@/types/models';

function recipe(over: Partial<Recipe> = {}): Recipe {
  return {
    id: 'r-1',
    name: 'Lemon Drizzle Cake',
    subtitle: 'the one that never lasts a day',
    prepTime: '20 mins',
    cookTime: '45 mins',
    servings: 'Serves 8',
    ingredients: ['225g butter', '4 eggs'],
    steps: ['Heat the oven.', 'Beat the butter.'],
    notes: 'Keeps three days.',
    sourceUrl: 'https://example.com/cake',
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...over,
  };
}

function prefill(fields: Partial<RecipePrefill['fields']> = {}): RecipePrefill {
  return {
    fields: { name: 'Lemon Drizzle Cake', ingredients: [], steps: [], ...fields },
    inferredIngredients: [],
    inferredSteps: [],
    inferredTimes: [],
    taxonomyRejected: [],
    dishImage: null,
    confidence: { name: 1, ingredients: 1, steps: 1 },
  };
}

describe('what it reports as changed', () => {
  it('reports nothing when the page says what the recipe already holds', () => {
    const d = diffRecipe(
      recipe(),
      prefill({
        ingredients: ['225g butter', '4 eggs'],
        steps: ['Heat the oven.', 'Beat the butter.'],
      })
    );
    expect(d.changed).toBe(false);
    expect(d.rows).toEqual([]);
    expect(d.patch).toEqual({});
  });

  it('reports a changed value old-beside-new', () => {
    const d = diffRecipe(
      recipe(),
      prefill({
        cookTime: '50 mins',
        ingredients: ['225g butter', '4 eggs'],
        steps: ['Heat the oven.', 'Beat the butter.'],
      })
    );
    expect(d.rows).toEqual([{ field: 'cookTime', mine: '45 mins', theirs: '50 mins' }]);
    expect(d.patch).toEqual({ cookTime: '50 mins' });
  });

  it('FILLS a field that was empty — the common case this feature exists for', () => {
    const d = diffRecipe(
      recipe({ prepTime: undefined, ingredients: ['225g butter'], steps: ['Heat the oven.'] }),
      prefill({ prepTime: '20 mins', ingredients: ['225g butter'], steps: ['Heat the oven.'] })
    );
    expect(d.patch).toEqual({ prepTime: '20 mins' });
    expect(d.rows[0].mine).toBeUndefined();
  });

  it('renders rows in a fixed display order, never object-key order', () => {
    const d = diffRecipe(
      recipe({ name: 'Old', notes: undefined, subtitle: undefined }),
      prefill({
        notes: 'New notes',
        subtitle: 'A subtitle',
        name: 'New',
        ingredients: ['225g butter', '4 eggs'],
        steps: ['Heat the oven.', 'Beat the butter.'],
      })
    );
    expect(d.rows.map((r) => r.field)).toEqual(['name', 'subtitle', 'notes']);
  });
});

describe('a re-fetch never empties a field', () => {
  it('drops an EMPTY ARRAY that would wipe a populated list', () => {
    // Live on every video re-fetch: the `titleOnly` rung produces `ingredients: []` and
    // `steps: []`, and diffPayload does NOT normalise an empty array — it would be written
    // as a literal [], wiping the list by assignment.
    const d = diffRecipe(recipe(), prefill({ ingredients: [], steps: [] }));
    expect(d.patch).not.toHaveProperty('ingredients');
    expect(d.patch).not.toHaveProperty('steps');
    expect(d.changed).toBe(false);
  });

  it('drops an empty NAME — recipeExtractionToPrefill accepts an extraction with no name', () => {
    const d = diffRecipe(
      recipe(),
      prefill({
        name: '',
        ingredients: ['225g butter', '4 eggs'],
        steps: ['Heat the oven.', 'Beat the butter.'],
      })
    );
    expect(d.patch).not.toHaveProperty('name');
  });

  it('still fills a list that was empty before', () => {
    // The rule is "never EMPTY", not "never touch a list".
    const d = diffRecipe(
      recipe({ ingredients: [], steps: [] }),
      prefill({ ingredients: ['flour'], steps: ['mix'] })
    );
    expect(d.patch).toEqual({ ingredients: ['flour'], steps: ['mix'] });
  });

  it('leaves an ABSENT key entirely alone rather than deleting it', () => {
    // The rest-spread is what makes this true: absence means "the page said nothing about
    // this", never "the page says it is empty".
    const d = diffRecipe(
      recipe(),
      prefill({
        ingredients: ['225g butter', '4 eggs'],
        steps: ['Heat the oven.', 'Beat the butter.'],
      })
    );
    expect(d.patch).not.toHaveProperty('notes');
    expect(d.patch).not.toHaveProperty('servings');
  });

  it('never offers to change sourceUrl, which capture rewrites on every read', () => {
    const d = diffRecipe(
      recipe(),
      prefill({
        sourceUrl: 'https://example.com/cake?utm_source=beanies',
        ingredients: ['225g butter', '4 eggs'],
        steps: ['Heat the oven.', 'Beat the butter.'],
      })
    );
    expect(d.patch).not.toHaveProperty('sourceUrl');
    expect(d.changed).toBe(false);
  });

  it('never touches tags, which a prefill cannot carry', () => {
    const d = diffRecipe(
      recipe({ tags: ['nana special'] }),
      prefill({
        ingredients: ['225g butter', '4 eggs'],
        steps: ['Heat the oven.', 'Beat the butter.'],
      })
    );
    expect(d.patch).not.toHaveProperty('tags');
  });
});

describe('the photo offer', () => {
  const withCandidate: RecipePrefill['dishImage'] = {
    kind: 'page',
    candidates: [{ url: 'https://example.com/cake.jpg', source: 'og_image' }],
    pageUrl: 'https://example.com/cake',
  };

  it('is offered when the recipe has no photo yet', () => {
    const p = { ...prefill(), dishImage: withCandidate };
    expect(diffRecipe(recipe({ photoIds: [] }), p).photo).toBe(true);
  });

  it('is NOT offered when the recipe already has one — it would add a duplicate', () => {
    // PhotoAttachment carries no source URL, so "the same og:image we already stored" and
    // "a new photo" are indistinguishable. Offering it would add a duplicate every press.
    const p = { ...prefill(), dishImage: withCandidate };
    expect(diffRecipe(recipe({ photoIds: ['p-1'] }), p).photo).toBe(false);
  });

  it('makes a photo-only result count as changed', () => {
    const p = {
      ...prefill({
        ingredients: ['225g butter', '4 eggs'],
        steps: ['Heat the oven.', 'Beat the butter.'],
      }),
      dishImage: withCandidate,
    };
    const d = diffRecipe(recipe(), p);
    expect(d.rows).toEqual([]);
    expect(d.changed).toBe(true);
  });
});

describe('whitespace is empty, and must never overwrite content', () => {
  it('does not let a whitespace-only value blank a populated field', () => {
    // `asString` now trims, so this should be unreachable from the real parser — but a
    // blank name reaching `updateRecipe` renders the recipe as an empty heading, and this
    // is the boundary that writes, so it checks rather than assumes.
    const d = diffRecipe(
      recipe(),
      prefill({
        name: '   ',
        prepTime: '\t\n',
        ingredients: ['225g butter', '4 eggs'],
        steps: ['Heat the oven.', 'Beat the butter.'],
      })
    );
    expect(d.patch).not.toHaveProperty('name');
    expect(d.patch).not.toHaveProperty('prepTime');
    expect(d.changed).toBe(false);
  });
});
