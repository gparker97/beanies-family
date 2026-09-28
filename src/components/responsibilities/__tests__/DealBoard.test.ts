/**
 * DealBoard (Who Owns What #109, desktop board): the lanes give their space to the people
 * holding cards. A member holding nothing folds into the idle strip, and each face there is
 * still a drop target (dropping deals the card). Skipped is folded by default, still takes
 * a drop, and opens to a capped grid. Every card in a lane shows (no "+N more" cap).
 */
import { setActivePinia, createPinia } from 'pinia';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount, flushPromises, enableAutoUnmount } from '@vue/test-utils';
import { reactive } from 'vue';
import { getResponsibilityCard, RESPONSIBILITY_CARDS } from '@/constants/responsibilityCards';
import type { CardStatus, ResolvedCard } from '@/utils/responsibilityDeck';

vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));
const telemetry = vi.hoisted(() => ({ logEvent: vi.fn() }));
vi.mock('@/services/telemetry/logEvent', () => telemetry);
const actions = vi.hoisted(() => ({
  deal: vi.fn(async () => true),
  skip: vi.fn(async () => true),
  keep: vi.fn(async () => true),
}));
vi.mock('../useDealActions', () => ({ useDealActions: () => actions }));

const family = reactive({
  members: [
    { id: 'greg', name: 'greg', role: 'owner', ageGroup: 'adult', color: '#3b82f6' },
    { id: 'mia', name: 'Mia', role: 'member', ageGroup: 'child', color: '#10b981' },
  ],
  get sortedHumans() {
    return this.members;
  },
});
vi.mock('@/stores/familyStore', () => ({ useFamilyStore: () => family }));

function card(id: string, status: CardStatus, holderId?: string): ResolvedCard {
  const def = getResponsibilityCard(id)!;
  return {
    id,
    def,
    isCustom: false,
    category: def.category,
    emoji: def.emoji,
    illustration: def.illustration,
    status,
    splitMode: 'single',
    parts: [{ key: 'main', holderId }],
    state: null,
  };
}

const HELD = RESPONSIBILITY_CARDS.slice(0, 12).map((d) => card(d.id, 'held', 'greg'));
const store = reactive({
  resolved: [
    ...HELD,
    card('trash-night', 'skipped'),
    card('snow-and-ice', 'skipped'),
    card('grocery-shopping', 'unsorted'),
  ] as ResolvedCard[],
  stats: { waiting: 0, unsorted: 1, skipped: 2 },
  cardById(id: string) {
    return this.resolved.find((c) => c.id === id);
  },
  myCards(memberId: string) {
    return this.resolved.filter((c) => c.parts.some((p) => p.holderId === memberId));
  },
});
vi.mock('@/stores/responsibilityStore', () => ({ useResponsibilityStore: () => store }));

import DealBoard from '../DealBoard.vue';

enableAutoUnmount(afterEach);
beforeEach(() => {
  setActivePinia(createPinia());
  vi.clearAllMocks();
});

const mountBoard = () =>
  mount(DealBoard, { global: { stubs: { BeanieAvatar: true, InlineMemberPicker: true } } });

const dataTransfer = { setData: vi.fn(), effectAllowed: '' };

describe('DealBoard', () => {
  it('gives a lane to members holding cards, every card shown; idle members fold into the strip', () => {
    const w = mountBoard();
    const lane = w.find('[data-testid="deal-row-greg"]');
    expect(lane.element.tagName).toBe('SECTION');
    expect(lane.findAll('[data-testid^="deal-chip-greg-"]')).toHaveLength(12);
    const strip = w.find('[data-testid="deal-idle-strip"]');
    expect(strip.find('[data-testid="deal-row-mia"]').exists()).toBe(true);
  });

  it('dropping a card on an idle face deals it, and logs that the folded target was used', async () => {
    const w = mountBoard();
    await w
      .find('[data-testid="deal-rail-grocery-shopping"]')
      .trigger('dragstart', { dataTransfer });
    await w.find('[data-testid="deal-row-mia"]').trigger('drop');
    await flushPromises();
    expect(actions.deal).toHaveBeenCalledWith('grocery-shopping', 'main', 'mia');
    expect(telemetry.logEvent).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'board_deal_to_idle' })
    );
  });

  it('Skipped is folded by default, still takes a drop, and opens to a capped grid', async () => {
    const w = mountBoard();
    expect(w.find('[data-testid="deal-skipped-grid"]').exists()).toBe(false);
    await w
      .find('[data-testid="deal-rail-grocery-shopping"]')
      .trigger('dragstart', { dataTransfer });
    await w.find('[data-testid="deal-row-skipped"]').trigger('drop');
    await flushPromises();
    expect(actions.skip).toHaveBeenCalledWith(['grocery-shopping']);

    await w.find('[data-testid="deal-skipped-toggle"]').trigger('click');
    const grid = w.find('[data-testid="deal-skipped-grid"]');
    expect(grid.classes()).toContain('max-h-[12rem]');
    expect(grid.findAll('[data-testid^="deal-chip-skipped-"]')).toHaveLength(2);
  });

  it('opening a lane card passes that lane as the list to step through', async () => {
    const w = mountBoard();
    await w.find(`[data-testid="deal-chip-greg-${HELD[1]!.id}:main"]`).trigger('click');
    const [id, seq] = w.emitted('open')![0] as [string, { ids: string[]; label: string }];
    expect(id).toBe(HELD[1]!.id);
    expect(seq.ids).toEqual(HELD.map((c) => c.id));
    expect(seq.label).toBe('whoOwnsWhat.board.rowLabel');
  });
});
