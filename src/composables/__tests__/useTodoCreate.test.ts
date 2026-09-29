/**
 * The one "create a to-do" sequence. What it must guarantee:
 *   - the author comes from `useAuthoringMember` with the single to-do toast by default,
 *     or the caller's own toast (the magic beans review's plural one),
 *   - no author means no write and `null`, never a to-do with `createdBy: ''`,
 *   - the payload is `toCreateTodoInput`'s (trimmed, blanks absent, no orphan time),
 *   - a failed write comes back as `null` (the store has toasted),
 *   - a successful create is counted once, with its source; a stop is never counted.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useTodoCreate } from '@/composables/useTodoCreate';
import { logEvent } from '@/services/telemetry/logEvent';

vi.mock('@/services/telemetry/logEvent', () => ({ logEvent: vi.fn() }));

const createTodo = vi.fn();
vi.mock('@/stores/todoStore', () => ({ useTodoStore: () => ({ createTodo }) }));

const resolveOrToast = vi.fn();
vi.mock('@/composables/useAuthoringMember', () => ({
  useAuthoringMember: () => ({ resolveOrToast }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  resolveOrToast.mockReturnValue('m-greg');
  createTodo.mockResolvedValue({ id: 'todo-new' });
});

describe('useTodoCreate', () => {
  it('resolves the author with the single to-do toast by default', () => {
    const { resolveTodoAuthor } = useTodoCreate();
    expect(resolveTodoAuthor('Caller')).toBe('m-greg');
    expect(resolveOrToast).toHaveBeenCalledWith({
      callerTag: 'Caller',
      toastTitleKey: 'todo.error.noAuthor',
      toastHelpKey: 'todo.error.noAuthorHelp',
    });
  });

  it("uses the caller's own toast when given one", () => {
    const { resolveTodoAuthor } = useTodoCreate();
    resolveTodoAuthor('Review', {
      titleKey: 'magicTodos.error.noAuthor',
      helpKey: 'magicTodos.error.noAuthorHelp',
    });
    expect(resolveOrToast).toHaveBeenCalledWith({
      callerTag: 'Review',
      toastTitleKey: 'magicTodos.error.noAuthor',
      toastHelpKey: 'magicTodos.error.noAuthorHelp',
    });
  });

  it('creates the to-do from the shared payload rules and returns it', async () => {
    const { createTodoFrom } = useTodoCreate();
    const created = await createTodoFrom(
      { title: '  Sign the slip ', description: ' ', dueDate: '', dueTime: '08:30' },
      'Caller',
      'sidebar'
    );
    expect(created).toEqual({ id: 'todo-new' });
    expect(createTodo).toHaveBeenCalledWith({
      title: 'Sign the slip',
      completed: false,
      createdBy: 'm-greg',
    });
  });

  it('counts a successful create once, tagged with its source', async () => {
    const { createTodoFrom } = useTodoCreate();
    await createTodoFrom({ title: 'Sign the slip' }, 'Caller', 'nook');
    expect(logEvent).toHaveBeenCalledTimes(1);
    expect(logEvent).toHaveBeenCalledWith({
      level: 'info',
      surface: 'todo-create',
      message: 'created',
      context: { action: 'created', detail: 'nook' },
    });
  });

  it('links the to-do and tags the count with its link kind when created from an activity', async () => {
    const { createTodoFrom } = useTodoCreate();
    await createTodoFrom(
      { title: 'Sign the form', activityId: 'series', activityDate: '2026-10-06' },
      'ActivityTodos',
      'activity'
    );
    expect(createTodo).toHaveBeenCalledWith(
      expect.objectContaining({ activityId: 'series', activityDate: '2026-10-06' })
    );
    expect(vi.mocked(logEvent).mock.calls[0]![0].context).toEqual({
      action: 'created',
      detail: 'activity',
      kind: 'session',
    });

    vi.mocked(logEvent).mockClear();
    await createTodoFrom({ title: 'Kit', activityId: 'one-off' }, 'ActivityTodos', 'activity');
    expect(vi.mocked(logEvent).mock.calls[0]![0].context).toEqual({
      action: 'created',
      detail: 'activity',
      kind: 'whole',
    });
  });

  it('writes nothing and returns null when there is no author', async () => {
    resolveOrToast.mockReturnValue(null);
    const { createTodoFrom } = useTodoCreate();
    expect(await createTodoFrom({ title: 'Sign the slip' }, 'Caller', 'quick_bar')).toBeNull();
    expect(createTodo).not.toHaveBeenCalled();
    expect(logEvent).not.toHaveBeenCalled();
  });

  it('returns null when the store could not write it', async () => {
    createTodo.mockResolvedValue(null);
    const { createTodoFrom } = useTodoCreate();
    expect(await createTodoFrom({ title: 'Sign the slip' }, 'Caller', 'sidebar')).toBeNull();
    expect(logEvent).not.toHaveBeenCalled();
  });
});
