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
  describe('the mapper carries NO image concern at all (#86)', () => {
    // ⚠️ THIS REPLACES THREE SUITES THAT TESTED A SAME-REGISTRABLE-DOMAIN BOUND.
    //
    // That bound was real security, not decoration: the model's imageUrl is
    // attacker-influenceable and is fetched SERVER-SIDE, so an unscreened value was a
    // beacon/SSRF channel and a way to write attacker-chosen bytes into a family's Drive.
    // It has not been weakened — it has been made unnecessary, by removing the thing it
    // guarded:
    //
    //   1. The model no longer returns an image URL at all. It never could return a real
    //      one — `htmlToText` strips every tag before the model sees the page — so its only
    //      possible contribution was an invention. That field is gone from the prompt.
    //   2. Candidates now come from the CONTENT-FETCH LAMBDA's reading of the page's own
    //      markup, pre-screened there, screened again by `screenCandidates`, and screened a
    //      third time by `screenUrl` + `resolvePublicAddress` inside `guardedFetch` on every
    //      hop of every fetch.
    //
    // The equivalent assertions now live in `shareLink.test.ts` (scheme/credentials/port
    // rejection, malformed input) and the Lambda's `imageCandidates.test.mjs` (server-side
    // pre-screening). What is asserted HERE is the invariant that makes those sufficient:
    // this mapper must never emit an image, whatever the model says.
    it('never surfaces an image, even from a model that smuggles one in', () => {
      // `imageUrl` is no longer on RecipeExtractionResult at all, so this casts past the type
      // deliberately: the runtime guarantee must hold regardless of what a model emits.
      const smuggled = {
        ...result(),
        imageUrl: 'https://attacker.example/beacon.png',
      } as RecipeExtractionResult;
      expect(recipeExtractionToPrefill(smuggled)!.dishImage).toBeNull();
    });

    it('yields no image on the ordinary path either', () => {
      expect(recipeExtractionToPrefill(result())!.dishImage).toBeNull();
    });
  });
});

describe('jsonLdToPrefill also carries no image', () => {
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

  it('does not re-derive the image from the JSON-LD node', () => {
    // The page's own JSON-LD `image` still reaches the user — but as candidate #1 of the
    // server's ladder, screened on the way, rather than being read a second time here.
    // Two paths to the same value is how one of them ends up missing a check.
    expect(jsonLdToPrefill(RECIPE, 'https://nanabakes.example/r').dishImage).toBeNull();
    expect(
      jsonLdToPrefill(
        { ...RECIPE, imageUrl: 'https://nanabakes.example/cake.jpg' },
        'https://nanabakes.example/r'
      ).dishImage
    ).toBeNull();
  });

  it('still records the source URL, which the form shows and stores', () => {
    const p = jsonLdToPrefill(RECIPE, 'https://nanabakes.example/r');
    expect(p.fields.sourceUrl).toBe('https://nanabakes.example/r');
  });
});
