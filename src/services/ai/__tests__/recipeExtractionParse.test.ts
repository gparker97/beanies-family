import { describe, it, expect } from 'vitest';
import { parseRecipeExtractionResult, MODEL_FIELD_MAX, MODEL_LIST_MAX } from '../extractionPrompt';

const VALID = {
  isRecipe: true,
  name: 'Lemon Drizzle Cake',
  subtitle: 'A tart, sticky loaf',
  prepTime: '20 minutes',
  cookTime: '45 minutes',
  servings: 'Serves 8',
  ingredients: [{ text: '225g butter', inferred: false }],
  steps: [{ text: 'Cream the butter.', inferred: true }],
  notes: 'Keeps 3 days.',
  imageUrl: 'https://example.com/cake.jpg',
  confidence: { name: 0.9, ingredients: 0.8, steps: 0.7 },
};

describe('parseRecipeExtractionResult', () => {
  it('parses a well-formed response and preserves the inferred flags', () => {
    const r = parseRecipeExtractionResult(VALID);
    expect(r.isRecipe).toBe(true);
    expect(r.ingredients).toEqual([{ text: '225g butter', inferred: false }]);
    expect(r.steps[0].inferred).toBe(true);
    expect(r.confidence).toEqual({ name: 0.9, ingredients: 0.8, steps: 0.7 });
  });

  it('throws when a required key is missing, so a garbled reply is never half-saved', () => {
    for (const key of ['isRecipe', 'name', 'ingredients', 'steps', 'confidence']) {
      const partial = { ...VALID } as Record<string, unknown>;
      delete partial[key];
      expect(() => parseRecipeExtractionResult(partial)).toThrow();
    }
  });

  it('throws on a non-object', () => {
    expect(() => parseRecipeExtractionResult(null)).toThrow();
    expect(() => parseRecipeExtractionResult('a recipe')).toThrow();
  });

  it('tolerates a BARE STRING line (older/BYOK responses) as not-inferred', () => {
    // Losing the whole ingredient list because a provider returned strings would be a
    // worse outcome than treating them as read-not-inferred.
    const r = parseRecipeExtractionResult({ ...VALID, ingredients: ['250g flour', '2 eggs'] });
    expect(r.ingredients).toEqual([
      { text: '250g flour', inferred: false },
      { text: '2 eggs', inferred: false },
    ]);
  });

  it('DROPS malformed or empty lines rather than persisting empty rows', () => {
    const r = parseRecipeExtractionResult({
      ...VALID,
      ingredients: [{ text: 'ok', inferred: false }, { text: '   ' }, null, 42, {}, ''],
    });
    expect(r.ingredients).toEqual([{ text: 'ok', inferred: false }]);
  });

  it('coerces a missing/odd inferred flag to false rather than true', () => {
    // Defaulting to true would flood the review UI with false "check this" hints and
    // train the user to ignore the one signal that matters.
    const r = parseRecipeExtractionResult({
      ...VALID,
      ingredients: [{ text: 'a' }, { text: 'b', inferred: 'yes' }],
    });
    expect(r.ingredients.every((l) => l.inferred === false)).toBe(true);
  });

  it('bounds a hostile response — long fields truncate, long lists slice, never throws', () => {
    const huge = 'A'.repeat(500_000);
    const r = parseRecipeExtractionResult({
      ...VALID,
      name: huge,
      servings: huge,
      ingredients: Array.from({ length: 5000 }, () => ({ text: huge, inferred: false })),
      steps: Array.from({ length: 5000 }, () => huge),
    });
    expect(r.name).toHaveLength(MODEL_FIELD_MAX);
    expect(r.servings).toHaveLength(MODEL_FIELD_MAX);
    expect(r.ingredients).toHaveLength(MODEL_LIST_MAX);
    expect(r.steps).toHaveLength(MODEL_LIST_MAX);
  });

  it('DROPS an imageUrl the model volunteers, rather than carrying it (#86)', () => {
    // The field was removed from the prompt, but a model can still emit whatever it likes —
    // so the parser is where "we do not accept model-supplied image URLs" has to be true.
    // Previously this value was carried through unscreened for the caller to screen; now
    // there is no caller for it, and a stray field must not become a fetched URL by
    // accident. Dish photos come from the page's own markup via content-fetch.
    const r = parseRecipeExtractionResult({ ...VALID, imageUrl: 'javascript:' + 'alert(1)' });
    expect(r).not.toHaveProperty('imageUrl');
  });
});
