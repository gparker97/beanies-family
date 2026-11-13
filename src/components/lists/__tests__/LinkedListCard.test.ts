/**
 * LinkedListCard: one embedded list, shown by the Lists section on a trip or an activity
 * (`LinkedListsSection`, #114).
 */
import { flushPromises, mount } from '@vue/test-utils';
import { setActivePinia, createPinia } from 'pinia';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { FamilyList } from '@/types/models';

const h = vi.hoisted(() => ({ toggleItem: vi.fn() }));

vi.mock('@/stores/listStore', () => ({
  useListStore: () => ({ toggleItem: h.toggleItem }),
}));
vi.mock('@/stores/familyStore', () => ({
  useFamilyStore: () => ({ currentMember: { id: 'me' }, members: [] }),
}));
vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({
    t: (k: string) => (k === 'lists.progress' ? '{done}/{total}' : k),
  }),
}));

import LinkedListCard from '../LinkedListCard.vue';

const stubs = {
  ActivityOwnerStack: true,
  EverySessionTag: { template: '<span data-testid="tag" />' },
};

function list(overrides: Partial<FamilyList> = {}): FamilyList {
  return {
    id: 'l-1',
    title: 'Beach bag',
    emoji: '🏖️',
    category: 'trips',
    ownerId: 'me',
    items: [
      { id: 'a', title: 'Towels', completed: true },
      { id: 'b', title: 'Sunscreen', completed: false },
    ],
    lifecycle: 'oneoff',
    completed: false,
    createdBy: 'me',
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
    ...overrides,
  } as FamilyList;
}

beforeEach(() => {
  setActivePinia(createPinia());
  vi.clearAllMocks();
});

describe('LinkedListCard', () => {
  it('shows the title, progress and items, and no tag by default', () => {
    const w = mount(LinkedListCard, { props: { list: list() }, global: { stubs } });
    expect(w.text()).toContain('Beach bag');
    expect(w.text()).toContain('1/2');
    expect(w.text()).toContain('Towels');
    expect(w.find('[data-testid="tag"]').exists()).toBe(false);
  });

  it('shows the Every Session tag when asked', () => {
    const w = mount(LinkedListCard, {
      props: { list: list(), everySession: true },
      global: { stubs },
    });
    expect(w.find('[data-testid="tag"]').exists()).toBe(true);
  });

  it('ticks an item through the store as the current member', async () => {
    const w = mount(LinkedListCard, { props: { list: list() }, global: { stubs } });
    w.findComponent({ name: 'ListItemRow' }).vm.$emit('toggle', 'a');
    await flushPromises();
    expect(h.toggleItem).toHaveBeenCalledWith('l-1', 'a', 'me');
  });

  it('clamps long lists behind a "+N more" door-back that opens the list', async () => {
    const items = Array.from({ length: 7 }, (_, i) => ({
      id: `i${i}`,
      title: `Item ${i}`,
      completed: false,
    }));
    const w = mount(LinkedListCard, { props: { list: list({ items }) }, global: { stubs } });
    expect(w.findAllComponents({ name: 'ListItemRow' })).toHaveLength(5);
    const more = w.findAll('button').find((b) => b.text().includes('lists.embed.more'));
    await more!.trigger('click');
    expect(w.emitted('open')?.[0]).toEqual(['l-1']);
  });
});
