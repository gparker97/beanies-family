/**
 * The Repeats block of To-do Details (#123). What it must guarantee:
 *   - a repeating to-do shows its cadence with time, where the next roll lands and a Recent
 *     strip with done, skipped and missed chips (Skip This Time lives in the drawer's title row),
 *   - the last occurrence says so instead of naming a next date,
 *   - editing shows the picker WITH its Ends row, started on `repeatStartDate`, and Turn off,
 *   - a card-made to-do is locked: "Set on the {card} card" opens the card; no picker, no Turn off,
 *   - a to-do that does not repeat shows the quiet offer row.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { setActivePinia, createPinia } from 'pinia';
import { ref } from 'vue';
import TodoRepeatField from '../TodoRepeatField.vue';
import RecurrencePicker from '@/components/ui/RecurrencePicker.vue';
import type { RecurrenceRule, TodoItem } from '@/types/models';

const push = vi.hoisted(() => vi.fn());
vi.mock('vue-router', () => ({ useRouter: () => ({ push }) }));

const today = vi.hoisted(() => ({ value: '2026-10-14' }));
vi.mock('@/composables/useToday', () => ({ useToday: () => ({ today: ref(today.value) }) }));

const cards = vi.hoisted(() => new Map<string, unknown>());
vi.mock('@/stores/responsibilityStore', () => ({
  useResponsibilityStore: () => ({ cardById: (id: string) => cards.get(id) }),
}));
vi.mock('@/composables/useMemberInfo', () => ({
  useMemberInfo: () => ({
    getMemberName: (id: string, fallback = 'Unknown') =>
      new Map([
        ['m-sofia', 'Sofia'],
        ['m-dan', 'Dan'],
      ]).get(id) ?? fallback,
  }),
}));

// 2026-09-23 is a Wednesday.
const WEEKLY_WED: RecurrenceRule = {
  unit: 'week',
  interval: 1,
  weekdays: [3],
  end: { kind: 'never' },
};

function todo(overrides: Partial<TodoItem> = {}): TodoItem {
  return {
    id: 't-1',
    title: 'Put the trash out',
    completed: false,
    createdBy: 'm-sofia',
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    dueDate: '2026-10-14',
    dueTime: '20:00',
    repeat: { rule: WEEKLY_WED, anchor: '2026-09-23' },
    repeatLog: [
      { date: '2026-09-30', outcome: 'done', by: 'm-sofia', at: '2026-09-30T20:00:00.000Z' },
      { date: '2026-10-07', outcome: 'skipped', by: 'm-dan', at: '2026-10-07T20:00:00.000Z' },
    ],
    ...overrides,
  };
}

const mountField = (t: TodoItem, editing = false) =>
  mount(TodoRepeatField, { props: { todo: t, editing, draftRule: null } });

describe('TodoRepeatField', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    cards.clear();
    push.mockClear();
    today.value = '2026-10-14';
  });

  it('shows the cadence with its time, the next date, and Recent incl. a derived miss', () => {
    const w = mountField(todo());
    expect(w.text()).toMatch(/weekly on wed at 8pm/i);
    expect(w.find('[data-testid="todo-repeat-next"]').text()).toMatch(/moves to.*21 oct/i);

    const chips = w.findAll('[data-testid="todo-repeat-recent"] [data-outcome]');
    expect(chips.map((c) => c.attributes('data-outcome'))).toEqual(['skipped', 'done', 'missed']);
    expect(chips[0]!.text()).toMatch(/skipped 7 oct/i);
    expect(chips[1]!.text()).toMatch(/30 sep, sofia/i);
    expect(chips[2]!.text()).toMatch(/skipped 23 sep, missed/i);

    expect(w.find('[data-testid="todo-repeat-skip"]').exists()).toBe(false);
    expect(w.find('[data-testid="todo-repeat-locked"]').exists()).toBe(false);
  });

  it('says "This is the last one." when the rule has no next occurrence', () => {
    const w = mountField(
      todo({
        repeat: {
          rule: { ...WEEKLY_WED, end: { kind: 'afterCount', count: 4 } },
          anchor: '2026-09-23',
        },
      })
    );
    expect(w.find('[data-testid="todo-repeat-next"]').text()).toMatch(/this is the last one/i);
  });

  it('editing shows the picker with Ends, started on repeatStartDate, and Turn off', async () => {
    today.value = '2026-10-16'; // the to-do is overdue, so the series restarts from today
    const w = mountField(todo(), true);
    const picker = w.findComponent(RecurrencePicker);
    expect(picker.props()).toMatchObject({
      startDate: '2026-10-16',
      time: '20:00',
      hideEnd: false,
      accent: 'purple',
    });
    // The picker's mount emit (its initial rule) reaches the host's draft.
    expect(w.emitted('update:draftRule')).toBeTruthy();

    await w.find('[data-testid="todo-repeat-turn-off"]').trigger('click');
    expect(w.emitted('turn-off')).toHaveLength(1);
  });

  it('a card-made to-do is locked: the card link opens the card, and editing shows no picker', async () => {
    cards.set('trash', {
      id: 'trash',
      custom: { name: 'Trash Night', emoji: '🗑️' },
      splitMode: 'single',
      parts: [{ key: 'main', holderId: 'm-sofia' }],
      state: null,
    });
    const cardTodo = todo({ cardId: 'trash', cardPartKey: 'main' });
    const w = mountField(cardTodo);
    const link = w.find('[data-testid="todo-repeat-card-link"]');
    expect(link.text()).toMatch(/set on the trash night card/i);

    await link.trigger('click');
    expect(push).toHaveBeenCalledWith({ path: '/who-owns-what', query: { card: 'trash' } });
    expect(w.emitted('open-card')).toEqual([['trash']]);

    const editing = mountField(cardTodo, true);
    expect(editing.findComponent(RecurrencePicker).exists()).toBe(false);
    expect(editing.find('[data-testid="todo-repeat-turn-off"]').exists()).toBe(false);
    expect(editing.find('[data-testid="todo-repeat-locked"]').exists()).toBe(true);
  });

  it('a to-do that does not repeat shows the quiet offer, and editing it offers no Turn off', () => {
    const plain = todo({ repeat: undefined, repeatLog: undefined });
    expect(mountField(plain).find('[data-testid="todo-repeat-off"]').exists()).toBe(true);

    const editing = mountField(plain, true);
    expect(editing.findComponent(RecurrencePicker).exists()).toBe(true);
    expect(editing.find('[data-testid="todo-repeat-turn-off"]').exists()).toBe(false);
  });
});
