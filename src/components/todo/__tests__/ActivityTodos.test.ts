/**
 * An activity's To-dos section (#114). What it pins:
 *   - open rows first, then a "Done" divider and the done rows, each with its link scope (so
 *     the row hides the chip back to this activity, and tags whole-activity items),
 *   - the "N open" count shows only when something is open,
 *   - the add row is there only with edit permission, even when nothing is linked,
 *   - a new to-do is linked to this session, given to the adder, due the day before the
 *     session (today if that has passed); a one-off gets a plain link and no hint,
 *   - on a rescheduled edited session the due default follows the session's real date while
 *     the link keeps the series + original date,
 *   - ticking goes through the store with the current member,
 *   - tapping a row opens it in a stacked drawer with the activity row hidden.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { ref } from 'vue';
import ActivityTodos from '@/components/todo/ActivityTodos.vue';
import type { FamilyActivity, TodoItem } from '@/types/models';
import type { SessionItem } from '@/utils/activityLinks';

vi.mock('@/services/telemetry/logEvent', () => ({ logEvent: vi.fn() }));
vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({
    t: (k: string) => (k === 'activityTodos.openCount' ? '{count} open' : k),
  }),
}));

const canEditActivities = ref(true);
vi.mock('@/composables/usePermissions', () => ({
  usePermissions: () => ({ canEditActivities }),
}));

vi.mock('@/composables/useAuthoringMember', () => ({
  useAuthoringMember: () => ({ resolveOrToast: () => 'm-greg' }),
}));

const { store } = vi.hoisted(() => ({
  store: {
    todos: [] as TodoItem[],
    session: { open: [], done: [] } as {
      open: SessionItem<TodoItem>[];
      done: SessionItem<TodoItem>[];
    },
    todosForActivitySession: vi.fn(),
    toggleComplete: vi.fn(),
    createTodo: vi.fn(),
  },
}));
vi.mock('@/stores/todoStore', () => ({ useTodoStore: () => store }));
vi.mock('@/stores/familyStore', () => ({
  useFamilyStore: () => ({ currentMember: { id: 'm-greg' } }),
}));

function todo(id: string, completed = false): TodoItem {
  return {
    id,
    title: id,
    completed,
    createdBy: 'm-greg',
    createdAt: '2030-09-01T00:00:00.000Z',
    updatedAt: '2030-09-01T00:00:00.000Z',
  } as TodoItem;
}

const oneOff = {
  id: 'act-1',
  title: 'Tournament',
  date: '2030-10-10',
  recurrence: 'none',
  category: 'soccer',
} as unknown as FamilyActivity;

const series = { ...oneOff, id: 'series-1', recurrence: 'weekly' } as FamilyActivity;

/** A session of `series` edited "this only" and moved from Sat 12th to Sun 13th. */
const editedSession = {
  ...oneOff,
  id: 'child-1',
  date: '2030-10-13',
  parentActivityId: 'series-1',
  originalOccurrenceDate: '2030-10-12',
} as FamilyActivity;

function mountSection(activity: FamilyActivity, sessionYmd: string) {
  return mount(ActivityTodos, {
    props: { activity, sessionYmd },
    global: {
      stubs: {
        TodoItemRow: true,
        TodoViewEditModal: true,
        BeanieDatePicker: true,
        AssigneePickerButton: true,
      },
    },
  });
}

const rows = (w: ReturnType<typeof mountSection>) => w.findAllComponents({ name: 'TodoItemRow' });
const input = (w: ReturnType<typeof mountSection>) => w.find('input');

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2030, 9, 1, 12, 0)); // Tue 1 Oct 2030, local noon
  canEditActivities.value = true;
  store.todos = [];
  store.session = { open: [], done: [] };
  store.todosForActivitySession.mockImplementation(() => store.session);
  store.createTodo.mockImplementation(async (input: object) => ({ id: 'todo-new', ...input }));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('ActivityTodos', () => {
  it('draws open rows, then "Done" and the done rows, each with its link scope', () => {
    store.session = {
      open: [
        { item: todo('bring-oranges'), scope: 'session' },
        { item: todo('pay-fees'), scope: 'every-session' },
      ],
      done: [{ item: todo('wash-kit', true), scope: 'session' }],
    };
    const w = mountSection(series, '2030-10-12');

    expect(store.todosForActivitySession).toHaveBeenCalledWith(series, '2030-10-12');
    expect(rows(w).map((r) => [r.props('todo').id, r.props('activityScope')])).toEqual([
      ['bring-oranges', 'session'],
      ['pay-fees', 'every-session'],
      ['wash-kit', 'session'],
    ]);
    // The divider sits between the last open row and the first done one.
    const order = [
      ...w.find('[data-testid="activity-todos-done"]').element.parentElement!.children,
    ];
    const divider = order.findIndex(
      (el) => el.getAttribute('data-testid') === 'activity-todos-done'
    );
    expect(divider).toBe(2);
    expect(order).toHaveLength(4);
    expect(w.text()).toContain('2 open');
  });

  it('shows no count and no Done divider when nothing is linked, but still the add row', () => {
    const w = mountSection(oneOff, '2030-10-10');
    expect(w.text()).not.toContain('open');
    expect(w.find('[data-testid="activity-todos-done"]').exists()).toBe(false);
    expect(input(w).exists()).toBe(true);
  });

  it('hides the add row without permission to edit activities', () => {
    canEditActivities.value = false;
    const w = mountSection(oneOff, '2030-10-10');
    expect(input(w).exists()).toBe(false);
  });

  it('hides the whole section for a viewer who cannot add and has nothing linked', () => {
    canEditActivities.value = false;
    const w = mountSection(oneOff, '2030-10-10');
    expect(w.find('[data-testid="activity-todos"]').exists()).toBe(false);
  });

  it('adds a to-do linked to this session, given to the adder, due the day before', async () => {
    const w = mountSection(series, '2030-10-12');
    expect(input(w).attributes('placeholder')).toBe('activityTodos.addSessionPlaceholder');
    await input(w).trigger('focusin');
    expect(w.find('[data-testid="quick-add-hint"]').exists()).toBe(true);

    await input(w).setValue('Sign the form');
    await input(w).trigger('keydown', { key: 'Enter' });
    await flushPromises();

    expect(store.createTodo).toHaveBeenCalledWith({
      title: 'Sign the form',
      dueDate: '2030-10-11',
      assigneeIds: ['m-greg'],
      assigneeId: 'm-greg',
      activityId: 'series-1',
      activityDate: '2030-10-12',
      completed: false,
      createdBy: 'm-greg',
    });
  });

  it('links a one-off by id alone, with the plain placeholder and no hint', async () => {
    const w = mountSection(oneOff, '2030-10-10');
    expect(input(w).attributes('placeholder')).toBe('activityTodos.addPlaceholder');
    await input(w).trigger('focusin');
    expect(w.find('[data-testid="quick-add-hint"]').exists()).toBe(false);

    await input(w).setValue('Sign the form');
    await input(w).trigger('keydown', { key: 'Enter' });
    await flushPromises();

    const written = store.createTodo.mock.calls[0]![0];
    expect(written.activityId).toBe('act-1');
    expect('activityDate' in written && written.activityDate !== undefined).toBe(false);
  });

  it('never defaults to a past due date', async () => {
    const w = mountSection(oneOff, '2030-10-01'); // the session is today
    await input(w).setValue('Sign the form');
    await input(w).trigger('keydown', { key: 'Enter' });
    await flushPromises();
    expect(store.createTodo.mock.calls[0]![0].dueDate).toBe('2030-10-01');
  });

  it('on a rescheduled edited session: due before its real date, linked to series + original date', async () => {
    const w = mountSection(editedSession, '2030-10-13');
    await input(w).setValue('Sign the form');
    await input(w).trigger('keydown', { key: 'Enter' });
    await flushPromises();

    expect(store.createTodo).toHaveBeenCalledWith(
      expect.objectContaining({
        dueDate: '2030-10-12',
        activityId: 'series-1',
        activityDate: '2030-10-12',
      })
    );
  });

  it('ticks through the store as the current member', () => {
    store.session = { open: [{ item: todo('bring-oranges'), scope: 'session' }], done: [] };
    const w = mountSection(oneOff, '2030-10-10');
    rows(w)[0]!.vm.$emit('toggle', 'bring-oranges');
    expect(store.toggleComplete).toHaveBeenCalledWith('bring-oranges', 'm-greg');
  });

  it('opens a row in a stacked drawer with the activity row hidden', async () => {
    const item = todo('bring-oranges');
    store.todos = [item];
    store.session = { open: [{ item, scope: 'session' }], done: [] };
    const w = mountSection(oneOff, '2030-10-10');
    const drawer = () => w.findComponent({ name: 'TodoViewEditModal' });
    expect(drawer().props('todo')).toBeNull();

    rows(w)[0]!.vm.$emit('view', item);
    await flushPromises();
    expect(drawer().props()).toMatchObject({ todo: item, stacked: true, hideActivityLink: true });

    drawer().vm.$emit('close');
    await flushPromises();
    expect(drawer().props('todo')).toBeNull();
  });
});
