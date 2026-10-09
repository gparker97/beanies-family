/**
 * DeckGrid (#109): `scrollToShelf`, which the page calls after an Overview "By Category" row
 * opens the Deck view filtered to that category. Plus the deck tile's reminder bell (#123).
 */
import { describe, it, expect, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { setActivePinia, createPinia } from 'pinia';
import { getResponsibilityCard } from '@/constants/responsibilityCards';
import type { ResolvedCard } from '@/utils/responsibilityDeck';
import type { ListCategory } from '@/types/models';

vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));
vi.mock('../useDealActions', () => ({ useDealActions: () => ({ bringBack: vi.fn() }) }));

import DeckGrid from '../DeckGrid.vue';
import ResponsibilityCardTile from '../ResponsibilityCardTile.vue';

function card(id: string): ResolvedCard {
  const def = getResponsibilityCard(id)!;
  const at = '2026-09-01T00:00:00Z';
  return {
    id,
    def,
    isCustom: false,
    category: def.category,
    emoji: def.emoji,
    status: 'waiting',
    splitMode: 'single',
    parts: [{ key: 'main' }],
    state: {
      id,
      status: 'kept',
      splitMode: 'single',
      parts: [{ key: 'main' }],
      createdAt: at,
      updatedAt: at,
    },
  };
}

function mountGrid(filter: ListCategory | null) {
  return mount(DeckGrid, {
    props: { cards: [card('dishes'), card('lunchboxes')], filter },
    attachTo: document.body,
    global: { stubs: { ListCategoryPills: true, ResponsibilityCardTile: true, DeckByBean: true } },
  });
}

describe('DeckGrid.scrollToShelf', () => {
  it('scrolls the filtered category shelf into view', async () => {
    const home = getResponsibilityCard('dishes')!.category;
    const w = mountGrid(home);
    const shelf = w.find(`[data-testid="deck-shelf-${home}"]`).element as HTMLElement;
    shelf.scrollIntoView = vi.fn();
    expect(await w.vm.scrollToShelf(home)).toBe(true);
    expect(shelf.scrollIntoView).toHaveBeenCalledWith(expect.objectContaining({ block: 'start' }));
    w.unmount();
  });

  it('reports false when that shelf is not shown', async () => {
    const home = getResponsibilityCard('dishes')!.category;
    const other = getResponsibilityCard('lunchboxes')!.category;
    expect(other).not.toBe(home);
    const w = mountGrid(home);
    expect(await w.vm.scrollToShelf(other)).toBe(false);
    w.unmount();
  });
});

describe('DeckGrid opening a card', () => {
  it('passes the list along: a shelf tile, and By Person through to the page', async () => {
    const shelfGrid = mount(DeckGrid, {
      props: { cards: [card('dishes'), card('laundry')], filter: null },
      global: {
        stubs: { ListCategoryPills: true, DeckByBean: true, ResponsibilityCardTile: true },
      },
    });
    const laundryTile = shelfGrid
      .findAllComponents({ name: 'ResponsibilityCardTile' })
      .find((c) => c.props('card').id === 'laundry')!;
    laundryTile.vm.$emit('open', 'laundry');
    expect(shelfGrid.emitted('open')![0]).toEqual([
      'laundry',
      { label: 'lists.category.home', ids: ['dishes', 'laundry'] },
    ]);
    shelfGrid.unmount();

    const byBean = mount(DeckGrid, {
      props: { cards: [card('dishes')], filter: 'byBean' },
      global: { stubs: { ListCategoryPills: true, DeckByBean: true } },
    });
    const seq = { label: "greg's cards", ids: ['dishes', 'laundry'] };
    byBean.findComponent({ name: 'DeckByBean' }).vm.$emit('open', 'laundry', seq);
    expect(byBean.emitted('open')![0]).toEqual(['laundry', seq]);
    byBean.unmount();
  });
});

describe('ResponsibilityCardTile reminder badge (#123)', () => {
  const mountTile = (c: ResolvedCard) => {
    setActivePinia(createPinia());
    return mount(ResponsibilityCardTile, {
      props: { card: c },
      global: { stubs: { CardArt: true, MemberChip: true } },
    });
  };

  it('shows the bell on the slab only when the card has a reminder', () => {
    const plain = mountTile(card('dishes'));
    expect(plain.find('[data-testid="card-reminder-badge-dishes"]').exists()).toBe(false);

    const reminding = mountTile({ ...card('dishes'), hasReminder: true });
    const badge = reminding.find('[data-testid="card-reminder-badge-dishes"]');
    expect(badge.exists()).toBe(true);
    expect(badge.attributes('aria-label')).toBe('whoOwnsWhat.tile.reminderBadge');
    expect(badge.text()).toBe('🔔');
  });
});
