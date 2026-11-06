/**
 * To-do Details, the #123 wiring. What it must guarantee:
 *   - the completion checkbox sits beside the title (the list row's control) and ticks through
 *     `todoStore.toggleComplete`; the footer has no Mark Completed / Reopen button,
 *   - a repeating to-do: no "Track as" chips, a read-only Due Date with the "moves with the
 *     repeat" hint, and the title row's Skip This Time pill goes to `todoStore.skipOccurrence`
 *     (the pill shows only on an open repeating to-do, never on a plain or completed one),
 *   - a card-made to-do: no Delete (with the "turn it off on the card" caption), the Linked Card
 *     row, the "Made by the {card} card" meta, and the read-only Keep Parents Posted hint for a child assignee,
 *   - a cadence saved on ✓ goes through `todoStore.setRepeat`.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { setActivePinia, createPinia } from 'pinia';
import { defineComponent, h } from 'vue';
import TodoViewEditModal from '../TodoViewEditModal.vue';
import TodoRepeatField from '../TodoRepeatField.vue';
import LinkedCardChip from '../LinkedCardChip.vue';
import CreatedMeta from '@/components/common/CreatedMeta.vue';
import InlineEditField from '@/components/ui/InlineEditField.vue';
import { useFamilyStore } from '@/stores/familyStore';
import type { TodoItem, TodoRepeat } from '@/types/models';

vi.mock('vue-router', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));
vi.mock('@/composables/useSounds', () => ({
  useSounds: () => ({ playWhoosh: vi.fn(), playPop: vi.fn() }),
}));
vi.mock('@/composables/useConfirm', () => ({ confirm: vi.fn() }));

const store = vi.hoisted(() => ({
  todos: [] as unknown[],
  toggleComplete: vi.fn(),
  skipOccurrence: vi.fn(),
  setRepeat: vi.fn(),
  setNotifyParents: vi.fn(),
  updateTodo: vi.fn(),
  setSomeday: vi.fn(),
  discardTodo: vi.fn(),
  acknowledgeHint: vi.fn(),
}));
vi.mock('@/stores/todoStore', () => ({ useTodoStore: () => store }));

const cards = vi.hoisted(() => new Map<string, unknown>());
vi.mock('@/stores/responsibilityStore', () => ({
  useResponsibilityStore: () => ({ cardById: (id: string) => cards.get(id) }),
}));

/** The drawer shell: renders the body and exposes `showDelete` like the real footer would. */
const BeanieFormModalStub = defineComponent({
  name: 'BeanieFormModal',
  props: { showDelete: Boolean },
  setup(_, { slots }) {
    return () => h('div', [slots.default?.(), slots['footer-start']?.()]);
  },
});

// 2026-10-14 is a Wednesday.
const repeat: TodoRepeat = {
  rule: { unit: 'week', interval: 1, weekdays: [3], end: { kind: 'never' } },
  anchor: '2026-10-07',
};

function todo(over: Partial<TodoItem> = {}): TodoItem {
  return {
    id: 't-1',
    title: 'Put the trash out',
    completed: false,
    createdBy: 'm-sofia',
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    ...over,
  };
}

function mountDrawer(t: TodoItem) {
  store.todos = [t];
  return mount(TodoViewEditModal, {
    props: { todo: t },
    global: {
      stubs: { BeanieFormModal: BeanieFormModalStub, MemberChip: true, LinkList: true },
    },
  });
}

const fieldLabels = (w: ReturnType<typeof mountDrawer>) =>
  w.findAllComponents({ name: 'FormFieldGroup' }).map((f) => f.props('label'));

describe('TodoViewEditModal (#123)', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    cards.clear();
    vi.clearAllMocks();
    useFamilyStore().members = [
      { id: 'm-sofia', name: 'Sofia', role: 'owner', ageGroup: 'adult' },
      { id: 'm-leo', name: 'Leo', role: 'member', ageGroup: 'child' },
    ] as never;
    // A grown-up is signed in (Keep Parents Posted is adults-only).
    useFamilyStore().setCurrentMember('m-sofia');
  });

  it('ticks through the checkbox beside the title; the footer has no complete button', async () => {
    const w = mountDrawer(todo());
    expect(w.text()).not.toContain('action.markCompleted');
    expect(w.text()).not.toContain('todo.reopenTask');

    await w.get('[data-testid="todo-complete-checkbox"]').trigger('click');
    expect(store.toggleComplete).toHaveBeenCalledWith('t-1', expect.any(String));
  });

  it('a plain to-do keeps Track as, Delete, and offers the repeat', () => {
    const w = mountDrawer(todo({ dueDate: '2026-10-14' }));
    expect(fieldLabels(w)).toContain('todo.kind');
    expect(fieldLabels(w)).toContain('todo.repeat.label');
    expect(w.getComponent(BeanieFormModalStub).props('showDelete')).toBe(true);
    expect(w.find('[data-testid="todo-date-follows"]').exists()).toBe(false);
  });

  it('a repeating to-do: no Track as, Due Date locked with its hint, Skip goes to the store', async () => {
    const w = mountDrawer(todo({ dueDate: '2026-10-14', repeat, repeatLog: [] }));
    expect(fieldLabels(w)).not.toContain('todo.kind');
    expect(fieldLabels(w)).toContain('todo.repeat.field');
    expect(w.find('[data-testid="todo-date-follows"]').exists()).toBe(true);
    // Title stays editable; Due Date does not.
    const disabled = w.findAllComponents(InlineEditField).map((f) => f.props('disabled'));
    expect(disabled[0]).toBe(false);
    expect(disabled[1]).toBe(true);

    const skip = w.get('[data-testid="todo-repeat-skip"]');
    expect(skip.attributes('aria-label')).toBe('todo.repeat.skipAria');
    await skip.trigger('click');
    await flushPromises();
    expect(store.skipOccurrence).toHaveBeenCalledWith('t-1', expect.any(String));
  });

  it('offers no Skip pill on a plain or a completed repeating to-do', () => {
    const plain = mountDrawer(todo({ dueDate: '2026-10-14' }));
    expect(plain.find('[data-testid="todo-repeat-skip"]').exists()).toBe(false);
    const done = mountDrawer(
      todo({ dueDate: '2026-10-14', repeat, repeatLog: [], completed: true })
    );
    expect(done.find('[data-testid="todo-repeat-skip"]').exists()).toBe(false);
  });

  it('saves an edited cadence through setRepeat', async () => {
    const w = mountDrawer(todo({ dueDate: '2026-10-14', repeat, repeatLog: [] }));
    const repeatField = w
      .findAllComponents(InlineEditField)
      .find((f) => f.findComponent(TodoRepeatField).exists())!;
    repeatField.vm.$emit('start-edit');
    await flushPromises();

    const daily = { unit: 'day', interval: 1, end: { kind: 'never' } };
    w.getComponent(TodoRepeatField).vm.$emit('update:draftRule', daily);
    await w.get('[data-testid="todo-repeat-save"]').trigger('click');
    await flushPromises();
    expect(store.setRepeat).toHaveBeenCalledWith('t-1', daily);
  });

  it('a card-made to-do: no Delete, the card caption, Linked Card, Made by, and the adults note', () => {
    cards.set('plants', {
      id: 'plants',
      custom: { name: 'Plants', emoji: '🪴' },
      splitMode: 'single',
      parts: [{ key: 'main', holderId: 'm-leo' }],
      state: null,
    });
    const w = mountDrawer(
      todo({
        dueDate: '2026-10-14',
        repeat,
        repeatLog: [],
        assigneeIds: ['m-leo'],
        cardId: 'plants',
        cardPartKey: 'main',
      })
    );
    expect(w.getComponent(BeanieFormModalStub).props('showDelete')).toBe(false);
    expect(w.find('[data-testid="todo-delete-on-card"]').exists()).toBe(true);
    // Managed on the card: a read-only hint, never a switch.
    expect(w.find('[data-testid="todo-notify-parents-hint"]').text()).toBe(
      'recurrence.notifyParents.hintOff'
    );
    expect(w.find('[data-testid="todo-notify-parents"]').exists()).toBe(false);
    expect(w.getComponent(LinkedCardChip).props()).toMatchObject({
      cardId: 'plants',
      variant: 'row',
    });
    expect(w.getComponent(CreatedMeta).props('label')).toBe('todo.linkedCard.madeBy');
    // Title, assignee, due date, due time and repeat are the card's.
    expect(w.findAllComponents(InlineEditField).filter((f) => f.props('disabled'))).toHaveLength(5);
  });

  describe('Keep Parents Posted', () => {
    const childRoutine = (over: Partial<TodoItem> = {}) =>
      todo({
        dueDate: '2026-10-14',
        repeat,
        repeatLog: [],
        assigneeIds: ['m-leo'],
        ...over,
      });
    const sw = (w: ReturnType<typeof mountDrawer>) => w.find('[data-testid="todo-notify-parents"]');

    it('a child-only repeating to-do offers the switch, which saves through setNotifyParents', async () => {
      const w = mountDrawer(childRoutine());
      expect(sw(w).exists()).toBe(true);
      await sw(w).trigger('click');
      expect(store.setNotifyParents).toHaveBeenCalledWith('t-1', true);
    });

    it('reflects the saved flag and turns it off', async () => {
      const w = mountDrawer(childRoutine({ notifyParents: true }));
      expect(sw(w).attributes('aria-checked')).toBe('true');
      await sw(w).trigger('click');
      expect(store.setNotifyParents).toHaveBeenCalledWith('t-1', false);
    });

    it('is not offered to a child viewer: only a grown-up may set it', () => {
      useFamilyStore().setCurrentMember('m-leo');
      expect(sw(mountDrawer(childRoutine())).exists()).toBe(false);
    });

    it('is not offered for an adult assignee, a one-off, or a completed to-do', () => {
      expect(sw(mountDrawer(childRoutine({ assigneeIds: ['m-sofia'] }))).exists()).toBe(false);
      expect(
        sw(mountDrawer(todo({ dueDate: '2026-10-14', assigneeIds: ['m-leo'] }))).exists()
      ).toBe(false);
      expect(sw(mountDrawer(childRoutine({ completed: true }))).exists()).toBe(false);
    });

    it('a card to-do has no interactive switch, and the read-only hint follows its flag', () => {
      cards.set('plants', {
        id: 'plants',
        custom: { name: 'Plants', emoji: '🪴' },
        splitMode: 'single',
        parts: [{ key: 'main', holderId: 'm-leo' }],
        state: null,
      });
      const w = mountDrawer(
        childRoutine({ cardId: 'plants', cardPartKey: 'main', notifyParents: true })
      );
      expect(sw(w).exists()).toBe(false);
      expect(w.get('[data-testid="todo-notify-parents-hint"]').text()).toBe(
        'recurrence.notifyParents.hintOn'
      );
    });
  });
});
