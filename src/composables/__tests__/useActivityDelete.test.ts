/**
 * The shared activity delete (planner, Nook, activity drawer).
 *
 * What is worth locking: the plain confirm is unchanged when nothing is linked; with open
 * linked to-dos the choice defaults to keep; the to-dos are deleted only AFTER the activity
 * delete succeeds; a `false` from the store is never reported again here.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { FamilyActivity, TodoItem } from '@/types/models';

const confirmFn = vi.hoisted(() => vi.fn());
const confirmChoiceFn = vi.hoisted(() => vi.fn());
vi.mock('@/composables/useConfirm', () => ({ confirm: confirmFn, confirmChoice: confirmChoiceFn }));

const toast = vi.hoisted(() => ({ fn: vi.fn() }));
vi.mock('@/composables/useToast', () => ({ showToast: toast.fn }));

const reporter = vi.hoisted(() => ({ fn: vi.fn() }));
vi.mock('@/utils/errorReporter', () => ({ reportError: reporter.fn }));

const sessionFailed = vi.hoisted(() => ({ fn: vi.fn() }));
vi.mock('@/utils/actionFailure', () => ({ reportSessionActionFailed: sessionFailed.fn }));

const logEventFn = vi.hoisted(() => vi.fn());
vi.mock('@/services/telemetry', () => ({ logEvent: logEventFn }));

vi.mock('@/stores/translationStore', () => ({
  useTranslationStore: () => ({ t: (k: string) => `${k}:{count}` }),
}));

const order: string[] = [];
const deleteActivityFn = vi.hoisted(() => vi.fn());
vi.mock('@/stores/activityStore', () => ({
  useActivityStore: () => ({ deleteActivity: deleteActivityFn }),
}));

const openTodosFn = vi.hoisted(() => vi.fn());
const deleteTodosFn = vi.hoisted(() => vi.fn());
vi.mock('@/stores/todoStore', () => ({
  useTodoStore: () => ({ openTodosForActivity: openTodosFn, deleteTodos: deleteTodosFn }),
}));

import { confirmAndDeleteActivity } from '../useActivityDelete';

const activity = { id: 'act-1', title: 'Field trip' } as FamilyActivity;
const linked = (...ids: string[]) => ids.map((id) => ({ id, activityId: 'act-1' }) as TodoItem);

beforeEach(() => {
  vi.clearAllMocks();
  order.length = 0;
  confirmFn.mockResolvedValue(true);
  openTodosFn.mockReturnValue([]);
  deleteActivityFn.mockImplementation(async () => {
    order.push('activity');
    return true;
  });
  deleteTodosFn.mockImplementation(async () => {
    order.push('todos');
    return true;
  });
});

describe('confirmAndDeleteActivity: no linked to-dos', () => {
  it('uses the existing danger confirm and deletes the activity', async () => {
    expect(await confirmAndDeleteActivity(activity)).toBe(true);
    expect(confirmFn).toHaveBeenCalledWith({
      title: 'planner.deleteActivity',
      message: 'planner.deleteConfirm',
      variant: 'danger',
    });
    expect(confirmChoiceFn).not.toHaveBeenCalled();
    expect(deleteActivityFn).toHaveBeenCalledWith('act-1');
    expect(deleteTodosFn).not.toHaveBeenCalled();
    expect(logEventFn).not.toHaveBeenCalled();
  });

  it('does nothing when cancelled', async () => {
    confirmFn.mockResolvedValue(false);
    expect(await confirmAndDeleteActivity(activity)).toBe(false);
    expect(deleteActivityFn).not.toHaveBeenCalled();
  });

  it('returns false on a store refusal without reporting it again', async () => {
    deleteActivityFn.mockResolvedValue(false);
    expect(await confirmAndDeleteActivity(activity)).toBe(false);
    expect(toast.fn).not.toHaveBeenCalled();
    expect(reporter.fn).not.toHaveBeenCalled();
    expect(sessionFailed.fn).not.toHaveBeenCalled();
  });
});

describe('confirmAndDeleteActivity: open linked to-dos', () => {
  beforeEach(() => {
    openTodosFn.mockReturnValue(linked('t-1', 't-2'));
  });

  it('offers keep (default) or delete-too, with the count in the label', async () => {
    confirmChoiceFn.mockResolvedValue('keep');
    await confirmAndDeleteActivity(activity);

    expect(confirmFn).not.toHaveBeenCalled();
    const opts = confirmChoiceFn.mock.calls[0]![0];
    expect(opts).toMatchObject({
      variant: 'danger',
      title: 'planner.deleteLinkedTodos.title',
      message: 'planner.deleteLinkedTodos.message',
      defaultChoice: 'keep',
    });
    expect(opts.choices.map((c: { id: string }) => c.id)).toEqual(['keep', 'delete']);
    expect(opts.choices[1].label).toBe('planner.deleteLinkedTodos.delete:2');
    expect(logEventFn).toHaveBeenCalledWith(
      expect.objectContaining({
        surface: 'activity-delete',
        context: { action: 'linked_todos_prompt', count: 2, activity_id: 'act-1' },
      })
    );
  });

  it('uses the singular keys for one linked to-do', async () => {
    openTodosFn.mockReturnValue(linked('t-1'));
    confirmChoiceFn.mockResolvedValue('keep');
    await confirmAndDeleteActivity(activity);

    const opts = confirmChoiceFn.mock.calls[0]![0];
    expect(opts.message).toBe('planner.deleteLinkedTodos.message.one');
    expect(opts.choices[1].label).toBe('planner.deleteLinkedTodos.delete.one:1');
  });

  it('keep deletes only the activity', async () => {
    confirmChoiceFn.mockResolvedValue('keep');
    expect(await confirmAndDeleteActivity(activity)).toBe(true);
    expect(deleteActivityFn).toHaveBeenCalledWith('act-1');
    expect(deleteTodosFn).not.toHaveBeenCalled();
    expect(logEventFn).toHaveBeenLastCalledWith(
      expect.objectContaining({
        context: { action: 'linked_todos_kept', count: 2, activity_id: 'act-1' },
      })
    );
  });

  it('delete removes the to-dos in one batch, after the activity', async () => {
    confirmChoiceFn.mockResolvedValue('delete');
    expect(await confirmAndDeleteActivity(activity)).toBe(true);
    expect(deleteTodosFn).toHaveBeenCalledTimes(1);
    expect(deleteTodosFn).toHaveBeenCalledWith(['t-1', 't-2']);
    expect(order).toEqual(['activity', 'todos']);
    expect(logEventFn).toHaveBeenLastCalledWith(
      expect.objectContaining({
        context: { action: 'linked_todos_deleted', count: 2, activity_id: 'act-1' },
      })
    );
  });

  it('never deletes the to-dos when the activity delete fails', async () => {
    confirmChoiceFn.mockResolvedValue('delete');
    deleteActivityFn.mockResolvedValue(false);
    expect(await confirmAndDeleteActivity(activity)).toBe(false);
    expect(deleteTodosFn).not.toHaveBeenCalled();
    expect(sessionFailed.fn).not.toHaveBeenCalled();
    expect(toast.fn).not.toHaveBeenCalled();
  });

  it('still reports the activity as deleted when only the to-do delete fails', async () => {
    confirmChoiceFn.mockResolvedValue('delete');
    deleteTodosFn.mockResolvedValue(false); // wrapAsync already toasted + reported
    expect(await confirmAndDeleteActivity(activity)).toBe(true);
    expect(toast.fn).not.toHaveBeenCalled();
    expect(logEventFn).not.toHaveBeenCalledWith(
      expect.objectContaining({
        context: expect.objectContaining({ action: 'linked_todos_deleted' }),
      })
    );
  });

  it('cancel does nothing', async () => {
    confirmChoiceFn.mockResolvedValue(null);
    expect(await confirmAndDeleteActivity(activity)).toBe(false);
    expect(deleteActivityFn).not.toHaveBeenCalled();
    expect(deleteTodosFn).not.toHaveBeenCalled();
  });

  it('deletes only the to-dos still open when the dialog closes', async () => {
    confirmChoiceFn.mockImplementation(async () => {
      // One was completed on another device while the dialog was open.
      openTodosFn.mockReturnValue(linked('t-2'));
      return 'delete';
    });
    await confirmAndDeleteActivity(activity);
    expect(deleteTodosFn).toHaveBeenCalledWith(['t-2']);
  });
});
