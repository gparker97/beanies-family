/**
 * The wire format and its guard.
 *
 * `decodeRecipeShare` is a security boundary, so most of this file is hostile input. The
 * golden fixture is the other half of the job: it pins the exact encoded bytes so a future
 * `Recipe` field rename cannot silently change a format that lives in people's chat history.
 */
import { describe, it, expect } from 'vitest';
import {
  encodeRecipeShare,
  decodeRecipeShare,
  sharedRecipeToPrefill,
  MAX_SHARE_PAYLOAD_CHARS,
  SHARE_WIRE_VERSION,
} from '../recipeShareLink';
import { bufferToBase64url } from '../encoding';
import type { Recipe } from '@/types/models';

function recipe(overrides: Partial<Recipe> = {}): Recipe {
  return {
    id: 'r-1',
    name: 'Lemon Drizzle Cake',
    subtitle: 'the one that never lasts a day',
    prepTime: '20 mins',
    cookTime: '45 mins',
    servings: 'Serves 8',
    ingredients: ['225g unsalted butter', '4 large eggs'],
    steps: ['Heat the oven to 180C.', 'Beat the butter and sugar.'],
    notes: 'Keeps three days in a tin.',
    sourceUrl: 'https://bbcgoodfood.com/lemon-drizzle',
    course: 'baking',
    mealSlots: ['snack'],
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

/** Encode an arbitrary object as a fragment, for hostile-input cases. */
const asFragment = (obj: unknown): string =>
  bufferToBase64url(new TextEncoder().encode(JSON.stringify(obj)));

describe('encode → decode round trip', () => {
  it('carries every shared field intact', () => {
    const out = decodeRecipeShare(encodeRecipeShare(recipe()));
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.fields).toMatchObject({
      name: 'Lemon Drizzle Cake',
      subtitle: 'the one that never lasts a day',
      prepTime: '20 mins',
      cookTime: '45 mins',
      servings: 'Serves 8',
      ingredients: ['225g unsalted butter', '4 large eggs'],
      steps: ['Heat the oven to 180C.', 'Beat the butter and sugar.'],
      notes: 'Keeps three days in a tin.',
      sourceUrl: 'https://bbcgoodfood.com/lemon-drizzle',
      course: 'baking',
      mealSlots: ['snack'],
    });
  });

  it('survives a non-Latin-1 name — the btoa regression guard', () => {
    // `btoa(JSON.stringify(recipe))` throws InvalidCharacterError here. This test is the
    // reason the encoder goes through TextEncoder rather than btoa.
    const out = decodeRecipeShare(encodeRecipeShare(recipe({ name: 'Crème Brûlée 🍮' })));
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.fields.name).toBe('Crème Brûlée 🍮');
  });

  it('handles a recipe captured from a photo, with no source URL', () => {
    const out = decodeRecipeShare(encodeRecipeShare(recipe({ sourceUrl: undefined })));
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.fields.sourceUrl).toBeUndefined();
  });

  it('never carries tags or photoIds', () => {
    const out = decodeRecipeShare(
      encodeRecipeShare(recipe({ tags: ['secret'], photoIds: ['p-1'] }))
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.fields).not.toHaveProperty('tags');
    expect(out.fields).not.toHaveProperty('photoIds');
  });

  it('survives a percent-encoded fragment, as some chat clients send', () => {
    const encoded = encodeURIComponent(encodeRecipeShare(recipe()));
    expect(decodeRecipeShare(encoded).ok).toBe(true);
  });
});

describe('golden wire format', () => {
  it('pins the encoded string so a Recipe rename cannot silently change it', () => {
    // A minimal, fully deterministic recipe. If this string changes, the wire format
    // changed — which means links already sitting in someone's chat may stop decoding.
    // Changing it is a deliberate act that needs a new SHARE_WIRE_VERSION.
    const encoded = encodeRecipeShare(
      recipe({
        name: 'Toast',
        subtitle: undefined,
        prepTime: undefined,
        cookTime: undefined,
        servings: undefined,
        ingredients: ['bread'],
        steps: ['toast it'],
        notes: undefined,
        sourceUrl: undefined,
        course: undefined,
        mealSlots: undefined,
      })
    );
    expect(encoded).toBe(
      bufferToBase64url(
        new TextEncoder().encode(
          JSON.stringify({ v: SHARE_WIRE_VERSION, n: 'Toast', i: ['bread'], t: ['toast it'] })
        )
      )
    );
    // And it still decodes, which is the property that actually matters.
    const out = decodeRecipeShare(encoded);
    expect(out.ok).toBe(true);
  });
});

describe('decode refuses hostile input', () => {
  it.each([
    ['empty', ''],
    ['too-long', 'a'.repeat(MAX_SHARE_PAYLOAD_CHARS + 1)],
    ['bad-encoding', '!!!not base64!!!'],
  ])('%s', (reason, raw) => {
    const out = decodeRecipeShare(raw);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toBe(reason);
  });

  it('bad-json', () => {
    const out = decodeRecipeShare(bufferToBase64url(new TextEncoder().encode('{not json')));
    expect(out).toEqual({ ok: false, reason: 'bad-json' });
  });

  it.each([
    ['an array', []],
    ['a bare number', 7],
    ['null', null],
  ])('not-an-object: %s', (_label, value) => {
    const out = decodeRecipeShare(asFragment(value));
    expect(out.ok).toBe(false);
  });

  it('refuses an unknown version rather than best-effort parsing it', () => {
    const out = decodeRecipeShare(asFragment({ v: 99, n: 'Cake' }));
    expect(out).toEqual({ ok: false, reason: 'unsupported-version' });
  });

  it('refuses a payload with no name', () => {
    expect(decodeRecipeShare(asFragment({ v: 1, i: ['x'] }))).toEqual({
      ok: false,
      reason: 'no-name',
    });
    // Whitespace is not a name either.
    expect(decodeRecipeShare(asFragment({ v: 1, n: '   ' }))).toEqual({
      ok: false,
      reason: 'no-name',
    });
  });
});

describe('decode sanitises what it accepts', () => {
  it('drops every key outside the allowlist, including __proto__', () => {
    const out = decodeRecipeShare(
      asFragment({ v: 1, n: 'Cake', evil: 'nope', __proto__: { polluted: true } })
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.fields).not.toHaveProperty('evil');
    expect(out.fields).not.toHaveProperty('polluted');
    // The prototype itself must be untouched.
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('rejects non-string list entries rather than coercing them', () => {
    // String({}) is "[object Object]" — coercion would persist that as an ingredient.
    const out = decodeRecipeShare(asFragment({ v: 1, n: 'Cake', i: ['flour', {}, 42, null] }));
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.fields.ingredients).toEqual(['flour']);
  });

  it('caps list length', () => {
    const many = Array.from({ length: 500 }, (_, i) => `item ${i}`);
    const out = decodeRecipeShare(asFragment({ v: 1, n: 'Cake', i: many }));
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.fields.ingredients.length).toBeLessThanOrEqual(100);
  });

  it.each([
    ['javascript:', 'javascript:alert(1)'],
    // ⚠️ BUILT, NOT WRITTEN. `@microsoft/sdl/no-insecure-url` is an eslint --fix rule and
    // the pre-commit hook runs it: written as a literal, this row was silently rewritten to
    // `https://`, turning a hostile-input assertion into "a valid https URL is dropped",
    // which then failed. Assembling the scheme keeps the fixture hostile. A disable comment
    // would work too, but the next person to run --fix on a nearby line would not see it.
    ['plain http', `${'ht' + 'tp'}://example.com/x`],
    ['a non-default port', 'https://example.com:8443/x'],
  ])('drops a %s sourceUrl', (_label, url) => {
    const out = decodeRecipeShare(asFragment({ v: 1, n: 'Cake', u: url }));
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.fields.sourceUrl).toBeUndefined();
  });

  it('drops an unrecognised course or meal slot rather than mapping it', () => {
    const out = decodeRecipeShare(
      asFragment({ v: 1, n: 'Cake', r: 'Main Course', m: ['brunch', 'lunch'] })
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.fields.course).toBeUndefined();
    expect(out.fields.mealSlots).toEqual(['lunch']);
  });

  it('keeps script-looking text as inert data', () => {
    // Vue escapes on render; the point here is that we neither strip nor execute it, so the
    // recipe reads exactly as the sender wrote it.
    const out = decodeRecipeShare(asFragment({ v: 1, n: '<script>alert(1)</script>' }));
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.fields.name).toBe('<script>alert(1)</script>');
  });

  it('never cuts a surrogate pair in half when bounding', () => {
    const out = decodeRecipeShare(asFragment({ v: 1, n: '🍮'.repeat(300) }));
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.fields.name).not.toContain('�');
  });
});

describe('sharedRecipeToPrefill', () => {
  it('fills the envelope with honest neutrals — no invented confidence', () => {
    const fields = { name: 'Cake', ingredients: ['flour'], steps: ['bake'] };
    const prefill = sharedRecipeToPrefill(fields);
    expect(prefill.fields).toBe(fields);
    expect(prefill.inferredIngredients).toEqual([]);
    expect(prefill.inferredSteps).toEqual([]);
    expect(prefill.taxonomyRejected).toEqual([]);
    // null means "there was no page" — correct, because nothing was fetched.
    expect(prefill.dishImage).toBeNull();
  });
});
