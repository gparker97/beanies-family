/**
 * The Scrapbook page's photo tap (#154): a photo opens the page's one viewer through the
 * existing milestone lightbox, a bean's photo carries a button to that bean's page, a
 * family-wide photo carries none, and tapping the rest of a card still routes as before.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { shallowMount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { nextTick } from 'vue';
import FamilyScrapbookPage from '@/pages/FamilyScrapbookPage.vue';
import { useMilestoneLightbox } from '@/composables/useMilestoneLightbox';
import type { ScrapbookEntry } from '@/composables/useScrapbookFeed';

const { pushMock } = vi.hoisted(() => ({ pushMock: vi.fn() }));

vi.mock('vue-router', async (orig) => ({
  ...(await orig<typeof import('vue-router')>()),
  useRouter: () => ({ push: pushMock, replace: vi.fn() }),
  useRoute: () => ({ query: {}, params: {}, path: '/pod/scrapbook' }),
}));
vi.mock('@/services/telemetry/logEvent', () => ({ logEvent: vi.fn() }));
vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('@/stores/familyStore', () => {
  const members = [{ id: 'm1', name: 'Mia' }];
  return { useFamilyStore: () => ({ members, sortedMembers: members }) };
});

/** Draws the `#actions` slot while open, so the page's button can be found. */
const PhotoViewerStub = {
  name: 'PhotoViewer',
  props: { open: Boolean, photoIds: Array, initialIndex: Number, readOnly: Boolean },
  emits: ['close'],
  template: '<div v-if="open" class="viewer"><slot name="actions" /></div>',
};

function milestone(id: string, memberId: string | null, photoIds: string[]): ScrapbookEntry {
  return {
    id,
    type: 'milestone',
    memberId,
    effectiveDate: '2026-11-10',
    createdAt: '2026-11-10T12:00:00',
    payload: { id, title: id, photoIds },
  } as unknown as ScrapbookEntry;
}

const mountPage = () =>
  shallowMount(FamilyScrapbookPage, { global: { stubs: { PhotoViewer: PhotoViewerStub } } });

const pageButton = (w: ReturnType<typeof mountPage>) =>
  w.find('[data-test="scrapbook-photo-bean-page"]');

describe('FamilyScrapbookPage photo tap', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    localStorage.clear();
    pushMock.mockReset();
    useMilestoneLightbox().close();
  });

  it("a bean's photo opens the viewer with a button to that bean's page", async () => {
    const w = mountPage();
    const swim = milestone('swim', 'm1', ['p1', 'p2']);
    w.findComponent({ name: 'EveryoneSpread' }).vm.$emit('photo-click', swim);
    await nextTick();

    const viewer = w.findComponent({ name: 'PhotoViewer' });
    expect(viewer.props('open')).toBe(true);
    expect(viewer.props('photoIds')).toEqual(['p1', 'p2']);
    expect(viewer.props('readOnly')).toBe(true);
    expect(pushMock).not.toHaveBeenCalled();

    expect(pageButton(w).text()).toBe('scrapbook.photo.beanPage');
    await pageButton(w).trigger('click');
    expect(useMilestoneLightbox().isOpen.value).toBe(false);
    expect(pushMock).toHaveBeenCalledWith('/pod/m1/milestones');
  });

  it('a family-wide photo opens the viewer with no page button', async () => {
    const w = mountPage();
    w.findComponent({ name: 'EveryoneSpread' }).vm.$emit(
      'photo-click',
      milestone('move', null, ['p3'])
    );
    await nextTick();
    expect(w.findComponent({ name: 'PhotoViewer' }).props('open')).toBe(true);
    expect(pageButton(w).exists()).toBe(false);
  });

  it('the Timeline forwards a photo tap the same way', async () => {
    localStorage.setItem('beanies:scrapbookView', 'timeline');
    const w = mountPage();
    w.findComponent({ name: 'ScrapbookTimeline' }).vm.$emit(
      'photo-click',
      milestone('swim', 'm1', ['p1'])
    );
    await nextTick();
    expect(w.findComponent({ name: 'PhotoViewer' }).props('open')).toBe(true);
    expect(pageButton(w).exists()).toBe(true);
  });

  it("the rest of a bean's card still goes to the bean's page, with no viewer", async () => {
    const w = mountPage();
    w.findComponent({ name: 'EveryoneSpread' }).vm.$emit(
      'entry-click',
      milestone('swim', 'm1', ['p1'])
    );
    await nextTick();
    expect(pushMock).toHaveBeenCalledWith('/pod/m1/milestones');
    expect(w.findComponent({ name: 'PhotoViewer' }).props('open')).toBe(false);
  });

  it('closing the viewer forgets the tapped entry', async () => {
    const w = mountPage();
    w.findComponent({ name: 'EveryoneSpread' }).vm.$emit(
      'photo-click',
      milestone('swim', 'm1', ['p1'])
    );
    await nextTick();
    w.findComponent({ name: 'PhotoViewer' }).vm.$emit('close');
    await nextTick();
    expect(useMilestoneLightbox().isOpen.value).toBe(false);

    // A family-wide milestone card opens the same lightbox afterwards: no stale bean button.
    w.findComponent({ name: 'EveryoneSpread' }).vm.$emit(
      'entry-click',
      milestone('move', null, ['p3'])
    );
    await nextTick();
    expect(w.findComponent({ name: 'PhotoViewer' }).props('open')).toBe(true);
    expect(pageButton(w).exists()).toBe(false);
  });
});
