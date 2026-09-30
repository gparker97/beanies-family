/**
 * The #55 reminder back-fill in a read-only family (#95): it is skipped, exactly like a member
 * without permission, logs the skip once per session, leaves its one-shot marker unset, and runs
 * on the next writable boot. It never attempts the write, so the gate never has to refuse it.
 */
import { setActivePinia, createPinia } from 'pinia';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { FamilyActivity } from '@/types/models';

const h = vi.hoisted(() => ({
  settings: {
    activityReminderBackfilledAt: null as string | null,
    setActivityReminderBackfilledAt: vi.fn(async () => {}),
  },
}));

vi.mock('@/services/automerge/repositories/activityRepository', () => ({
  getAllActivities: vi.fn(),
  backfillActivityReminders: vi.fn(async () => {}),
}));
vi.mock('@/stores/settingsStore', () => ({ useSettingsStore: () => h.settings }));
vi.mock('@/services/telemetry', () => ({ logEvent: vi.fn() }));

import { useActivityStore } from '../activityStore';
import * as activityRepo from '@/services/automerge/repositories/activityRepository';
import { logEvent } from '@/services/telemetry';
import { setWriteGate, __resetWriteGateForTesting } from '@/services/automerge/worker/writeGate';

/** An activity the back-fill selects: no reminder set yet. */
const swim = {
  id: 'a1',
  title: 'Swim class',
  date: '2026-10-01',
  recurrence: 'none',
  category: 'sports',
  reminderMinutes: 0,
  createdAt: '2026-01-01',
  updatedAt: '2026-01-01',
} as unknown as FamilyActivity;

let readOnly = false;

const skipped = () =>
  vi
    .mocked(logEvent)
    .mock.calls.filter(
      ([e]) =>
        e.surface === 'activity-reminder-backfill' &&
        (e.context as { action?: string })?.action === 'skipped_read_only'
    );

describe('activity reminder back-fill while read-only (#95)', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    h.settings.activityReminderBackfilledAt = null;
    readOnly = false;
    __resetWriteGateForTesting();
    setWriteGate(() => ({ block: readOnly, wouldBlock: false }));
  });

  afterEach(() => {
    __resetWriteGateForTesting();
  });

  it('skips while read-only, logs once per session, and leaves the marker unset', async () => {
    readOnly = true;
    const store = useActivityStore();
    store.activities.push(swim);

    await store.backfillReminderMinutes({ canEdit: true });
    await store.backfillReminderMinutes({ canEdit: true });

    expect(activityRepo.backfillActivityReminders).not.toHaveBeenCalled();
    expect(h.settings.setActivityReminderBackfilledAt).not.toHaveBeenCalled();
    expect(skipped()).toHaveLength(1);
  });

  it('runs on the next writable boot', async () => {
    readOnly = true;
    const store = useActivityStore();
    store.activities.push(swim);
    await store.backfillReminderMinutes({ canEdit: true });

    readOnly = false;
    await store.backfillReminderMinutes({ canEdit: true });

    expect(activityRepo.backfillActivityReminders).toHaveBeenCalledWith(['a1'], expect.any(Number));
    expect(h.settings.setActivityReminderBackfilledAt).toHaveBeenCalledOnce();
  });
});
