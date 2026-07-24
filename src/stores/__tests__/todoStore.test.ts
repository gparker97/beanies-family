import { setActivePinia, createPinia } from 'pinia';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { TodoItem } from '@/types/models';

vi.mock('@/services/automerge/repositories/todoRepository', () => ({
  getAllTodos: vi.fn().mockResolvedValue([]),
  createTodo: vi.fn(),
  updateTodo: vi.fn(),
  deleteTodo: vi.fn(),
}));

vi.mock('@/composables/useCelebration', () => ({ celebrate: vi.fn() }));

// Pass-through — the member filter is exercised in its own test; here we want
// the unfiltered/filtered getters to track the same `todos` source.
vi.mock('@/composables/useMemberFiltered', () => ({
  createMemberFiltered: <T>(source: { value: T[] }) => ({
    get value() {
      return source.value;
    },
  }),
}));

import { useTodoStore } from '../todoStore';
import * as todoRepo from '@/services/automerge/repositories/todoRepository';

function todo(overrides: Partial<TodoItem> = {}): TodoItem {
  return {
    id: 't-1',
    title: 'Buy fruit',
    completed: false,
    createdBy: 'm-1',
    createdAt: '2026-05-01T00:00:00.000Z',
    updatedAt: '2026-05-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('todoStore — someday lane', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  it('partitions open to-dos into active vs. someday; completed in neither', () => {
    const store = useTodoStore();
    const active = todo({ id: 'a', createdAt: '2026-05-03T00:00:00.000Z' });
    const activeDated = todo({
      id: 'b',
      dueDate: '2026-06-01',
      createdAt: '2026-05-02T00:00:00.000Z',
    });
    const someday = todo({ id: 's', someday: true, createdAt: '2026-05-04T00:00:00.000Z' });
    const done = todo({ id: 'd', completed: true, completedAt: '2026-05-05T00:00:00.000Z' });
    const somedayDone = todo({
      id: 'sd',
      someday: true,
      completed: true,
      completedAt: '2026-05-06T00:00:00.000Z',
    });
    store.todos = [active, activeDated, someday, done, somedayDone];

    expect(store.activeTodos.map((t) => t.id)).toEqual(['a', 'b']); // someday excluded, sorted newest-created
    expect(store.somedayTodos.map((t) => t.id)).toEqual(['s']);
    expect(store.completedTodos.map((t) => t.id)).toEqual(['sd', 'd']); // includes a completed someday item
    expect(store.scheduledTodos.map((t) => t.id)).toEqual(['b']); // active + has a date — never a someday item
    expect(store.undatedTodos.map((t) => t.id)).toEqual(['a']);
    // Filtered variants mirror the unfiltered ones (member filter is a pass-through here).
    expect(store.filteredActiveTodos.map((t) => t.id)).toEqual(['a', 'b']);
    expect(store.filteredSomedayTodos.map((t) => t.id)).toEqual(['s']);
    expect(store.filteredScheduledTodos.map((t) => t.id)).toEqual(['b']);
  });

  it('setSomeday(true) marks the item someday AND clears its due date/time', async () => {
    const store = useTodoStore();
    const original = todo({ id: 't', dueDate: '2026-06-01', dueTime: '09:00' });
    store.todos = [original];
    // Repo returns the entity with the schedule removed (mimics the real delete).
    vi.mocked(todoRepo.updateTodo).mockResolvedValue({ ...original, someday: true } as TodoItem);

    await store.setSomeday('t', true);

    expect(todoRepo.updateTodo).toHaveBeenCalledWith('t', {
      someday: true,
      dueDate: undefined,
      dueTime: undefined,
    });
    expect(store.somedayTodos.map((t) => t.id)).toEqual(['t']);
    expect(store.activeTodos).toEqual([]);
  });

  it('setSomeday(false) clears the someday flag (item returns to active)', async () => {
    const store = useTodoStore();
    const original = todo({ id: 't', someday: true });
    store.todos = [original];
    vi.mocked(todoRepo.updateTodo).mockResolvedValue({ ...original, someday: false } as TodoItem);

    await store.setSomeday('t', false);

    expect(todoRepo.updateTodo).toHaveBeenCalledWith('t', { someday: false });
    expect(store.activeTodos.map((t) => t.id)).toEqual(['t']);
    expect(store.somedayTodos).toEqual([]);
  });

  it('completing a someday to-do keeps the someday flag (toggleComplete only touches completion)', async () => {
    const store = useTodoStore();
    const original = todo({ id: 't', someday: true });
    store.todos = [original];
    vi.mocked(todoRepo.updateTodo).mockImplementation(async (_id, input) => ({
      ...original,
      ...(input as Partial<TodoItem>),
    }));

    await store.toggleComplete('t', 'm-1');

    const call = vi.mocked(todoRepo.updateTodo).mock.calls[0]![1] as Partial<TodoItem>;
    expect(call.completed).toBe(true);
    expect('someday' in call).toBe(false); // toggleComplete doesn't touch `someday`
    expect(store.completedTodos.map((t) => t.id)).toEqual(['t']);
    expect(store.completedTodos[0]!.someday).toBe(true);
    expect(store.somedayTodos).toEqual([]); // not in someday (it's completed)
  });
});

describe('todoStore — Helpful Hints (#40)', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('keeps hints OUT of every manual lane but IN activeTodos + hintTodos', () => {
    const store = useTodoStore();
    const manual = todo({ id: 'm', dueDate: '2020-01-01' }); // past → overdue
    // A hint with a past nudge-date dueDate would leak into overdue/scheduled if
    // those lanes read activeTodos instead of manualActiveTodos.
    const hint = todo({
      id: 'h',
      dueDate: '2020-01-01',
      hintType: 'trip-packing',
      hintKey: 'trip-packing:x:2020-01-03',
      hintEventDate: '2020-01-03',
    });
    store.todos = [manual, hint];

    expect(store.activeTodos.map((t) => t.id).sort()).toEqual(['h', 'm']); // reminder path still sees the hint
    expect(store.manualActiveTodos.map((t) => t.id)).toEqual(['m']);
    expect(store.overdueTodos.map((t) => t.id)).toEqual(['m']); // hint never overdue
    expect(store.scheduledTodos.map((t) => t.id)).toEqual(['m']);
    expect(store.filteredActiveTodos.map((t) => t.id)).toEqual(['m']); // Open feed hint-free
    expect(store.hintTodos.map((t) => t.id)).toEqual(['h']);
  });

  it('allHintTodos includes completed hints (for reconcile) while hintTodos excludes them', () => {
    const store = useTodoStore();
    const active = todo({ id: 'a', hintType: 'trip-packing', hintKey: 'ka' });
    const done = todo({ id: 'd', hintType: 'trip-packing', hintKey: 'kd', completed: true });
    store.todos = [active, done];
    expect(store.allHintTodos.map((t) => t.id).sort()).toEqual(['a', 'd']);
    expect(store.hintTodos.map((t) => t.id)).toEqual(['a']); // completed dropped from display
  });

  it('dedupes hintTodos by hintKey, keeping the earliest-created', () => {
    const store = useTodoStore();
    const late = todo({
      id: 'late',
      hintType: 'trip-packing',
      hintKey: 'k',
      createdAt: '2026-05-05T00:00:00.000Z',
    });
    const early = todo({
      id: 'early',
      hintType: 'trip-packing',
      hintKey: 'k',
      createdAt: '2026-05-01T00:00:00.000Z',
    });
    store.todos = [late, early];
    expect(store.hintTodos.map((t) => t.id)).toEqual(['early']);
  });

  it('visibleHintTodos hides a surprise-sensitive hint from a non-assignee', () => {
    const store = useTodoStore();
    const dad = { id: 'dad', name: 'Dad', role: 'owner' } as never;
    const kid = { id: 'kid', name: 'Kid', role: 'member', ageGroup: 'child' } as never;
    const resolve = (id: string) => (id === 'dad' ? dad : id === 'kid' ? kid : undefined);
    // Present hint assigned to the adult (dad), excluding the birthday kid.
    const present = todo({
      id: 'p',
      hintType: 'birthday-present',
      hintKey: 'bp',
      assigneeIds: ['dad'],
    });
    store.todos = [present];

    expect(store.visibleHintTodos(dad, resolve).map((t) => t.id)).toEqual(['p']); // assignee sees it
    expect(store.visibleHintTodos(kid, resolve)).toEqual([]); // the kid (non-assignee) does not
  });

  it('acknowledgeHint marks the hint kept', async () => {
    const store = useTodoStore();
    (todoRepo.updateTodo as ReturnType<typeof vi.fn>).mockResolvedValue(
      todo({ id: 'h', hintType: 'trip-packing', hintAcknowledged: true })
    );
    await store.acknowledgeHint('h');
    const calls = (todoRepo.updateTodo as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls.at(-1)![1]).toEqual({ hintAcknowledged: true });
  });
});
