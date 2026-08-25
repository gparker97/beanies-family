import { describe, it, expect } from 'vitest';
import { recipeExtractionToPrefill } from '@/utils/recipeExtractionToRecipe';
import type { RecipeExtractionResult } from '@/services/ai/types';

function result(over: Partial<RecipeExtractionResult> = {}): RecipeExtractionResult {
  return {
    isRecipe: true,
    name: 'Lemon Drizzle Cake',
    subtitle: 'A tart, sticky loaf',
    prepTime: '20 minutes',
    cookTime: '45 minutes',
    servings: 'Serves 8',
    ingredients: [
      { text: '225g unsalted butter', inferred: false },
      { text: '1 tsp salt', inferred: true },
    ],
    steps: [
      { text: 'Cream the butter and sugar.', inferred: false },
      { text: 'Bake for 45 minutes at 180C.', inferred: true },
    ],
    notes: 'Keeps 3 days in a tin.',
    imageUrl: 'https://example.com/cake.jpg',
    confidence: { name: 0.9, ingredients: 0.8, steps: 0.7 },
    ...over,
  };
}

describe('recipeExtractionToPrefill', () => {
  it('maps every field and flattens the lines to text', () => {
    const p = recipeExtractionToPrefill(result())!;
    expect(p.fields.name).toBe('Lemon Drizzle Cake');
    expect(p.fields.cookTime).toBe('45 minutes');
    expect(p.fields.ingredients).toEqual(['225g unsalted butter', '1 tsp salt']);
    expect(p.fields.steps).toHaveLength(2);
    expect(p.confidence.name).toBe(0.9);
  });

  it('reports inferred lines as TEXT, not indices', () => {
    // Indices would be stale the moment the user edits or reorders the textarea; texts
    // stay meaningful. This is the whole reason the shape is what it is.
    const p = recipeExtractionToPrefill(result())!;
    expect(p.inferredIngredients).toEqual(['1 tsp salt']);
    expect(p.inferredSteps).toEqual(['Bake for 45 minutes at 180C.']);
  });

  it('omits empty optional fields rather than seeding empty strings', () => {
    const p = recipeExtractionToPrefill(
      result({ subtitle: '', prepTime: '', cookTime: '', servings: '', notes: '' })
    )!;
    expect(p.fields.subtitle).toBeUndefined();
    expect(p.fields.cookTime).toBeUndefined();
    expect(p.fields.notes).toBeUndefined();
  });

  describe('returns null rather than an empty form', () => {
    it('when the source was not a recipe', () => {
      expect(recipeExtractionToPrefill(result({ isRecipe: false }))).toBeNull();
    });

    it('when there is no name AND no ingredients or steps', () => {
      expect(
        recipeExtractionToPrefill(result({ name: '  ', ingredients: [], steps: [] }))
      ).toBeNull();
    });

    it('but NOT when a name is missing yet ingredients exist', () => {
      expect(recipeExtractionToPrefill(result({ name: '', steps: [] }))).not.toBeNull();
    });
  });

  describe('dish image URL is screened, never trusted', () => {
    // The model reads untrusted sources, so imageUrl is attacker-influenceable. It is
    // fetched server-side later, which makes an unscreened value a beacon/SSRF channel.
    it.each([
      'javascript:' + '//%0aalert(1)',
      'data:text/html,<script>alert(1)</script>',
      'http' + '://insecure.example.com/x.jpg',
      'https://user:pass@evil.example.com/x.jpg',
      '',
    ])('drops %s', (bad) => {
      expect(recipeExtractionToPrefill(result({ imageUrl: bad }))!.dishImageUrl).toBeNull();
    });

    it('keeps a plain https URL', () => {
      expect(recipeExtractionToPrefill(result())!.dishImageUrl).toBe(
        'https://example.com/cake.jpg'
      );
    });
  });
});
