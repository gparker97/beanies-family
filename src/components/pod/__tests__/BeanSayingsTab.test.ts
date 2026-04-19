/**
 * Smoke tests for BeanSayingsTab — empty-state, populated rendering,
 * and per-member filtering. Same shape as BeanFavoritesTab's tests.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { setActivePinia, createPinia } from 'pinia';
import BeanSayingsTab from '@/components/pod/BeanSayingsTab.vue';
import { useSayingsStore } from '@/stores/sayingsStore';
import type { SayingItem } from '@/types/models';

vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/composables/useAutoOpenOnQuery', () => ({
  useAutoOpenOnQuery: () => undefined,
}));

const MEMBER_ID = 'bean-neil';

function makeSaying(overrides: Partial<SayingItem> = {}): SayingItem {
  return {
    id: overrides.id ?? 's1',
    memberId: overrides.memberId ?? MEMBER_ID,
    words: overrides.words ?? "I'm the captain now",
    saidOn: overrides.saidOn,
    place: overrides.place,
    context: overrides.context,
    createdAt: overrides.createdAt ?? '2026-03-01T00:00:00Z',
    updatedAt: overrides.updatedAt ?? '2026-03-01T00:00:00Z',
  };
}

function mountTab(sayings: SayingItem[] = []) {
  setActivePinia(createPinia());
  const store = useSayingsStore();
  store.sayings = sayings;
  return mount(BeanSayingsTab, {
    props: { memberId: MEMBER_ID },
    global: { stubs: { SayingFormModal: true } },
  });
}

describe('BeanSayingsTab', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders the empty state when the member has no sayings', () => {
    const wrapper = mountTab([]);
    expect(wrapper.text()).toContain('sayings.empty');
    expect(wrapper.text()).toContain('sayings.emptyCTA');
  });

  it('renders a sticky note per saying plus the AddTile when populated', () => {
    const wrapper = mountTab([
      makeSaying({ id: 's1', words: 'First quote', saidOn: '2026-03-01' }),
      makeSaying({ id: 's2', words: 'Second quote', place: 'kitchen' }),
    ]);
    expect(wrapper.text()).toContain('First quote');
    expect(wrapper.text()).toContain('Second quote');
    expect(wrapper.text()).toContain('sayings.addTile');
  });

  it('filters out sayings for other members', () => {
    const wrapper = mountTab([
      makeSaying({ id: 's1', words: 'Mine', memberId: MEMBER_ID }),
      makeSaying({ id: 's2', words: 'Sibling quote', memberId: 'someone-else' }),
    ]);
    expect(wrapper.text()).toContain('Mine');
    expect(wrapper.text()).not.toContain('Sibling quote');
  });
});
