/**
 * Who Owns What (#109) card drawers and page: the contracts a regression would break
 * silently.
 *  - The edit drawer saves ONE draft through ONE store call (`saveCard` / `createCustom`),
 *    never a sequence of actions, and closes only on a truthy result.
 *  - Built-in cards show the DISABLED delete tile with its reason; family-made cards the
 *    real one.
 *  - Children see everything read-only: no Edit, no delete, no Add, no write menu items.
 *  - Card reminders (#123): the edit drawer seeds, edits and carries the `reminders` map in the
 *    same one draft (one control per part, one open at a time; a mode switch keeps it); the
 *    view drawer prints the stub, the single card's Reminder field with its live to-do, and
 *    each split part's line.
 */
import { setActivePinia, createPinia } from 'pinia';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount, flushPromises, enableAutoUnmount } from '@vue/test-utils';
import { defineComponent, reactive } from 'vue';
import { getResponsibilityCard } from '@/constants/responsibilityCards';
import type { ResolvedCard } from '@/utils/responsibilityDeck';
import type { CardReminder, FamilyMember } from '@/types/models';

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
  moves: [] as {
    id: string;
    cardId: string;
    partKey: string;
    fromId?: string;
    toId?: string;
    at: string;
  }[],
  checkIns: [] as unknown[],
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
import DealPileStage from '../DealPileStage.vue';
import { logEvent } from '@/services/telemetry/logEvent';
import { swipe } from '@/test/pointerSwipe';
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
  template: `<div data-testid="split-editor">
    <template v-if="modelValue.splitMode !== 'single'">
      <slot name="parts-intro" />
      <div v-for="part in modelValue.parts" :key="part.key"><slot name="part" :part="part" /></div>
    </template>
  </div>`,
});
const ReminderFieldStub = defineComponent({
  name: 'CardReminderField',
  props: ['modelValue', 'holderName', 'cardName', 'childHolder', 'partLabel', 'expanded'],
  emits: ['update:modelValue', 'update:expanded'],
  template: '<div data-testid="reminder-field" />',
});
const LinkedTodoStub = defineComponent({
  name: 'LinkedTodoRow',
  props: ['todoId'],
  emits: ['open'],
  template: '<div data-testid="linked-todo" />',
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
  CardReminderField: ReminderFieldStub,
  LinkedTodoRow: LinkedTodoStub,
};

/** Every Monday at 8pm (#123). */
const REMINDER: CardReminder = {
  say: 'Laundry day',
  cadence: { unit: 'week', interval: 1, weekdays: [1] },
  time: '20:00',
  anchor: '2026-09-07',
};
/** Laundry with a reminder on its one part, or a child split of it; restored after each test. */
function withCard(card: ResolvedCard): void {
  store.cards[card.id] = card;
}
const LAUNDRY_REMINDING: ResolvedCard = {
  ...LAUNDRY,
  parts: [{ key: 'main', holderId: 'greg', reminder: REMINDER }],
  hasReminder: true,
};
const SPLIT_REMINDING: ResolvedCard = {
  ...LAUNDRY,
  id: 'school-drop-off',
  def: getResponsibilityCard('school-drop-off'),
  category: 'kids',
  emoji: '🎒',
  splitMode: 'label',
  parts: [
    { key: 'label-a', label: 'Mornings', holderId: 'greg', reminder: REMINDER },
    { key: 'label-b', label: 'Afternoons', holderId: 'sofia' },
    { key: 'label-c', label: 'Weekends' },
  ],
  hasReminder: true,
};

async function openEdit(cardId: string | null) {
  const w = mount(CardEditDrawer, { props: { open: false, cardId }, global: { stubs } });
  await w.setProps({ open: true });
  await flushPromises();
  return w;
}

// Drawers now watch their card: a wrapper leaked from an earlier test would react to this
// one's store edits.
enableAutoUnmount(afterEach);

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
      reminders: {},
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

  it('a card that vanishes while open says so and emits close, so the page resets', async () => {
    const saved = store.cards['custom-swim']!;
    try {
      const w = await openEdit('custom-swim');
      delete store.cards['custom-swim']; // another device deleted it
      await flushPromises();
      expect(vi.mocked(showToast).mock.calls.map((c) => c[1])).toEqual([
        'whoOwnsWhat.error.cardGone',
      ]);
      expect(w.emitted('close')).toHaveLength(1);
    } finally {
      store.cards['custom-swim'] = saved;
    }
  });

  it('retargeted while open, the form refills for the new card (never saves the old draft)', async () => {
    const w = await openEdit('custom-swim');
    expect((w.find('[data-testid="card-edit-name-input"]').element as HTMLInputElement).value).toBe(
      'Swim gear'
    );
    // Edit on another card while `open` stays true: no open transition to seed on.
    await w.setProps({ cardId: 'laundry' });
    await flushPromises();
    expect(w.findComponent(SplitEditorStub).props('modelValue')).toEqual({
      splitMode: 'single',
      parts: [{ key: 'main', holderId: 'greg' }],
    });
    await w.find('[data-testid="save"]').trigger('click');
    await flushPromises();
    expect(store.saveCard).toHaveBeenCalledTimes(1);
    const [id, draft] = store.saveCard.mock.calls[0]!;
    expect(id).toBe('laundry');
    expect(draft.custom).toBeUndefined();
    // And to New: the identity fields reset.
    await w.setProps({ cardId: null });
    await flushPromises();
    expect((w.find('[data-testid="card-edit-name-input"]').element as HTMLInputElement).value).toBe(
      ''
    );
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

describe('CardEditDrawer reminders (#123)', () => {
  afterEach(() => {
    store.cards.laundry = LAUNDRY;
    delete store.cards['school-drop-off'];
  });
  const fields = (w: Awaited<ReturnType<typeof openEdit>>) =>
    w.findAllComponents(ReminderFieldStub);

  it('a new card has no Reminder field', async () => {
    const w = await openEdit(null);
    expect(fields(w)).toHaveLength(0);
  });

  it('a single card seeds one open field from the card and saves the edit in the one draft', async () => {
    withCard(LAUNDRY_REMINDING);
    const w = await openEdit('laundry');
    const [field] = fields(w);
    expect(fields(w)).toHaveLength(1);
    expect(field!.props()).toMatchObject({
      modelValue: REMINDER,
      holderName: 'greg',
      childHolder: false,
      expanded: true,
      partLabel: undefined,
    });
    // The name a blank What to Say saves.
    expect(field!.props('cardName')).toBeTruthy();

    const next = { ...REMINDER, time: '19:00' };
    field!.vm.$emit('update:modelValue', next);
    await w.find('[data-testid="save"]').trigger('click');
    await flushPromises();
    expect(store.saveCard).toHaveBeenCalledTimes(1);
    expect(store.saveCard.mock.calls[0]![1].reminders).toEqual({ main: next });
  });

  it('turned off, the draft carries an empty map (the store clears it)', async () => {
    withCard(LAUNDRY_REMINDING);
    const w = await openEdit('laundry');
    fields(w)[0]!.vm.$emit('update:modelValue', null);
    await w.find('[data-testid="save"]').trigger('click');
    await flushPromises();
    expect(store.saveCard.mock.calls[0]![1].reminders).toEqual({});
  });

  it('a split card: one control per part, the hint once, and one open at a time', async () => {
    withCard(SPLIT_REMINDING);
    const w = await openEdit('school-drop-off');
    expect(w.findAll('[data-testid="card-reminder-per-part-hint"]')).toHaveLength(1);
    const parts = fields(w);
    expect(parts.map((f) => f.props('holderName'))).toEqual(['greg', 'Sofia', null]);
    expect(parts.map((f) => f.props('partLabel'))).toEqual(['Mornings', 'Afternoons', 'Weekends']);
    expect(parts.map((f) => f.props('modelValue'))).toEqual([REMINDER, null, null]);
    expect(parts.every((f) => f.props('expanded') === false)).toBe(true);

    parts[0]!.vm.$emit('update:expanded', true);
    await flushPromises();
    expect(fields(w).map((f) => f.props('expanded'))).toEqual([true, false, false]);
    fields(w)[1]!.vm.$emit('update:expanded', true);
    await flushPromises();
    expect(fields(w).map((f) => f.props('expanded'))).toEqual([false, true, false]);

    const second = { ...REMINDER, say: 'Pick up' };
    fields(w)[1]!.vm.$emit('update:modelValue', second);
    await w.find('[data-testid="save"]').trigger('click');
    await flushPromises();
    expect(store.saveCard.mock.calls[0]![1].reminders).toEqual({
      'label-a': REMINDER,
      'label-b': second,
    });
  });

  it('switching split to single keeps the first part reminder, on the card', async () => {
    withCard(SPLIT_REMINDING);
    const w = await openEdit('school-drop-off');
    w.findComponent(SplitEditorStub).vm.$emit('update:modelValue', {
      splitMode: 'single',
      parts: [{ key: 'main', holderId: 'greg' }],
    });
    await flushPromises();
    expect(fields(w)).toHaveLength(1);
    expect(fields(w)[0]!.props('modelValue')).toEqual(REMINDER);
    expect(w.find('[data-testid="card-reminder-per-part-hint"]').exists()).toBe(false);
    await w.find('[data-testid="save"]').trigger('click');
    await flushPromises();
    expect(store.saveCard.mock.calls[0]![1].reminders).toEqual({ main: REMINDER });
  });

  it('switching single to split carries the reminder to the first part', async () => {
    withCard(LAUNDRY_REMINDING);
    const w = await openEdit('laundry');
    w.findComponent(SplitEditorStub).vm.$emit('update:modelValue', {
      splitMode: 'label',
      parts: [
        { key: 'label-x', label: '', holderId: 'greg' },
        { key: 'label-y', label: '' },
      ],
    });
    await flushPromises();
    expect(fields(w).map((f) => f.props('modelValue'))).toEqual([REMINDER, null]);
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

  it('opens on the card itself, owner on the card, history below; done is not repeated', () => {
    store.moves = [
      { id: 'm1', cardId: 'laundry', partKey: 'main', toId: 'sofia', at: '2026-09-02T10:00:00Z' },
      {
        id: 'm2',
        cardId: 'laundry',
        partKey: 'main',
        fromId: 'sofia',
        toId: 'greg',
        at: '2026-09-10T10:00:00Z',
      },
    ];
    const w = mountView(true);
    expect(w.find('[data-testid="card-view-card-laundry"]').exists()).toBe(true);
    expect(w.find('[data-testid="card-view-owner"]').text()).toContain(
      'whoOwnsWhat.details.heldByName'
    );
    // Newest first: the hand-over, the first deal, then when it was first sorted.
    const history = w.findAll('[data-testid="card-view-history"] li').map((li) => li.text());
    expect(history).toHaveLength(3);
    expect(history[0]).toContain('whoOwnsWhat.history.moved');
    expect(history[1]).toContain('whoOwnsWhat.history.dealt');
    expect(history[2]).toContain('whoOwnsWhat.history.sorted');
    store.moves = [];
    expect(w.html()).not.toContain('whoOwnsWhat.details.done');
    // Deep link / no list: no arrows, no counter.
    expect(w.find('[data-testid="card-view-prev"]').exists()).toBe(false);
    expect(w.find('[data-testid="card-view-position"]').exists()).toBe(false);
  });

  it('steps through the list it was opened from: arrows, ← →, ends disabled', async () => {
    const w = mount(CardViewDrawer, {
      props: {
        open: true,
        cardId: 'laundry',
        sequence: { label: 'Home', ids: ['laundry', 'custom-swim', 'gone'] },
        canEdit: true,
      },
      global: { stubs },
    });
    // 'gone' no longer exists: the list is 2 long.
    expect(w.find('[data-testid="card-view-position"]').exists()).toBe(true);
    expect(w.find('[data-testid="card-view-prev"]').attributes('disabled')).toBeDefined();
    await w.find('[data-testid="card-view-next"]').trigger('click');
    expect(w.emitted('navigate')).toEqual([['custom-swim']]);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', cancelable: true }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', cancelable: true }));
    // Still on laundry (the parent owns the id): → steps again, ← is at the start.
    expect(w.emitted('navigate')).toEqual([['custom-swim'], ['custom-swim']]);
  });

  it('a touch swipe on the card in hand steps (the stage owns it); a mouse drag does not', () => {
    const w = mount(CardViewDrawer, {
      props: {
        open: true,
        cardId: 'laundry',
        sequence: { label: 'Home', ids: ['laundry', 'custom-swim'] },
      },
      global: { stubs },
      attachTo: document.body,
    });
    const stage = w.findComponent(DealPileStage).element as HTMLElement;
    swipe(stage, { x: 200, y: 100 }, { x: 60, y: 100 }, 'mouse');
    expect(w.emitted('navigate')).toBeUndefined();
    // At the start: a swipe right has nowhere to go.
    swipe(stage, { x: 60, y: 100 }, { x: 200, y: 100 });
    expect(w.emitted('navigate')).toBeUndefined();
    swipe(stage, { x: 200, y: 100 }, { x: 60, y: 100 });
    expect(w.emitted('navigate')).toEqual([['custom-swim']]);
    expect(
      vi.mocked(logEvent).mock.calls.filter((c) => c[0].message === 'card_view_navigate')
    ).toEqual([[expect.objectContaining({ context: { detail: 'swipe' } })]]);
    w.unmount();
  });

  it('reaching the end hands focus to the other arrow instead of dropping it', async () => {
    const w = mount(CardViewDrawer, {
      props: {
        open: true,
        cardId: 'laundry',
        sequence: { label: 'Home', ids: ['laundry', 'custom-swim'] },
      },
      global: { stubs },
      attachTo: document.body,
    });
    (w.find('[data-testid="card-view-next"]').element as HTMLButtonElement).focus();
    await w.setProps({ cardId: 'custom-swim' });
    await flushPromises();
    expect(document.activeElement).toBe(w.find('[data-testid="card-view-prev"]').element);
    w.unmount();
  });

  it('a split card lists its parts BELOW the card: an open one says Nobody Yet', () => {
    store.cards['school-drop-off'] = {
      ...LAUNDRY,
      id: 'school-drop-off',
      def: getResponsibilityCard('school-drop-off'),
      category: 'kids',
      emoji: '🎒',
      status: 'waiting',
      splitMode: 'child',
      parts: [{ key: 'mia', holderId: 'greg' }, { key: 'leo' }],
      state: null,
    };
    const w = mountView(true, 'school-drop-off');
    // On the card: just who holds it.
    expect(w.find('[data-testid="card-view-owner"]').text()).toContain(
      'whoOwnsWhat.details.heldByName'
    );
    const split = w.find('[data-testid="card-view-split"]');
    expect(split.findAll('li')).toHaveLength(2);
    expect(split.text()).toContain('whoOwnsWhat.deck.nobody');
    delete store.cards['school-drop-off'];
  });

  describe('reminders (#123)', () => {
    afterEach(() => {
      store.cards.laundry = LAUNDRY;
      delete store.cards['school-drop-off'];
      family.members = family.members.filter((m) => m.id !== 'leo');
    });

    it('a single card: the stub on the card, then the Reminder field and its live to-do', () => {
      withCard(LAUNDRY_REMINDING);
      const w = mountView(true);
      const stub = w.find('[data-testid="card-view-stub"]');
      expect(stub.exists()).toBe(true);
      expect(stub.text()).toContain('🔔');
      expect(stub.text()).not.toContain('whoOwnsWhat.reminder.partNone');
      const field = w.find('[data-testid="card-view-reminder"]');
      expect(field.text()).toContain('whoOwnsWhat.reminder.goesOn');
      expect(field.text()).not.toContain('whoOwnsWhat.reminder.adultsSee');
      expect(w.findComponent(LinkedTodoStub).props('todoId')).toBe('card-laundry-main');
    });

    it('opening the linked to-do closes the drawer', () => {
      withCard(LAUNDRY_REMINDING);
      const w = mountView(true);
      w.findComponent(LinkedTodoStub).vm.$emit('open', 'card-laundry-main');
      expect(w.emitted('close')).toHaveLength(1);
    });

    it('a child holder: adults see it too', () => {
      family.members = [
        ...family.members,
        { id: 'leo', name: 'Leo', role: 'member', ageGroup: 'child' },
      ];
      withCard({
        ...LAUNDRY_REMINDING,
        parts: [{ key: 'main', holderId: 'leo', reminder: REMINDER }],
      });
      const w = mountView(false);
      expect(w.find('[data-testid="card-view-reminder-adults"]').exists()).toBe(true);
    });

    it('a split card: a stub line per held part, and each split row says its reminder', () => {
      withCard(SPLIT_REMINDING);
      const w = mountView(true, 'school-drop-off');
      const stubLines = w.findAll('[data-testid="card-view-stub"] p').map((p) => p.text());
      // The part nobody holds is left off the card.
      expect(stubLines).toHaveLength(2);
      expect(stubLines[0]).toContain('Mornings');
      expect(stubLines[0]).toContain('🔔');
      expect(stubLines[1]).toContain('whoOwnsWhat.reminder.partNone');
      // No separate Reminder field: the rows carry it.
      expect(w.find('[data-testid="card-view-reminder"]').exists()).toBe(false);
      expect(w.findComponent(LinkedTodoStub).exists()).toBe(false);
      const rows = w.findAll('[data-testid="card-view-split"] li');
      expect(rows[0]!.find('[data-testid="card-view-split-reminder"]').text()).toContain(
        'whoOwnsWhat.reminder.remindsHolder'
      );
      expect(rows[1]!.find('[data-testid="card-view-split-reminder-none"]').exists()).toBe(true);
    });

    it('no reminder: no stub; a grown-up gets "No reminder" and how to add one, a child nothing', () => {
      const adult = mountView(true);
      expect(adult.find('[data-testid="card-view-stub"]').exists()).toBe(false);
      const none = adult.find('[data-testid="card-view-reminder-none"]');
      expect(none.text()).toContain('whoOwnsWhat.reminder.none');
      expect(none.text()).toContain('whoOwnsWhat.reminder.editHint');

      const child = mountView(false);
      expect(child.find('[data-testid="card-view-reminder-none"]').exists()).toBe(false);
      expect(child.text()).not.toContain('whoOwnsWhat.reminder.editHint');
      expect(child.findComponent(LinkedTodoStub).exists()).toBe(false);
    });
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
    expect(menuIds(w)).toEqual(['rhythm', 'skipped', 'restore']);
  });

  it('a child gets no Add and only the read-only menu items', () => {
    store.canDeal = false;
    const w = mountPage();
    expect(w.find('[data-testid="who-owns-what-add"]').exists()).toBe(false);
    expect(menuIds(w)).toEqual(['skipped']);
  });
});
