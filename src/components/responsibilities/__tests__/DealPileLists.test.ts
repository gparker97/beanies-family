/**
 * DealPileLists: Kept (with owner) and Skipped (with Bring back), newest first from the
 * store; the first 6 with Show all; a row click asks the pile to jump; Bring back goes
 * through useDealActions and is its own button.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { reactive } from 'vue';
import { getResponsibilityCard, RESPONSIBILITY_CARDS } from '@/constants/responsibilityCards';
import type { CardStatus, ResolvedCard } from '@/utils/responsibilityDeck';

vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));
const telemetry = vi.hoisted(() => ({ logEvent: vi.fn() }));
vi.mock('@/services/telemetry/logEvent', () => telemetry);
vi.mock('@/composables/useToast', () => ({ showToast: vi.fn(() => 1), dismissToast: vi.fn() }));
vi.mock('@/composables/useBreakpoint', () => ({
  useBreakpoint: () => ({ isMobile: { value: false } }),
}));

const family = reactive({
  members: [{ id: 'sofia', name: 'Sofia', role: 'member', ageGroup: 'adult', color: '#ec4899' }],
  get sortedHumans() {
    return this.members;
  },
});
vi.mock('@/stores/familyStore', () => ({ useFamilyStore: () => family }));

function card(id: string, status: CardStatus, updatedAt: string, holderId?: string): ResolvedCard {
  const def = getResponsibilityCard(id)!;
  return {
    id,
    def,
    isCustom: false,
    category: def.category,
    emoji: def.emoji,
    status,
    splitMode: 'single',
    parts: [{ key: 'main', holderId }],
    state: {
      id,
      status: status === 'skipped' ? 'skipped' : 'kept',
      splitMode: 'single',
      parts: [{ key: 'main', holderId }],
      createdAt: updatedAt,
      updatedAt,
    },
  };
}

const store = reactive({
  resolved: [] as ResolvedCard[],
  bringBack: vi.fn(),
  cardById(id: string) {
    return this.resolved.find((c) => c.id === id);
  },
});
vi.mock('@/stores/responsibilityStore', () => ({ useResponsibilityStore: () => store }));

import DealPileLists from '../DealPileLists.vue';
import { resetDealActionsForTest } from '../useDealActions';

function mountLists(props: Record<string, unknown> = {}) {
  return mount(DealPileLists, { props, global: { stubs: { MemberChip: true } } });
}

beforeEach(() => {
  vi.clearAllMocks();
  resetDealActionsForTest();
  store.resolved = [
    card('laundry', 'held', '2026-09-01T00:00:00Z', 'sofia'),
    card('dishes', 'waiting', '2026-09-03T00:00:00Z'),
    card('lunchboxes', 'skipped', '2026-09-02T00:00:00Z'),
  ];
  store.bringBack.mockResolvedValue(null);
});

describe('DealPileLists', () => {
  it('lists kept cards newest first with the owner, or Nobody yet', () => {
    const w = mountLists();
    const rows = w.findAll('[data-testid^="deal-list-kept-"]');
    expect(rows.map((r) => r.attributes('data-testid'))).toEqual([
      'deal-list-kept-dishes',
      'deal-list-kept-laundry',
    ]);
    expect(rows[0]!.text()).toContain('whoOwnsWhat.deck.nobody');
    expect(rows[1]!.text()).toContain('Sofia');
    expect(w.find('[data-testid="deal-list-skipped-lunchboxes"]').exists()).toBe(true);
  });

  it('never uses the pile card or pick test-id prefixes', () => {
    const html = mountLists().html();
    expect(html).not.toContain('deal-pile-card-');
    expect(html).not.toContain('deal-pick-');
  });

  it('a row click emits jump; Bring back calls the action and does not jump', async () => {
    const w = mountLists({ currentId: 'laundry' });
    expect(w.find('[data-testid="deal-list-kept-laundry"]').attributes('aria-current')).toBe(
      'true'
    );
    await w.find('[data-testid="deal-list-kept-dishes"]').trigger('click');
    expect(w.emitted('jump')).toEqual([['dishes']]);
    await w.find('[data-testid="deal-list-bring-back-lunchboxes"]').trigger('click');
    expect(store.bringBack).toHaveBeenCalledWith('lunchboxes');
    expect(w.emitted('jump')).toHaveLength(1);
  });

  it('does nothing while disabled', async () => {
    const w = mountLists({ disabled: true });
    await w.find('[data-testid="deal-list-kept-dishes"]').trigger('click');
    await w.find('[data-testid="deal-list-bring-back-lunchboxes"]').trigger('click');
    expect(w.emitted('jump')).toBeUndefined();
    expect(store.bringBack).not.toHaveBeenCalled();
  });

  it('shows the first 6, then Show all expands in place and is logged', async () => {
    const ids = RESPONSIBILITY_CARDS.slice(0, 8).map((d) => d.id);
    store.resolved = ids.map((id, i) => card(id, 'skipped', `2026-09-0${i + 1}T00:00:00Z`));
    const w = mountLists();
    expect(w.findAll('[data-testid^="deal-list-skipped-"]')).toHaveLength(6);
    const more = w.findAll('button').find((b) => b.text().includes('action.showAllN'))!;
    await more.trigger('click');
    expect(w.findAll('[data-testid^="deal-list-skipped-"]')).toHaveLength(8);
    expect(telemetry.logEvent).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'pile_lists_show_all', context: { detail: 'skipped' } })
    );
  });
});
