/**
 * The sleep slideshow's pool, deck and fallback rules (#140). What sits in which slot is
 * pinned in `wallSlideshowSlots.test.ts`.
 */
import { describe, it, expect } from 'vitest';
import {
  buildSlideshowPool,
  compareNightOrder,
  slideshowDeck,
  slideshowFallback,
  WALL_SLIDESHOW_DECK_MAX,
  type SlidePhoto,
  type SlidePhotoCandidate,
  type SlideshowFrame,
  type SlideshowPool,
  type SlideText,
} from '@/utils/wallSlideshow';
import { DEFAULT_WALL_MEMORIES } from '@/utils/wallMemories';
import type { ScrapbookEntry } from '@/composables/useScrapbookFeed';
import type { Milestone, ScrapType, WallMemoriesSettings } from '@/types/models';

const SEED = '2026-11-12';

function settingsWith(show: Partial<Record<ScrapType, boolean>> = {}): WallMemoriesSettings {
  return { ...DEFAULT_WALL_MEMORIES, show: { ...DEFAULT_WALL_MEMORIES.show, ...show } };
}

function milestone(id: string, memberId: string | null, photoIds: string[]): ScrapbookEntry {
  const payload = { id, memberId, title: `title-${id}`, photoIds } as unknown as Milestone;
  return {
    id,
    type: 'milestone',
    memberId,
    effectiveDate: '2026-11-01',
    createdAt: '2026-11-01T00:00:00Z',
    payload,
  };
}

function text(id: string, type: 'favorite' | 'saying' | 'note', memberId: string): ScrapbookEntry {
  return {
    id,
    type,
    memberId,
    effectiveDate: '2026-11-01T00:00:00Z',
    createdAt: '2026-11-01T00:00:00Z',
    payload: { id } as unknown as ScrapbookEntry['payload'],
  };
}

const imageOnly =
  (pdfs: string[] = []) =>
  (id: string) =>
    !pdfs.includes(id);

function pool(
  overrides: Partial<Parameters<typeof buildSlideshowPool>[0]> = {}
): ReturnType<typeof buildSlideshowPool> {
  return buildSlideshowPool({
    settings: settingsWith(),
    entries: [],
    avatars: [],
    dishes: [],
    isImage: imageOnly(),
    seed: SEED,
    ...overrides,
  });
}

const ids = (photos: SlidePhoto[]) => photos.map((p) => p.photoId);

describe('buildSlideshowPool', () => {
  it('takes every milestone photo with its title, avatars and dishes', () => {
    const avatars: SlidePhotoCandidate[] = [{ photoId: 'av1', memberId: 'm1' }];
    const dishes: SlidePhotoCandidate[] = [{ photoId: 'd1', memberId: null, caption: 'Pancakes' }];
    const p = pool({ entries: [milestone('ms1', 'm1', ['p1', 'p2'])], avatars, dishes });
    expect(ids(p.photos).sort()).toEqual(['av1', 'd1', 'p1', 'p2']);
    const p1 = p.photos.find((x) => x.photoId === 'p1')!;
    expect(p1).toMatchObject({ source: 'milestone', memberId: 'm1', caption: 'title-ms1' });
    expect(p.photos.find((x) => x.photoId === 'av1')).toMatchObject({ source: 'avatar' });
    expect(p.photos.find((x) => x.photoId === 'd1')).toMatchObject({
      source: 'dish',
      caption: 'Pancakes',
    });
  });

  it('keeps PDFs out of all three sources', () => {
    const p = pool({
      entries: [milestone('ms1', 'm1', ['pdf1', 'p1'])],
      avatars: [{ photoId: 'pdf2', memberId: 'm1' }],
      dishes: [{ photoId: 'pdf3', memberId: null }],
      isImage: imageOnly(['pdf1', 'pdf2', 'pdf3']),
    });
    expect(ids(p.photos)).toEqual(['p1']);
  });

  it('keeps one entry per photo id, the milestone winning', () => {
    const p = pool({
      entries: [milestone('ms1', 'm1', ['p1', 'p1'])],
      avatars: [{ photoId: 'p1', memberId: 'm1' }],
      dishes: [{ photoId: 'p1', memberId: null }],
    });
    expect(p.photos).toHaveLength(1);
    expect(p.photos[0]!.source).toBe('milestone');
  });

  it('keeps every candidate: the deck is cut later, once loadability is known', () => {
    const many = Array.from({ length: 30 }, (_, i) => `p${i}`);
    expect(pool({ entries: [milestone('ms1', 'm1', many)] }).photos).toHaveLength(30);
  });

  it('orders by the seed: the same seed twice, a different order for another', () => {
    const many = Array.from({ length: 30 }, (_, i) => `p${i}`);
    const entries = [milestone('ms1', 'm1', many)];
    const a = ids(pool({ entries }).photos);
    expect(ids(pool({ entries }).photos)).toEqual(a);
    expect(ids(pool({ entries: [milestone('ms1', 'm1', [...many].reverse())] }).photos)).toEqual(a);
    expect(ids(pool({ entries, seed: '2026-11-13' }).photos)).not.toEqual(a);
  });

  it('has no photos with photos switched off, but keeps texts', () => {
    const p = pool({
      settings: settingsWith({ milestone: false }),
      entries: [milestone('ms1', 'm1', ['p1']), text('f1', 'favorite', 'm1')],
      avatars: [{ photoId: 'av1', memberId: 'm1' }],
      dishes: [{ photoId: 'd1', memberId: null }],
    });
    expect(p.photos).toEqual([]);
    expect(p.texts.map((t) => t.entry.id)).toEqual(['f1']);
  });

  it('keeps only the enabled text types', () => {
    const entries = [
      text('f1', 'favorite', 'm1'),
      text('s1', 'saying', 'm1'),
      text('n1', 'note', 'm1'),
    ];
    const p = pool({ settings: settingsWith({ saying: false }), entries });
    expect(p.texts.map((t) => t.entry.id).sort()).toEqual(['f1', 'n1']);
    expect(p.texts.every((t) => t.kind === 'text')).toBe(true);
  });

  it('is empty with all four types off', () => {
    const p = pool({
      settings: settingsWith({ milestone: false, favorite: false, saying: false, note: false }),
      entries: [milestone('ms1', 'm1', ['p1']), text('f1', 'favorite', 'm1')],
      avatars: [{ photoId: 'av1', memberId: 'm1' }],
    });
    expect(p).toEqual({ photos: [], texts: [] });
  });
});

describe('slideshowDeck', () => {
  const candidates = Array.from({ length: 20 }, (_, i) => ({ photoId: `p${i}` }));
  const deckIds = (given: string[]) =>
    slideshowDeck(candidates, new Set(given)).map((c) => c.photoId);

  it('is the first DECK_MAX candidates', () => {
    expect(deckIds([])).toEqual(candidates.slice(0, WALL_SLIDESHOW_DECK_MAX).map((c) => c.photoId));
  });

  it("gives a given-up photo's slot to the next candidate, keeping the order", () => {
    const ids = deckIds(['p3']);
    expect(ids).toHaveLength(WALL_SLIDESHOW_DECK_MAX);
    expect(ids).not.toContain('p3');
    expect(ids.slice(0, 4)).toEqual(['p0', 'p1', 'p2', 'p4']);
    expect(ids.at(-1)).toBe(`p${WALL_SLIDESHOW_DECK_MAX}`);
  });

  it('keeps given-up photos at the back when the candidates run out', () => {
    const few = [{ photoId: 'a' }, { photoId: 'b' }, { photoId: 'c' }];
    expect(slideshowDeck(few, new Set(['a'])).map((c) => c.photoId)).toEqual(['b', 'c', 'a']);
  });
});

function photo(id: string, memberId: string | null = null): SlidePhoto {
  return { kind: 'photo', photoId: id, memberId, source: 'milestone' };
}

function slideText(id: string, memberId: string): SlideText {
  return { kind: 'text', memberId, entry: text(id, 'note', memberId) as SlideText['entry'] };
}

const P: SlideshowPool = {
  photos: ['a', 'b', 'c'].map((id) => photo(id)),
  texts: ['t1', 't2'].map((id) => slideText(id, 'm1')),
};

describe('compareNightOrder', () => {
  it('is the order the pool uses, and depends on the ids alone', () => {
    const many = Array.from({ length: 30 }, (_, i) => `p${i}`);
    const p = pool({ entries: [milestone('ms1', 'm1', many)] });
    const sorted = [...many].sort((a, b) => compareNightOrder(SEED, a, b));
    expect(ids(p.photos)).toEqual(sorted);
    expect(compareNightOrder(SEED, 'p1', 'p1')).toBe(0);
  });

  it('stamps a milestone photo with its milestone', () => {
    const p = pool({ entries: [milestone('ms1', 'm1', ['p1', 'p2'])] });
    expect(p.photos.map((ph) => ph.entryId)).toEqual(['ms1', 'ms1']);
  });
});

const photoFrame: SlideshowFrame = {
  layout: 'around',
  photos: [{ slot: 'p1', piece: photo('a') }],
  texts: [],
};
const textOnly: SlideshowFrame = {
  layout: 'around',
  photos: [],
  texts: [{ slot: 'p1', piece: slideText('t1', 'm1') }],
};

describe('slideshowFallback', () => {
  const base = { pool: P, settings: settingsWith(), error: false, settled: true };

  it('is null for mode off and for a photo frame', () => {
    expect(slideshowFallback({ ...base, mode: 'off', frame: { layout: 'plain' } })).toBeNull();
    expect(slideshowFallback({ ...base, mode: 'around', frame: photoFrame })).toBeNull();
  });

  it('names the reason', () => {
    expect(slideshowFallback({ ...base, mode: 'around', frame: textOnly })).toEqual({
      kind: 'text-only',
      reason: 'none-ready',
    });
    expect(
      slideshowFallback({ ...base, mode: 'around', frame: textOnly, settled: false })
    ).toBeNull();
    expect(
      slideshowFallback({
        ...base,
        mode: 'full',
        frame: { layout: 'plain' },
        pool: { photos: [], texts: [] },
      })
    ).toEqual({ kind: 'plain', reason: 'no-photos' });
    expect(
      slideshowFallback({
        ...base,
        mode: 'full',
        frame: { layout: 'plain' },
        settings: settingsWith({ milestone: false }),
      })
    ).toEqual({ kind: 'plain', reason: 'types-off' });
    expect(
      slideshowFallback({ ...base, mode: 'around', frame: { layout: 'plain' }, error: true })
    ).toEqual({ kind: 'plain', reason: 'error' });
  });
});
