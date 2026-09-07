/**
 * The message builder.
 *
 * The test that matters most is "a realistic recipe keeps its link" — a review pass found
 * that a single 2000-character budget on the whole message would have dropped the link for
 * the median recipe, which deletes the entire point of the feature.
 */
import { describe, it, expect } from 'vitest';
import { buildRecipeShareText, MAX_SHARE_MESSAGE_CHARS } from '../recipeShareText';
import type { SharedRecipeFields } from '../recipeShareLink';
import type { UIStringKey } from '@/services/translation/uiStrings';

/** Identity translate, plus the two keys that interpolate. */
const t = ((key: string) => {
  if (key === 'recipeShare.text.prep') return 'Prep {value}';
  if (key === 'recipeShare.text.cook') return 'Cook {value}';
  if (key === 'recipeShare.text.andMore') return '… and {count} more';
  return key;
}) as unknown as (key: UIStringKey) => string;

const LINK = 'https://app.beanies.family/recipe#abc123';

function fields(overrides: Partial<SharedRecipeFields> = {}): SharedRecipeFields {
  return {
    name: 'Lemon Drizzle Cake',
    subtitle: 'the one that never lasts a day',
    prepTime: '20 mins',
    cookTime: '45 mins',
    servings: 'Serves 8',
    ingredients: ['225g butter', '4 eggs'],
    steps: ['Heat the oven.', 'Beat the butter.'],
    notes: 'Keeps three days.',
    ...overrides,
  };
}

/** A realistic mid-sized recipe: 12 ingredients, 8 steps. */
const realistic = fields({
  ingredients: Array.from({ length: 12 }, (_, i) => `${100 + i}g of ingredient number ${i + 1}`),
  steps: Array.from({ length: 8 }, (_, i) => `Step ${i + 1}: do the thing carefully and well.`),
});

describe('buildRecipeShareText', () => {
  it('includes the recipe, the sign-off and the link', () => {
    const { text, rung } = buildRecipeShareText({ fields: fields(), link: LINK, t });
    expect(text).toContain('Lemon Drizzle Cake');
    expect(text).toContain('225g butter');
    expect(text).toContain('Prep 20 mins');
    expect(text).toContain(LINK);
    expect(rung).toBe('none');
  });

  it('KEEPS THE LINK for a realistic 12-ingredient recipe', () => {
    // The pass-4 regression guard. A single 2000-char budget on the composed message would
    // have hit the no-link floor here — for the median recipe.
    const { text, linkDropped } = buildRecipeShareText({ fields: realistic, link: LINK, t });
    expect(linkDropped).toBe(false);
    expect(text).toContain(LINK);
  });

  it('trims text down the ladder rather than dropping the link', () => {
    const huge = fields({
      notes: 'n'.repeat(1200),
      steps: Array.from({ length: 40 }, (_, i) => `Step ${i}: ${'x'.repeat(80)}`),
      ingredients: Array.from({ length: 60 }, (_, i) => `${i}: ${'y'.repeat(40)}`),
    });
    const { text, rung, linkDropped } = buildRecipeShareText({ fields: huge, link: LINK, t });
    expect(linkDropped).toBe(false);
    expect(text).toContain(LINK);
    expect(rung).not.toBe('none');
  });

  it('drops notes before it drops steps', () => {
    const withNotes = fields({
      notes: 'n'.repeat(1900),
      steps: ['one', 'two', 'three', 'four'],
    });
    const { text } = buildRecipeShareText({ fields: withNotes, link: LINK, t });
    expect(text).not.toContain('n'.repeat(1900));
    expect(text).toContain('one');
  });

  it('ships an over-budget floor anyway rather than sacrificing the link', () => {
    // A single ingredient list so long that even the floor exceeds the budget.
    const monstrous = fields({
      name: 'X'.repeat(150),
      ingredients: Array.from({ length: 8 }, () => 'z'.repeat(480)),
      steps: [],
      notes: undefined,
    });
    const { text, rung, linkDropped } = buildRecipeShareText({
      fields: monstrous,
      link: LINK,
      t,
    });
    expect(rung).toBe('floor');
    expect(linkDropped).toBe(false);
    expect(text).toContain(LINK);
    expect(text.length).toBeGreaterThan(MAX_SHARE_MESSAGE_CHARS);
  });

  it('reports linkDropped and omits the link when the payload was too large', () => {
    const { text, linkDropped } = buildRecipeShareText({ fields: fields(), link: null, t });
    expect(linkDropped).toBe(true);
    expect(text).not.toContain('http');
    // The recipe itself is still there — the share is degraded, not lost.
    expect(text).toContain('225g butter');
  });

  it('does not promise "the rest is in the link" when there is no link', () => {
    const many = fields({ steps: Array.from({ length: 30 }, (_, i) => `Step ${i}`) });
    const { text } = buildRecipeShareText({ fields: many, link: null, t });
    expect(text).not.toContain('recipeShare.text.restInLink');
  });

  it('caps ingredients with a count at the floor', () => {
    const many = fields({
      ingredients: Array.from({ length: 40 }, (_, i) => `ingredient ${i} ${'q'.repeat(60)}`),
      steps: Array.from({ length: 30 }, (_, i) => `Step ${i} ${'w'.repeat(60)}`),
      notes: 'n'.repeat(500),
    });
    const { text } = buildRecipeShareText({ fields: many, link: LINK, t });
    expect(text).toContain('… and');
  });

  it('handles a recipe with no times and no subtitle', () => {
    const bare = fields({
      subtitle: undefined,
      prepTime: undefined,
      cookTime: undefined,
      servings: undefined,
    });
    const { text } = buildRecipeShareText({ fields: bare, link: LINK, t });
    expect(text).toContain('Lemon Drizzle Cake');
    expect(text).not.toContain('Prep');
  });

  it('does not garble a name containing $& — the fillTemplate guard', () => {
    const dollar = fields({ name: 'Chicken $& Rice', prepTime: '$& mins' });
    const { text } = buildRecipeShareText({ fields: dollar, link: LINK, t });
    expect(text).toContain('Chicken $& Rice');
    expect(text).toContain('Prep $& mins');
  });
});
