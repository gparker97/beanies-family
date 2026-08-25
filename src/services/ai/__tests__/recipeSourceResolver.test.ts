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
      description: 'Full recipe: https://nanabakes.example/lemon-drizzle',
      captions: 'first cream the butter then add the eggs',
      ...over,
    });

  it('RUNG 2 wins: follows a recipe link in the description before touching captions', async () => {
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

  it('a DEAD link falls through to captions rather than aborting the capture', async () => {
    const fetchService = svc({
      fetchYoutube: vi.fn().mockResolvedValue(video()),
      fetchPage: vi.fn().mockResolvedValue(fail('fetch_failed')),
    });
    const r = await resolveRecipeSource('https://youtu.be/dQw4w9WgXcQ', { fetchService });
    if (r.kind !== 'text') throw new Error('expected captions fallback');
    expect(r.path).toBe('youtube_captions');
  });

  it('RUNG 3: captions carry the harvested context, not just the transcript', async () => {
    const fetchService = svc({
      fetchYoutube: vi.fn().mockResolvedValue(video({ description: 'no links here' })),
    });
    const r = await resolveRecipeSource('https://youtu.be/dQw4w9WgXcQ', { fetchService });
    if (r.kind !== 'text') throw new Error('expected text');
    expect(r.text).toContain('Best Lemon Cake');
    expect(r.text).toContain('Nana Bakes');
    expect(r.text).toContain('no links here');
    expect(r.text).toContain('first cream the butter');
  });

  it('RUNG 4: REFUSES when there are no captions and no link — writes nothing', async () => {
    // The headline behaviour greg asked for: never reconstruct a recipe from a title.
    const fetchService = svc({
      fetchYoutube: vi.fn().mockResolvedValue(video({ captions: null, description: 'like & sub' })),
    });
    const r = await resolveRecipeSource('https://youtu.be/dQw4w9WgXcQ', { fetchService });
    expect(r).toEqual({ kind: 'refusal', reason: 'no_transcript_no_link' });
  });

  it('ignores social/affiliate links so they cannot burn the fetch budget', async () => {
    const fetchPage = vi.fn();
    const fetchService = svc({
      fetchYoutube: vi.fn().mockResolvedValue(
        video({
          description: 'https://instagram.com/nana https://amzn.to/xyz https://patreon.com/nana',
          captions: 'transcript here',
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
