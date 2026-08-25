import { describe, it, expect } from 'vitest';
import { jsonLdToPrefill, recipeExtractionToPrefill } from '@/utils/recipeExtractionToRecipe';
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

    it('when there is nothing to cook — no ingredients AND no steps', () => {
      expect(
        recipeExtractionToPrefill(result({ name: '  ', ingredients: [], steps: [] }))
      ).toBeNull();
    });

    it('when a NAME-ONLY result comes back (roundup and category pages)', () => {
      // The bug this pins: `&&` only rejected the all-empty shape, so this opened a form
      // containing nothing but a dish title — silently, and logged as a success.
      expect(
        recipeExtractionToPrefill(
          result({ name: 'Lemon Drizzle Cake', ingredients: [], steps: [] })
        )
      ).toBeNull();
    });

    it('but NOT when a name is missing yet ingredients exist', () => {
      // Keeping this: the model found real ingredients, and the form makes the user supply a
      // name before saving. Discarding the extraction here would lose genuine work.
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

    it('keeps a plain https URL when it is on the SOURCE domain', () => {
      // Behaviour change: scheme screening alone is no longer enough. Without a source page
      // to bound it against, a model-supplied URL is dropped (see the same-domain suite
      // below) — so this now asserts the bounded form.
      expect(
        recipeExtractionToPrefill(result(), 'https://example.com/recipes/cake')!.dishImageUrl
      ).toBe('https://example.com/cake.jpg');
    });
  });
});

describe('dish image is bounded to the SOURCE DOMAIN (found by /code-review max)', () => {
  // The type comment and the saved plan both claimed this control existed. It did not.
  // Without it a hostile recipe page names any host as its og:image and we fetch it
  // server-side: a per-victim ping from our AWS egress, and up to 1.5MB of attacker-chosen
  // bytes written into the family's Drive as their dish photo. No prompt injection needed —
  // the page's own og:image is copied straight through.
  const SRC = 'https://nanabakes.example/recipes/lemon';

  it('keeps an image on the same registrable domain, including subdomains', () => {
    for (const img of [
      'https://nanabakes.example/img/cake.jpg',
      'https://cdn.nanabakes.example/img/cake.jpg',
      'https://images.nanabakes.example/cake.jpg',
    ]) {
      expect(recipeExtractionToPrefill(result({ imageUrl: img }), SRC)!.dishImageUrl).toBe(img);
    }
  });

  it('DROPS an image on any other domain', () => {
    for (const img of [
      'https://attacker.example/beacon.png',
      'https://nanabakes.example.evil.test/cake.jpg',
      'https://evil.test/cake.jpg',
    ]) {
      expect(recipeExtractionToPrefill(result({ imageUrl: img }), SRC)!.dishImageUrl).toBeNull();
    }
  });

  it('drops the image entirely when there is no source page to bound it against', () => {
    // A photo/PDF capture has no page, so a model-suggested URL is unbounded by definition.
    expect(recipeExtractionToPrefill(result())!.dishImageUrl).toBeNull();
  });
});

describe('jsonLdToPrefill applies the same bound', () => {
  const RECIPE = {
    name: 'Lemon Drizzle',
    subtitle: '',
    prepTime: '20 mins',
    cookTime: '45 mins',
    servings: 'Serves 8',
    ingredients: ['225g butter'],
    steps: ['Bake.'],
    imageUrl: 'https://attacker.example/beacon.png',
  };

  it('drops a cross-domain image even from the page own JSON-LD', () => {
    // A page's own markup is no more trustworthy than a model's suggestion — both are
    // attacker-authored when the page is hostile.
    const p = jsonLdToPrefill(RECIPE, 'https://nanabakes.example/r');
    expect(p.dishImageUrl).toBeNull();
  });

  it('keeps a same-domain image', () => {
    const img = 'https://cdn.nanabakes.example/cake.jpg';
    const p = jsonLdToPrefill({ ...RECIPE, imageUrl: img }, 'https://nanabakes.example/r');
    expect(p.dishImageUrl).toBe(img);
  });
});
