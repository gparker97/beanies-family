/**
 * The two link rules (#64 links).
 *
 * These were closures inside a 175-line function, which is why the share path could not
 * reach them and an early draft assumed they had to be rewritten. As pure functions they get
 * direct tests — and both carry a failure mode that is SILENT when wrong:
 *
 *  - `boundedDishImage` is the same-registrable-domain bound on a page-supplied image. Too
 *    loose and a hostile page names any host as its image; too tight and no dish photo ever
 *    appears.
 *  - `toShareLink` is the only place `pageUrl` and `provenanceUrl` are distinguished. Swap
 *    them and every video capture silently loses its photo, because the image is then
 *    screened against youtube.com.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { boundedDishImage, toShareLink } from '../shareLink';
import type { ShareLink } from '@/types/magicPayload';

const link = (over: Partial<ShareLink> = {}): ShareLink => ({
  pageUrl: 'https://cook.example.com/recipes/cake',
  provenanceUrl: 'https://cook.example.com/recipes/cake',
  imageUrl: '',
  path: 'page_text',
  kind: 'page',
  ...over,
});

describe('boundedDishImage', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('prefers the mapper value, which is already bounded against the same page', () => {
    const mapper = 'https://cook.example.com/img/cake.jpg';
    expect(boundedDishImage(link({ imageUrl: 'https://cook.example.com/other.jpg' }), mapper)).toBe(
      mapper
    );
  });

  it('falls back to the page image when it is on the same registrable domain', () => {
    const image = 'https://cdn.cook.example.com/cake.jpg';
    expect(boundedDishImage(link({ imageUrl: image }), null)).toBe(image);
  });

  it('REJECTS a page image from another domain, and says so', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(boundedDishImage(link({ imageUrl: 'https://evil.example.net/x.jpg' }), null)).toBeNull();
    // A rejection must be diagnosable: "this site never gets photos" is otherwise
    // indistinguishable from "this site has no photos".
    expect(warn).toHaveBeenCalled();
  });

  it('rejects a non-https image', () => {
    // The http:// URL is the POINT here: it must be rejected, not fetched.
    // eslint-disable-next-line @microsoft/sdl/no-insecure-url
    const insecure = 'http://cook.example.com/x.jpg';
    expect(boundedDishImage(link({ imageUrl: insecure }), null)).toBeNull();
  });

  it('returns null when there is nothing to use', () => {
    expect(boundedDishImage(link(), null)).toBeNull();
  });
});

describe('toShareLink', () => {
  const resolved = {
    path: 'page_text' as const,
    sourceUrl: 'https://cook.example.com/recipes/cake',
    imageUrl: 'https://cook.example.com/img/cake.jpg',
  };

  it('for a page, both URLs are the page', () => {
    const out = toShareLink(resolved, { kind: 'page', url: resolved.sourceUrl });
    expect(out.pageUrl).toBe(resolved.sourceUrl);
    expect(out.provenanceUrl).toBe(resolved.sourceUrl);
    expect(out.kind).toBe('page');
  });

  it('for a VIDEO, provenance is the video and pageUrl is the page we followed', () => {
    // This is the case that makes the two fields necessary. Getting it backwards screens the
    // blog's photo against youtube.com and silently drops it.
    const video = 'https://youtu.be/dQw4w9WgXcQ';
    const out = toShareLink(resolved, { kind: 'youtube', url: video });

    expect(out.provenanceUrl).toBe(video);
    expect(out.pageUrl).toBe(resolved.sourceUrl);
    expect(out.kind).toBe('youtube');

    // And the consequence, end to end: the followed blog's own image still passes the bound.
    expect(boundedDishImage(out, null)).toBe(resolved.imageUrl);
  });

  it('carries the extraction path through, so the rung is visible in telemetry', () => {
    expect(toShareLink(resolved, { kind: 'page' }).path).toBe('page_text');
  });
});
