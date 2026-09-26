/**
 * DealPile (round 7): the wiring between the cursor, the actions and the flights. Cursor
 * edge cases live in `usePileCursor.test.ts`; these cover what only a mount can show:
 *  - Keep → pick is ONE `deal` call (never keep + deal), flies to the face, and advances.
 *  - "Decide later" is the only path that calls `keep`.
 *  - Skip flies to the Skipped list's heading.
 *  - An Undo during the flight keeps the card; an Undo after it jumps back to the card.
 *  - Revisiting a decided card shows its banner, and each change stays on the card.
 *  - While an action is in flight the pile renders from its snapshot (nothing re-renders
 *    under the flying card), and releases it once the action settles.
 *  - The keyboard shortcuts call the same guarded functions as the buttons, and leave a key
 *    alone when it would do nothing.
 * The store is a live stand-in: its actions flip card statuses the way the real store's
 * projection would, so the pile moves off the store, not off its own bookkeeping.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { defineComponent, h, reactive } from 'vue';
import { getResponsibilityCard } from '@/constants/responsibilityCards';
import type { CardStatus, ResolvedCard } from '@/utils/responsibilityDeck';
import type { UndoToken } from '@/utils/responsibilityOps';

vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));
vi.mock('@/utils/prefersReducedMotion', () => ({ prefersReducedMotion: () => true }));
const telemetry = vi.hoisted(() => ({ logEvent: vi.fn() }));
vi.mock('@/services/telemetry/logEvent', () => telemetry);
const fly = vi.hoisted(() => ({ flyTo: vi.fn(() => Promise.resolve()) }));
vi.mock('@/composables/useFlyTo', () => ({ flyTo: fly.flyTo }));
const toast = vi.hoisted(() => ({ show: vi.fn(), dismiss: vi.fn(), invoke: vi.fn() }));
vi.mock('@/composables/useToast', () => ({
  showToast: toast.show,
  dismissToast: toast.dismiss,
  invokeToastAction: toast.invoke,
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

function makeCard(id: string, status: CardStatus = 'unsorted', holderId?: string): ResolvedCard {
  const def = getResponsibilityCard(id)!;
  return {
    id,
    def,
    isCustom: false,
    category: 'home',
    emoji: def.emoji,
    status,
    splitMode: 'single',
    parts: [{ key: 'main', holderId }],
    state:
      status === 'unsorted'
        ? null
        : {
            id,
            status: status === 'skipped' ? 'skipped' : 'kept',
            splitMode: 'single',
            parts: [{ key: 'main', holderId }],
            createdAt: '2026-09-01T12:00:00.000Z',
            updatedAt: '2026-09-01T12:00:00.000Z',
          },
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

// A light InlineMemberPicker: the real one's tiles, testids and back chip.
const PickerStub = defineComponent({
  props: ['members', 'title', 'backLabel', 'tileTestidPrefix'],
  emits: ['pick', 'cancel'],
  setup(props, { emit }) {
    return () =>
      h('section', { 'data-testid': 'picker', 'data-back': props.backLabel }, [
        h('button', { 'data-testid': 'picker-back', onClick: () => emit('cancel') }),
        ...props.members.map((m: { id: string }) =>
          h('button', {
            'data-testid': `${props.tileTestidPrefix}${m.id}`,
            onClick: () => emit('pick', m.id),
          })
        ),
      ]);
  },
});

import DealPile from '../DealPile.vue';
import { resetDealActionsForTest } from '../useDealActions';

let wrapper: VueWrapper | null = null;
function mountPile(props: Record<string, unknown> = {}) {
  wrapper = mount(DealPile, {
    props: { scope: 'unsorted', ...props },
    attachTo: document.body,
    global: { stubs: { InlineMemberPicker: PickerStub, MemberChip: true } },
  });
  return wrapper;
}
const has = (w: VueWrapper, id: string) => w.find(`[data-testid="${id}"]`).exists();
const click = (w: VueWrapper, id: string) => w.find(`[data-testid="${id}"]`).trigger('click');
function press(key: string): KeyboardEvent {
  const e = new KeyboardEvent('keydown', { key, cancelable: true });
  window.dispatchEvent(e);
  return e;
}
const logged = (message: string) =>
  telemetry.logEvent.mock.calls.filter((c) => c[0].message === message).map((c) => c[0].context);
function lastUndo(): () => Promise<void> {
  return toast.show.mock.calls.filter((c) => c[3]?.actionFn).at(-1)![3].actionFn;
}

beforeEach(() => {
  vi.clearAllMocks();
  resetDealActionsForTest();
  toast.show.mockImplementation(() => 1);
  store.resolved = [makeCard('laundry'), makeCard('dishes')];
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
  store.bringBack.mockImplementation(async (id: string) => {
    store.set(id, { status: 'held', parts: [{ key: 'main', holderId: 'greg' }] });
    return { result: store.cardById(id), undo: TOKEN };
  });
});
afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
});

describe('DealPile: first decisions', () => {
  it('keep → pick deals once, flies to the face, advances, and Undo jumps back', async () => {
    const w = mountPile();
    expect(has(w, 'deal-pile-card-laundry')).toBe(true);

    await click(w, 'deal-pile-keep');
    await click(w, 'deal-pick-sofia');
    await flushPromises();

    expect(store.deal).toHaveBeenCalledTimes(1);
    expect(store.deal).toHaveBeenCalledWith('laundry', 'main', 'sofia');
    expect(store.keep).not.toHaveBeenCalled();
    const [, target] = fly.flyTo.mock.calls[0]! as unknown as [HTMLElement, HTMLElement];
    expect(target.getAttribute('data-testid')).toBe('deal-pick-sofia');
    expect(has(w, 'deal-pile-card-dishes')).toBe(true);
    expect(has(w, 'deal-list-kept-laundry')).toBe(true);

    store.undo.mockImplementation(async () => {
      store.set('laundry', { status: 'unsorted', parts: [{ key: 'main' }] });
      return true;
    });
    await lastUndo()();
    await flushPromises();
    expect(has(w, 'deal-pile-card-laundry')).toBe(true);
    expect(has(w, 'deal-pile-question')).toBe(true);
  });

  it('an Undo while the card is still flying keeps it on screen, asking again', async () => {
    let land!: () => void;
    fly.flyTo.mockImplementationOnce(() => new Promise<void>((r) => (land = r)));
    store.undo.mockImplementation(async () => {
      store.set('laundry', { status: 'unsorted', parts: [{ key: 'main' }] });
      return true;
    });
    const w = mountPile();
    await click(w, 'deal-pile-keep');
    await click(w, 'deal-pick-sofia');
    await flushPromises();

    await lastUndo()();
    await flushPromises();
    land();
    await flushPromises();

    expect(has(w, 'deal-pile-card-laundry')).toBe(true);
    expect(has(w, 'deal-pick-sofia')).toBe(false);
    expect(has(w, 'deal-pile-question')).toBe(true);
    expect(w.find('[data-testid="deal-pile-card-laundry"]').classes()).not.toContain('is-leaving');
  });

  it('while a pick is in flight the picker and the target face stay, then the pile moves on', async () => {
    let land!: () => void;
    fly.flyTo.mockImplementationOnce(() => new Promise<void>((r) => (land = r)));
    const w = mountPile();
    await click(w, 'deal-pile-keep');
    await click(w, 'deal-pick-sofia');
    await flushPromises();

    // The deal has landed in the store (laundry is held by Sofia), the card is still flying.
    expect(store.cardById('laundry')!.status).toBe('held');
    expect(has(w, 'picker')).toBe(true);
    expect(has(w, 'deal-pick-sofia')).toBe(true);
    expect(w.find('[data-testid="picker"]').attributes('data-back')).toBe(
      'whoOwnsWhat.pile.decideLater'
    );
    expect(has(w, 'deal-pile-banner')).toBe(false);
    expect(has(w, 'deal-pile-back-to')).toBe(false);

    land();
    await flushPromises();
    expect(has(w, 'deal-pile-card-dishes')).toBe(true);
    expect(has(w, 'deal-pile-question')).toBe(true);
  });

  it('while a skip is in flight Keep and Skip stay and no Skipped banner flashes', async () => {
    let land!: () => void;
    fly.flyTo.mockImplementationOnce(() => new Promise<void>((r) => (land = r)));
    const w = mountPile();
    await click(w, 'deal-pile-skip');
    await flushPromises();

    expect(store.cardById('laundry')!.status).toBe('skipped');
    expect(has(w, 'deal-pile-skip')).toBe(true);
    expect(has(w, 'deal-pile-keep')).toBe(true);
    expect(has(w, 'deal-pile-banner')).toBe(false);

    land();
    await flushPromises();
    expect(has(w, 'deal-pile-card-dishes')).toBe(true);
  });

  it('"Decide later" is the only path that calls keep, and moves on', async () => {
    const w = mountPile();
    await click(w, 'deal-pile-keep');
    await click(w, 'picker-back');
    await flushPromises();

    expect(store.keep).toHaveBeenCalledWith('laundry');
    expect(store.deal).not.toHaveBeenCalled();
    expect(fly.flyTo).not.toHaveBeenCalled();
    expect(has(w, 'deal-pile-card-dishes')).toBe(true);
  });

  it('skip flies the card to the Skipped list heading and lists it there', async () => {
    const w = mountPile();
    await click(w, 'deal-pile-skip');
    await flushPromises();

    expect(store.skip).toHaveBeenCalledWith(['laundry']);
    const [, target] = fly.flyTo.mock.calls[0]! as unknown as [HTMLElement, HTMLElement];
    expect(target.getAttribute('data-testid')).toBe('deal-lists-skipped-heading');
    expect(has(w, 'deal-list-skipped-laundry')).toBe(true);
    expect(has(w, 'deal-pile-card-dishes')).toBe(true);
  });

  it('skip works from the faces view too', async () => {
    const w = mountPile();
    await click(w, 'deal-pile-keep');
    await click(w, 'deal-pile-skip-pick');
    await flushPromises();
    expect(store.skip).toHaveBeenCalledWith(['laundry']);
    expect(has(w, 'deal-pile-card-dishes')).toBe(true);
  });

  it('a refused deal leaves the card on the pile with the faces still open', async () => {
    store.deal.mockResolvedValueOnce(null);
    const w = mountPile();
    await click(w, 'deal-pile-keep');
    await click(w, 'deal-pick-greg');
    await flushPromises();

    const card = w.find('[data-testid="deal-pile-card-laundry"]');
    expect(card.exists()).toBe(true);
    expect(card.classes()).not.toContain('is-leaving');
    expect(has(w, 'deal-pick-greg')).toBe(true);
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
    await click(w, 'deal-pile-skip');
    await flushPromises();
    await click(w, 'deal-pile-skip');
    await flushPromises();
    expect(has(w, 'deal-pile-celebrate')).toBe(false);
    expect(has(w, 'deal-pile-done')).toBe(true);
    expect(has(w, 'deal-lists')).toBe(true);
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

  it('startCardId opens the pile at that card', () => {
    store.resolved = [makeCard('laundry', 'waiting'), makeCard('dishes', 'waiting')];
    const w = mountPile({ scope: 'waiting', startCardId: 'dishes' });
    expect(has(w, 'deal-pile-card-dishes')).toBe(true);
    expect(has(w, 'picker')).toBe(true);
  });
});

describe('DealPile: stepping and revisiting', () => {
  beforeEach(() => {
    store.resolved = [makeCard('laundry', 'held', 'sofia'), makeCard('dishes')];
  });

  it('a card visited from the lists does not grow the pile, and "Back to" returns', async () => {
    const w = mountPile({ scope: 'unsorted' });
    expect(has(w, 'deal-pile-card-dishes')).toBe(true);
    const position = () => w.find('[data-testid="deal-pile-position"]').text();
    expect(position()).toBe('whoOwnsWhat.pile.position');
    await click(w, 'deal-list-kept-laundry');
    expect(has(w, 'deal-pile-card-laundry')).toBe(true);
    expect(w.find('[data-testid="deal-list-kept-laundry"]').attributes('aria-current')).toBe(
      'true'
    );
    expect(has(w, 'deal-pile-banner')).toBe(true);
    // Outside the pile's queue: the category alone, and the totals don't move.
    expect(position()).not.toContain('whoOwnsWhat.pile.position');
    expect(w.find('[role="progressbar"]').attributes('aria-valuemax')).toBe('1');
    await click(w, 'deal-pile-back-to');
    expect(has(w, 'deal-pile-card-dishes')).toBe(true);
    expect(w.find('[data-testid="deal-pile-prev"]').attributes('disabled')).toBeDefined();
  });

  it('Bring back from the Skipped list runs the pile revisit: on the card, logged, undo', async () => {
    store.resolved = [makeCard('laundry', 'skipped'), makeCard('dishes')];
    const w = mountPile();
    await click(w, 'deal-list-bring-back-laundry');
    await flushPromises();
    expect(store.bringBack).toHaveBeenCalledWith('laundry');
    expect(has(w, 'deal-pile-card-laundry')).toBe(true);
    expect(has(w, 'deal-banner-give')).toBe(true);
    expect(logged('pile_revisit_change')).toEqual([{ detail: 'bring_back' }]);
    expect(toast.show.mock.calls.at(-1)![3]?.actionFn).toBeTypeOf('function');
  });

  it('a split card with a part held shows that part above "Waiting for a holder"', () => {
    const split: ResolvedCard = {
      ...makeCard('laundry', 'waiting'),
      splitMode: 'label',
      parts: [
        { key: 'a', label: 'Mornings', holderId: 'sofia' },
        { key: 'b', label: 'Evenings' },
      ],
    };
    store.resolved = [split];
    const w = mountPile({ scope: 'waiting' });
    const banner = w.find('[data-testid="deal-pile-banner"]');
    expect(banner.text()).toContain('Mornings');
    expect(banner.text()).toContain('whoOwnsWhat.pile.withSince');
    expect(banner.text()).toContain('whoOwnsWhat.pile.waitingBanner');
    expect(banner.text()).not.toContain('Evenings');
    expect(banner.text().indexOf('Mornings')).toBeLessThan(
      banner.text().indexOf('whoOwnsWhat.pile.waitingBanner')
    );
  });

  it('arrows and list jumps are disabled while an action is in flight', async () => {
    let land!: () => void;
    fly.flyTo.mockImplementationOnce(() => new Promise<void>((r) => (land = r)));
    const w = mountPile();
    await click(w, 'deal-list-kept-laundry');
    await click(w, 'deal-pile-next');
    expect(has(w, 'deal-pile-card-dishes')).toBe(true);
    await click(w, 'deal-pile-skip');
    await flushPromises();
    expect(w.find('[data-testid="deal-pile-prev"]').attributes('disabled')).toBeDefined();
    expect(w.find('[data-testid="deal-list-kept-laundry"]').attributes('disabled')).toBeDefined();
    land();
    await flushPromises();
  });

  it('Give it to someone else excludes the holder; Cancel returns with no write', async () => {
    const w = mountPile();
    await click(w, 'deal-list-kept-laundry');
    await click(w, 'deal-banner-give');
    expect(has(w, 'deal-pick-sofia')).toBe(false);
    expect(has(w, 'deal-pick-greg')).toBe(true);
    expect(w.find('[data-testid="picker"]').attributes('data-back')).toBe('action.cancel');
    await click(w, 'picker-back');
    expect(has(w, 'deal-pile-banner')).toBe(true);
    expect(store.deal).not.toHaveBeenCalled();
    expect(store.keep).not.toHaveBeenCalled();
  });

  it('Give deals to the new holder and stays on the card, without a flight', async () => {
    const w = mountPile();
    await click(w, 'deal-list-kept-laundry');
    await click(w, 'deal-banner-give');
    await click(w, 'deal-pick-greg');
    await flushPromises();
    expect(store.deal).toHaveBeenCalledWith('laundry', 'main', 'greg');
    expect(fly.flyTo).not.toHaveBeenCalled();
    expect(has(w, 'deal-pile-card-laundry')).toBe(true);
    expect(has(w, 'deal-pile-banner')).toBe(true);
  });

  it('Skip instead, then Bring back, both stay on the card with the new banner', async () => {
    const w = mountPile();
    await click(w, 'deal-list-kept-laundry');
    await click(w, 'deal-banner-skip-instead');
    await flushPromises();
    expect(store.skip).toHaveBeenCalledWith(['laundry']);
    expect(has(w, 'deal-pile-card-laundry')).toBe(true);
    expect(has(w, 'deal-banner-bring-back')).toBe(true);

    await click(w, 'deal-banner-bring-back');
    await flushPromises();
    expect(store.bringBack).toHaveBeenCalledWith('laundry');
    expect(has(w, 'deal-pile-card-laundry')).toBe(true);
    expect(has(w, 'deal-banner-give')).toBe(true);
    expect(fly.flyTo).not.toHaveBeenCalled();
  });

  it('a Split save while the faces are open does not open the Give picker', async () => {
    const w = mountPile();
    await click(w, 'deal-pile-keep');
    expect(has(w, 'picker')).toBe(true);
    // The edit drawer saved: the card is now held (by someone, on another path).
    store.set('dishes', { status: 'held', parts: [{ key: 'main', holderId: 'greg' }] });
    await flushPromises();
    expect(has(w, 'picker')).toBe(false);
    expect(has(w, 'deal-pile-banner')).toBe(true);
  });
});

describe('DealPile: keyboard shortcuts', () => {
  it('K keeps, a digit picks that face', async () => {
    const w = mountPile();
    press('k');
    await flushPromises();
    expect(has(w, 'picker')).toBe(true);
    press('2');
    await flushPromises();
    expect(store.deal).toHaveBeenCalledWith('laundry', 'main', 'sofia');
  });

  it('S skips an undecided card but does nothing on a held one', async () => {
    store.resolved = [makeCard('laundry', 'held', 'sofia'), makeCard('dishes')];
    const w = mountPile();
    await click(w, 'deal-list-kept-laundry');
    expect(press('s').defaultPrevented).toBe(false);
    await flushPromises();
    expect(store.skip).not.toHaveBeenCalled();
    expect(press('ArrowRight').defaultPrevented).toBe(true);
    await flushPromises();
    expect(has(w, 'deal-pile-card-dishes')).toBe(true);
    press('S');
    await flushPromises();
    expect(store.skip).toHaveBeenCalledWith(['dishes']);
  });

  it('U taps the live Undo', async () => {
    const w = mountPile();
    await click(w, 'deal-pile-skip');
    await flushPromises();
    press('u');
    await flushPromises();
    expect(toast.invoke).toHaveBeenCalledWith(1);
    expect(w.exists()).toBe(true);
  });

  it('keys that would do nothing keep their default: an arrow at the end, U with no toast', () => {
    mountPile();
    expect(press('ArrowLeft').defaultPrevented).toBe(false);
    expect(press('u').defaultPrevented).toBe(false);
    expect(press('3').defaultPrevented).toBe(false);
    expect(press('ArrowRight').defaultPrevented).toBe(true);
  });

  it('ignores keys while focus is on a control outside the pile', async () => {
    const outside = document.createElement('button');
    document.body.appendChild(outside);
    const w = mountPile();
    outside.focus();
    expect(press('k').defaultPrevented).toBe(false);
    await flushPromises();
    expect(has(w, 'picker')).toBe(false);
    outside.remove();
  });
});
