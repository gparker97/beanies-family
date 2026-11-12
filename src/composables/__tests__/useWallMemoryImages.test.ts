/**
 * useWallMemoryImages: the slideshow's overnight loader (#140), with fake timers.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { effectScope, nextTick, ref, type EffectScope } from 'vue';
import type { SlidePhoto } from '@/utils/wallSlideshow';

const h = vi.hoisted(() => ({
  online: { value: true } as { value: boolean },
  photos: {} as Record<string, { driveFileId: string; deletedAt?: string }>,
  markUnresolved: vi.fn(),
  logEvent: vi.fn(),
}));

vi.mock('@/composables/useOnline', async () => {
  const { ref: vueRef } = await import('vue');
  const online = vueRef(true);
  h.online = online;
  return { useOnline: () => ({ isOnline: online }) };
});
vi.mock('@/services/telemetry/logEvent', () => ({ logEvent: h.logEvent }));
vi.mock('@/stores/photoStore', () => ({
  usePhotoStore: () => ({
    photos: h.photos,
    markUnresolved: h.markUnresolved,
    getPublicUrl: (id: string, size: string, opts?: { ignoreUnresolved?: boolean }) => {
      if (!opts?.ignoreUnresolved) throw new Error('loader must ignore unresolved');
      // eslint-disable-next-line security/detect-object-injection -- test fixture
      const p = h.photos[id];
      return p && !p.deletedAt ? `https://img/${p.driveFileId}=${size}` : null;
    },
  }),
}));

import {
  useWallMemoryImages,
  WALL_IMAGE_GIVE_UP_AFTER,
  WALL_IMAGE_QUICK_RETRY_MS,
} from '@/composables/useWallMemoryImages';
import { WALL_SLIDESHOW_DECK_MAX } from '@/utils/wallSlideshow';

const MIN = 60_000;

function photo(id: string): SlidePhoto {
  return { kind: 'photo', photoId: id, memberId: null, source: 'avatar' };
}

function img(decode: () => Promise<void> = () => Promise.resolve()): HTMLImageElement {
  return { decode } as unknown as HTMLImageElement;
}

let scope: EffectScope;
const deck = ref<SlidePhoto[]>([]);

function setup(list: string[]) {
  // eslint-disable-next-line security/detect-object-injection -- test fixture ids
  for (const id of list) h.photos[id] = { driveFileId: `drive-${id}` };
  deck.value = list.map(photo);
  scope = effectScope();
  return scope.run(() => useWallMemoryImages(deck))!;
}

function failedEvents() {
  return h.logEvent.mock.calls.filter(([e]) => e.message === 'wall_slideshow_image_failed');
}

beforeEach(() => {
  vi.useFakeTimers();
  h.online.value = true;
  // eslint-disable-next-line security/detect-object-injection -- test fixture ids
  for (const k of Object.keys(h.photos)) delete h.photos[k];
  h.logEvent.mockClear();
  h.markUnresolved.mockClear();
});

afterEach(() => {
  scope?.stop();
  vi.useRealTimers();
});

describe('useWallMemoryImages', () => {
  it('mounts every deck photo at the screen size and marks loaded ones ready', async () => {
    const images = setup(['a', 'b']);
    expect(images.mounted.value.map((m) => m.url)).toEqual([
      'https://img/drive-a=screen',
      'https://img/drive-b=screen',
    ]);
    await images.onLoad('a', img());
    expect(images.ready.value.has('a')).toBe(true);
    expect(images.settled.value).toBe(false);
    await images.onLoad('b', img());
    expect(images.settled.value).toBe(true);
    expect(failedEvents()).toHaveLength(0);
  });

  it('retries once quickly, then on the backoff ladder', async () => {
    const images = setup(['a']);
    images.onError('a');
    expect(images.mounted.value[0]!.renderKey).toBe(0);
    vi.advanceTimersByTime(WALL_IMAGE_QUICK_RETRY_MS);
    expect(images.mounted.value[0]!.renderKey).toBe(1);
    images.onError('a');
    vi.advanceTimersByTime(4 * MIN);
    expect(images.mounted.value[0]!.renderKey).toBe(1);
    vi.advanceTimersByTime(MIN);
    expect(images.mounted.value[0]!.renderKey).toBe(2);
    expect(images.retries.value).toBe(2);
    expect(images.failedCount.value).toBe(1);
  });

  it('logs one summary per pass, not one per photo', () => {
    const images = setup(['a', 'b', 'c']);
    images.onError('a');
    images.onError('b');
    expect(failedEvents()).toHaveLength(0);
    images.onError('c');
    expect(failedEvents()).toHaveLength(1);
    expect(failedEvents()[0]![0]).toMatchObject({
      level: 'warn',
      surface: 'wall-slideshow',
      context: {
        file_count: 3,
        stage: 'load',
        kind: 'avatar',
        file_id_tail: '…ve-a',
        online: true,
      },
    });
  });

  it('waits while offline, then retries at once when the device comes back', async () => {
    const images = setup(['a']);
    h.online.value = false;
    await nextTick();
    images.onError('a');
    vi.advanceTimersByTime(2 * 60 * MIN);
    expect(images.mounted.value[0]!.renderKey).toBe(0);
    h.online.value = true;
    await nextTick();
    expect(images.mounted.value[0]!.renderKey).toBe(1);
    expect(images.failedCount.value).toBe(0);
  });

  it('online transition clears the ladder so the next failure retries quickly', async () => {
    const images = setup(['a']);
    images.onError('a');
    vi.advanceTimersByTime(WALL_IMAGE_QUICK_RETRY_MS);
    images.onError('a'); // now on the 5 minute step
    h.online.value = false;
    await nextTick();
    h.online.value = true;
    await nextTick();
    expect(images.mounted.value[0]!.renderKey).toBe(2);
    images.onError('a');
    vi.advanceTimersByTime(WALL_IMAGE_QUICK_RETRY_MS);
    expect(images.mounted.value[0]!.renderKey).toBe(3);
  });

  it('counts a decode rejection after load as ready, logged with stage decode', async () => {
    const images = setup(['a']);
    await images.onLoad(
      'a',
      img(() => Promise.reject(new Error('EncodingError')))
    );
    expect(images.ready.value.has('a')).toBe(true);
    expect(failedEvents()).toHaveLength(1);
    expect(failedEvents()[0]![0].context).toMatchObject({ file_count: 1, stage: 'decode' });
  });

  it('drops a photo that leaves the deck, ready or failed', async () => {
    const images = setup(['a', 'b']);
    await images.onLoad('a', img());
    images.onError('b');
    deck.value = [];
    await nextTick();
    expect(images.ready.value.has('a')).toBe(false);
    expect(images.mounted.value).toEqual([]);
    vi.advanceTimersByTime(WALL_IMAGE_QUICK_RETRY_MS);
    expect(images.retries.value).toBe(0);
  });

  it('never marks a photo unresolved', () => {
    const images = setup(['a']);
    for (let i = 0; i < 4; i++) {
      images.onError('a');
      vi.advanceTimersByTime(60 * MIN);
    }
    expect(h.markUnresolved).not.toHaveBeenCalled();
  });

  it('takes the deck from the front of the candidates', () => {
    const ids = Array.from({ length: WALL_SLIDESHOW_DECK_MAX + 3 }, (_, i) => `p${i}`);
    const images = setup(ids);
    expect(images.deck.value.map((p) => p.photoId)).toEqual(ids.slice(0, WALL_SLIDESHOW_DECK_MAX));
  });

  it('gives a bad photo up after its second failure following a good load, and hands its slot on', async () => {
    const ids = Array.from({ length: WALL_SLIDESHOW_DECK_MAX + 1 }, (_, i) => `p${i}`);
    const images = setup(ids);
    const spare = ids.at(-1)!;
    images.onError('p0'); // first failure: no evidence yet
    await images.onLoad('p1', img()); // the network works
    images.onError('p0');
    expect(images.givenUp.value.size).toBe(0);
    vi.advanceTimersByTime(WALL_IMAGE_QUICK_RETRY_MS * 100);
    images.onError('p0');
    await nextTick();
    expect(WALL_IMAGE_GIVE_UP_AFTER).toBe(2);
    expect(images.givenUp.value).toEqual(new Set(['p0']));
    const deckIds = images.mounted.value.map((m) => m.photoId);
    expect(deckIds).not.toContain('p0');
    expect(deckIds).toContain(spare);
    expect(deckIds).toHaveLength(WALL_SLIDESHOW_DECK_MAX);
    expect(h.logEvent.mock.calls.map(([e]) => e.message)).toContain(
      'wall_slideshow_image_given_up'
    );
  });

  it('a network-wide outage with Wi-Fi up gives nothing up and keeps the backoff', async () => {
    const ids = Array.from({ length: WALL_SLIDESHOW_DECK_MAX + 4 }, (_, i) => `p${i}`);
    const images = setup(ids);
    const deckBefore = images.mounted.value.map((m) => m.photoId);
    for (let round = 0; round < 6; round++) {
      for (const m of images.mounted.value) images.onError(m.photoId);
      vi.advanceTimersByTime(4 * 60 * MIN);
    }
    await nextTick();
    expect(images.givenUp.value.size).toBe(0);
    expect(images.mounted.value.map((m) => m.photoId)).toEqual(deckBefore);
    expect(h.logEvent.mock.calls.map(([e]) => e.message)).not.toContain(
      'wall_slideshow_image_given_up'
    );
    // Still on the ladder: after a failure, nothing retries before the quick retry is due.
    const before = images.retries.value;
    images.onError('p0');
    vi.advanceTimersByTime(WALL_IMAGE_QUICK_RETRY_MS - 1);
    expect(images.retries.value).toBe(before);
  });

  it('a photo that errors after it was ready stops being ready and is retried', async () => {
    const images = setup(['a']);
    await images.onLoad('a', img());
    images.onError('a');
    expect(images.ready.value.has('a')).toBe(false);
    vi.advanceTimersByTime(WALL_IMAGE_QUICK_RETRY_MS);
    expect(images.mounted.value[0]!.renderKey).toBe(1);
  });

  it("a photo's own good load is no evidence against it later", async () => {
    const ids = Array.from({ length: WALL_SLIDESHOW_DECK_MAX + 1 }, (_, i) => `p${i}`);
    const images = setup(ids);
    images.onError('p0'); // a first failure, then it loads on the retry
    await images.onLoad('p0', img());
    // Later the network dies with Wi-Fi up: nothing else has loaded since.
    for (let i = 0; i < 4; i++) images.onError('p0');
    expect(images.givenUp.value.size).toBe(0);
  });

  it('never counts an offline failure towards giving up', async () => {
    const images = setup(['a', 'b']);
    h.online.value = false;
    await nextTick();
    for (let i = 0; i < 5; i++) images.onError('a');
    expect(images.givenUp.value.size).toBe(0);
  });

  it('keeps a given-up photo retrying when no candidate is left to take its slot', async () => {
    const images = setup(['a', 'b']);
    images.onError('a');
    await images.onLoad('b', img());
    images.onError('a');
    vi.advanceTimersByTime(WALL_IMAGE_QUICK_RETRY_MS);
    images.onError('a');
    await nextTick();
    expect(images.givenUp.value.has('a')).toBe(true);
    expect(images.mounted.value.map((m) => m.photoId)).toEqual(['b', 'a']);
    const key = images.mounted.value[1]!.renderKey;
    vi.advanceTimersByTime(60 * MIN);
    expect(images.mounted.value[1]!.renderKey).toBe(key + 1);
  });

  it('clears every timer when its scope is disposed', () => {
    const images = setup(['a', 'b']);
    images.onError('a');
    images.onError('b');
    expect(vi.getTimerCount()).toBe(2);
    scope.stop();
    expect(vi.getTimerCount()).toBe(0);
  });
});
