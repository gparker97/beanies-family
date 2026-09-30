/**
 * Who Owns What at phone width (`useBreakpoint().isMobile`, mocked `matchMedia`): the
 * decorative tagline row is gone and its ＋ and ⋯ render in the controls row, in the order
 * toggle, ＋, Share, ⋯. The phone copies are `v-if`, never CSS-hidden, so exactly ONE
 * `who-owns-what-add` and ONE `OverflowMenu` are mounted at either width.
 */
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { enableAutoUnmount, mount } from '@vue/test-utils';
import { defineComponent, reactive } from 'vue';

// `useBreakpoint` reads matchMedia once, on first use, and then follows `change`.
const media = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  const state = { phone: true };
  return {
    state,
    set(phone: boolean) {
      state.phone = phone;
      listeners.forEach((fn) => fn());
    },
    matchMedia: (query: string) => ({
      get matches() {
        return query === '(max-width: 767px)' ? state.phone : false;
      },
      media: query,
      addEventListener: (_: string, fn: () => void) => listeners.add(fn),
      removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
    }),
  };
});
Object.defineProperty(window, 'matchMedia', { configurable: true, value: media.matchMedia });

vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));
vi.mock('@/composables/useToast', () => ({ showToast: vi.fn(() => 1), dismissToast: vi.fn() }));
vi.mock('@/composables/useConfirm', () => ({ confirm: vi.fn(), confirmChoice: vi.fn() }));
vi.mock('@/services/telemetry/logEvent', () => ({ logEvent: vi.fn() }));
vi.mock('vue-router', () => ({
  useRoute: () => ({ query: {} }),
  useRouter: () => ({ replace: vi.fn() }),
}));
vi.mock('@/stores/familyStore', () => ({
  useFamilyStore: () => ({ members: [], sortedHumans: [] }),
}));
const store = reactive({
  canDeal: true,
  isLoaded: true,
  isFirstDeal: false,
  resolved: [],
  stats: { total: 2, deck: 1, held: 1, waiting: 0, skipped: 0, unsorted: 1, splitCount: 0 },
  customCount: 0,
  rhythmWeeks: 4,
  moves: [],
  checkIns: [],
  cardById: () => undefined,
  load: vi.fn(),
});
vi.mock('@/stores/responsibilityStore', () => ({ useResponsibilityStore: () => store }));

import WhoOwnsWhatPage from '@/pages/WhoOwnsWhatPage.vue';

enableAutoUnmount(afterEach);

const MenuStub = defineComponent({
  name: 'OverflowMenu',
  props: ['items'],
  template: '<div data-testid="menu" />',
});
const mountPage = () =>
  mount(WhoOwnsWhatPage, {
    global: {
      stubs: {
        OverflowMenu: MenuStub,
        PageWelcomeSubtitle: { template: '<p data-testid="tagline" />' },
        TogglePillGroup: { template: '<div />' },
        AddEntityButton: { template: '<button />' },
        SheetExportActions: { template: '<div data-testid="share" />' },
        DeckOverview: true,
        FirstDealEmptyState: true,
        DeckGrid: true,
        CardViewDrawer: true,
        CardEditDrawer: true,
        CheckInDrawer: true,
      },
    },
  });
const count = (w: ReturnType<typeof mountPage>, id: string) =>
  w.findAll(`[data-testid="${id}"]`).length;

describe('WhoOwnsWhatPage at phone width', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    store.canDeal = true;
    media.set(true);
  });

  it('one controls row: toggle, ＋, Share, ⋯; no tagline row; one of each', () => {
    const w = mountPage();
    expect(count(w, 'tagline')).toBe(0);
    expect(count(w, 'who-owns-what-add')).toBe(1);
    expect(w.findAllComponents(MenuStub)).toHaveLength(1);
    const row = w.find('[data-testid="who-owns-what-views"]').element.parentElement!;
    const order = Array.from(row.querySelectorAll('[data-testid]')).map((el) =>
      el.getAttribute('data-testid')
    );
    expect(order).toEqual(['who-owns-what-views', 'who-owns-what-add', 'share', 'menu']);
  });

  it('a child gets no ＋ on a phone either, and still one ⋯', () => {
    store.canDeal = false;
    const w = mountPage();
    expect(count(w, 'who-owns-what-add')).toBe(0);
    expect(w.findAllComponents(MenuStub)).toHaveLength(1);
  });

  it('md+: the tagline row is back, holding the only ＋ and ⋯', async () => {
    media.set(false);
    const w = mountPage();
    await w.vm.$nextTick();
    expect(count(w, 'tagline')).toBe(1);
    expect(count(w, 'who-owns-what-add')).toBe(1);
    expect(w.findAllComponents(MenuStub)).toHaveLength(1);
    const header = w.find('[data-testid="tagline"]').element.parentElement!;
    expect(header.querySelector('[data-testid="who-owns-what-add"]')).not.toBeNull();
    expect(header.querySelector('[data-testid="menu"]')).not.toBeNull();
  });
});
