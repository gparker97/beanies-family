/**
 * DealPile: the first deal's contracts.
 *  - Keep → pick is ONE `deal` call (never keep + deal), the card flies to the picked face,
 *    and the card's emoji joins that face's row. Undo from the toast removes it again.
 *  - "Decide later" is the only path that calls `keep`.
 *  - Skip flies into the skipped tray and its emoji joins the tray.
 * The store is a live stand-in: its actions flip card statuses the way the real store's
 * projection would, so the pile advances off the store, not off its own bookkeeping.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { defineComponent, h, reactive } from 'vue';
import { getResponsibilityCard } from '@/constants/responsibilityCards';
import type { ResolvedCard } from '@/utils/responsibilityDeck';
import type { UndoToken } from '@/utils/responsibilityOps';

vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));
vi.mock('@/utils/prefersReducedMotion', () => ({ prefersReducedMotion: () => true }));
const fly = vi.hoisted(() => ({ flyTo: vi.fn(() => Promise.resolve()) }));
vi.mock('@/composables/useFlyTo', () => ({ flyTo: fly.flyTo }));
const toast = vi.hoisted(() => ({ show: vi.fn(), dismiss: vi.fn() }));
vi.mock('@/composables/useToast', () => ({
  showToast: toast.show,
  dismissToast: toast.dismiss,
}));

const family = reactive({
  members: [
    { id: 'greg', name: 'greg', role: 'owner', ageGroup: 'adult', color: '#3b82f6' },
    { id: 'sofia', name: 'Sofia', role: 'member', ageGroup: 'adult', color: '#ec4899' },
  ],
  get sortedHumans() {
    return this.members;
  },
});
vi.mock('@/stores/familyStore', () => ({ useFamilyStore: () => family }));

function unsorted(id: string, category: ResolvedCard['category'] = 'home'): ResolvedCard {
  const def = getResponsibilityCard(id)!;
  return {
    id,
    def,
    isCustom: false,
    category,
    emoji: def.emoji,
    status: 'unsorted',
    splitMode: 'single',
    parts: [{ key: 'main' }],
    state: null,
  };
}

const TOKEN: UndoToken = {
  action: 'deal',
  before: {},
  afterUpdatedAt: {},
  createdMoveIds: [],
  createdCheckInIds: [],
};

const store = reactive({
  isLoaded: true,
  resolved: [] as ResolvedCard[],
  stats: { total: 2, deck: 0, held: 0, waiting: 0, skipped: 0, unsorted: 2, splitCount: 0 },
  nextCheckIn: null as string | null,
  get isFullyDealt() {
    return this.stats.deck > 0 && this.stats.waiting === 0 && this.stats.unsorted === 0;
  },
  cardById(id: string) {
    return this.resolved.find((c) => c.id === id);
  },
  myCards: () => [],
  set(id: string, patch: Partial<ResolvedCard>) {
    const i = this.resolved.findIndex((c) => c.id === id);
    this.resolved[i] = { ...this.resolved[i]!, ...patch };
  },
  deal: vi.fn(),
  keep: vi.fn(),
  skip: vi.fn(),
  bringBack: vi.fn(),
  undo: vi.fn(),
});
vi.mock('@/stores/responsibilityStore', () => ({ useResponsibilityStore: () => store }));

// A light InlineMemberPicker: the real one's tiles, testids, badge slot and back chip.
const PickerStub = defineComponent({
  props: ['members', 'title', 'backLabel', 'tileTestidPrefix'],
  emits: ['pick', 'cancel'],
  setup(props, { emit, slots }) {
    return () =>
      h('section', [
        h('button', { 'data-testid': 'picker-back', onClick: () => emit('cancel') }),
        ...props.members.map((m: { id: string }) =>
          h(
            'button',
            {
              'data-testid': `${props.tileTestidPrefix}${m.id}`,
              onClick: () => emit('pick', m.id),
            },
            slots.badge?.({ member: m })
          )
        ),
      ]);
  },
});

import DealPile from '../DealPile.vue';
import { resetDealActionsForTest } from '../useDealActions';

function mountPile() {
  return mount(DealPile, {
    props: { scope: 'unsorted' },
    global: { stubs: { InlineMemberPicker: PickerStub } },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  resetDealActionsForTest();
  toast.show.mockImplementation(() => 1);
  store.resolved = [unsorted('laundry'), unsorted('dishes')];
  store.deal.mockImplementation(async (id: string, _part: string, memberId: string) => {
    store.set(id, { status: 'held', parts: [{ key: 'main', holderId: memberId }] });
    return { result: store.cardById(id), undo: TOKEN };
  });
  store.keep.mockImplementation(async (id: string) => {
    store.set(id, { status: 'waiting' });
    return { result: store.cardById(id), undo: TOKEN };
  });
  store.skip.mockImplementation(async (ids: string[]) => {
    for (const id of ids) store.set(id, { status: 'skipped' });
    return { result: ids, undo: TOKEN };
  });
});

describe('DealPile', () => {
  it('keep → pick deals once, flies to the face, adds the emoji, and undo removes it', async () => {
    const w = mountPile();
    expect(w.find('[data-testid="deal-pile-card-laundry"]').exists()).toBe(true);

    await w.find('[data-testid="deal-pile-keep"]').trigger('click');
    await w.find('[data-testid="deal-pick-sofia"]').trigger('click');
    await flushPromises();

    expect(store.deal).toHaveBeenCalledTimes(1);
    expect(store.deal).toHaveBeenCalledWith('laundry', 'main', 'sofia');
    expect(store.keep).not.toHaveBeenCalled();
    expect(fly.flyTo).toHaveBeenCalledTimes(1);
    const [, target] = fly.flyTo.mock.calls[0]! as unknown as [HTMLElement, HTMLElement];
    expect(target.getAttribute('data-testid')).toBe('deal-pick-sofia');

    // The next card is on top; its picker shows sofia's session row.
    expect(w.find('[data-testid="deal-pile-card-dishes"]').exists()).toBe(true);
    await w.find('[data-testid="deal-pile-keep"]').trigger('click');
    expect(w.find('[data-testid="deal-pile-got-sofia"]').text()).toBe('🧺');

    // Undo from the toast: the store restores the card, the emoji leaves the row.
    store.undo.mockImplementation(async () => {
      store.set('laundry', { status: 'unsorted', parts: [{ key: 'main' }] });
      return true;
    });
    const opts = toast.show.mock.calls.find((c) => c[3]?.actionFn)![3];
    await opts.actionFn();
    await flushPromises();

    expect(store.undo).toHaveBeenCalledWith(TOKEN);
    expect(w.find('[data-testid="deal-pile-card-laundry"]').exists()).toBe(true);
    await w.find('[data-testid="deal-pile-keep"]').trigger('click');
    expect(w.find('[data-testid="deal-pile-got-sofia"]').text()).toBe('');
  });

  it('an Undo tapped while the card is still flying leaves no emoji behind', async () => {
    let land!: () => void;
    fly.flyTo.mockImplementationOnce(() => new Promise<void>((r) => (land = r)));
    store.undo.mockImplementation(async () => {
      store.set('laundry', { status: 'unsorted', parts: [{ key: 'main' }] });
      return true;
    });
    const w = mountPile();
    await w.find('[data-testid="deal-pile-keep"]').trigger('click');
    await w.find('[data-testid="deal-pick-sofia"]').trigger('click');
    await flushPromises();

    // The write resolved, so the toast is up; the flight has not landed yet.
    const opts = toast.show.mock.calls.find((c) => c[3]?.actionFn)![3];
    await opts.actionFn();
    await flushPromises();
    land();
    await flushPromises();

    expect(store.undo).toHaveBeenCalledWith(TOKEN);
    // The same card is back on top, asking "Keep this card, or skip it?" again (it is
    // unsorted again), with nothing under sofia once Keep is tapped.
    expect(w.find('[data-testid="deal-pile-card-laundry"]').exists()).toBe(true);
    expect(w.find('[data-testid="deal-pick-sofia"]').exists()).toBe(false);
    await w.find('[data-testid="deal-pile-keep"]').trigger('click');
    expect(w.find('[data-testid="deal-pile-got-sofia"]').text()).toBe('');
  });

  it('an all-skipped deck ends on the plain done card, not "every card has a holder"', async () => {
    store.stats = {
      total: 2,
      deck: 0,
      held: 0,
      waiting: 0,
      skipped: 2,
      unsorted: 0,
      splitCount: 0,
    };
    const w = mountPile();
    await w.find('[data-testid="deal-pile-skip"]').trigger('click');
    await flushPromises();
    await w.find('[data-testid="deal-pile-skip"]').trigger('click');
    await flushPromises();
    expect(w.find('[data-testid="deal-pile-celebrate"]').exists()).toBe(false);
    expect(w.find('[data-testid="deal-pile-done"]').exists()).toBe(true);
    store.stats = {
      total: 2,
      deck: 0,
      held: 0,
      waiting: 0,
      skipped: 0,
      unsorted: 2,
      splitCount: 0,
    };
  });

  it('"Decide later" is the only path that calls keep', async () => {
    const w = mountPile();
    await w.find('[data-testid="deal-pile-keep"]').trigger('click');
    await w.find('[data-testid="picker-back"]').trigger('click');
    await flushPromises();

    expect(store.keep).toHaveBeenCalledWith('laundry');
    expect(store.deal).not.toHaveBeenCalled();
    expect(fly.flyTo).not.toHaveBeenCalled();
    expect(w.find('[data-testid="deal-pile-card-dishes"]').exists()).toBe(true);
  });

  it('skip flies the card into the tray and adds its emoji there', async () => {
    const w = mountPile();
    await w.find('[data-testid="deal-pile-skip"]').trigger('click');
    await flushPromises();

    expect(store.skip).toHaveBeenCalledWith(['laundry']);
    const [, target] = fly.flyTo.mock.calls[0]! as unknown as [HTMLElement, HTMLElement];
    expect(target.getAttribute('data-testid')).toBe('deal-pile-tray');
    expect(w.find('[data-testid="deal-pile-tray-emojis"]').text()).toBe('🧺');
    expect(w.find('[data-testid="deal-pile-card-dishes"]').exists()).toBe(true);
  });

  it('a refused deal leaves the card on the pile and records nothing', async () => {
    store.deal.mockResolvedValueOnce(null);
    const w = mountPile();
    await w.find('[data-testid="deal-pile-keep"]').trigger('click');
    await w.find('[data-testid="deal-pick-greg"]').trigger('click');
    await flushPromises();

    const card = w.find('[data-testid="deal-pile-card-laundry"]');
    expect(card.exists()).toBe(true);
    expect(card.classes()).not.toContain('is-leaving');
    expect(w.find('[data-testid="deal-pick-greg"]').text()).toBe('');
  });
});
