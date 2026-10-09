/**
 * The family's reminders roster (#123). What it must guarantee:
 *   - one group per member in family order, under each to-do's first assignee still in the
 *     family (a to-do for two never counts twice), unassigned last,
 *   - each group says how many reminders it holds, and a child's group says adults see it too,
 *   - a row shows the title, the cadence with time, "Next" + its day, and ↻ or the card emoji,
 *   - a tap on a row emits `view`; the card chip renders under a card-made row,
 *   - an empty roster shows the shared empty state.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { setActivePinia, createPinia } from 'pinia';
import { ref } from 'vue';
import TodoRemindersRoster from '../TodoRemindersRoster.vue';
import LinkedCardChip from '../LinkedCardChip.vue';
import { useFamilyStore } from '@/stores/familyStore';
import type { TodoItem, TodoRepeat } from '@/types/models';

vi.mock('vue-router', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/composables/useToday', () => ({ useToday: () => ({ today: ref('2026-10-14') }) }));

const cards = vi.hoisted(() => new Map<string, unknown>());
vi.mock('@/stores/responsibilityStore', () => ({
  useResponsibilityStore: () => ({ cardById: (id: string) => cards.get(id) }),
}));

// 2026-10-14 is a Wednesday.
const repeat: TodoRepeat = {
  rule: { unit: 'week', interval: 1, weekdays: [3], end: { kind: 'never' } },
  anchor: '2026-10-07',
};

function todo(id: string, assigneeIds: string[], over: Partial<TodoItem> = {}): TodoItem {
  return {
    id,
    title: id,
    completed: false,
    dueDate: '2026-10-14',
    repeat,
    repeatLog: [],
    assigneeIds,
    createdBy: 'm-sofia',
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    ...over,
  };
}

const groupKeys = (w: ReturnType<typeof mount>) =>
  w.findAll('[data-testid="member-group-card"]').map((g) => g.attributes('data-group'));

describe('TodoRemindersRoster', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    cards.clear();
    useFamilyStore().members = [
      { id: 'm-sofia', name: 'Sofia', role: 'owner', ageGroup: 'adult', color: '#f15d22' },
      { id: 'm-dan', name: 'Dan', role: 'admin', ageGroup: 'adult', color: '#2c3e50' },
      { id: 'm-leo', name: 'Leo', role: 'member', ageGroup: 'child', color: '#aed6f1' },
    ] as never;
  });

  it('shows the shared empty state with no repeating to-dos', () => {
    const w = mount(TodoRemindersRoster, { props: { todos: [] } });
    expect(w.find('[data-testid="todo-reminders-empty"]').exists()).toBe(true);
  });

  it('groups by first known assignee in family order, unassigned last, without double counting', () => {
    const w = mount(TodoRemindersRoster, {
      props: {
        todos: [
          todo('plants', ['m-leo']),
          todo('sitter', ['m-dan', 'm-sofia']),
          todo('filter', ['m-gone', 'm-dan']),
          todo('trash', ['m-sofia']),
          todo('lights', []),
        ],
      },
    });
    const sortedIds = useFamilyStore().sortedHumans.map((m) => m.id);
    const expected = sortedIds.filter((id) => ['m-sofia', 'm-dan', 'm-leo'].includes(id));
    expect(groupKeys(w)).toEqual([...expected, 'unassigned']);

    const dan = w.find('[data-group="m-dan"]');
    expect(dan.findAll('li').map((li) => li.text())).toEqual([
      expect.stringContaining('sitter'),
      expect.stringContaining('filter'),
    ]);
    expect(dan.text()).toMatch(/2 reminders/i);
    expect(w.find('[data-group="m-sofia"]').text()).toMatch(/1 reminder\b/i);
  });

  it("notes that adults see a child's reminders, only on the child's group", () => {
    const w = mount(TodoRemindersRoster, {
      props: { todos: [todo('plants', ['m-leo']), todo('trash', ['m-sofia'])] },
    });
    expect(w.find('[data-group="m-leo"] [data-testid="todo-reminders-adults-see"]').exists()).toBe(
      true
    );
    expect(
      w.find('[data-group="m-sofia"] [data-testid="todo-reminders-adults-see"]').exists()
    ).toBe(false);
  });

  it('a row shows the cadence with time and Next, ↻ for a plain one, the card emoji for a card one', async () => {
    cards.set('trash', {
      id: 'trash',
      custom: { name: 'Trash Night', emoji: '🗑️' },
      splitMode: 'single',
      parts: [{ key: 'main', holderId: 'm-sofia' }],
      state: null,
    });
    const plain = todo('sitter', ['m-dan'], { dueTime: '18:00', dueDate: '2026-10-21' });
    const cardMade = todo('trash', ['m-sofia'], {
      dueTime: '20:00',
      cardId: 'trash',
      cardPartKey: 'main',
    });
    const w = mount(TodoRemindersRoster, { props: { todos: [plain, cardMade] } });

    const sitter = w.find('[data-roster-todo="sitter"]');
    expect(sitter.text()).toContain('↻');
    expect(sitter.text()).toMatch(/weekly on wed at 6pm/i);
    expect(sitter.text()).toMatch(/next/i);
    expect(sitter.text()).toContain('21 Oct');

    const trash = w.find('[data-roster-todo="trash"]');
    expect(trash.text()).toContain('🗑️');
    expect(trash.text()).toMatch(/today/i);
    expect(w.findComponent(LinkedCardChip).props()).toMatchObject({
      cardId: 'trash',
      partKey: 'main',
    });

    await sitter.trigger('click');
    expect(w.emitted('view')).toEqual([[plain]]);
  });
});
