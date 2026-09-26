/**
 * Who Owns What (#109) card drawers and page: the contracts a regression would break
 * silently.
 *  - The edit drawer saves ONE draft through ONE store call (`saveCard` / `createCustom`),
 *    never a sequence of actions, and closes only on a truthy result.
 *  - Built-in cards show the DISABLED delete tile with its reason; family-made cards the
 *    real one.
 *  - Children see everything read-only: no Edit, no delete, no Add, no write menu items.
 */
import { setActivePinia, createPinia } from 'pinia';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { defineComponent, reactive } from 'vue';
import { getResponsibilityCard } from '@/constants/responsibilityCards';
import type { ResolvedCard } from '@/utils/responsibilityDeck';
import type { FamilyMember } from '@/types/models';

vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));
vi.mock('@/composables/useToast', () => ({ showToast: vi.fn(() => 1), dismissToast: vi.fn() }));
vi.mock('@/composables/useConfirm', () => ({ confirm: vi.fn(async () => true) }));
vi.mock('@/composables/useSounds', () => ({ playWhoosh: vi.fn() }));
vi.mock('@/services/telemetry/logEvent', () => ({ logEvent: vi.fn() }));
vi.mock('vue-router', () => ({
  useRoute: () => ({ query: {} }),
  useRouter: () => ({ replace: vi.fn() }),
}));

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

const LAUNDRY: ResolvedCard = {
  id: 'laundry',
  def: getResponsibilityCard('laundry'),
  isCustom: false,
  category: 'home',
  emoji: '🧺',
  status: 'held',
  splitMode: 'single',
  parts: [{ key: 'main', holderId: 'greg' }],
  state: {
    id: 'laundry',
    status: 'kept',
    splitMode: 'single',
    parts: [{ key: 'main', holderId: 'greg' }],
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
  },
};
const SWIM: ResolvedCard = {
  ...LAUNDRY,
  id: 'custom-swim',
  def: undefined,
  isCustom: true,
  custom: { name: 'Swim gear', emoji: '🏊', category: 'kids' },
  category: 'kids',
  emoji: '🏊',
};

const store = reactive({
  cards: { laundry: LAUNDRY, 'custom-swim': SWIM } as Record<string, ResolvedCard>,
  canDeal: true,
  isLoaded: true,
  isFirstDeal: false,
  resolved: [LAUNDRY, SWIM],
  stats: { total: 2, deck: 2, held: 2, waiting: 0, skipped: 0, unsorted: 0, splitCount: 0 },
  customCount: 1,
  rhythmWeeks: 4,
  cardById(id: string) {
    return this.cards[id];
  },
  load: vi.fn(),
  saveCard: vi.fn(),
  createCustom: vi.fn(),
  deleteCustom: vi.fn(),
  deal: vi.fn(),
  keep: vi.fn(),
  skip: vi.fn(),
  bringBack: vi.fn(),
});
vi.mock('@/stores/responsibilityStore', () => ({ useResponsibilityStore: () => store }));

import { showToast } from '@/composables/useToast';
import { confirm } from '@/composables/useConfirm';
import CardEditDrawer from '../CardEditDrawer.vue';
import CardSplitEditor from '../CardSplitEditor.vue';
import CardViewDrawer from '../CardViewDrawer.vue';
import WhoOwnsWhatPage from '@/pages/WhoOwnsWhatPage.vue';

const FormModalStub = defineComponent({
  name: 'BeanieFormModal',
  props: ['open', 'showDelete', 'deleteDisabledReason', 'saveLabel', 'isSubmitting'],
  emits: ['save', 'close', 'delete'],
  template: `<div v-if="open">
    <button data-testid="save" @click="$emit('save')">{{ saveLabel }}</button>
    <button v-if="showDelete" data-testid="delete" @click="$emit('delete')" />
    <span v-if="deleteDisabledReason" data-testid="delete-reason">{{ deleteDisabledReason }}</span>
    <slot /><slot name="footer-start" />
  </div>`,
});
/** Held as a value so the test can drive the editor's v-model directly. */
const SplitEditorStub = defineComponent({
  name: 'CardSplitEditor',
  props: ['modelValue'],
  emits: ['update:modelValue'],
  template: '<div data-testid="split-editor" />',
});
const stubs = {
  BeanieFormModal: FormModalStub,
  CardSplitEditor: SplitEditorStub,
  FormFieldGroup: { template: '<div><slot /></div>' },
  BaseInput: {
    props: ['modelValue'],
    emits: ['update:modelValue'],
    template:
      '<input :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />',
  },
  EmojiPicker: true,
  ListCategoryPills: true,
  ToggleSwitch: true,
  MemberChip: true,
};

async function openEdit(cardId: string | null) {
  const w = mount(CardEditDrawer, { props: { open: false, cardId }, global: { stubs } });
  await w.setProps({ open: true });
  await flushPromises();
  return w;
}

beforeEach(() => {
  setActivePinia(createPinia());
  vi.clearAllMocks();
  store.canDeal = true;
  store.saveCard.mockImplementation(async (id: string) => store.cards[id]);
  store.createCustom.mockImplementation(async () => SWIM);
});

describe('CardEditDrawer', () => {
  it('saves the whole edit as ONE draft through ONE store call', async () => {
    const w = await openEdit('laundry');
    w.findComponent(SplitEditorStub).vm.$emit('update:modelValue', {
      splitMode: 'single',
      parts: [{ key: 'main', holderId: 'sofia' }],
    });
    await w.find('[data-testid="save"]').trigger('click');
    await flushPromises();

    expect(store.saveCard).toHaveBeenCalledTimes(1);
    expect(store.saveCard).toHaveBeenCalledWith('laundry', {
      splitMode: 'single',
      parts: [{ key: 'main', holderId: 'sofia' }],
      doneOverride: undefined,
      skipped: false,
    });
    for (const other of [store.deal, store.keep, store.skip, store.bringBack, store.createCustom])
      expect(other).not.toHaveBeenCalled();
    expect(w.emitted('close')).toHaveLength(1);
  });

  it('shows the re-deal note when an unsplit card changes hands', async () => {
    const w = await openEdit('laundry');
    expect(w.find('[data-testid="card-edit-redeal-note"]').exists()).toBe(false);
    w.findComponent(SplitEditorStub).vm.$emit('update:modelValue', {
      splitMode: 'single',
      parts: [{ key: 'main', holderId: 'sofia' }],
    });
    await flushPromises();
    expect(w.find('[data-testid="card-edit-redeal-note"]').exists()).toBe(true);
  });

  it('a split with no parts (By child, no children) never reaches the store', async () => {
    const w = await openEdit('laundry');
    w.findComponent(SplitEditorStub).vm.$emit('update:modelValue', {
      splitMode: 'child',
      parts: [],
    });
    await w.find('[data-testid="save"]').trigger('click');
    await flushPromises();
    expect(store.saveCard).not.toHaveBeenCalled();
    expect(w.emitted('close')).toBeUndefined();
  });

  it('stays open when the store refused (the store already said why)', async () => {
    store.saveCard.mockResolvedValue(null);
    const w = await openEdit('laundry');
    await w.find('[data-testid="save"]').trigger('click');
    await flushPromises();
    expect(w.emitted('close')).toBeUndefined();
  });

  it('a family-made card sends its name, emoji and category in the same draft', async () => {
    const w = await openEdit('custom-swim');
    await w.find('[data-testid="save"]').trigger('click');
    await flushPromises();
    expect(store.saveCard).toHaveBeenCalledWith(
      'custom-swim',
      expect.objectContaining({ custom: { name: 'Swim gear', emoji: '🏊', category: 'kids' } })
    );
  });

  it('a new card is one createCustom call', async () => {
    const w = await openEdit(null);
    await w.find('input').setValue('Swim gear');
    await w.find('[data-testid="save"]').trigger('click');
    await flushPromises();
    expect(store.createCustom).toHaveBeenCalledTimes(1);
    expect(store.createCustom).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Swim gear', category: 'home' })
    );
    expect(store.saveCard).not.toHaveBeenCalled();
  });

  it('built-in: the delete tile is disabled with the reason; custom: a real delete', async () => {
    const builtIn = await openEdit('laundry');
    expect(builtIn.find('[data-testid="delete"]').exists()).toBe(false);
    expect(builtIn.find('[data-testid="delete-reason"]').text()).toBe(
      'whoOwnsWhat.details.builtInDelete'
    );
    const custom = await openEdit('custom-swim');
    expect(custom.find('[data-testid="delete"]').exists()).toBe(true);
    expect(custom.find('[data-testid="delete-reason"]').exists()).toBe(false);
  });
});

describe('CardSplitEditor', () => {
  const PillsStub = defineComponent({
    name: 'TogglePillGroup',
    props: ['modelValue', 'options'],
    template: '<div />',
  });
  const modes = (members: readonly object[]) =>
    mount(CardSplitEditor, {
      props: {
        modelValue: { splitMode: 'single', parts: [{ key: 'main' }] },
        members: members as FamilyMember[],
        holders: [],
      },
      global: {
        stubs: {
          TogglePillGroup: PillsStub,
          FormFieldGroup: { template: '<div><slot /></div>' },
          FamilyChipPicker: true,
          BeanieAvatar: true,
        },
      },
    })
      .findComponent(PillsStub)
      .props('options')
      .map((o: { value: string }) => o.value);

  it('offers By child only when the family has a child to split for', () => {
    expect(modes(family.members)).toEqual(['single', 'label']);
    expect(
      modes([...family.members, { id: 'leo', name: 'Leo', role: 'member', ageGroup: 'child' }])
    ).toEqual(['single', 'child', 'label']);
  });
});

describe('CardViewDrawer', () => {
  const mountView = (canEdit: boolean, cardId = 'laundry') =>
    mount(CardViewDrawer, { props: { open: true, cardId, canEdit }, global: { stubs } });

  it('a grown-up sees Edit and, on a built-in card, the disabled delete with its reason', () => {
    const w = mountView(true);
    expect(w.find('[data-testid="card-view-edit"]').exists()).toBe(true);
    expect(w.find('[data-testid="delete"]').exists()).toBe(false);
    expect(w.find('[data-testid="delete-reason"]').exists()).toBe(true);
  });

  it('deleting from its own tile shows the delete toast only, never the card-gone notice', async () => {
    const saved = store.cards['custom-swim']!;
    store.deleteCustom.mockImplementation(async (id: string) => {
      delete store.cards[id];
      return true;
    });
    const w = mountView(true, 'custom-swim');
    await w.find('[data-testid="delete"]').trigger('click');
    await flushPromises();
    expect(store.deleteCustom).toHaveBeenCalledWith('custom-swim');
    expect(w.emitted('close')).toHaveLength(1);
    const titles = vi.mocked(showToast).mock.calls.map((c) => c[1]);
    expect(titles).toEqual(['whoOwnsWhat.delete.done']);
    w.unmount();
    store.cards['custom-swim'] = saved;
  });

  it('a card deleted elsewhere while open still says so and closes', async () => {
    const saved = store.cards['custom-swim']!;
    const w = mountView(true, 'custom-swim');
    delete store.cards['custom-swim'];
    await flushPromises();
    expect(vi.mocked(showToast).mock.calls.map((c) => c[1])).toEqual([
      'whoOwnsWhat.error.cardGone',
    ]);
    expect(w.emitted('close')).toHaveLength(1);
    w.unmount();
    store.cards['custom-swim'] = saved;
  });

  it('a card deleted elsewhere while the delete confirm is up still says so and closes', async () => {
    const saved = store.cards['custom-swim']!;
    let answer!: (ok: boolean) => void;
    vi.mocked(confirm).mockImplementationOnce(() => new Promise<boolean>((r) => (answer = r)));
    const w = mountView(true, 'custom-swim');
    await w.find('[data-testid="delete"]').trigger('click');
    delete store.cards['custom-swim']; // another device, while the confirm is open
    await flushPromises();
    expect(vi.mocked(showToast).mock.calls.map((c) => c[1])).toEqual([
      'whoOwnsWhat.error.cardGone',
    ]);
    expect(w.emitted('close')).toHaveLength(1);
    answer(false);
    await flushPromises();
    expect(store.deleteCustom).not.toHaveBeenCalled();
    w.unmount();
    store.cards['custom-swim'] = saved;
  });

  it('a child sees the card read-only: no Edit, no delete of any kind', () => {
    for (const id of ['laundry', 'custom-swim']) {
      const w = mountView(false, id);
      expect(w.find('[data-testid="card-view-name"]').exists()).toBe(true);
      expect(w.find('[data-testid="card-view-edit"]').exists()).toBe(false);
      expect(w.find('[data-testid="delete"]').exists()).toBe(false);
      expect(w.find('[data-testid="delete-reason"]').exists()).toBe(false);
    }
  });
});

describe('WhoOwnsWhatPage', () => {
  const MenuStub = defineComponent({
    name: 'OverflowMenu',
    props: ['items'],
    template: '<div />',
  });
  const mountPage = () =>
    mount(WhoOwnsWhatPage, {
      global: {
        stubs: {
          ...stubs,
          OverflowMenu: MenuStub,
          PageWelcomeSubtitle: true,
          TogglePillGroup: true,
          DeckOverview: true,
          FirstDealEmptyState: true,
          DeckGrid: true,
          CardViewDrawer: true,
          CardEditDrawer: true,
          AddEntityButton: { template: '<button />' },
        },
      },
    });
  const menuIds = (w: ReturnType<typeof mountPage>) =>
    (w.findComponent(MenuStub).props('items') as { id: string }[]).map((i) => i.id);

  it('a grown-up gets Add and every menu item', () => {
    const w = mountPage();
    expect(w.find('[data-testid="who-owns-what-add"]').exists()).toBe(true);
    expect(menuIds(w)).toEqual(['share', 'export', 'rhythm', 'skipped', 'restore']);
  });

  it('a child gets no Add and only the read-only menu items', () => {
    store.canDeal = false;
    const w = mountPage();
    expect(w.find('[data-testid="who-owns-what-add"]').exists()).toBe(false);
    expect(menuIds(w)).toEqual(['share', 'export', 'skipped']);
  });
});
