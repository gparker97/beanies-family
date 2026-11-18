/**
 * WallMemoriesViewer: the family scrapbook on the wall. Pins its two close paths, its empty
 * states (and that it says WHY it is empty), focus on open, and that every open starts on
 * everyone.
 */
import { mount } from '@vue/test-utils';
import { computed } from 'vue';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import WallMemoriesViewer from '../WallMemoriesViewer.vue';
import { __resetEscapeCloseForTests, escapeLayerCount } from '@/composables/useEscapeClose';
import type { ScrapbookEntry, ScrapType } from '@/composables/useScrapbookFeed';
import type { FamilyMember } from '@/types/models';

const { entriesRef } = vi.hoisted(() => ({ entriesRef: { value: [] as unknown[] } }));

vi.mock('@/composables/useScrapbookFeed', () => ({
  useScrapbookFeed: () => ({
    entries: {
      get value() {
        return entriesRef.value;
      },
    },
  }),
}));
vi.mock('@/stores/familyStore', () => ({
  useFamilyStore: () => ({ members: [{ id: 'm1' }, { id: 'm2' }] }),
}));
vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key, currentLanguage: computed(() => 'en') }),
}));
vi.mock('@/composables/useMemberAvatar', () => ({
  useMemberAvatarBindings: () => ({ memberAvatarBindings: () => ({}) }),
}));
vi.mock('@/utils/errorReporter', () => ({ reportError: vi.fn() }));
const { logEventMock } = vi.hoisted(() => ({ logEventMock: vi.fn() }));
vi.mock('@/services/telemetry/logEvent', () => ({ logEvent: logEventMock }));
vi.mock('@/stores/photoStore', () => ({
  usePhotoStore: () => ({
    photos: {},
    isUnresolved: () => false,
    getPublicUrl: (id: string) => `https://example.test/${id}`,
    markUnresolved: vi.fn(),
  }),
}));
vi.mock('@/utils/deliverFile', () => ({ deliverFile: vi.fn() }));
vi.mock('@/utils/pdfRender', () => ({ pdfToPageImages: vi.fn() }));

const beans = [
  { id: 'm1', name: 'Leo' },
  { id: 'm2', name: 'Mia' },
] as FamilyMember[];
const ALL = new Set<ScrapType>(['milestone', 'favorite', 'saying', 'note']);

function favorite(id: string, memberId: string): ScrapbookEntry {
  return {
    id,
    type: 'favorite',
    memberId,
    effectiveDate: '2026-11-05',
    createdAt: '2026-11-05T12:00:00',
    payload: { id, name: id } as unknown as ScrapbookEntry['payload'],
  };
}

function mountViewer(types: ReadonlySet<ScrapType> = ALL) {
  return mount(WallMemoriesViewer, {
    props: { beans, types },
    attachTo: document.body,
    global: { stubs: { BeanieAvatar: true, ScrapbookPiece: true } },
  });
}

/** A bare piece whose photo emits `photo-click`, as the real one does with `photoPress`. */
const PhotoPieceStub = {
  name: 'ScrapbookPiece',
  props: {
    entry: Object,
    photoPress: Boolean,
    noteIndex: Number,
    emphasizePhoto: Boolean,
    photoSize: String,
  },
  emits: ['photo-click'],
  template:
    '<button v-if="photoPress" class="photo" :data-id="entry.id" @click="$emit(\'photo-click\', entry)" />',
};
const BaseModalStub = {
  name: 'BaseModal',
  props: ['open'],
  template: '<div v-if="open" class="photo-modal"><slot /><slot name="footer" /></div>',
};

function milestone(id: string, photoIds: string[]): ScrapbookEntry {
  return {
    id,
    type: 'milestone',
    memberId: 'm1',
    effectiveDate: '2026-11-06',
    createdAt: '2026-11-06T12:00:00',
    payload: { id, title: id, photoIds } as unknown as ScrapbookEntry['payload'],
  };
}

/** `realModal`: keep the real BaseModal, which is what puts the photo on the Escape stack. */
function mountWithPhotos({ realModal = false } = {}) {
  return mount(WallMemoriesViewer, {
    props: { beans, types: ALL },
    attachTo: document.body,
    global: {
      stubs: {
        BeanieAvatar: true,
        BeanieIcon: true,
        BeanieSpinner: true,
        ScrapbookPiece: PhotoPieceStub,
        ...(realModal ? {} : { BaseModal: BaseModalStub }),
      },
    },
  });
}

const closeButton = (w: ReturnType<typeof mountViewer>) =>
  w.findAll('button').find((b) => b.text() === 'action.close')!;

beforeEach(() => {
  setActivePinia(createPinia());
  __resetEscapeCloseForTests();
  entriesRef.value = [favorite('f1', 'm1'), favorite('f2', 'm2')];
});

describe('WallMemoriesViewer', () => {
  it('is a labelled modal dialog and puts focus on Close', () => {
    const w = mountViewer();
    const dialog = w.find('[role="dialog"]');
    expect(dialog.attributes('aria-modal')).toBe('true');
    expect(dialog.attributes('aria-label')).toBe('wall.memories.title');
    expect(document.activeElement).toBe(closeButton(w).element);
    w.unmount();
  });

  it('closes with "button" on the Close button', async () => {
    const w = mountViewer();
    await closeButton(w).trigger('click');
    expect(w.emitted('close')).toEqual([['button']]);
    w.unmount();
  });

  it('closes with "escape" on Escape', () => {
    const w = mountViewer();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(w.emitted('close')).toEqual([['escape']]);
    w.unmount();
  });

  it('every open starts on everyone, even after a bean was picked last time', async () => {
    const first = mountViewer();
    const mia = first.find('[role="group"]').findAll('button')[2]!;
    await mia.trigger('click');
    expect(mia.attributes('aria-pressed')).toBe('true');
    expect(first.find('h2').text()).toBe('wall.memories.titleFor');
    first.unmount();

    const second = mountViewer();
    const pressed = second
      .find('[role="group"]')
      .findAll('button')
      .map((b) => b.attributes('aria-pressed'));
    expect(pressed).toEqual(['true', 'false', 'false']);
    expect(second.find('h2').text()).toBe('wall.memories.title');
    second.unmount();
  });

  it('has nothing to edit, add or open: only the bean row, the rail and Close are buttons', () => {
    const w = mountViewer();
    // Everyone + 2 beans, 1 month on the rail, Close.
    expect(w.findAll('button')).toHaveLength(5);
    expect(w.find('a').exists()).toBe(false);
    w.unmount();
  });

  it('all types off: says to turn one on, and reports types-off', () => {
    const w = mountViewer(new Set());
    expect(w.text()).toContain('wall.memories.empty.typesOff');
    expect(w.emitted('empty')).toEqual([['types-off']]);
    w.unmount();
  });

  it('no memories yet: says so, and reports no-entries', () => {
    entriesRef.value = [];
    const w = mountViewer();
    expect(w.text()).toContain('wall.memories.empty.noEntries');
    expect(w.emitted('empty')).toEqual([['no-entries']]);
    w.unmount();
  });

  it('with memories: reports nothing', () => {
    const w = mountViewer();
    expect(w.emitted('empty')).toBeUndefined();
    w.unmount();
  });

  it("a photo tap opens the photo viewer, read-only, with that memory's photos, and logs it", async () => {
    entriesRef.value = [milestone('swim', ['p1', 'p2', 'p3'])];
    const w = mountWithPhotos();
    expect(w.find('.photo-modal').exists()).toBe(false);

    await w.find('.photo').trigger('click');
    const viewer = w.findComponent({ name: 'PhotoViewer' });
    expect(viewer.props('open')).toBe(true);
    expect(viewer.props('photoIds')).toEqual(['p1', 'p2', 'p3']);
    expect(viewer.props('readOnly')).toBe(true);
    // No link off the wall: nothing in the viewer's actions slot.
    expect(w.find('.photo-modal a').exists()).toBe(false);
    expect(logEventMock).toHaveBeenCalledWith({
      level: 'info',
      surface: 'beanie-wall',
      message: 'wall_memories_photo',
      context: { kind: 'open' },
    });
    w.unmount();
  });

  it('one Escape closes only the photo; the next closes the scrapbook', async () => {
    entriesRef.value = [milestone('swim', ['p1'])];
    const w = mountWithPhotos({ realModal: true });
    const viewer = w.findComponent({ name: 'PhotoViewer' });
    const scrapbookOnly = escapeLayerCount();
    await w.find('.photo').trigger('click');
    expect(viewer.props('open')).toBe(true);
    // The photo is one more layer, not two.
    expect(escapeLayerCount()).toBe(scrapbookOnly + 1);

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await w.vm.$nextTick();
    expect(viewer.props('open')).toBe(false);
    expect(escapeLayerCount()).toBe(scrapbookOnly);
    expect(w.emitted('close')).toBeUndefined();

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(w.emitted('close')).toEqual([['escape']]);
    w.unmount();
  });
});
