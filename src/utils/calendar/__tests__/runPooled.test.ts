import { describe, it, expect, vi } from 'vitest';
import { runPooled } from '../runPooled';

describe('runPooled', () => {
  it('runs every task with bounded concurrency', async () => {
    let inFlight = 0;
    let peak = 0;
    const tasks = Array.from({ length: 10 }, () => async () => {
      peak = Math.max(peak, ++inFlight);
      await Promise.resolve();
      inFlight--;
    });

    await runPooled(tasks, 3);

    expect(peak).toBeLessThanOrEqual(3);
  });

  describe('shouldAbort', () => {
    it('defaults to never aborting — existing callers are unchanged', async () => {
      const tasks = Array.from({ length: 5 }, () => vi.fn(async () => {}));

      await runPooled(tasks, 2);

      for (const t of tasks) expect(t).toHaveBeenCalledTimes(1);
    });

    it('stops dispatching new tasks once the predicate flips', async () => {
      // Mirrors calendarSyncStore: the first `auth` failure latches, and the
      // remaining tasks must not be dispatched.
      let aborted = false;
      const ran: number[] = [];
      const tasks = Array.from({ length: 10 }, (_, i) => async () => {
        ran.push(i);
        if (i === 0) aborted = true;
      });

      await runPooled(tasks, 1, () => aborted);

      expect(ran).toEqual([0]);
    });

    it('never interrupts work already in flight', async () => {
      let aborted = false;
      let completed = 0;
      const tasks = [
        async () => {
          aborted = true;
          await Promise.resolve();
          completed++; // must still finish
        },
        async () => {
          completed++;
        },
      ];

      await runPooled(tasks, 1, () => aborted);

      expect(completed).toBe(1);
    });

    it('does not dispatch anything when already aborted', async () => {
      const task = vi.fn(async () => {});

      await runPooled([task, task], 2, () => true);

      expect(task).not.toHaveBeenCalled();
    });
  });
});
