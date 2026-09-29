/**
 * The shared "add a to-do" draft (#114). What it must guarantee:
 *   - a double submit while the first create is in flight writes once,
 *   - a stop (no author, or the store failed) keeps the whole draft,
 *   - a created to-do resets the fields it was made from to `defaults()`, read afresh,
 *   - anything changed while that create was in flight stays for the next to-do,
 *   - the link is read at submit and written with the to-do,
 *   - with no defaults, the draft starts and resets empty.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import { useTodoDraft } from '@/composables/useTodoDraft';
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

describe('useTodoDraft', () => {
  it('starts empty and writes nothing for a blank title', async () => {
    const draft = useTodoDraft({ source: 'nook', callerTag: 'test' });
    expect(draft.dueDate.value).toBe('');
    expect(draft.assigneeIds.value).toEqual([]);

    draft.title.value = '   ';
    expect(await draft.add()).toBeNull();
    expect(createTodo).not.toHaveBeenCalled();
  });

  it('writes once when submitted twice while saving', async () => {
    let finish: (v: unknown) => void = () => {};
    createTodo.mockReturnValue(new Promise((r) => (finish = r)));
    const draft = useTodoDraft({ source: 'quick_bar', callerTag: 'test' });
    draft.title.value = 'Pack the lunch';

    const first = draft.add();
    expect(draft.isAdding.value).toBe(true);
    expect(await draft.add()).toBeNull();
    finish({ id: 'todo-new' });

    expect(await first).toEqual({ id: 'todo-new' });
    expect(createTodo).toHaveBeenCalledTimes(1);
    expect(draft.isAdding.value).toBe(false);
  });

  it('keeps the whole draft when there is no author', async () => {
    resolveOrToast.mockReturnValue(null);
    const draft = useTodoDraft({
      source: 'activity',
      callerTag: 'test',
      defaults: () => ({ dueDate: '2030-10-09', assigneeIds: ['m-greg'] }),
    });
    draft.title.value = 'Sign the form';
    draft.assigneeIds.value = ['m-leo'];

    expect(await draft.add()).toBeNull();
    expect(createTodo).not.toHaveBeenCalled();
    expect(draft.title.value).toBe('Sign the form');
    expect(draft.dueDate.value).toBe('2030-10-09');
    expect(draft.assigneeIds.value).toEqual(['m-leo']);
  });

  it('keeps the whole draft when the create fails', async () => {
    createTodo.mockResolvedValue(null);
    const draft = useTodoDraft({ source: 'quick_bar', callerTag: 'test' });
    draft.title.value = 'Pack the lunch';
    draft.dueDate.value = '2030-10-13';

    expect(await draft.add()).toBeNull();
    expect(createTodo).toHaveBeenCalledTimes(1);
    expect(draft.title.value).toBe('Pack the lunch');
    expect(draft.dueDate.value).toBe('2030-10-13');
  });

  it('starts from defaults() and resets to a fresh read of it after a create', async () => {
    let due = '2030-10-09';
    const defaults = vi.fn(() => ({ dueDate: due, assigneeIds: ['m-greg'] }));
    const draft = useTodoDraft({ source: 'activity', callerTag: 'test', defaults });
    expect(draft.dueDate.value).toBe('2030-10-09');
    expect(draft.assigneeIds.value).toEqual(['m-greg']);

    draft.title.value = 'Sign the form';
    draft.dueDate.value = '2030-10-01';
    due = '2030-10-10'; // e.g. the day turned over while the drawer was open
    await draft.add();

    expect(draft.title.value).toBe('');
    expect(draft.dueDate.value).toBe('2030-10-10');
    expect(draft.assigneeIds.value).toEqual(['m-greg']);
  });

  it('keeps what changed during an in-flight create for the next to-do', async () => {
    let finish: (v: unknown) => void = () => {};
    createTodo.mockReturnValue(new Promise((r) => (finish = r)));
    const draft = useTodoDraft({ source: 'nook', callerTag: 'test' });
    draft.title.value = 'Pack the lunch';
    draft.assigneeIds.value = ['m-leo'];
    const pending = draft.add();

    draft.title.value = 'Book the dentist';
    draft.dueDate.value = '2030-10-13';
    finish({ id: 'todo-new' });
    await pending;

    expect(draft.title.value).toBe('Book the dentist');
    expect(draft.dueDate.value).toBe('2030-10-13');
    // Unchanged since the submit, so it went with the first to-do and is reset.
    expect(draft.assigneeIds.value).toEqual([]);
  });

  it('writes the link read at submit, and counts the create by source and kind', async () => {
    let link: { activityId: string; activityDate?: string } = { activityId: 'act-1' };
    const draft = useTodoDraft({
      source: 'activity',
      callerTag: 'test',
      defaults: () => ({ dueDate: '2030-10-09', assigneeIds: ['m-greg'] }),
      link: () => link,
    });
    link = { activityId: 'series-1', activityDate: '2030-10-10' };
    draft.title.value = 'Sign the form';
    await draft.add();
    await flushPromises();

    expect(createTodo).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Sign the form',
        dueDate: '2030-10-09',
        activityId: 'series-1',
        activityDate: '2030-10-10',
        createdBy: 'm-greg',
      })
    );
    expect(logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        surface: 'todo-create',
        context: { action: 'created', detail: 'activity', kind: 'session' },
      })
    );
  });

  it('writes no link keys when there is no link', async () => {
    const draft = useTodoDraft({ source: 'quick_bar', callerTag: 'test' });
    draft.title.value = 'Pack the lunch';
    await draft.add();

    expect(createTodo).toHaveBeenCalledWith({
      title: 'Pack the lunch',
      completed: false,
      createdBy: 'm-greg',
    });
  });
});
