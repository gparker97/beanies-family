/**
 * useWallSlideshow: the stores-to-frame wiring of the sleep slideshow (#140).
 *
 * The pool rules are pinned in `utils/__tests__/wallSlideshow.test.ts` and the slot state in
 * `wallSlideshowSlots.test.ts`; this file pins the night's seed, the reactive pool, the
 * fill / tick wiring, the error path and the telemetry.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { effectScope, nextTick, type EffectScope } from 'vue';
import type { ScrapbookEntry } from '@/composables/useScrapbookFeed';
import type { Milestone, UUID, WallMemoriesSettings } from '@/types/models';
import { DEFAULT_WALL_MEMORIES } from '@/utils/wallMemories';

interface State {
  entries: { value: ScrapbookEntry[] };
  family: { members: { id: string; avatarPhotoId?: string }[]; boom: boolean };
  recipes: { recipes: { id: string; name: string; photoIds?: string[] }[] };
  photos: { photos: Record<string, { driveFileId: string; mime?: string; deletedAt?: string }> };
  settings: { wallMemories: WallMemoriesSettings };
}

const h = vi.hoisted(() => ({
  state: {} as State,
  feedArgs: [] as unknown[],
  tick: null as null | (() => void),
  intervalMs: 0,
  logEvent: vi.fn(),
  reportError: vi.fn(),
  recordPerf: vi.fn(),
  tickThrows: false,
}));

vi.mock('@/utils/wallSlideshowSlots', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/wallSlideshowSlots')>();
  return {
    ...actual,
    tickSlides: (...args: Parameters<typeof actual.tickSlides>) => {
      if (h.tickThrows) throw new Error('tick boom');
      return actual.tickSlides(...args);
    },
  };
});

vi.mock('@/composables/useScrapbookFeed', async () => {
  const { ref } = await import('vue');
  h.state.entries = ref<ScrapbookEntry[]>([]);
  return {
    useScrapbookFeed: (opts: unknown) => {
      h.feedArgs.push(opts);
      return { entries: h.state.entries };
    },
  };
});
vi.mock('@/stores/familyStore', async () => {
  const { reactive } = await import('vue');
  const list = reactive({ members: [] as State['family']['members'], boom: false });
  h.state.family = list;
  return {
    useFamilyStore: () => ({
      get members() {
        if (list.boom) throw new Error('boom');
        return list.members;
      },
    }),
  };
});
vi.mock('@/stores/recipesStore', async () => {
  const { reactive } = await import('vue');
  h.state.recipes = reactive({ recipes: [] });
  return { useRecipesStore: () => h.state.recipes };
});
vi.mock('@/stores/photoStore', async () => {
  const { reactive } = await import('vue');
  const store = reactive({ photos: {} as State['photos']['photos'] });
  h.state.photos = store;
  return {
    usePhotoStore: () => ({
      get photos() {
        return store.photos;
      },
      getPublicUrl: (id: string) => {
        // eslint-disable-next-line security/detect-object-injection -- test fixture
        const p = store.photos[id];
        return p && !p.deletedAt ? `https://img/${p.driveFileId}` : null;
      },
    }),
  };
});
vi.mock('@/stores/settingsStore', async () => {
  const { reactive } = await import('vue');
  h.state.settings = reactive({ wallMemories: { ...DEFAULT_WALL_MEMORIES } });
  return { useSettingsStore: () => h.state.settings };
});
vi.mock('@/composables/usePollWhileVisible', () => ({
  usePollWhileVisible: (cb: () => void, ms: number) => {
    h.tick = cb;
    h.intervalMs = ms;
    return { stop: () => {} };
  },
}));
vi.mock('@/composables/useOnline', async () => {
  const { ref } = await import('vue');
  return { useOnline: () => ({ isOnline: ref(true) }) };
});
vi.mock('@/services/telemetry/logEvent', () => ({ logEvent: h.logEvent }));
vi.mock('@/utils/errorReporter', () => ({ reportError: h.reportError }));
vi.mock('@/utils/perfTiming', () => ({ record: h.recordPerf }));

import { useWallSlideshow } from '@/composables/useWallSlideshow';
import { buildSlideshowPool, WALL_SLIDESHOW_DECK_MAX } from '@/utils/wallSlideshow';
import type { SlideshowShape } from '@/utils/wallSlideshow';

let scope: EffectScope;

function milestone(id: string, photoIds: string[]): ScrapbookEntry {
  const payload = { id, memberId: 'm1', title: id, photoIds } as unknown as Milestone;
  return {
    id,
    type: 'milestone',
    memberId: 'm1',
    effectiveDate: '2026-11-01',
    createdAt: '2026-11-01T00:00:00Z',
    payload,
  };
}

function note(id: string): ScrapbookEntry {
  return {
    id,
    type: 'note',
    memberId: 'm1',
    effectiveDate: '2026-11-01T00:00:00Z',
    createdAt: '2026-11-01T00:00:00Z',
    payload: { id } as unknown as ScrapbookEntry['payload'],
  };
}

function addPhotos(ids: string[], mime = 'image/jpeg'): void {
  // eslint-disable-next-line security/detect-object-injection -- test fixture ids
  for (const id of ids) h.state.photos.photos[id] = { driveFileId: `drive-${id}`, mime };
}

function start(shape?: SlideshowShape) {
  scope = effectScope();
  return scope.run(() => useWallSlideshow({ shape }))!;
}

function events(message: string) {
  return h.logEvent.mock.calls.map(([e]) => e).filter((e) => e.message === message);
}

const deckIds = (s: ReturnType<typeof start>) => s.deck.value.map((d) => d.photoId);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 10, 12, 22, 0));
  h.state.entries.value = [];
  h.state.family.members = [{ id: 'm1' }];
  h.state.family.boom = false;
  h.state.recipes.recipes = [];
  h.state.photos.photos = {};
  h.state.settings.wallMemories = { ...DEFAULT_WALL_MEMORIES };
  h.feedArgs.length = 0;
  h.logEvent.mockClear();
  h.reportError.mockClear();
  h.recordPerf.mockClear();
  h.tickThrows = false;
});

afterEach(() => {
  scope?.stop();
  vi.useRealTimers();
});

describe('useWallSlideshow', () => {
  it('asks the feed for every type over the whole roster', () => {
    start();
    const opts = h.feedArgs[0] as { memberIds: () => UUID[]; contentTypes: { value: Set<string> } };
    expect(opts.memberIds()).toEqual(['m1']);
    expect(opts.contentTypes.value.size).toBe(0);
  });

  it('gathers avatars and the first dish photo, PDFs excluded', () => {
    addPhotos(['av1', 'd1']);
    addPhotos(['pdf1'], 'application/pdf');
    h.state.family.members = [{ id: 'm1', avatarPhotoId: 'av1' }];
    h.state.recipes.recipes = [
      { id: 'r1', name: 'Pancakes', photoIds: ['d1'] },
      { id: 'r2', name: 'Menu', photoIds: ['pdf1', 'av1'] },
    ];
    const s = start();
    expect(deckIds(s).sort()).toEqual(['av1', 'd1']);
  });

  it('keeps the seed of the night it started when the date changes', async () => {
    const many = Array.from({ length: 30 }, (_, i) => `p${i}`);
    addPhotos(many);
    h.state.entries.value = [milestone('ms1', many)];
    const s = start();
    const order = (seed: string) =>
      buildSlideshowPool({
        settings: DEFAULT_WALL_MEMORIES,
        entries: h.state.entries.value,
        avatars: [],
        dishes: [],
        isImage: () => true,
        seed,
      })
        .photos.slice(0, WALL_SLIDESHOW_DECK_MAX)
        .map((p) => p.photoId);
    expect(order('2026-11-12')).not.toEqual(order('2026-11-13'));

    vi.setSystemTime(new Date(2026, 10, 13, 1, 0));
    h.state.entries.value = [milestone('ms1', many)]; // force a recompute after midnight
    await nextTick();
    expect(deckIds(s)).toEqual(order('2026-11-12'));
  });

  it('drops a photo tombstoned elsewhere on the next recompute', async () => {
    addPhotos(['p1', 'p2']);
    h.state.entries.value = [milestone('ms1', ['p1', 'p2'])];
    const s = start();
    expect(deckIds(s).sort()).toEqual(['p1', 'p2']);
    h.state.photos.photos.p1!.deletedAt = '2026-11-12T23:00:00Z';
    await nextTick();
    expect(deckIds(s)).toEqual(['p2']);
  });

  it('shows ready photos and logs ready once the first pass settles', async () => {
    addPhotos(['p1', 'p2']);
    h.state.entries.value = [milestone('ms1', ['p1', 'p2'])];
    const s = start();
    expect(events('wall_slideshow_start')[0]).toMatchObject({
      context: { kind: 'around', format: 'medium', file_count: 2, detail: 'speed=medium' },
    });
    await s.images.onLoad('p1', {} as HTMLImageElement);
    s.images.onError('p2');
    await nextTick();
    expect(s.frame.value).toMatchObject({
      layout: 'around',
      photos: [{ slot: 'p1', piece: { photoId: 'p1' } }],
    });
    expect(events('wall_slideshow_ready')).toEqual([
      expect.objectContaining({ context: { file_count: 1, detail: 'failed=1' } }),
    ]);
    expect(h.recordPerf).toHaveBeenCalledWith('wall_slideshow_preload', expect.any(Number));
  });

  it('logs a fallback only when its layout or reason changes, never for mode off', async () => {
    h.state.entries.value = [note('n1')];
    const s = start();
    await nextTick();
    expect(s.frame.value.layout).toBe('around');
    for (let i = 0; i < 3; i++) h.tick!();
    await nextTick();
    expect(events('wall_slideshow_fallback')).toEqual([
      expect.objectContaining({
        level: 'warn',
        context: { kind: 'text-only', detail: 'no-photos', online: true },
      }),
    ]);

    // A text that leaves the pool stays up until the next rotation replaces it.
    h.state.entries.value = [];
    await nextTick();
    expect(events('wall_slideshow_fallback')).toHaveLength(1);
    h.tick!();
    await nextTick();
    expect(events('wall_slideshow_fallback')).toHaveLength(2);
    expect(events('wall_slideshow_fallback')[1]!.context).toMatchObject({
      kind: 'plain',
      detail: 'no-photos',
    });

    h.state.settings.wallMemories = { ...DEFAULT_WALL_MEMORIES, slideshow: 'off' };
    await nextTick();
    expect(s.frame.value).toEqual({ layout: 'plain' });
    expect(events('wall_slideshow_fallback')).toHaveLength(2);
  });

  it('a throwing pool shows the plain face and reports', async () => {
    h.state.family.boom = true;
    const s = start();
    expect(s.frame.value).toEqual({ layout: 'plain' });
    expect(h.reportError).toHaveBeenCalledWith(
      expect.objectContaining({ surface: 'wall-slideshow', severity: 'error' })
    );
    await nextTick();
    expect(events('wall_slideshow_fallback')[0]!.context).toMatchObject({
      kind: 'plain',
      detail: 'error',
    });
  });

  it.each([
    ['slow', 60_000, 60],
    ['medium', 30_000, 120],
    ['fast', 15_000, 240],
  ] as const)(
    'at %s speed rotates every %i ms and beats progress about hourly (every %i rotations)',
    (speed, ms, every) => {
      h.state.settings.wallMemories = { ...DEFAULT_WALL_MEMORIES, speed };
      start();
      expect(h.intervalMs).toBe(ms);
      expect(events('wall_slideshow_start')[0]!.context.detail).toBe(`speed=${speed}`);
      for (let i = 0; i < every * 2 + 5; i++) h.tick!();
      expect(events('wall_slideshow_progress').map((e) => e.context.detail)).toEqual([
        `rotations=${every}`,
        `rotations=${every * 2}`,
      ]);
      scope.stop();
      expect(events('wall_slideshow_end')[0]!.context).toEqual({
        detail: `rotations=${every * 2 + 5};retries=0;given_up=0`,
      });
    }
  );

  it('defaults to the medium speed, 30 s a rotation', () => {
    start();
    expect(h.intervalMs).toBe(30_000);
  });

  it('reports a persistent pool failure once a night, however often it recomputes', async () => {
    h.state.family.boom = true;
    const s = start();
    for (let i = 0; i < 3; i++) {
      h.state.entries.value = [note(`n${i}`)];
      await nextTick();
      expect(s.frame.value).toEqual({ layout: 'plain' });
    }
    expect(h.reportError).toHaveBeenCalledTimes(1);
  });

  it('a photo that loads mid-rotation fills a free slot, and the rotation moves nothing showing', async () => {
    addPhotos(['p1', 'p2', 'p3']);
    h.state.entries.value = [
      milestone('ms1', ['p1']),
      milestone('ms2', ['p2']),
      milestone('ms3', ['p3']),
    ];
    const s = start();
    const slots = () =>
      s.frame.value.layout === 'around'
        ? Object.fromEntries(s.frame.value.photos.map((p) => [p.slot, p.piece.photoId]))
        : {};
    const order = deckIds(s);
    await s.images.onLoad(order[2]!, {} as HTMLImageElement);
    await s.images.onLoad(order[0]!, {} as HTMLImageElement);
    expect(slots()).toEqual({ p1: order[2], p2: order[0] });
    await s.images.onLoad(order[1]!, {} as HTMLImageElement);
    expect(slots()).toEqual({ p1: order[2], p2: order[0], p3: order[1] });
    h.tick!();
    await nextTick();
    expect(slots()).toEqual({ p1: order[2], p2: order[0], p3: order[1] });
  });

  it('a photo that errors after showing leaves the frame at once', async () => {
    addPhotos(['p1', 'p2']);
    h.state.entries.value = [milestone('ms1', ['p1']), milestone('ms2', ['p2'])];
    const s = start();
    await s.images.onLoad('p1', {} as HTMLImageElement);
    await s.images.onLoad('p2', {} as HTMLImageElement);
    s.images.onError('p1');
    if (s.frame.value.layout !== 'around') throw new Error('expected around');
    expect(s.frame.value.photos.map((p) => p.piece.photoId)).toEqual(['p2']);
  });

  it('a rotation step that throws reports once, goes plain, and recovers when one works', () => {
    h.state.entries.value = [note('n1')];
    const s = start();
    expect(s.frame.value.layout).toBe('around');
    h.tickThrows = true;
    h.tick!();
    h.tick!();
    expect(s.frame.value).toEqual({ layout: 'plain' });
    expect(h.reportError).toHaveBeenCalledTimes(1);
    expect(h.reportError.mock.calls[0]![0]).toMatchObject({
      message: 'slideshow rotation failed',
      severity: 'error',
    });
    h.tickThrows = false;
    h.tick!();
    expect(s.frame.value.layout).toBe('around');
  });

  it('fills four slots on a portrait wall, the last one a text memory', async () => {
    const ids = ['p1', 'p2', 'p3', 'p4', 'p5'];
    addPhotos(ids);
    h.state.entries.value = [...ids.map((id) => milestone(`ms-${id}`, [id])), note('n1')];
    const s = start('portrait');
    for (const id of ids) await s.images.onLoad(id, {} as HTMLImageElement);
    if (s.frame.value.layout !== 'around') throw new Error('expected around');
    expect(s.frame.value.photos.map((p) => p.slot)).toEqual(['p1', 'p2', 'p3']);
    expect(s.frame.value.texts.map((t) => t.slot)).toEqual(['p4']);
  });
});
