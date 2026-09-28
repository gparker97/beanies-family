/**
 * DeckOverview (#109): the summary card's one primary deal action and the By Category rows.
 *
 *  - "Deal the Remaining N" counts unsorted + waiting, opens the unsorted pile while any
 *    remain and the waiting cards after that, and is for grown-ups only.
 *  - A By Category row is a button (children too) that asks the page to open that category.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { computed, reactive } from 'vue';
import { getResponsibilityCard } from '@/constants/responsibilityCards';
import {
  categoryCoverage,
  deckStats,
  type CardStatus,
  type ResolvedCard,
} from '@/utils/responsibilityDeck';

vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));
vi.mock('@/services/telemetry/logEvent', () => ({ logEvent: vi.fn() }));
vi.mock('@/composables/useToast', () => ({ showToast: vi.fn(() => 1), dismissToast: vi.fn() }));
vi.mock('@/stores/notificationsStore', () => ({
  useNotificationsStore: () => ({ markRead: vi.fn() }),
}));

const family = reactive({
  members: [{ id: 'sofia', name: 'Sofia', role: 'member', ageGroup: 'adult', color: '#ec4899' }],
  get sortedHumans() {
    return this.members;
  },
});
vi.mock('@/stores/familyStore', () => ({ useFamilyStore: () => family }));

function card(id: string, status: CardStatus, holderId?: string): ResolvedCard {
  const def = getResponsibilityCard(id)!;
  const at = '2026-09-01T00:00:00Z';
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
      createdAt: at,
      updatedAt: at,
    },
  };
}

const deck = reactive({ resolved: [] as ResolvedCard[] });
const stats = computed(() => deckStats(deck.resolved));
const coverage = computed(() => categoryCoverage(deck.resolved));
const waiting = computed(() => deck.resolved.filter((c) => c.status === 'waiting'));
const store = reactive({
  get resolved() {
    return deck.resolved;
  },
  get remaining() {
    return stats.value.unsorted + stats.value.waiting;
  },
  get stats() {
    return stats.value;
  },
  get coverage() {
    return coverage.value;
  },
  get waiting() {
    return waiting.value;
  },
  moves: [],
  checkIns: [],
  states: [],
  checkInSince: undefined,
  rhythmWeeks: 4,
  lastCheckIn: null,
  nextCheckIn: null,
  checkInDue: false,
  cardById(id: string) {
    return deck.resolved.find((c) => c.id === id);
  },
  myCards: () => [],
});
vi.mock('@/stores/responsibilityStore', () => ({ useResponsibilityStore: () => store }));

import DeckOverview from '../DeckOverview.vue';

function mountOverview(canDeal = true) {
  return mount(DeckOverview, {
    props: { canDeal },
    global: { stubs: { CheckInCard: true, DeckRing: true, ActivityOwnerStack: true } },
  });
}

const DEAL = '[data-testid="overview-deal-remaining"]';

beforeEach(() => {
  deck.resolved = [
    card('laundry', 'held', 'sofia'),
    card('dishes', 'waiting'),
    card('lunchboxes', 'unsorted'),
    card('floors', 'unsorted'),
  ];
});

describe('DeckOverview: Deal the Remaining', () => {
  it('counts unsorted plus waiting (store.remaining) and asks the page to deal them', async () => {
    const w = mountOverview();
    const btn = w.find(DEAL);
    expect(btn.text()).toBe('whoOwnsWhat.overview.dealRemaining.other');
    await btn.trigger('click');
    // No payload: the page picks the pile with `remainingScope` (the ONE rule).
    expect(w.emitted('deal-remaining')).toEqual([[]]);
  });

  it('says Last Card for one', () => {
    deck.resolved = [card('laundry', 'held', 'sofia'), card('dishes', 'waiting')];
    expect(mountOverview().find(DEAL).text()).toBe('whoOwnsWhat.overview.dealRemaining.one');
  });

  it('titles the facts tile Good to Know', () => {
    expect(mountOverview().text()).toContain('whoOwnsWhat.facts.title');
  });

  it('hides when everything is dealt, and for children', () => {
    expect(mountOverview(false).find(DEAL).exists()).toBe(false);
    deck.resolved = [card('laundry', 'held', 'sofia'), card('dishes', 'skipped')];
    expect(mountOverview().find(DEAL).exists()).toBe(false);
  });

  it('is the only primary deal button on the card (no Deal the Last N beside it)', () => {
    expect(mountOverview().find('[data-testid="overview-deal-last"]').exists()).toBe(false);
  });
});

describe('DeckOverview: By Category', () => {
  it('re-emits a category row click as open-category, for children too', async () => {
    const w = mountOverview(false);
    const cat = getResponsibilityCard('dishes')!.category;
    const row = w.find(`[data-testid="category-coverage-row-${cat}"]`);
    expect(row.element.tagName).toBe('BUTTON');
    await row.trigger('click');
    expect(w.emitted('open-category')).toEqual([[cat]]);
  });
});
