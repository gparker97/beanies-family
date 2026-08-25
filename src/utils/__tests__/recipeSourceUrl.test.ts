import { describe, it, expect } from 'vitest';
import { routeUrl, pickRecipeLinks } from '@/utils/recipeSourceUrl';

describe('routeUrl', () => {
  const ID = 'dQw4w9WgXcQ';

  it.each([
    `https://www.youtube.com/watch?v=${ID}`,
    `https://youtube.com/watch?v=${ID}&t=30s`,
    `https://youtu.be/${ID}`,
    `https://www.youtube.com/embed/${ID}`,
    `https://www.youtube.com/shorts/${ID}`,
    `https://m.youtube.com/watch?v=${ID}`,
  ])('routes %s to youtube', (u) => {
    const r = routeUrl(u);
    expect(r.kind).toBe('youtube');
    if (r.kind === 'youtube') expect(r.videoId).toBe(ID);
  });

  it('routes an ordinary recipe site to the page path', () => {
    const r = routeUrl('https://site.example/recipes/lemon-drizzle');
    expect(r.kind).toBe('page');
  });

  it('accepts a scheme-less domain by normalizing it to https', () => {
    const r = routeUrl('site.example/recipes/lemon');
    expect(r).toEqual({ kind: 'page', url: 'https://site.example/recipes/lemon' });
  });

  it('rejects a YouTube URL with no readable video id', () => {
    // A channel or playlist page has no recipe to read; saying so beats fetching it.
    expect(routeUrl('https://www.youtube.com/@nanabakes').kind).toBe('invalid');
    expect(routeUrl('https://www.youtube.com/playlist?list=PL123').kind).toBe('invalid');
  });

  it.each([
    'javascript:' + '//%0aalert(1)',
    'vbscript:' + '//x',
    'data:text/html,<script>alert(1)</script>',
    'http' + '://insecure.example/r',
    'https://user:pass@evil.example/r',
    'file:///etc/passwd',
    '',
    '   ',
  ])('rejects %s', (bad) => {
    expect(routeUrl(bad).kind).toBe('invalid');
  });
});

describe('pickRecipeLinks', () => {
  it('finds a recipe link in a description', () => {
    expect(pickRecipeLinks('Full recipe: https://nanabakes.example/lemon-drizzle')).toEqual([
      'https://nanabakes.example/lemon-drizzle',
    ]);
  });

  it('drops socials, affiliates and shorteners', () => {
    // A channel's boilerplate "follow me" block would otherwise burn the fetch budget
    // before the real recipe link is reached.
    const desc = `
      Follow me https://instagram.com/nana
      My gear https://amzn.to/xyz
      Support https://patreon.com/nana
      Short https://bit.ly/abc
      Recipe https://nanabakes.example/lemon
    `;
    expect(pickRecipeLinks(desc)).toEqual(['https://nanabakes.example/lemon']);
  });

  it('drops bare homepages with no path', () => {
    expect(pickRecipeLinks('see https://nanabakes.example')).toEqual([]);
  });

  it('drops non-https links rather than upgrading them silently', () => {
    const insecure = 'http' + '://nanabakes.example/lemon';
    expect(pickRecipeLinks(`recipe ${insecure}`)).toEqual([]);
  });

  it('dedupes and preserves order', () => {
    const d = 'https://a.example/r1 then https://b.example/r2 then https://a.example/r1';
    expect(pickRecipeLinks(d)).toEqual(['https://a.example/r1', 'https://b.example/r2']);
  });

  it('returns [] for empty input', () => {
    expect(pickRecipeLinks('')).toEqual([]);
    expect(pickRecipeLinks('no links at all here')).toEqual([]);
  });
});
