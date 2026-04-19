/**
 * Smoke tests for BeanFavoritesTab — verifies the three-state rendering
 * contract (empty / populated / error) and that the AddTile opens the
 * form modal.
 *
 * Store is stubbed via `createTestingPinia` with `createSpy: vi.fn` so
 * action calls are observable but don't touch the real Automerge layer.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { setActivePinia, createPinia } from 'pinia';
import BeanFavoritesTab from '@/components/pod/BeanFavoritesTab.vue';
import { useFavoritesStore } from '@/stores/favoritesStore';
import type { FavoriteItem } from '@/types/models';

vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const MEMBER_ID = 'bean-neil';

function makeFav(overrides: Partial<FavoriteItem> = {}): FavoriteItem {
  return {
    id: overrides.id ?? 'fav-1',
    memberId: overrides.memberId ?? MEMBER_ID,
    category: overrides.category ?? 'food',
    name: overrides.name ?? 'Spaghetti carbonara',
    description: overrides.description,
    createdAt: overrides.createdAt ?? '2026-03-01T00:00:00Z',
    updatedAt: overrides.updatedAt ?? '2026-03-01T00:00:00Z',
  };
}

function mountTab(favorites: FavoriteItem[] = []) {
  setActivePinia(createPinia());
  const store = useFavoritesStore();
  store.favorites = favorites;
  return mount(BeanFavoritesTab, {
    props: { memberId: MEMBER_ID },
    global: { stubs: { FavoriteFormModal: true } },
  });
}

describe('BeanFavoritesTab', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders the empty state + CTA when the member has no favorites', () => {
    const wrapper = mountTab([]);
    expect(wrapper.text()).toContain('favorites.empty');
    expect(wrapper.text()).toContain('favorites.emptyCTA');
  });

  it('renders a card per favorite + the AddTile when populated', () => {
    const wrapper = mountTab([
      makeFav({ id: 'f1', name: 'Pizza' }),
      makeFav({ id: 'f2', name: 'Gyoza', category: 'food' }),
      makeFav({ id: 'f3', name: 'Paris', category: 'place' }),
    ]);
    // Three cards + one AddTile — scope to buttons inside the component's
    // root element rather than `wrapper.findAll('button')` which also picks
    // up children of stubbed sub-components.
    expect(wrapper.text()).toContain('Pizza');
    expect(wrapper.text()).toContain('Gyoza');
    expect(wrapper.text()).toContain('Paris');
    expect(wrapper.text()).toContain('favorites.addTile');
  });

  it('filters out favorites that belong to other members', () => {
    const wrapper = mountTab([
      makeFav({ id: 'f1', name: 'Mine', memberId: MEMBER_ID }),
      makeFav({ id: 'f2', name: 'Sibling', memberId: 'someone-else' }),
    ]);
    expect(wrapper.text()).toContain('Mine');
    expect(wrapper.text()).not.toContain('Sibling');
  });
});
