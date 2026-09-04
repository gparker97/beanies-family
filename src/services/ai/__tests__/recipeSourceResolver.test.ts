import { describe, it, expect, vi } from 'vitest';
import { resolveRecipeSource } from '../recipeSourceResolver';
import type { RecipeFetchService } from '../recipeFetchService';

/**
 * The ladder's logic lives here rather than in the composable precisely so it can be tested
 * with ONE mocked service and no Vue, no Pinia and no toast harness. Every rung and every
 * fall-through is exercised, including the refusal — the outcome that must write nothing.
 */

const JSONLD = {
  name: 'Lemon Drizzle',
  subtitle: '',
  prepTime: '20 mins',
  cookTime: '45 mins',
  servings: 'Serves 8',
  ingredients: ['225g butter'],
  steps: ['Bake it.'],
  imageUrl: 'https://site.example/cake.jpg',
};

const ok = <T>(data: T) => ({ success: true as const, data });
const fail = (errorCode: string) => ({ success: false as const, errorCode: errorCode as never });

function svc(over: Partial<RecipeFetchService> = {}): RecipeFetchService {
  return {
    fetchPage: vi.fn().mockResolvedValue(fail('provider_error')),
    fetchYoutube: vi.fn().mockResolvedValue(fail('provider_error')),
    fetchImage: vi.fn().mockResolvedValue(fail('provider_error')),
    ...over,
  } as RecipeFetchService;
}

describe('page urls', () => {
  it('returns jsonld when the site publishes structured data — model never invoked', async () => {
    const fetchService = svc({
      fetchPage: vi
        .fn()
        .mockResolvedValue(
          ok({ kind: 'jsonld', recipe: JSONLD, finalUrl: 'https://site.example/r' })
        ),
    });
    const r = await resolveRecipeSource('https://site.example/r', { fetchService });
    expect(r.kind).toBe('jsonld');
    if (r.kind !== 'jsonld') throw new Error('unreachable');
    expect(r.path).toBe('jsonld');
    expect(r.recipe.ingredients).toEqual(['225g butter']);
    expect(r.sourceUrl).toBe('https://site.example/r');
  });

  it('falls back to page text when there is no jsonld, and prepends the title', async () => {
    const fetchService = svc({
      fetchPage: vi.fn().mockResolvedValue(
        ok({
          kind: 'text',
          text: 'body text',
          title: 'Nana Cake',
          imageUrl: '',
          finalUrl: 'https://site.example/r',
        })
      ),
    });
    const r = await resolveRecipeSource('https://site.example/r', { fetchService });
    if (r.kind !== 'text') throw new Error('expected text');
    expect(r.path).toBe('page_text');
    // The reduced page usually loses the <h1>, so the title is worth carrying.
    expect(r.text).toBe('Nana Cake\n\nbody text');
  });

  it('propagates a fetch failure as a typed failure, not a refusal', async () => {
    const fetchService = svc({ fetchPage: vi.fn().mockResolvedValue(fail('fetch_blocked')) });
    const r = await resolveRecipeSource('https://site.example/r', { fetchService });
    expect(r).toEqual({ kind: 'failed', errorCode: 'fetch_blocked' });
  });
});

describe('url screening happens before any fetch', () => {
  it.each([
    'javascript:' + '//%0aalert(1)',
    'http' + '://insecure.example/r',
    'data:text/html,x',
    'not a url',
    'https://www.youtube.com/@somechannel', // a channel, not a video
  ])('refuses %s without calling out', async (bad) => {
    const fetchService = svc();
    const r = await resolveRecipeSource(bad, { fetchService });
    expect(r).toEqual({ kind: 'refusal', reason: 'not_a_recipe_url' });
    expect(fetchService.fetchPage).not.toHaveBeenCalled();
    expect(fetchService.fetchYoutube).not.toHaveBeenCalled();
  });
});

describe('the youtube ladder', () => {
  const video = (over: Record<string, unknown> = {}) =>
    ok({
      videoId: 'dQw4w9WgXcQ',
      title: 'Best Lemon Cake',
      channel: 'Nana Bakes',
      // Long enough to clear MIN_DESCRIPTION_CHARS, so tests exercise the rung they name
      // rather than tripping the refusal threshold by accident.
      description:
        'Full recipe: https://nanabakes.example/lemon-drizzle\n' + 'ingredient. '.repeat(30),
      ...over,
    });

  it('RUNG 2 wins: follows a recipe link before falling back to the description', async () => {
    // The best outcome — exact quantities from the blog's markup, zero inference.
    const fetchPage = vi
      .fn()
      .mockResolvedValue(
        ok({ kind: 'jsonld', recipe: JSONLD, finalUrl: 'https://nanabakes.example/lemon-drizzle' })
      );
    const fetchService = svc({ fetchYoutube: vi.fn().mockResolvedValue(video()), fetchPage });
    const r = await resolveRecipeSource('https://youtu.be/dQw4w9WgXcQ', { fetchService });
    if (r.kind !== 'jsonld') throw new Error('expected jsonld');
    expect(r.path).toBe('youtube_link_followed');
    expect(fetchPage).toHaveBeenCalledWith('https://nanabakes.example/lemon-drizzle', undefined);
  });

  it('a DEAD link falls through to the description rather than aborting the capture', async () => {
    const fetchService = svc({
      fetchYoutube: vi.fn().mockResolvedValue(video()),
      fetchPage: vi.fn().mockResolvedValue(fail('fetch_failed')),
    });
    const r = await resolveRecipeSource('https://youtu.be/dQw4w9WgXcQ', { fetchService });
    if (r.kind !== 'text') throw new Error('expected description fallback');
    expect(r.path).toBe('youtube_description');
  });

  it('RUNG 3: the description carries the harvested context, not just the raw text', async () => {
    const fetchService = svc({
      fetchYoutube: vi
        .fn()
        .mockResolvedValue(
          video({ description: 'no links here. ' + 'flour and sugar. '.repeat(20) })
        ),
    });
    const r = await resolveRecipeSource('https://youtu.be/dQw4w9WgXcQ', { fetchService });
    if (r.kind !== 'text') throw new Error('expected text');
    expect(r.path).toBe('youtube_description');
    expect(r.text).toContain('Best Lemon Cake');
    expect(r.text).toContain('Nana Bakes');
    expect(r.text).toContain('no links here');
  });

  it('RUNG 4: a boilerplate description falls back to the TITLE, and only the title', async () => {
    // The original rule stands — never RECONSTRUCT a recipe from a title. This carries the
    // title across as a name with the link, and nothing else: no ingredients, no steps, no
    // guessing. The user finishes it while they watch, instead of losing the capture.
    const fetchService = svc({
      fetchYoutube: vi.fn().mockResolvedValue(video({ description: 'like & sub' })),
    });
    const r = await resolveRecipeSource('https://youtu.be/dQw4w9WgXcQ', { fetchService });
    expect(r).toEqual({
      kind: 'titleOnly',
      title: 'Best Lemon Cake',
      sourceUrl: 'https://youtu.be/dQw4w9WgXcQ',
      path: 'youtube_description',
      // The video thumbnail is the ONLY image this rung can ever have — there is no page to
      // read — and it used to be hard-coded empty, so the one capture with no alternative
      // was also the one guaranteed to end up pictureless (#86). Two rungs, because
      // `maxresdefault` 404s below 720p while `hqdefault` always exists; the attach ladder
      // falls through the first for free.
      imageCandidates: [
        { url: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/maxresdefault.jpg', source: 'youtube_thumb' },
        { url: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg', source: 'youtube_thumb' },
      ],
    });
  });

  it('RUNG 5: with no title EITHER, it still refuses — the fallback invents nothing', async () => {
    // The floor under rung 4. A blank title must not become a blank-named recipe.
    const fetchService = svc({
      fetchYoutube: vi.fn().mockResolvedValue(video({ title: '   ', description: 'like & sub' })),
    });
    const r = await resolveRecipeSource('https://youtu.be/dQw4w9WgXcQ', { fetchService });
    expect(r).toEqual({ kind: 'refusal', reason: 'no_text_no_link' });
  });

  it('a description too short to hold a recipe is never sent to the model', async () => {
    // Guards the threshold itself: 199 chars of prose must not become a model call whose
    // only possible answer is "not a recipe". Falling back to the title costs no call.
    const fetchService = svc({
      fetchYoutube: vi.fn().mockResolvedValue(video({ description: 'a'.repeat(199) })),
    });
    const r = await resolveRecipeSource('https://youtu.be/dQw4w9WgXcQ', { fetchService });
    expect(r.kind).toBe('titleOnly');
  });

  it('ignores social/affiliate links so they cannot burn the fetch budget', async () => {
    const fetchPage = vi.fn();
    const fetchService = svc({
      fetchYoutube: vi.fn().mockResolvedValue(
        video({
          description:
            'https://instagram.com/nana https://amzn.to/xyz https://patreon.com/nana ' +
            'and here is the actual method. '.repeat(10),
        })
      ),
      fetchPage,
    });
    const r = await resolveRecipeSource('https://youtu.be/dQw4w9WgXcQ', { fetchService });
    expect(fetchPage).not.toHaveBeenCalled();
    expect(r.kind).toBe('text');
  });

  it('caps outbound calls per capture', async () => {
    // Budget = 3. A YouTube capture uses watch + one link; nothing may exceed that.
    const fetchPage = vi.fn().mockResolvedValue(fail('fetch_failed'));
    const fetchService = svc({
      fetchYoutube: vi
        .fn()
        .mockResolvedValue(
          video({ description: 'https://a.example/r1 https://b.example/r2 https://c.example/r3' })
        ),
      fetchPage,
    });
    await resolveRecipeSource('https://youtu.be/dQw4w9WgXcQ', { fetchService });
    // Only the FIRST link is followed — not one call per link.
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });
});

describe('the imageUrl compatibility shim works in BOTH deploy directions (#86)', () => {
  // The Lambda-side shim protected old-client/new-Lambda. This is the other direction, which
  // matters because both deploy workflows are manual and the client ships separately: a
  // client that lands first, or a Lambda rolled back, would otherwise log
  // `image_none / no_candidates` on every capture — indistinguishable in CloudWatch from a
  // page that genuinely declared nothing, the one diagnosis this issue exists to enable.
  it('falls back to imageUrl when a pre-#86 Lambda sends no candidates', async () => {
    const fetchService = svc({
      fetchPage: vi.fn().mockResolvedValue({
        success: true,
        data: {
          kind: 'text',
          text: 'x'.repeat(400),
          title: 'Cake',
          imageUrl: 'https://cdn.test/legacy.jpg',
          finalUrl: 'https://food.test/cake',
        },
      }),
    });
    const r = await resolveRecipeSource('https://food.test/cake', { fetchService });
    expect(r).toMatchObject({
      kind: 'text',
      imageCandidates: [{ url: 'https://cdn.test/legacy.jpg', source: 'other' }],
    });
  });

  it('prefers candidates when both are present, and tolerates an empty list', async () => {
    const page = (over: object) => ({
      success: true,
      data: {
        kind: 'text',
        text: 'x'.repeat(400),
        title: 'Cake',
        finalUrl: 'https://food.test/cake',
        ...over,
      },
    });
    const both = await resolveRecipeSource('https://food.test/cake', {
      fetchService: svc({
        fetchPage: vi.fn().mockResolvedValue(
          page({
            imageCandidates: [{ url: 'https://cdn.test/new.jpg', source: 'og_image' }],
            imageUrl: 'https://cdn.test/legacy.jpg',
          })
        ),
      }),
    });
    expect(both).toMatchObject({
      imageCandidates: [{ url: 'https://cdn.test/new.jpg', source: 'og_image' }],
    });

    // An EMPTY candidates array is a real answer ("the page declared nothing") and must not
    // fall back to the shim, or that outcome becomes unobservable again.
    const empty = await resolveRecipeSource('https://food.test/cake', {
      fetchService: svc({
        fetchPage: vi
          .fn()
          .mockResolvedValue(
            page({ imageCandidates: [], imageUrl: 'https://cdn.test/legacy.jpg' })
          ),
      }),
    });
    expect(empty).toMatchObject({ imageCandidates: [] });
  });
});
