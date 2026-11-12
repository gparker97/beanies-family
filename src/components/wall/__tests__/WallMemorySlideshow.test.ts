/**
 * The slideshow's error boundary and stage (#140): a throw anywhere below leaves the night
 * face plain, and the deck's `<img>` elements are mounted once and never remounted by rotation.
 */
/* eslint-disable security/detect-object-injection -- fixtures index tiles by position */
import { flushPromises, mount } from '@vue/test-utils';
import { computed, defineComponent, ref } from 'vue';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import WallMemorySlideshow from '../WallMemorySlideshow.vue';
import WallMemoryStage from '../WallMemoryStage.vue';
import WallMemoryPhoto, { type MemorySlot } from '../WallMemoryPhoto.vue';
import type { SlideshowFrame, SlidePhoto, SlideText, TileSlotId } from '@/utils/wallSlideshow';

const h = vi.hoisted(() => ({
  reportError: vi.fn(),
  throwInSetup: false,
  frame: null as unknown as { value: SlideshowFrame },
  deck: null as unknown as { value: unknown[] },
  onLoad: vi.fn(),
  onError: vi.fn(),
  options: null as null | { shape?: () => string },
}));

vi.mock('@/utils/errorReporter', () => ({ reportError: h.reportError }));
vi.mock('@/stores/familyStore', () => ({
  useFamilyStore: () => ({ members: [{ id: 'm1', name: 'Juno' }] }),
}));
vi.mock('@/composables/useWallSlideshow', () => ({
  useWallSlideshow: (options: { shape?: () => string }) => {
    h.options = options;
    if (h.throwInSetup) throw new Error('boom');
    return {
      frame: h.frame,
      deck: h.deck,
      images: { onLoad: h.onLoad, onError: h.onError },
      brightness: computed(() => ({ opacity: 0.62, saturation: 0.85 })),
      mode: ref('around'),
    };
  },
}));

function photo(id: string, caption?: string): SlidePhoto {
  return { kind: 'photo', photoId: id, memberId: 'm1', caption, source: 'milestone' };
}

function text(id: string): SlideText {
  return {
    kind: 'text',
    memberId: 'm1',
    entry: {
      id,
      type: 'saying',
      memberId: 'm1',
      effectiveDate: '2026-11-01T00:00:00Z',
      createdAt: '2026-11-01T00:00:00Z',
      payload: { id, words: `words ${id}` },
    } as unknown as SlideText['entry'],
  };
}

/** An around frame: photos in p1, p2, ... unless placed explicitly. */
function around(
  photos: (SlidePhoto | [TileSlotId, SlidePhoto])[],
  texts: [TileSlotId | 'n1' | 'n2', SlideText][] = []
): SlideshowFrame {
  return {
    layout: 'around',
    photos: photos.map((p, i) =>
      Array.isArray(p) ? { slot: p[0], piece: p[1] } : { slot: `p${i + 1}` as TileSlotId, piece: p }
    ),
    texts: texts.map(([slot, piece]) => ({ slot, piece })),
  };
}

function deckOf(...ids: string[]) {
  return ids.map((id) => ({
    photoId: id,
    source: 'milestone',
    url: `https://x/${id}`,
    renderKey: 0,
  }));
}

beforeEach(() => {
  h.reportError.mockReset();
  h.onLoad.mockReset();
  h.onError.mockReset();
  h.throwInSetup = false;
  h.frame = ref<SlideshowFrame>({ layout: 'plain' });
  h.deck = ref(deckOf('a', 'b', 'c'));
});

describe('WallMemorySlideshow (error boundary)', () => {
  it('reports a throwing stage, goes plain, renders nothing and does not rethrow', async () => {
    h.throwInSetup = true;
    const wrapper = mount(WallMemorySlideshow);
    await flushPromises();
    expect(h.reportError).toHaveBeenCalledTimes(1);
    expect(h.reportError.mock.calls[0]![0]).toMatchObject({
      surface: 'wall-slideshow',
      severity: 'error',
    });
    expect(wrapper.emitted('layout')!.at(-1)).toEqual(['plain']);
    expect(wrapper.find('.mem-stage').exists()).toBe(false);
  });

  it('re-emits the stage layout', async () => {
    h.frame = ref<SlideshowFrame>(around([photo('a')]));
    const wrapper = mount(WallMemorySlideshow);
    expect(wrapper.emitted('layout')![0]).toEqual(['around']);
    h.frame.value = { layout: 'full', photo: photo('b'), pins: [] };
    await flushPromises();
    expect(wrapper.emitted('layout')!.at(-1)).toEqual(['full']);
  });
});

describe('WallMemoryStage', () => {
  it('is hidden from assistive tech, brightness is set as custom properties', () => {
    const wrapper = mount(WallMemoryStage);
    const root = wrapper.get('.mem-stage');
    expect(root.attributes('aria-hidden')).toBe('true');
    expect(root.attributes('style')).toContain('--mem-opacity: 0.62');
    expect(root.attributes('style')).toContain('--mem-sat: 0.85');
  });

  it('mounts one img per deck photo and keeps the same element across frames', async () => {
    h.frame = ref<SlideshowFrame>(around([photo('a'), photo('b')]));
    const wrapper = mount(WallMemoryStage);
    const imgs = wrapper.findAll('img');
    expect(imgs).toHaveLength(3);
    expect(imgs.every((i) => i.attributes('referrerpolicy') === 'no-referrer')).toBe(true);
    expect(imgs.some((i) => i.attributes('loading'))).toBe(false);
    const before = imgs.map((i) => i.element);

    h.frame.value = around([photo('b'), photo('c')]);
    await flushPromises();
    h.frame.value = { layout: 'full', photo: photo('c', 'Sunday'), pins: [] };
    await flushPromises();
    const after = wrapper.findAll('img').map((i) => i.element);
    expect(after).toEqual(before);
    expect(wrapper.find('.mem-full-cap').text()).toBe('Sunday');
  });

  it('puts the photos in the frame in their slots and the others out of sight', () => {
    h.frame = ref<SlideshowFrame>(around([photo('a'), photo('b')]));
    const tiles = mount(WallMemoryStage).findAll('.mem-photo');
    expect(tiles[0]!.classes()).toEqual(expect.arrayContaining(['wall-mem-p1', 'is-visible']));
    expect(tiles[1]!.classes()).toEqual(expect.arrayContaining(['wall-mem-p2', 'is-visible']));
    expect(tiles[2]!.classes()).not.toContain('is-visible');
  });

  it('across a rotation, only the changed tile and the changed note fade; the rest stay put', async () => {
    vi.useFakeTimers();
    try {
      h.deck = ref(deckOf('a', 'b', 'c', 'd'));
      h.frame = ref<SlideshowFrame>(
        around(
          [photo('a'), photo('b'), photo('c')],
          [
            ['n1', text('s1')],
            ['n2', text('s2')],
          ]
        )
      );
      const wrapper = mount(WallMemoryStage);
      const tiles = () => wrapper.findAll('.mem-photo');
      const notes = () => wrapper.findAll('.mem-around .mem-slot');
      const imgsBefore = wrapper.findAll('img').map((i) => i.element);
      const noteS2 = notes().find((n) => n.classes().includes('wall-mem-n2'))!.element;
      const styleOf = (i: number) => tiles()[i]!.attributes('style');
      const before = [0, 1, 2].map(styleOf);

      // One rotation: p1 swaps 'a' for 'd', n1 swaps s1 for s3; b, c and s2 are unchanged.
      h.frame.value = around(
        [
          ['p1', photo('d')],
          ['p2', photo('b')],
          ['p3', photo('c')],
        ],
        [
          ['n1', text('s3')],
          ['n2', text('s2')],
        ]
      );
      await flushPromises();
      expect(wrapper.findAll('img').map((i) => i.element)).toEqual(imgsBefore);
      for (const i of [1, 2]) {
        expect(tiles()[i]!.classes()).toEqual(
          expect.arrayContaining([`wall-mem-p${i + 1}`, 'is-visible'])
        );
        expect(styleOf(i)).toBe(before[i]);
      }
      expect(tiles()[0]!.classes()).not.toContain('is-visible'); // 'a' fades out
      vi.advanceTimersByTime(1200);
      await flushPromises();
      expect(tiles()[3]!.classes()).toEqual(expect.arrayContaining(['wall-mem-p1', 'is-visible']));
      // The unchanged note is the same element; the changed one is new.
      const after = notes().filter((n) => n.classes().includes('wall-mem-n2'));
      expect(after.map((n) => n.element)).toEqual([noteS2]);
      expect(notes().some((n) => n.text().includes('words s3'))).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('a note drifts on its slot phase, whatever else is showing', async () => {
    h.frame = ref<SlideshowFrame>(around([], [['n2', text('s1')]]));
    const wrapper = mount(WallMemoryStage);
    const delay = () => wrapper.get('.wall-mem-n2').attributes('style');
    const first = delay();
    h.frame.value = around([photo('a'), photo('b')], [['n2', text('s1')]]);
    await flushPromises();
    expect(delay()).toBe(first);
  });

  it('passes load and error to the loader with the photo id', async () => {
    const wrapper = mount(WallMemoryStage);
    const imgs = wrapper.findAll('img');
    await imgs[1]!.trigger('load');
    expect(h.onLoad).toHaveBeenCalledWith('b', imgs[1]!.element);
    await imgs[2]!.trigger('error');
    expect(h.onError).toHaveBeenCalledWith('c');
  });

  it('emits the layout immediately and on change', async () => {
    const wrapper = mount(WallMemoryStage);
    expect(wrapper.emitted('layout')![0]).toEqual(['plain']);
    h.frame.value = { layout: 'full', photo: photo('a'), pins: [] };
    await flushPromises();
    expect(wrapper.emitted('layout')!.at(-1)).toEqual(['full']);
  });

  it("tells the frame the wall's shape, following the page's portrait signal", async () => {
    const wrapper = mount(WallMemorySlideshow, { props: { portrait: true } });
    expect(h.options!.shape!()).toBe('portrait');
    await wrapper.setProps({ portrait: false });
    expect(h.options!.shape!()).toBe('landscape');
  });

  it('has no pointer targets of its own', () => {
    const Host = defineComponent({
      components: { WallMemoryStage },
      template: '<WallMemoryStage />',
    });
    expect(mount(Host).get('.mem-stage').classes()).toContain('mem-stage');
  });
});

describe('WallMemoryPhoto', () => {
  type Place = MemorySlot | null;
  const tile = (place: Place) =>
    mount(WallMemoryPhoto, { props: { url: 'https://x/a', place, reduced: false } });
  const slotOf = (w: ReturnType<typeof tile>) =>
    w
      .get('.mem-photo')
      .classes()
      .find((c) => c.startsWith('wall-mem-'));

  it('fades out before moving, and a second move during the fade waits for it to end', async () => {
    vi.useFakeTimers();
    try {
      const w = tile('p1');
      await w.setProps({ place: 'p2' });
      expect(w.get('.mem-photo').classes()).not.toContain('is-visible');
      expect(slotOf(w)).toBe('wall-mem-p1');

      vi.advanceTimersByTime(600);
      await w.setProps({ place: 'p3' }); // mid-fade: must not jump while half visible
      expect(slotOf(w)).toBe('wall-mem-p1');
      expect(w.get('.mem-photo').classes()).not.toContain('is-visible');

      vi.advanceTimersByTime(600);
      await flushPromises();
      expect(slotOf(w)).toBe('wall-mem-p3');
      expect(w.get('.mem-photo').classes()).toContain('is-visible');
    } finally {
      vi.useRealTimers();
    }
  });

  it('a tile taken out and put back in another slot mid-fade also waits', async () => {
    vi.useFakeTimers();
    try {
      const w = tile('p1');
      await w.setProps({ place: null });
      vi.advanceTimersByTime(300);
      await w.setProps({ place: 'p2' });
      expect(slotOf(w)).toBe('wall-mem-p1');
      vi.advanceTimersByTime(900);
      await flushPromises();
      expect(slotOf(w)).toBe('wall-mem-p2');
    } finally {
      vi.useRealTimers();
    }
  });
});
