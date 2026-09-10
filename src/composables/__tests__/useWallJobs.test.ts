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
}));
vi.mock('@/composables/useToday', () => ({ useToday: () => ({ today: { value: '2026-09-10' } }) }));

import { useWallJobs } from '../useWallJobs';
import { useListStore } from '@/stores/listStore';
import { useTodoStore } from '@/stores/todoStore';
import { logEvent } from '@/services/telemetry/logEvent';
import { reportError } from '@/utils/errorReporter';
import { reportListAddFailed, reportTodoAddFailed } from '@/utils/actionFailure';

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
});
