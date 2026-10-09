/**
 * The live to-do a card reminder made, linked from the card drawer (#123). What it must guarantee:
 *   - it resolves only through `todoStore.todos` and renders nothing on a miss,
 *   - the row reads the to-do's title, and its next day and time under it,
 *   - a tap opens the to-do (`/todo?view=<id>`) and emits `open` so the host drawer can close.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { reactive } from 'vue';
import LinkedTodoRow from '../LinkedTodoRow.vue';

const push = vi.hoisted(() => vi.fn());
vi.mock('vue-router', () => ({ useRouter: () => ({ push }) }));

vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

vi.mock('@/composables/useToday', async () => {
  const { ref } = await import('vue');
  return { useToday: () => ({ today: ref('2026-10-14') }) };
});

const todoState = vi.hoisted(() => ({ todos: [] as Record<string, unknown>[] }));
vi.mock('@/stores/todoStore', () => ({ useTodoStore: () => todoState }));

describe('LinkedTodoRow', () => {
  beforeEach(() => {
    push.mockClear();
    todoState.todos = reactive([
      {
        id: 'card-trash-main',
        title: 'Put the trash out',
        dueDate: '2026-10-14',
        dueTime: '20:00',
        completed: false,
      },
      { id: 'card-plants-main', title: 'Water the plants', dueDate: '2026-10-17' },
    ]);
  });

  it('renders nothing when the to-do does not exist (yet)', () => {
    const w = mount(LinkedTodoRow, { props: { todoId: 'card-gone-main' } });
    expect(w.find('button').exists()).toBe(false);
  });

  it('names the to-do and says when it is next due, with the time', () => {
    const w = mount(LinkedTodoRow, { props: { todoId: 'card-trash-main' } });
    expect(w.find('[data-testid="linked-item-row"]').exists()).toBe(true);
    expect(w.text()).toContain('Put the trash out');
    expect(w.text()).toContain('date.today, 8pm');
    expect(w.find('button').attributes('aria-label')).toBe('whoOwnsWhat.reminder.openTodo');
  });

  it('an untimed to-do on another day shows the day alone', () => {
    const w = mount(LinkedTodoRow, { props: { todoId: 'card-plants-main' } });
    expect(w.text()).toContain('Water the plants');
    expect(w.text()).not.toContain('date.today');
    expect(w.text()).not.toContain('pm');
  });

  it('a tap opens the to-do drawer and emits open', async () => {
    const w = mount(LinkedTodoRow, { props: { todoId: 'card-trash-main' } });
    await w.find('button').trigger('click');
    expect(push).toHaveBeenCalledWith({ path: '/todo', query: { view: 'card-trash-main' } });
    expect(w.emitted('open')).toEqual([['card-trash-main']]);
  });
});
