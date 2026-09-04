/**
 * The two link rules (#64 links, reshaped by #86).
 *
 * These were closures inside a 175-line function, which is why the share path could not
 * reach them and an early draft assumed they had to be rewritten. As pure functions they get
 * direct tests — and both carry a failure mode that is SILENT when wrong:
 *
 *  - `screenCandidates` decides which page-declared images may be fetched at all, and is
 *    also the defensive normaliser for an unchecked `body as T` cast. Too loose and a
 *    hostile value reaches a server-side fetch; too strict — in particular, rejecting an
 *    unfamiliar `source` — and a Lambda-first deploy silently drops every candidate.
 *  - `toShareLink` is the only place `pageUrl` and `provenanceUrl` are distinguished. Swap
 *    them and a video capture stores the wrong provenance.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screenCandidates, toShareLink } from '../shareLink';
import type { ImageCandidate } from '@/types/magicPayload';

const candidate = (url: string, source = 'og_image'): unknown => ({ url, source });

describe('screenCandidates', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('keeps well-formed candidates in order', () => {
    const raw = [
      candidate('https://cdn.test/a.jpg', 'jsonld'),
      candidate('https://cdn.test/b.jpg'),
    ];
    expect(screenCandidates(raw)).toEqual([
      { url: 'https://cdn.test/a.jpg', source: 'jsonld' },
      { url: 'https://cdn.test/b.jpg', source: 'og_image' },
    ]);
  });

  it('THE FIX: keeps an image on a third-party CDN', () => {
    // The same-registrable-domain bound this replaced dropped exactly this shape, which is
    // how nearly every real recipe site serves its photos. See the module docblock for why
    // removing the bound is safe rather than merely convenient.
    const raw = [candidate('https://cdn.sndimg.com/hero.jpg')];
    expect(screenCandidates(raw)).toEqual([
      { url: 'https://cdn.sndimg.com/hero.jpg', source: 'og_image' },
    ]);
  });

  it('KEEPS a candidate with an unrecognised source, relabelled `other`', () => {
    // Load-bearing for the deploy order. The Lambda ships ahead of the client, so a rung the
    // server learns first must not have its candidates discarded on-device — that would be
    // the same silent-drop class this whole issue exists to remove.
    const raw = [candidate('https://cdn.test/new.jpg', 'a_rung_from_the_future')];
    expect(screenCandidates(raw)).toEqual([{ url: 'https://cdn.test/new.jpg', source: 'other' }]);
  });

  it('rejects a non-https candidate, and says so', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    // The http:// URL is the POINT here: it must be rejected, not fetched.
    // eslint-disable-next-line @microsoft/sdl/no-insecure-url
    expect(screenCandidates([candidate('http://cook.example.com/x.jpg')])).toEqual([]);
    // A rejection must be diagnosable: "this site never gets photos" is otherwise
    // indistinguishable from "this site has no photos".
    expect(warn).toHaveBeenCalled();
  });

  it('rejects javascript: and data: URLs', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(screenCandidates([candidate('javascript:alert(1)')])).toEqual([]);
    expect(screenCandidates([candidate('data:image/png;base64,AAAA')])).toEqual([]);
  });

  it('NEVER THROWS on a malformed or absent field', () => {
    // This runs inside a Vue watch callback with no catch above it, on a value that arrives
    // through an unchecked `body as T` cast. A throw here is a broken capture, not a log line.
    expect(screenCandidates(undefined)).toEqual([]);
    expect(screenCandidates(null)).toEqual([]);
    expect(screenCandidates('not an array')).toEqual([]);
    expect(screenCandidates({})).toEqual([]);
    expect(screenCandidates([null, undefined, 42, 'x'])).toEqual([]);
    expect(screenCandidates([{ url: 42, source: 'og_image' }])).toEqual([]);
    expect(screenCandidates([{ source: 'og_image' }])).toEqual([]);
  });

  it('filters the bad and keeps the good from the same list', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const raw = [
      { url: 42 },
      candidate('https://cdn.test/good.jpg'),
      candidate('javascript:alert(1)'),
    ];
    expect(screenCandidates(raw)).toEqual([
      { url: 'https://cdn.test/good.jpg', source: 'og_image' },
    ]);
  });
});

describe('toShareLink', () => {
  const candidates: ImageCandidate[] = [
    { url: 'https://cook.example.com/img/cake.jpg', source: 'og_image' },
  ];
  const resolved = {
    path: 'page_text' as const,
    sourceUrl: 'https://cook.example.com/recipes/cake',
    imageCandidates: candidates,
  };

  it('for a page, both URLs are the page', () => {
    const out = toShareLink(resolved, { kind: 'page', url: resolved.sourceUrl });
    expect(out.pageUrl).toBe(resolved.sourceUrl);
    expect(out.provenanceUrl).toBe(resolved.sourceUrl);
    expect(out.kind).toBe('page');
  });

  it('for a VIDEO, provenance is the video and pageUrl is the page we followed', () => {
    // This is the case that makes the two fields necessary: the user chose the video, so
    // that is what we store, while the page we actually read is the blog behind it.
    const video = 'https://youtu.be/dQw4w9WgXcQ';
    const out = toShareLink(resolved, { kind: 'youtube', url: video });

    expect(out.provenanceUrl).toBe(video);
    expect(out.pageUrl).toBe(resolved.sourceUrl);
    expect(out.kind).toBe('youtube');
  });

  it('carries the candidates through', () => {
    expect(toShareLink(resolved, { kind: 'page' }).imageCandidates).toEqual(candidates);
  });

  it('carries the extraction path through, so the rung is visible in telemetry', () => {
    expect(toShareLink(resolved, { kind: 'page' }).path).toBe('page_text');
  });

  it('an empty candidate list is preserved, not turned into a missing page', () => {
    // `[]` means "we read a page and it declared nothing" — a loggable outcome, distinct
    // from having had no page at all. See DishImagePrefill.
    const out = toShareLink({ ...resolved, imageCandidates: [] }, { kind: 'page' });
    expect(out.imageCandidates).toEqual([]);
  });
});
