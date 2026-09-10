/**
 * The wall's write contract.
 *
 * `useWallJobs` had no test coverage at all while it carried three hand-copied
 * try/catch/report/log blocks, so nothing would have noticed when they drifted
 * from each other (and they had: the toggle logged `action: 'job_toggled'` on
 * success but `'job_toggle'` on failure, and the two adds carried `kind: 'ok'`
 * on success and no `kind` at all on failure).
 *
 * These tests pin the contract itself rather than any one operation: every
 * write reports the same shape on success and on failure, a refusal and a throw
 * take the same path, and neither can ever be silent.
 */
import { setActivePinia, createPinia } from 'pinia';
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@/services/telemetry/logEvent', () => ({ logEvent: vi.fn() }));
vi.mock('@/utils/errorReporter', () => ({ reportError: vi.fn() }));
vi.mock('@/utils/actionFailure', () => ({
  reportJobToggleFailed: vi.fn(),
  reportListAddFailed: vi.fn(),
  reportTodoAddFailed: vi.fn(),
  reportJobEditFailed: vi.fn(),
}));
vi.mock('@/composables/useToast', () => ({ showToast: vi.fn() }));
vi.mock('@/stores/translationStore', () => ({
  useTranslationStore: () => ({ t: (key: string) => key }),
}));
vi.mock('@/composables/useToday', () => ({ useToday: () => ({ today: { value: '2026-09-10' } }) }));

import { useWallJobs } from '../useWallJobs';
import { useListStore } from '@/stores/listStore';
import { useTodoStore } from '@/stores/todoStore';
import { logEvent } from '@/services/telemetry/logEvent';
import { reportError } from '@/utils/errorReporter';
import {
  reportJobEditFailed,
  reportListAddFailed,
  reportTodoAddFailed,
} from '@/utils/actionFailure';
import { showToast } from '@/composables/useToast';
import type { WallJob } from '@/types/wall';
import type { FamilyList, TodoItem } from '@/types/models';

const SURFACE = 'beanie-wall';

describe('useWallJobs write contract', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  describe('addListItem', () => {
    it('logs one info event carrying the op as `action` and the job source as `kind`', async () => {
      const listStore = useListStore();
      vi.spyOn(listStore, 'addItem').mockResolvedValue({ id: 'l1' } as never);

      await expect(useWallJobs().addListItem('l1', 'Bread')).resolves.toBe(true);

      expect(logEvent).toHaveBeenCalledTimes(1);
      expect(logEvent).toHaveBeenCalledWith({
        level: 'info',
        surface: SURFACE,
        message: 'wall_list_item_added',
        context: { action: 'list_add', kind: 'list' },
      });
      expect(reportError).not.toHaveBeenCalled();
    });

    it('trims before writing', async () => {
      const listStore = useListStore();
      const addItem = vi.spyOn(listStore, 'addItem').mockResolvedValue({ id: 'l1' } as never);

      await useWallJobs().addListItem('l1', '  Bread  ');

      expect(addItem).toHaveBeenCalledWith('l1', 'Bread');
    });

    it('refuses a blank title without touching the store or the firehose', async () => {
      const listStore = useListStore();
      const addItem = vi.spyOn(listStore, 'addItem');

      await expect(useWallJobs().addListItem('l1', '   ')).resolves.toBe(false);

      expect(addItem).not.toHaveBeenCalled();
      expect(logEvent).not.toHaveBeenCalled();
      expect(reportError).not.toHaveBeenCalled();
    });

    it('never fails silently: a refused write pages AND tells the family', async () => {
      const listStore = useListStore();
      vi.spyOn(listStore, 'addItem').mockResolvedValue(null);

      await expect(useWallJobs().addListItem('l1', 'Bread')).resolves.toBe(false);

      expect(reportListAddFailed).toHaveBeenCalledWith('l1');
      expect(reportError).toHaveBeenCalledWith(
        expect.objectContaining({
          surface: SURFACE,
          message: 'wall_list_add_failed',
          severity: 'critical',
          context: { action: 'list_add', kind: 'list' },
        })
      );
      expect(logEvent).not.toHaveBeenCalled();
    });

    it('takes the same path for a throw as for a refusal, and carries the cause', async () => {
      const listStore = useListStore();
      vi.spyOn(listStore, 'addItem').mockRejectedValue(new Error('drive offline'));

      await expect(useWallJobs().addListItem('l1', 'Bread')).resolves.toBe(false);

      expect(reportListAddFailed).toHaveBeenCalledWith('l1');
      expect(reportError).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'wall_list_add_failed',
          severity: 'critical',
          error: expect.objectContaining({ message: 'drive offline' }),
          context: { action: 'list_add', kind: 'list' },
        })
      );
    });

    it('omits `error` entirely when the store merely refused', async () => {
      const listStore = useListStore();
      vi.spyOn(listStore, 'addItem').mockResolvedValue(null);

      await useWallJobs().addListItem('l1', 'Bread');

      expect(vi.mocked(reportError).mock.calls[0][0]).not.toHaveProperty('error');
    });
  });

  describe('addTodo', () => {
    it('reports as `kind: todo`, not as a list', async () => {
      const todoStore = useTodoStore();
      vi.spyOn(todoStore, 'createTodo').mockResolvedValue({ id: 't1' } as never);

      await expect(useWallJobs().addTodo('Passports')).resolves.toBe(true);

      expect(logEvent).toHaveBeenCalledWith({
        level: 'info',
        surface: SURFACE,
        message: 'wall_todo_added',
        context: { action: 'todo_add', kind: 'todo' },
      });
    });

    it('pages on refusal with the todo kind', async () => {
      const todoStore = useTodoStore();
      vi.spyOn(todoStore, 'createTodo').mockResolvedValue(null);

      await expect(useWallJobs().addTodo('Passports')).resolves.toBe(false);

      expect(reportTodoAddFailed).toHaveBeenCalled();
      expect(reportError).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'wall_todo_add_failed',
          severity: 'critical',
          context: { action: 'todo_add', kind: 'todo' },
        })
      );
    });
  });

  const listJob: WallJob = {
    key: 'list:l1:i1',
    title: 'goggles',
    done: false,
    ownerId: 'm1',
    source: 'list',
    listId: 'l1',
    itemId: 'i1',
  };
  const todoJob: WallJob = {
    key: 'todo:t1:m1',
    title: 'passports',
    done: false,
    ownerId: 'm1',
    source: 'todo',
    todoId: 't1',
  };

  describe('renameJob', () => {
    it('routes a list job to updateItemText, trimmed', async () => {
      const listStore = useListStore();
      const rename = vi.spyOn(listStore, 'updateItemText').mockResolvedValue({ id: 'l1' } as never);

      await expect(useWallJobs().renameJob(listJob, '  swim cap  ')).resolves.toBe(true);

      expect(rename).toHaveBeenCalledWith('l1', 'i1', 'swim cap');
      expect(logEvent).toHaveBeenCalledWith({
        level: 'info',
        surface: SURFACE,
        message: 'wall_job_renamed',
        context: { action: 'job_rename', kind: 'list' },
      });
    });

    it('routes a to-do job to updateTodo, not to the list store', async () => {
      const todoStore = useTodoStore();
      const listStore = useListStore();
      const update = vi.spyOn(todoStore, 'updateTodo').mockResolvedValue({ id: 't1' } as never);
      const listRename = vi.spyOn(listStore, 'updateItemText');

      await expect(useWallJobs().renameJob(todoJob, 'passports and visas')).resolves.toBe(true);

      expect(update).toHaveBeenCalledWith('t1', { title: 'passports and visas' });
      expect(listRename).not.toHaveBeenCalled();
    });

    it('does not write when the title is unchanged', async () => {
      const listStore = useListStore();
      const rename = vi.spyOn(listStore, 'updateItemText');

      await expect(useWallJobs().renameJob(listJob, 'goggles')).resolves.toBe(false);

      expect(rename).not.toHaveBeenCalled();
      expect(logEvent).not.toHaveBeenCalled();
    });

    it('does not DELETE when the field is cleared: an emptied edit is not a removal', async () => {
      const listStore = useListStore();
      const rename = vi.spyOn(listStore, 'updateItemText');
      const remove = vi.spyOn(listStore, 'removeItem');

      await expect(useWallJobs().renameJob(listJob, '   ')).resolves.toBe(false);

      expect(rename).not.toHaveBeenCalled();
      expect(remove).not.toHaveBeenCalled();
    });

    it('pages and tells the family when the store refuses', async () => {
      const listStore = useListStore();
      vi.spyOn(listStore, 'updateItemText').mockResolvedValue(null);

      await expect(useWallJobs().renameJob(listJob, 'swim cap')).resolves.toBe(false);

      expect(reportJobEditFailed).toHaveBeenCalledWith('rename', 'list', 'i1');
      expect(reportError).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'wall_job_rename_failed',
          severity: 'critical',
          context: { action: 'job_rename', kind: 'list' },
        })
      );
    });
  });

  describe('removeJob', () => {
    function seedList(over: Partial<FamilyList> = {}) {
      const listStore = useListStore();
      listStore.lists = [
        {
          id: 'l1',
          title: 'Swim bag',
          items: [{ id: 'i1', title: 'goggles', completed: false }],
          completed: false,
          ...over,
        } as FamilyList,
      ];
      return listStore;
    }

    it('removes a list item and offers Undo for 6 seconds', async () => {
      const listStore = seedList();
      vi.spyOn(listStore, 'removeItem').mockResolvedValue({ id: 'l1' } as never);

      await expect(useWallJobs().removeJob(listJob)).resolves.toBe(true);

      expect(showToast).toHaveBeenCalledWith(
        'info',
        expect.stringContaining('wall.job.removed'),
        undefined,
        expect.objectContaining({ durationMs: 6000, actionLabel: 'wall.job.undo' })
      );
    });

    it('restores ONE item at its original position, never a whole-array snapshot', async () => {
      const listStore = seedList({
        items: [
          { id: 'i0', title: 'towel', completed: false },
          { id: 'i1', title: 'goggles', completed: false },
          { id: 'i2', title: 'cap', completed: false },
        ],
      } as Partial<FamilyList>);
      vi.spyOn(listStore, 'removeItem').mockResolvedValue({ id: 'l1' } as never);
      const restoreItem = vi
        .spyOn(listStore, 'restoreItem')
        .mockResolvedValue({ id: 'l1' } as never);

      await useWallJobs().removeJob(listJob);
      await vi.mocked(showToast).mock.calls[0][3]!.actionFn!();

      expect(restoreItem).toHaveBeenCalledWith(
        'l1',
        expect.objectContaining({ id: 'i1', title: 'goggles' }),
        1
      );
    });

    it('never writes the items array wholesale: that is what destroyed concurrent adds', async () => {
      const listStore = seedList();
      vi.spyOn(listStore, 'removeItem').mockResolvedValue({ id: 'l1' } as never);
      vi.spyOn(listStore, 'restoreItem').mockResolvedValue({ id: 'l1' } as never);
      const updateList = vi.spyOn(listStore, 'updateList');

      await useWallJobs().removeJob(listJob);
      await vi.mocked(showToast).mock.calls[0][3]!.actionFn!();

      expect(updateList).not.toHaveBeenCalled();
    });

    it('restores a to-do under its ORIGINAL id, not as a new record', async () => {
      const todoStore = useTodoStore();
      const original = { id: 't1', title: 'passports', completed: false } as TodoItem;
      todoStore.todos = [original];
      vi.spyOn(todoStore, 'deleteTodo').mockResolvedValue(true);
      const restore = vi.spyOn(todoStore, 'restoreTodo').mockResolvedValue(original);

      await useWallJobs().removeJob(todoJob);
      await vi.mocked(showToast).mock.calls[0][3]!.actionFn!();

      expect(restore).toHaveBeenCalledWith(original);
    });

    it('offers no Undo when the delete itself was refused', async () => {
      const listStore = seedList();
      vi.spyOn(listStore, 'removeItem').mockResolvedValue(null);

      await expect(useWallJobs().removeJob(listJob)).resolves.toBe(false);

      expect(showToast).not.toHaveBeenCalled();
      expect(reportJobEditFailed).toHaveBeenCalledWith('remove', 'list', 'i1');
    });

    it('offers no Undo it could not honour when the record was already gone', async () => {
      const listStore = useListStore();
      listStore.lists = [];
      vi.spyOn(listStore, 'removeItem').mockResolvedValue({ id: 'l1' } as never);

      await expect(useWallJobs().removeJob(listJob)).resolves.toBe(true);

      expect(showToast).not.toHaveBeenCalled();
    });

    it('reports a failed undo rather than leaving the family to guess', async () => {
      const listStore = seedList();
      vi.spyOn(listStore, 'removeItem').mockResolvedValue({ id: 'l1' } as never);
      vi.spyOn(listStore, 'restoreItem').mockResolvedValue(null);

      await useWallJobs().removeJob(listJob);
      await vi.mocked(showToast).mock.calls[0][3]!.actionFn!();

      expect(reportJobEditFailed).toHaveBeenCalledWith('undo', 'list', 'i1');
      expect(reportError).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'wall_job_remove_undo_failed',
          severity: 'critical',
          context: { action: 'job_remove_undo', kind: 'list' },
        })
      );
    });
  });

  describe('the contract holds even when reporting itself fails', () => {
    it('does not throw out of a write when the user-facing reporter throws', async () => {
      const listStore = useListStore();
      vi.spyOn(listStore, 'addItem').mockResolvedValue(null);
      vi.mocked(reportListAddFailed).mockImplementationOnce(() => {
        throw new Error('toast queue is gone');
      });

      await expect(useWallJobs().addListItem('l1', 'Bread')).resolves.toBe(false);
    });

    it("reports the REAL refusal, not the reporter's own error", async () => {
      const listStore = useListStore();
      vi.spyOn(listStore, 'addItem').mockResolvedValue(null);
      vi.mocked(reportListAddFailed).mockImplementationOnce(() => {
        throw new Error('toast queue is gone');
      });

      await useWallJobs().addListItem('l1', 'Bread');

      expect(reportError).toHaveBeenCalledTimes(1);
      expect(vi.mocked(reportError).mock.calls[0][0]).not.toHaveProperty('error');
    });

    it('does not throw out of a write when telemetry throws', async () => {
      const listStore = useListStore();
      vi.spyOn(listStore, 'addItem').mockResolvedValue(null);
      vi.mocked(reportError).mockImplementationOnce(() => {
        throw new Error('telemetry queue is gone');
      });

      await expect(useWallJobs().addListItem('l1', 'Bread')).resolves.toBe(false);
    });
  });
});
