/**
 * Recurring transactions are load maintenance, once a day (2026-11-15, plan requirement 8).
 *
 * `processRecurringItems` used to be awaited on every open path in App.vue and on every tab
 * wake, so an open waited on its writes. It is now ONE registered task, run after each
 * authoritative store reload, with a per-session day cursor set only on a clean run.
 */
import { setActivePinia, createPinia } from 'pinia';
import { describe, it, expect, beforeEach, vi } from 'vitest';

const h = vi.hoisted(() => ({
  family: { value: 'fam-a' as string | null },
  process: vi.fn(async () => ({ processed: 0, errors: [] as string[] })),
}));
vi.mock('@/services/recurring/recurringProcessor', () => ({ processRecurringItems: h.process }));
vi.mock('@/services/indexeddb/database', () => ({ getActiveFamilyId: () => h.family.value }));

import { useRecurringStore } from '../recurringStore';
import { useTransactionsStore } from '../transactionsStore';
import { useGoalsStore } from '../goalsStore';
import {
  __resetLoadMaintenanceForTesting,
  __whenLoadMaintenanceIdleForTesting,
  runLoadMaintenance,
} from '@/services/automerge/loadMaintenance';
import { markAuthoritative, resetProjection } from '@/services/automerge/projection';

async function reloadMaintenance(): Promise<void> {
  runLoadMaintenance('reload');
  await __whenLoadMaintenanceIdleForTesting();
}

describe('recurring items as load maintenance', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    __resetLoadMaintenanceForTesting();
    resetProjection();
    markAuthoritative();
    h.family.value = 'fam-a';
    h.process.mockReset();
    h.process.mockResolvedValue({ processed: 0, errors: [] });
    useRecurringStore(); // store setup registers the task
  });

  it('run twice on the same day (an open, then a post-merge reload) writes once', async () => {
    await reloadMaintenance();
    await reloadMaintenance();
    expect(h.process).toHaveBeenCalledTimes(1);
  });

  it('reloads transactions and goals only when something was generated', async () => {
    const tx = vi.spyOn(useTransactionsStore(), 'loadTransactions');
    const goals = vi.spyOn(useGoalsStore(), 'loadGoals');
    h.process.mockResolvedValueOnce({ processed: 2, errors: [] });
    await reloadMaintenance();
    expect(tx).toHaveBeenCalledTimes(1);
    expect(goals).toHaveBeenCalledTimes(1);
  });

  it('a run with errors does not set the cursor: the next reload retries', async () => {
    h.process.mockResolvedValueOnce({ processed: 0, errors: ['Failed to generate rent'] });
    await reloadMaintenance();
    await reloadMaintenance();
    expect(h.process).toHaveBeenCalledTimes(2);
    await reloadMaintenance(); // clean now: the cursor holds
    expect(h.process).toHaveBeenCalledTimes(2);
  });

  it('a family switch in the same session runs again for the new family', async () => {
    await reloadMaintenance();
    h.family.value = 'fam-b';
    await reloadMaintenance();
    expect(h.process).toHaveBeenCalledTimes(2);
  });

  it('a new local day runs again', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(new Date(2026, 10, 15, 12, 0));
      await reloadMaintenance();
      vi.setSystemTime(new Date(2026, 10, 16, 0, 5));
      await reloadMaintenance();
      expect(h.process).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does nothing before the document is authoritative (a snapshot paint)', async () => {
    resetProjection();
    await reloadMaintenance();
    expect(h.process).not.toHaveBeenCalled();
  });
});
