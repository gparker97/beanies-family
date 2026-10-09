import { setActivePinia, createPinia, getActivePinia } from 'pinia';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import type { RecurrenceRule, TodoItem } from '@/types/models';

vi.mock('@/services/automerge/repositories/todoRepository', () => ({
  getAllTodos: vi.fn().mockResolvedValue([]),
  createTodo: vi.fn(),
  updateTodo: vi.fn(),
  deleteTodo: vi.fn(),
  createTodosWithIds: vi.fn(),
  patchTodos: vi.fn(),
  patchTodosEach: vi.fn(),
  deleteTodos: vi.fn(),
  createTodoWithId: vi.fn(),
}));

// #123: the auto-roll runs only once the document is loaded.
const { docLoaded } = vi.hoisted(() => ({ docLoaded: { value: false } }));
vi.mock('@/services/automerge/docService', () => ({ isDocLoaded: () => docLoaded.value }));

// #123: one controllable "today" shared by every store instance (a real ref, so `watch` fires).
vi.mock('@/composables/useToday', async () => {
  const { ref } = await import('vue');
  const today = ref('2026-10-09');
  return { useToday: () => ({ today, isVisible: ref(true) }), __today: today };
});

// `openTodosForActivity` resolves the soft `activityId` against the activity store.
const { activityIds } = vi.hoisted(() => ({ activityIds: { value: [] as string[] } }));
vi.mock('@/stores/activityStore', () => ({
  useActivityStore: () => ({ activities: activityIds.value.map((id) => ({ id })) }),
}));

const { trackFeatureMock } = vi.hoisted(() => ({
  trackFeatureMock: vi.fn(<T>(result: T) => result),
}));
vi.mock('@/services/analytics/plausible', () => ({ trackFeature: trackFeatureMock }));

const { showToastMock } = vi.hoisted(() => ({ showToastMock: vi.fn() }));
vi.mock('@/composables/useToast', () => ({ showToast: showToastMock }));

vi.mock('@/composables/useCelebration', () => ({ celebrate: vi.fn() }));

// `discardTodo` records a dismissed hint's key in the family settings.
const { recordDismissedHint, forgetDismissedHint } = vi.hoisted(() => ({
  recordDismissedHint: vi.fn(),
  forgetDismissedHint: vi.fn(),
}));
vi.mock('@/stores/settingsStore', () => ({
  useSettingsStore: () => ({ recordDismissedHint, forgetDismissedHint }),
}));

// Telemetry spy — hoisted because `vi.mock` factories run before `const`s.
const { logEventMock } = vi.hoisted(() => ({ logEventMock: vi.fn() }));
vi.mock('@/services/telemetry/logEvent', () => ({ logEvent: logEventMock }));

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
import * as todayModule from '@/composables/useToday';
import { celebrate } from '@/composables/useCelebration';
import { setWriteGate, __resetWriteGateForTesting } from '@/services/automerge/worker/writeGate';

const todayRef = (todayModule as unknown as { __today: { value: string } }).__today;

// Every store's `watch(today)` would otherwise outlive its test and react to the next one's
// clock changes.
afterEach(() => {
  getActivePinia()?._s.forEach((store) => store.$dispose());
});

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

  it('visibleHintTodos is typed HintTodo[] — hintType readable without a guard', () => {
    const store = useTodoStore();
    const dad = { id: 'dad', name: 'Dad', role: 'owner' } as never;
    store.todos = [todo({ id: 'h', hintType: 'trip-packing', hintKey: 'k', assigneeIds: ['dad'] })];
    const [hint] = store.visibleHintTodos(dad, () => dad);
    // Compile-time: `hint.hintType` is `HelpfulHintType`, not `| undefined`.
    const type: string = hint.hintType;
    expect(type).toBe('trip-packing');
  });

  it('completing a hint emits the helpful-hints consumption event; a manual to-do does not', async () => {
    const store = useTodoStore();
    const hint = todo({ id: 'h', hintType: 'trip-packing', hintKey: 'k' });
    const manual = todo({ id: 'm' });
    store.todos = [hint, manual];
    (todoRepo.updateTodo as ReturnType<typeof vi.fn>).mockImplementation(
      async (id: string, patch: Partial<TodoItem>) => ({
        ...store.todos.find((t) => t.id === id)!,
        ...patch,
      })
    );

    logEventMock.mockClear();
    await store.toggleComplete('h', 'm-1');
    expect(logEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'info',
        surface: 'helpful-hints',
        context: expect.objectContaining({
          hint_type: 'trip-packing',
          hint_op: 'complete',
          route_path: '/',
        }),
      })
    );

    logEventMock.mockClear();
    await store.toggleComplete('m', 'm-1');
    const hintEvents = logEventMock.mock.calls.filter(
      (call) => (call[0] as { surface: string }).surface === 'helpful-hints'
    );
    expect(hintEvents).toHaveLength(0);
  });

  it('toggleComplete on an unknown id warns instead of returning null silently', async () => {
    const store = useTodoStore();
    store.todos = [];
    logEventMock.mockClear();

    await expect(store.toggleComplete('nope', 'm-1')).resolves.toBeNull();
    expect(logEventMock).toHaveBeenCalledWith(
      expect.objectContaining({ level: 'warn', surface: 'todos' })
    );
  });
});

describe('todoStore — discardTodo (a person removing a to-do)', () => {
  const hint = () =>
    todo({
      id: 'h-1',
      hintType: 'trip-packing',
      hintKey: 'trip-packing:v1:2026-07-26',
      hintEventDate: '2026-07-26',
    });

  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    vi.mocked(todoRepo.deleteTodo).mockResolvedValue(true);
    recordDismissedHint.mockResolvedValue(undefined);
  });

  it('records a hint key before deleting, so the engine never brings it back', async () => {
    const store = useTodoStore();
    store.todos.push(hint());
    await expect(store.discardTodo('h-1')).resolves.toBe(true);
    expect(recordDismissedHint).toHaveBeenCalledWith('trip-packing:v1:2026-07-26', '2026-07-26');
    expect(recordDismissedHint.mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(todoRepo.deleteTodo).mock.invocationCallOrder[0]!
    );
    expect(store.todos).toHaveLength(0);
    expect(logEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        surface: 'helpful-hints',
        message: 'hint dismissed',
        context: expect.objectContaining({ hint_op: 'dismiss', hint_type: 'trip-packing' }),
      })
    );
  });

  it('still deletes the hint when the record fails, and logs a warning', async () => {
    recordDismissedHint.mockRejectedValue(new Error('write failed'));
    const store = useTodoStore();
    store.todos.push(hint());
    await expect(store.discardTodo('h-1')).resolves.toBe(true);
    expect(store.todos).toHaveLength(0);
    expect(logEventMock).toHaveBeenCalledWith(
      expect.objectContaining({ level: 'warn', surface: 'helpful-hints' })
    );
  });

  it('offers the house Undo toast; Undo forgets the key BEFORE restoring the hint', async () => {
    forgetDismissedHint.mockResolvedValue(undefined);
    vi.mocked(todoRepo.createTodoWithId).mockImplementation(
      async (id, input) => ({ id, ...input, createdAt: 'c', updatedAt: 'u' }) as TodoItem
    );
    const store = useTodoStore();
    store.todos.push(hint());
    await store.discardTodo('h-1');
    expect(showToastMock).toHaveBeenCalledTimes(1);
    const [type, , , options] = showToastMock.mock.calls[0]!;
    expect(type).toBe('info');
    expect(options).toEqual(expect.objectContaining({ durationMs: 6000 }));
    await options.actionFn();
    expect(forgetDismissedHint).toHaveBeenCalledWith('trip-packing:v1:2026-07-26');
    expect(forgetDismissedHint.mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(todoRepo.createTodoWithId).mock.invocationCallOrder[0]!
    );
    expect(store.todos.map((t) => t.id)).toEqual(['h-1']);
    expect(logEventMock).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'hint dismiss undone' })
    );
  });

  it('Undo does not restore when the key could not be forgotten (it would be removed again)', async () => {
    forgetDismissedHint.mockRejectedValue(new Error('write failed'));
    const store = useTodoStore();
    store.todos.push(hint());
    await store.discardTodo('h-1');
    await showToastMock.mock.calls[0]![3].actionFn();
    expect(todoRepo.createTodoWithId).not.toHaveBeenCalled();
    expect(logEventMock).toHaveBeenCalledWith(
      expect.objectContaining({ level: 'warn', message: 'hint dismiss undo failed' })
    );
  });

  it('a failed delete logs a failure, never a dismissal', async () => {
    vi.mocked(todoRepo.deleteTodo).mockRejectedValue(new Error('boom'));
    const store = useTodoStore();
    store.todos.push(hint());
    await expect(store.discardTodo('h-1')).resolves.toBe(false);
    expect(logEventMock).toHaveBeenCalledWith(
      expect.objectContaining({ level: 'warn', message: 'hint dismiss failed' })
    );
    expect(logEventMock).not.toHaveBeenCalledWith(
      expect.objectContaining({ message: 'hint dismissed' })
    );
  });

  it('a normal to-do is just deleted, with no hint record', async () => {
    const store = useTodoStore();
    store.todos.push(todo());
    await expect(store.discardTodo('t-1')).resolves.toBe(true);
    expect(recordDismissedHint).not.toHaveBeenCalled();
    expect(showToastMock).not.toHaveBeenCalled(); // its own confirm already happened
    expect(store.todos).toHaveLength(0);
  });
});

describe('todoStore: batch actions (magic beans shared result)', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    activityIds.value = [];
  });

  it('createTodos writes one batch with the caller ids and tracks one feature use', async () => {
    const store = useTodoStore();
    const a = todo({ id: 'n-1', title: 'Sign slip' });
    const b = todo({ id: 'n-2', title: 'Pay fee' });
    vi.mocked(todoRepo.createTodosWithIds).mockResolvedValue([a, b]);

    const { id: _ia, createdAt: _ca, updatedAt: _ua, ...inputA } = a;
    const { id: _ib, createdAt: _cb, updatedAt: _ub, ...inputB } = b;
    const result = await store.createTodos([
      { ...inputA, id: 'n-1' },
      { ...inputB, id: 'n-2' },
    ]);

    expect(todoRepo.createTodosWithIds).toHaveBeenCalledTimes(1);
    expect(todoRepo.createTodosWithIds).toHaveBeenCalledWith(
      [
        { id: 'n-1', input: inputA },
        { id: 'n-2', input: inputB },
      ],
      { ifAbsent: false }
    );
    expect(result).toEqual([a, b]);
    expect(store.todos.map((t) => t.id)).toEqual(['n-1', 'n-2']);
    expect(trackFeatureMock).toHaveBeenCalledTimes(1);
  });

  it('createTodos retried with the same ids keeps one copy in memory', async () => {
    const store = useTodoStore();
    const a = todo({ id: 'n-1' });
    vi.mocked(todoRepo.createTodosWithIds).mockResolvedValue([a]);
    const { id: _i, createdAt: _c, updatedAt: _u, ...input } = a;

    await store.createTodos([{ ...input, id: 'n-1' }]);
    await store.createTodos([{ ...input, id: 'n-1' }]);

    expect(store.todos).toHaveLength(1);
  });

  it('createTodos failure toasts once under the todos surface and returns null', async () => {
    const store = useTodoStore();
    vi.mocked(todoRepo.createTodosWithIds).mockRejectedValue(new Error('write failed'));
    const { id: _i, createdAt: _c, updatedAt: _u, ...input } = todo();

    const result = await store.createTodos([{ ...input, id: 'n-1' }]);

    expect(result).toBeNull();
    expect(store.todos).toEqual([]);
    expect(showToastMock).toHaveBeenCalledTimes(1);
    expect(showToastMock.mock.calls[0]![3]).toMatchObject({
      surface: 'todos',
      context: { action: 'todoStore:createTodos' },
    });
  });

  it('linkTodosToActivity patches in one batch with onMissing skip and syncs memory', async () => {
    const store = useTodoStore();
    store.todos = [todo({ id: 'a' }), todo({ id: 'b' }), todo({ id: 'c' })];
    vi.mocked(todoRepo.patchTodos).mockResolvedValue([
      todo({ id: 'a', activityId: 'act-1' }),
      todo({ id: 'b', activityId: 'act-1' }),
    ]);

    const linked = await store.linkTodosToActivity(['a', 'b', 'gone'], { activityId: 'act-1' });

    // Both keys always travel: `activityDate: undefined` deletes any stale session date.
    const patch = vi.mocked(todoRepo.patchTodos).mock.calls[0]![1];
    expect(Object.keys(patch).sort()).toEqual(['activityDate', 'activityId']);
    expect(todoRepo.patchTodos).toHaveBeenCalledWith(
      ['a', 'b', 'gone'],
      { activityId: 'act-1', activityDate: undefined },
      { onMissing: 'skip' }
    );
    expect(linked).toHaveLength(2);
    expect(store.todos.map((t) => t.activityId)).toEqual(['act-1', 'act-1', undefined]);
  });

  it('linkTodosToActivity(null) clears the id and the session date together', async () => {
    const store = useTodoStore();
    store.todos = [todo({ id: 'a', activityId: 'act-1', activityDate: '2026-10-06' })];
    vi.mocked(todoRepo.patchTodos).mockResolvedValue([todo({ id: 'a' })]);

    await store.linkTodosToActivity(['a'], null);

    const patch = vi.mocked(todoRepo.patchTodos).mock.calls[0]![1] as Record<string, unknown>;
    expect('activityId' in patch && 'activityDate' in patch).toBe(true);
    expect(patch.activityId).toBeUndefined();
    expect(patch.activityDate).toBeUndefined();
  });

  it('todosForActivitySession: session + every-session items, open by due date, done newest first', () => {
    const store = useTodoStore();
    const master = {
      id: 'series',
      date: '2026-10-06',
      recurrence: 'weekly',
    } as unknown as import('@/types/models').FamilyActivity;
    store.todos = [
      todo({ id: 'undated', activityId: 'series', activityDate: '2026-10-06' }),
      todo({ id: 'late', activityId: 'series', dueDate: '2026-10-05' }),
      todo({
        id: 'early',
        activityId: 'series',
        activityDate: '2026-10-06',
        dueDate: '2026-10-01',
      }),
      todo({ id: 'other-session', activityId: 'series', activityDate: '2026-10-13' }),
      todo({ id: 'other-activity', activityId: 'else' }),
      todo({
        id: 'done-old',
        activityId: 'series',
        completed: true,
        completedAt: '2026-10-01T00:00:00.000Z',
      }),
      todo({
        id: 'done-new',
        activityId: 'series',
        activityDate: '2026-10-06',
        completed: true,
        completedAt: '2026-10-03T00:00:00.000Z',
      }),
    ];

    const { open, done } = store.todosForActivitySession(master, '2026-10-06');

    expect(open.map((o) => [o.item.id, o.scope])).toEqual([
      ['early', 'session'],
      ['late', 'every-session'],
      ['undated', 'session'],
    ]);
    expect(done.map((d) => d.item.id)).toEqual(['done-new', 'done-old']);
  });

  it('deleteTodos removes in one batch and syncs memory', async () => {
    const store = useTodoStore();
    store.todos = [todo({ id: 'a' }), todo({ id: 'b' }), todo({ id: 'c' })];
    vi.mocked(todoRepo.deleteTodos).mockResolvedValue(undefined);

    const ok = await store.deleteTodos(['a', 'c']);

    expect(ok).toBe(true);
    expect(todoRepo.deleteTodos).toHaveBeenCalledTimes(1);
    expect(store.todos.map((t) => t.id)).toEqual(['b']);
  });

  it('deleteTodos failure keeps the to-dos and returns false', async () => {
    const store = useTodoStore();
    store.todos = [todo({ id: 'a' })];
    vi.mocked(todoRepo.deleteTodos).mockRejectedValue(new Error('write failed'));

    expect(await store.deleteTodos(['a'])).toBe(false);
    expect(store.todos).toHaveLength(1);
    expect(showToastMock).toHaveBeenCalledTimes(1);
  });

  it('openTodosForActivity returns open linked to-dos only, and none for a missing activity', () => {
    const store = useTodoStore();
    store.todos = [
      todo({ id: 'open', activityId: 'act-1' }),
      todo({ id: 'done', activityId: 'act-1', completed: true }),
      todo({ id: 'other', activityId: 'act-2' }),
      todo({ id: 'plain' }),
    ];
    activityIds.value = ['act-1'];

    expect(store.openTodosForActivity('act-1').map((t) => t.id)).toEqual(['open']);
    // act-2 was deleted (soft reference): its to-dos are not "linked" to anything.
    expect(store.openTodosForActivity('act-2')).toEqual([]);
  });
});

// ── #123: repeating to-dos ──────────────────────────────────────────────────────────────────
// Calendar: 2026-10-07, -14, -21 and -28 are Wednesdays; 2026-10-09 is a Friday.

const WEEKLY_WED: RecurrenceRule = {
  unit: 'week',
  interval: 1,
  weekdays: [3],
  end: { kind: 'never' },
};

function repeatingTodo(overrides: Partial<TodoItem> = {}): TodoItem {
  return todo({
    id: 'r',
    dueDate: '2026-10-14',
    repeat: { rule: WEEKLY_WED, anchor: '2026-10-07' },
    repeatLog: [],
    createdAt: '2026-10-07T12:00:00.000Z',
    ...overrides,
  });
}

/** `updateTodo` that echoes the patch onto the stored record, like the repository. */
function echoUpdates(store: ReturnType<typeof useTodoStore>): void {
  vi.mocked(todoRepo.updateTodo).mockImplementation(async (id, input) => {
    const current = store.todos.find((t) => t.id === id)!;
    return { ...current, ...input } as TodoItem;
  });
}

/** The logEvent calls on the to-do recurrence surface with this message. */
const recurrenceEvents = (message: string) =>
  logEventMock.mock.calls
    .map(([e]) => e)
    .filter((e) => e.surface === 'todo-recurrence' && e.message === message);

describe('todoStore: repeating to-dos (#123)', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    todayRef.value = '2026-10-14';
    docLoaded.value = false;
  });

  it('toggleComplete rolls to the next occurrence, never completes, and celebrates', async () => {
    const store = useTodoStore();
    store.todos = [repeatingTodo()];
    echoUpdates(store);

    const result = await store.toggleComplete('r', 'm-1');

    const patch = vi.mocked(todoRepo.updateTodo).mock.calls[0]![1];
    expect(patch).toEqual({
      dueDate: '2026-10-21',
      repeatLog: [{ date: '2026-10-14', outcome: 'done', by: 'm-1', at: expect.any(String) }],
    });
    expect(patch).not.toHaveProperty('completed');
    expect(result?.completed).toBe(false);
    expect(result?.dueDate).toBe('2026-10-21');
    expect(celebrate).toHaveBeenCalledTimes(1);
    expect(recurrenceEvents('rolled')[0]?.context).toEqual({
      recur_surface: 'todo',
      recur_outcome: 'done',
      recur_unit: 'week',
      recur_interval: 1,
      count: 0,
    });
  });

  it('rolled telemetry counts cap trims only, not a replaced same-date entry', async () => {
    const store = useTodoStore();
    // Another device already logged today's occurrence: the roll replaces it, trimming nothing.
    store.todos = [
      repeatingTodo({ repeatLog: [{ date: '2026-10-14', outcome: 'skipped', at: 'x' }] }),
    ];
    echoUpdates(store);

    await store.toggleComplete('r', 'm-1');

    expect(recurrenceEvents('rolled')[0]?.context).toMatchObject({ count: 0 });
  });

  it("the celebration's undo writes back the previous date and log", async () => {
    const store = useTodoStore();
    store.todos = [
      repeatingTodo({ repeatLog: [{ date: '2026-10-07', outcome: 'done', at: 'x' }] }),
    ];
    echoUpdates(store);

    await store.toggleComplete('r', 'm-1');
    const { onUndo } = vi.mocked(celebrate).mock.calls[0]![1] as { onUndo: () => void };
    onUndo();

    expect(todoRepo.updateTodo).toHaveBeenLastCalledWith('r', {
      dueDate: '2026-10-14',
      repeatLog: [{ date: '2026-10-07', outcome: 'done', at: 'x' }],
    });
  });

  it('the last occurrence of an ending rule completes normally (series-ended)', async () => {
    const store = useTodoStore();
    const twice: RecurrenceRule = { ...WEEKLY_WED, end: { kind: 'afterCount', count: 2 } };
    store.todos = [repeatingTodo({ repeat: { rule: twice, anchor: '2026-10-07' } })];
    echoUpdates(store);

    const result = await store.toggleComplete('r', 'm-1');

    expect(todoRepo.updateTodo).toHaveBeenCalledWith('r', {
      completed: true,
      completedBy: 'm-1',
      completedAt: expect.any(String),
    });
    expect(result?.completed).toBe(true);
    expect(recurrenceEvents('rolled')[0]?.context).toMatchObject({
      recur_outcome: 'series-ended',
    });
  });

  it('skipOccurrence logs a skipped entry, rolls, toasts the next date, no celebration', async () => {
    const store = useTodoStore();
    store.todos = [repeatingTodo()];
    echoUpdates(store);

    const result = await store.skipOccurrence('r', 'm-1');

    expect(result?.dueDate).toBe('2026-10-21');
    expect(result?.repeatLog).toEqual([
      { date: '2026-10-14', outcome: 'skipped', by: 'm-1', at: expect.any(String) },
    ]);
    expect(celebrate).not.toHaveBeenCalled();
    expect(showToastMock).toHaveBeenCalledWith(
      'info',
      expect.stringContaining('21 Oct'),
      undefined,
      expect.objectContaining({ actionFn: expect.any(Function), durationMs: 6000 })
    );
    expect(recurrenceEvents('rolled')[0]?.context).toMatchObject({ recur_outcome: 'skipped' });
  });

  it('skip then Undo restores the exact previous dueDate and repeatLog', async () => {
    const store = useTodoStore();
    const log = [{ date: '2026-10-07', outcome: 'done' as const, by: 'm-2', at: 'x' }];
    store.todos = [repeatingTodo({ repeatLog: log })];
    const before = store.todos[0]!;
    echoUpdates(store);

    await store.skipOccurrence('r', 'm-1');
    const options = showToastMock.mock.calls[0]![3] as {
      actionLabel: string;
      actionFn: () => void;
    };
    expect(options.actionLabel).toBeTruthy();
    vi.mocked(todoRepo.updateTodo).mockClear();
    options.actionFn();
    await flushPromises();

    expect(todoRepo.updateTodo).toHaveBeenCalledWith('r', {
      dueDate: before.dueDate,
      repeatLog: log,
    });
    expect(store.todos[0]?.dueDate).toBe(before.dueDate);
    expect(store.todos[0]?.repeatLog).toEqual(log);
  });

  it('Undo of a skipped last occurrence reopens it with its date and log', async () => {
    const store = useTodoStore();
    const twice: RecurrenceRule = { ...WEEKLY_WED, end: { kind: 'afterCount', count: 2 } };
    const log = [{ date: '2026-10-07', outcome: 'done' as const, by: 'm-2', at: 'x' }];
    store.todos = [
      repeatingTodo({ repeat: { rule: twice, anchor: '2026-10-07' }, repeatLog: log }),
    ];
    const before = store.todos[0]!;
    echoUpdates(store);

    await store.skipOccurrence('r', 'm-1');
    const options = showToastMock.mock.calls[0]![3] as { actionFn: () => void };
    vi.mocked(todoRepo.updateTodo).mockClear();
    options.actionFn();
    await flushPromises();

    expect(todoRepo.updateTodo).toHaveBeenCalledWith('r', {
      dueDate: before.dueDate,
      repeatLog: log,
      completed: false,
      completedBy: undefined,
      completedAt: undefined,
    });
  });

  it('skipping the last occurrence logs it as skipped and completes with nobody as doer', async () => {
    const store = useTodoStore();
    const twice: RecurrenceRule = { ...WEEKLY_WED, end: { kind: 'afterCount', count: 2 } };
    const log = [{ date: '2026-10-07', outcome: 'done' as const, by: 'm-2', at: 'x' }];
    store.todos = [
      repeatingTodo({ repeat: { rule: twice, anchor: '2026-10-07' }, repeatLog: log }),
    ];
    echoUpdates(store);

    const result = await store.skipOccurrence('r', 'm-1');

    expect(todoRepo.updateTodo).toHaveBeenCalledTimes(1);
    expect(todoRepo.updateTodo).toHaveBeenCalledWith('r', {
      completed: true,
      completedBy: undefined,
      completedAt: expect.any(String),
      repeatLog: [
        ...log,
        { date: '2026-10-14', outcome: 'skipped', by: 'm-1', at: expect.any(String) },
      ],
    });
    expect(result?.completed).toBe(true);
    expect(result?.completedBy).toBeUndefined();
    expect(celebrate).not.toHaveBeenCalled();
    expect(recurrenceEvents('rolled').map((e) => e.context?.recur_outcome)).toEqual([
      'series-ended',
    ]);
  });

  it('skipOccurrence on a plain or unknown to-do is refused, logged and toasted', async () => {
    const store = useTodoStore();
    store.todos = [todo({ id: 'p', dueDate: '2026-10-14' })];

    expect(await store.skipOccurrence('p', 'm-1')).toBeNull();
    expect(await store.skipOccurrence('nope', 'm-1')).toBeNull();

    expect(todoRepo.updateTodo).not.toHaveBeenCalled();
    expect(recurrenceEvents('refused').map((e) => [e.level, e.context])).toEqual([
      ['warn', { action: 'skip', detail: 'not-repeating' }],
      ['warn', { action: 'skip', detail: 'not-found' }],
    ]);
    expect(showToastMock).toHaveBeenCalledTimes(2);
    expect(showToastMock.mock.calls[0]![0]).toBe('info');
  });

  it('setRepeat on: anchors on repeatStartDate and lands on the first occurrence', async () => {
    todayRef.value = '2026-10-09';
    const store = useTodoStore();
    store.todos = [todo({ id: 'p', dueDate: '2026-10-20' })];
    echoUpdates(store);

    await store.setRepeat('p', WEEKLY_WED);

    expect(todoRepo.updateTodo).toHaveBeenCalledWith('p', {
      repeat: { rule: WEEKLY_WED, anchor: '2026-10-20' },
      dueDate: '2026-10-21',
      repeatLog: [],
    });
    expect(recurrenceEvents('repeat_set')[0]?.context).toEqual({
      recur_surface: 'todo',
      action: 'change',
      recur_unit: 'week',
      recur_interval: 1,
      recur_end: 'never',
    });
  });

  it('setRepeat change: re-anchors on the current due date (or today) and keeps the log', async () => {
    todayRef.value = '2026-10-09';
    const store = useTodoStore();
    const log = [{ date: '2026-10-07', outcome: 'done' as const, at: 'x' }];
    store.todos = [repeatingTodo({ repeatLog: log })];
    echoUpdates(store);
    const fridays: RecurrenceRule = { ...WEEKLY_WED, weekdays: [5] };

    await store.setRepeat('r', fridays);

    expect(todoRepo.updateTodo).toHaveBeenCalledWith('r', {
      repeat: { rule: fridays, anchor: '2026-10-14' },
      dueDate: '2026-10-16',
      repeatLog: log,
    });
  });

  it('setRepeat with an unchanged rule is a no-op (never a write)', async () => {
    const store = useTodoStore();
    const existing = repeatingTodo();
    store.todos = [existing];

    // Same schedule, different key order: still the same rule.
    const same = { end: { kind: 'never' }, weekdays: [3], interval: 1, unit: 'week' };
    expect(await store.setRepeat('r', same as RecurrenceRule)).toEqual(existing);
    expect(todoRepo.updateTodo).not.toHaveBeenCalled();
  });

  it('setRepeat(null) turns the repeat off and keeps the to-do on its date', async () => {
    const store = useTodoStore();
    store.todos = [repeatingTodo()];
    echoUpdates(store);

    await store.setRepeat('r', null);

    expect(todoRepo.updateTodo).toHaveBeenCalledWith('r', {
      repeat: undefined,
      repeatLog: undefined,
    });
    expect(recurrenceEvents('repeat_set')[0]?.context).toMatchObject({ action: 'off' });
  });

  it('setRepeat on a card-made to-do is refused', async () => {
    const store = useTodoStore();
    store.todos = [repeatingTodo({ cardId: 'c-1', cardPartKey: 'main' })];

    expect(await store.setRepeat('r', null)).toBeNull();
    expect(todoRepo.updateTodo).not.toHaveBeenCalled();
    expect(recurrenceEvents('refused')[0]?.context).toEqual({
      action: 'set-repeat',
      detail: 'card-made',
    });
    expect(showToastMock).toHaveBeenCalledWith('info', expect.any(String));
  });

  it('setRepeat on an unknown to-do is refused, logged and toasted like skip', async () => {
    const store = useTodoStore();
    store.todos = [];

    expect(await store.setRepeat('gone', null)).toBeNull();
    expect(todoRepo.updateTodo).not.toHaveBeenCalled();
    expect(recurrenceEvents('refused').map((e) => [e.level, e.context])).toEqual([
      ['warn', { action: 'set-repeat', detail: 'not-found' }],
    ]);
    expect(showToastMock).toHaveBeenCalledWith('info', expect.any(String));
  });

  it('setSomeday(true) is refused on a repeating to-do; setSomeday(false) is not', async () => {
    const store = useTodoStore();
    store.todos = [repeatingTodo()];
    echoUpdates(store);

    expect(await store.setSomeday('r', true)).toBeNull();
    expect(todoRepo.updateTodo).not.toHaveBeenCalled();
    expect(recurrenceEvents('refused')[0]?.context).toEqual({
      action: 'someday',
      detail: 'repeating',
    });

    await store.setSomeday('r', false);
    expect(todoRepo.updateTodo).toHaveBeenCalledWith('r', { someday: false });
  });

  it('deleteTodo (and so discardTodo) refuses a card-made to-do; deleteTodos does not', async () => {
    const store = useTodoStore();
    store.todos = [repeatingTodo({ cardId: 'c-1', cardPartKey: 'main' })];
    vi.mocked(todoRepo.deleteTodos).mockResolvedValue(undefined as never);

    expect(await store.deleteTodo('r')).toBe(false);
    expect(await store.discardTodo('r')).toBe(false);
    expect(todoRepo.deleteTodo).not.toHaveBeenCalled();
    expect(recurrenceEvents('refused').map((e) => e.context)).toEqual([
      { action: 'delete', detail: 'card-made' },
      { action: 'delete', detail: 'card-made' },
    ]);
    expect(showToastMock).toHaveBeenCalledTimes(2);

    expect(await store.deleteTodos(['r'])).toBe(true);
    expect(todoRepo.deleteTodos).toHaveBeenCalledWith(['r']);
  });

  it('createTodo logs repeat_set (create) for a repeating to-do only', async () => {
    const store = useTodoStore();
    vi.mocked(todoRepo.createTodo).mockResolvedValueOnce(repeatingTodo());
    vi.mocked(todoRepo.createTodo).mockResolvedValueOnce(todo({ id: 'plain' }));
    const { id: _i, createdAt: _c, updatedAt: _u, ...input } = repeatingTodo();

    await store.createTodo(input);
    await store.createTodo({ title: 'x', completed: false, createdBy: 'm-1' });

    expect(recurrenceEvents('repeat_set').map((e) => e.context)).toEqual([
      {
        recur_surface: 'todo',
        action: 'create',
        recur_unit: 'week',
        recur_interval: 1,
        recur_end: 'never',
      },
    ]);
  });

  it('createTodos({ ifAbsent }) passes it through and merges only the created to-dos', async () => {
    const store = useTodoStore();
    const created = todo({ id: 'card-c1-main' });
    vi.mocked(todoRepo.createTodosWithIds).mockResolvedValue([created]);
    const { id: _i, createdAt: _c, updatedAt: _u, ...input } = created;

    const result = await store.createTodos(
      [
        { ...input, id: 'card-c1-main' },
        { ...input, id: 'card-c2-main' },
      ],
      { ifAbsent: true }
    );

    expect(vi.mocked(todoRepo.createTodosWithIds).mock.calls[0]![1]).toEqual({ ifAbsent: true });
    expect(result).toEqual([created]);
    expect(store.todos.map((t) => t.id)).toEqual(['card-c1-main']);
  });
});

describe('todoStore: reconcileRepeatingTodos, the auto-roll (#123)', () => {
  /** `patchTodosEach` that echoes each patch onto the to-do it was given. */
  function echoPatches(source: TodoItem[]): void {
    vi.mocked(todoRepo.patchTodosEach).mockImplementation(async (items) =>
      items.map(({ id, patch }) => ({ ...source.find((t) => t.id === id)!, ...patch }) as TodoItem)
    );
  }

  const overdue = repeatingTodo({ id: 'overdue', dueDate: '2026-10-07' });
  const current = repeatingTodo({ id: 'current', dueDate: '2026-10-14' });
  const offRule = repeatingTodo({ id: 'off-rule', dueDate: '2026-10-15' });
  const logged = repeatingTodo({
    id: 'logged',
    dueDate: '2026-10-14',
    repeatLog: [{ date: '2026-10-14', outcome: 'done', at: 'x' }],
  });
  const plainOverdue = todo({ id: 'plain', dueDate: '2026-10-01' });
  const doneRepeating = repeatingTodo({ id: 'done', dueDate: '2026-10-07', completed: true });
  const all = [overdue, current, offRule, logged, plainOverdue, doneRepeating];

  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    __resetWriteGateForTesting();
    todayRef.value = '2026-10-09';
    docLoaded.value = true;
    vi.mocked(todoRepo.getAllTodos).mockResolvedValue(all);
    echoPatches(all);
  });

  afterEach(() => {
    __resetWriteGateForTesting();
    vi.mocked(todoRepo.getAllTodos).mockResolvedValue([]);
  });

  it('on load: one batch rolling only overdue, off-rule and already-logged repeating to-dos', async () => {
    const store = useTodoStore();

    await store.loadTodos();

    expect(todoRepo.patchTodosEach).toHaveBeenCalledTimes(1);
    expect(vi.mocked(todoRepo.patchTodosEach).mock.calls[0]).toEqual([
      [
        { id: 'overdue', patch: { dueDate: '2026-10-14' } },
        { id: 'off-rule', patch: { dueDate: '2026-10-14' } },
        { id: 'logged', patch: { dueDate: '2026-10-21' } },
      ],
      { onMissing: 'skip' },
    ]);
    expect(store.todos.find((t) => t.id === 'overdue')?.dueDate).toBe('2026-10-14');
    expect(store.todos.find((t) => t.id === 'plain')?.dueDate).toBe('2026-10-01');
    expect(recurrenceEvents('reconcile')[0]?.context).toEqual({
      action: 'auto-roll',
      count: 3,
      detail: 'load',
    });
  });

  it('does nothing before the document loads', async () => {
    docLoaded.value = false;
    const store = useTodoStore();

    await store.loadTodos();

    expect(todoRepo.patchTodosEach).not.toHaveBeenCalled();
  });

  it('a read-only family: no write attempt, skipped_read_only logged once per session', async () => {
    setWriteGate(() => ({ block: true, wouldBlock: true }));
    const store = useTodoStore();

    await store.loadTodos();
    await store.loadTodos();

    expect(todoRepo.patchTodosEach).not.toHaveBeenCalled();
    const skips = logEventMock.mock.calls
      .map(([e]) => e)
      .filter((e) => e.surface === 'todo-recurrence' && e.context?.action === 'skipped_read_only');
    expect(skips).toHaveLength(1);
    expect(showToastMock).not.toHaveBeenCalled();
  });

  it('the day advancing rolls again, coalescing a burst of triggers into one run', async () => {
    const store = useTodoStore();
    store.todos = [current];

    todayRef.value = '2026-10-15';
    await Promise.resolve();
    todayRef.value = '2026-10-16';

    await vi.waitFor(() => expect(todoRepo.patchTodosEach).toHaveBeenCalledTimes(1));
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(todoRepo.patchTodosEach).toHaveBeenCalledTimes(1);
    expect(vi.mocked(todoRepo.patchTodosEach).mock.calls[0]![0]).toEqual([
      { id: 'current', patch: { dueDate: '2026-10-21' } },
    ]);
    await vi.waitFor(() =>
      expect(recurrenceEvents('reconcile')[0]?.context).toMatchObject({ detail: 'today' })
    );
  });

  it('a failed write is reported once (toast, surface) and retried on the next trigger', async () => {
    vi.mocked(todoRepo.patchTodosEach).mockRejectedValueOnce(new Error('worker down'));
    const store = useTodoStore();

    await store.loadTodos();

    expect(showToastMock).toHaveBeenCalledTimes(1);
    expect(showToastMock.mock.calls[0]![3]).toMatchObject({
      surface: 'todo-recurrence',
      context: { action: 'todoStore:patchTodosEach' },
    });
    expect(store.todos.find((t) => t.id === 'overdue')?.dueDate).toBe('2026-10-07');

    todayRef.value = '2026-10-10';
    await vi.waitFor(() => expect(todoRepo.patchTodosEach).toHaveBeenCalledTimes(2));
    await vi.waitFor(() =>
      expect(store.todos.find((t) => t.id === 'overdue')?.dueDate).toBe('2026-10-14')
    );
  });
});
