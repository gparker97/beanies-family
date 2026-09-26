/**
 * CheckInDrawer: Re-deal moves a card, so the picker it opens never offers the card's
 * current holder (picking them would write nothing, yet toast "dealt" and count a
 * re-deal). Deal Now, for a card with nobody, offers everyone.
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
  nextCheckIn: null,
  cardById(id: string) {
    return this.resolved.find((c) => c.id === id);
  },
  startCheckIn: vi.fn(async () => true),
  completeCheckIn: vi.fn(),
  deal: vi.fn(),
});
vi.mock('@/stores/responsibilityStore', () => ({ useResponsibilityStore: () => store }));

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
        BeanieFormModal: { template: '<div><slot /></div>' },
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

beforeEach(() => {
  setActivePinia(createPinia());
  vi.clearAllMocks();
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
});
