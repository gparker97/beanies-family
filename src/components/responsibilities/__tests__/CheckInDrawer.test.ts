/**
 * CheckInDrawer: Re-deal moves a card, so the picker it opens never offers the card's
 * current holder (picking them would write nothing, yet toast "dealt" and count a
 * re-deal), and Re-deal is not offered at all when nobody else could take it. Deal Now,
 * for a card with nobody, offers everyone. An Undo from the deal's toast reopens the card.
 */
import { setActivePinia, createPinia } from 'pinia';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { defineComponent, reactive } from 'vue';
import { getResponsibilityCard } from '@/constants/responsibilityCards';
import type { ResolvedCard } from '@/utils/responsibilityDeck';

vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));
vi.mock('@/composables/useToday', () => ({ useToday: () => ({ today: { value: '2026-09-26' } }) }));
vi.mock('@/composables/useToast', () => ({ showToast: vi.fn(() => 1), dismissToast: vi.fn() }));

const family = reactive({
  members: [
    { id: 'greg', name: 'greg', role: 'owner', ageGroup: 'adult' },
    { id: 'sofia', name: 'Sofia', role: 'member', ageGroup: 'adult' },
  ],
  get sortedHumans() {
    return this.members;
  },
});
vi.mock('@/stores/familyStore', () => ({ useFamilyStore: () => family }));

const OLD = '2026-01-01T10:00:00.000Z'; // held, unchanged 90+ days
function card(id: string, holderId?: string): ResolvedCard {
  const def = getResponsibilityCard(id)!;
  const parts = [{ key: 'main', ...(holderId ? { holderId } : {}) }];
  return {
    id,
    def,
    isCustom: false,
    category: def.category,
    emoji: def.emoji,
    status: holderId ? 'held' : 'waiting',
    splitMode: 'single',
    parts,
    state: { id, status: 'kept', splitMode: 'single', parts, createdAt: OLD, updatedAt: OLD },
  };
}
const store = reactive({
  resolved: [card('laundry', 'greg'), card('dishes')],
  moves: [],
  lastCheckIn: undefined,
  checkInSince: undefined,
  nextCheckIn: null,
  cardById(id: string) {
    return this.resolved.find((c) => c.id === id);
  },
  startCheckIn: vi.fn(async () => true),
  completeCheckIn: vi.fn(),
  deal: vi.fn(),
  undo: vi.fn(async () => true),
});
vi.mock('@/stores/responsibilityStore', () => ({ useResponsibilityStore: () => store }));

import { dismissToast, showToast } from '@/composables/useToast';
import { resetDealActionsForTest } from '../useDealActions';
import CheckInDrawer from '../CheckInDrawer.vue';

const PickerStub = defineComponent({
  name: 'InlineMemberPicker',
  props: ['members'],
  template: '<div data-testid="picker" />',
});
const PillsStub = defineComponent({
  name: 'TogglePillGroup',
  props: ['modelValue', 'options'],
  emits: ['update:modelValue'],
  template: '<div />',
});

function mountDrawer() {
  return mount(CheckInDrawer, {
    props: { open: true },
    global: {
      stubs: {
        BeanieFormModal: {
          emits: ['save'],
          template: '<div><button data-testid="save" @click="$emit(\'save\')" /><slot /></div>',
        },
        InlineMemberPicker: PickerStub,
        TogglePillGroup: PillsStub,
        MemberChip: true,
        DeckCelebration: true,
      },
    },
  });
}
const offered = (w: ReturnType<typeof mountDrawer>) =>
  (w.findComponent(PickerStub).props('members') as { id: string }[]).map((m) => m.id);

const TOKEN = {
  action: 'deal' as const,
  before: {},
  afterUpdatedAt: {},
  createdMoveIds: [],
  createdCheckInIds: [],
};
const optionsOf = (w: ReturnType<typeof mountDrawer>, id: string) =>
  (
    w.find(`[data-testid="checkin-unchanged-${id}"]`).findComponent(PillsStub).props('options') as {
      value: string;
    }[]
  ).map((o) => o.value);

beforeEach(() => {
  setActivePinia(createPinia());
  vi.clearAllMocks();
  resetDealActionsForTest();
  family.members = [
    { id: 'greg', name: 'greg', role: 'owner', ageGroup: 'adult' },
    { id: 'sofia', name: 'Sofia', role: 'member', ageGroup: 'adult' },
  ];
});

describe('CheckInDrawer', () => {
  it('Re-deal never offers the card to the member who already holds it', async () => {
    const w = mountDrawer();
    w.find('[data-testid="checkin-unchanged-laundry"]')
      .findComponent(PillsStub)
      .vm.$emit('update:modelValue', 'redeal');
    await flushPromises();
    expect(offered(w)).toEqual(['sofia']);
  });

  it('Deal Now, for a card with nobody, offers everyone', async () => {
    const w = mountDrawer();
    await w.find('[data-testid="checkin-deal-dishes"]').trigger('click');
    expect(offered(w)).toEqual(['greg', 'sofia']);
  });

  it('offers no Re-deal when the holder is the only member (never an empty picker)', () => {
    family.members = [{ id: 'greg', name: 'greg', role: 'owner', ageGroup: 'adult' }];
    const w = mountDrawer();
    expect(optionsOf(w, 'laundry')).toEqual(['stillWorks', 'talk']);
  });

  it('an Undo from the Deal Now toast reopens the card and drops it from the counts', async () => {
    store.deal.mockResolvedValue({ result: store.resolved[1], undo: TOKEN });
    const w = mountDrawer();
    await w.find('[data-testid="checkin-deal-dishes"]').trigger('click');
    w.findComponent(PickerStub).vm.$emit('pick', 'sofia');
    await flushPromises();
    expect(w.find('[data-testid="checkin-deal-dishes"]').exists()).toBe(false);
    const opts = vi.mocked(showToast).mock.calls.at(-1)![3] as { actionFn: () => Promise<void> };
    await opts.actionFn();
    await flushPromises();
    expect(store.undo).toHaveBeenCalledWith(TOKEN);
    expect(w.find('[data-testid="checkin-deal-dishes"]').exists()).toBe(true);
    await w.find('[data-testid="checkin-deal-dishes"]').trigger('click');
    expect(w.findComponent(PickerStub).exists()).toBe(true);
  });

  it("Finish retires a deal's live Undo, so the record and the deck can't disagree", async () => {
    vi.mocked(showToast).mockReturnValueOnce(41); // the deal's Undo toast
    store.deal.mockResolvedValue({ result: store.resolved[1], undo: TOKEN });
    const w = mountDrawer();
    await w.find('[data-testid="checkin-deal-dishes"]').trigger('click');
    w.findComponent(PickerStub).vm.$emit('pick', 'sofia');
    await flushPromises();
    // A refused finish keeps the Undo: nothing was recorded.
    store.completeCheckIn.mockResolvedValueOnce(null);
    await w.find('[data-testid="save"]').trigger('click');
    await flushPromises();
    expect(dismissToast).not.toHaveBeenCalled();
    store.completeCheckIn.mockResolvedValueOnce({ id: 'ci', completedAt: OLD, dealtNow: 1 });
    await w.find('[data-testid="save"]').trigger('click');
    await flushPromises();
    expect(store.completeCheckIn).toHaveBeenLastCalledWith(
      expect.objectContaining({ dealtNow: 1 })
    );
    expect(dismissToast).toHaveBeenCalledWith(41);
    expect(store.undo).not.toHaveBeenCalled();
  });
});
