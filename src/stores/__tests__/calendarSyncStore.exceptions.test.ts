import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { installInlineBackend } from '@/services/automerge/worker/__tests__/inlineHarness';
import { addDaysYmd, localToday } from '@/utils/date';
import {
  createActivity,
  deleteActivity,
} from '@/services/automerge/repositories/activityRepository';
import { createCalendarConnection } from '@/services/automerge/repositories/calendarRepository';
import { useCalendarSyncStore, setCalendarClientForTesting } from '../calendarSyncStore';
import { makeCalendarClientStub } from '@/services/calendar/__tests__/fakeCalendarClient';
import type { CreateFamilyActivityInput } from '@/types/models';

// P2 exceptions — the two-phase reconcile applies per-occurrence overrides as Google
// recurring-instance exceptions (reschedule / edit-one / delete-one) + restores.

vi.mock('@/utils/errorReporter', () => ({ reportError: vi.fn() }));

const OWNED = 'https://www.googleapis.com/auth/calendar.events.owned';
const OCC = addDaysYmd(localToday(), 5); // the occurrence being overridden

function makeExceptionClient() {
  const calls = {
    insert: [] as string[],
    listInstances: [] as string[],
    patch: [] as Array<{ eventId: string }>,
    patchFields: [] as Array<{ eventId: string; patch: unknown }>,
  };
  const client = makeCalendarClientStub({
    async insertEvent(_c, _cal, eventId) {
      calls.insert.push(eventId);
    },
    async listInstances(_c, _cal, masterEventId) {
      calls.listInstances.push(masterEventId);
      // One instance, original start on the overridden occurrence day.
      return [{ id: `${masterEventId}__inst`, originalStartTime: { date: OCC } }];
    },
    async patchEvent(_c, _cal, eventId) {
      calls.patch.push({ eventId });
    },
    async patchEventFields(_c, _cal, eventId, patch) {
      calls.patchFields.push({ eventId, patch });
    },
  });
  return { client, calls };
}

function base(overrides: Partial<CreateFamilyActivityInput>): CreateFamilyActivityInput {
  return {
    title: 'Piano',
    date: OCC,
    recurrence: 'none',
    category: 'music',
    feeSchedule: 'none',
    reminderMinutes: 0,
    isActive: true,
    createdBy: 'm0',
    startTime: '15:00',
    endTime: '16:00',
    ...overrides,
  } as unknown as CreateFamilyActivityInput;
}

async function seedConnection() {
  await createCalendarConnection({
    provider: 'google',
    accountEmail: 'mum@example.com',
    destinationCalendarId: 'primary',
    refreshToken: 'r',
    grantedScopes: [OWNED],
    status: 'ok',
  });
}

describe('calendarSyncStore — recurring-instance exceptions', () => {
  beforeEach(async () => {
    setActivePinia(createPinia());
    await installInlineBackend();
    localStorage.setItem('beanies:flag:googleCalendarSync', 'true');
  });
  afterEach(() => {
    setCalendarClientForTesting(null);
    localStorage.clear();
  });

  it('edit-one → discovers the instance once and patches it (modify)', async () => {
    const { client, calls } = makeExceptionClient();
    setCalendarClientForTesting(client);
    await seedConnection();
    const master = await createActivity(
      base({ title: 'Piano', recurrence: 'daily', date: addDaysYmd(localToday(), -1) })
    );
    await createActivity(
      base({ title: 'Piano (edited)', parentActivityId: master!.id, date: OCC })
    );

    await useCalendarSyncStore().syncNow();

    expect(calls.listInstances).toHaveLength(1);
    expect(calls.patch).toHaveLength(1);
    expect(calls.patch[0]!.eventId).toContain('__inst'); // patched the INSTANCE, not the master
    expect(calls.patchFields).toHaveLength(0);
  });

  it('delete-one → cancels the instance via patchEventFields', async () => {
    const { client, calls } = makeExceptionClient();
    setCalendarClientForTesting(client);
    await seedConnection();
    const master = await createActivity(
      base({ recurrence: 'daily', date: addDaysYmd(localToday(), -1) })
    );
    await createActivity(base({ parentActivityId: master!.id, date: OCC, isActive: false }));

    await useCalendarSyncStore().syncNow();

    expect(calls.patchFields).toHaveLength(1);
    expect(calls.patchFields[0]!.patch).toEqual({ status: 'cancelled' });
    expect(calls.patch).toHaveLength(0);
  });

  it('is idempotent — a second reconcile with no change writes no exception', async () => {
    const { client, calls } = makeExceptionClient();
    setCalendarClientForTesting(client);
    await seedConnection();
    const master = await createActivity(
      base({ recurrence: 'daily', date: addDaysYmd(localToday(), -1) })
    );
    await createActivity(base({ parentActivityId: master!.id, date: OCC }));

    const store = useCalendarSyncStore();
    await store.syncNow();
    const patchesAfterFirst = calls.patch.length;
    await store.syncNow();
    expect(calls.patch.length).toBe(patchesAfterFirst); // no new writes
  });

  it('reschedule → then delete the override → RESTORE patches by the STORED instance id (no re-discovery)', async () => {
    const { client, calls } = makeExceptionClient();
    setCalendarClientForTesting(client);
    await seedConnection();
    const master = await createActivity(
      base({ recurrence: 'daily', date: addDaysYmd(localToday(), -1) })
    );
    const child = await createActivity(
      base({ parentActivityId: master!.id, date: addDaysYmd(OCC, 3), originalOccurrenceDate: OCC })
    );

    const store = useCalendarSyncStore();
    await store.syncNow(); // creates the exception + stores the instance id
    expect(calls.patch).toHaveLength(1);

    const listCallsBefore = calls.listInstances.length;
    // Delete the override → next reconcile restores the instance.
    await deleteActivity(child!.id);
    await store.syncNow();

    // Restore patched by the stored instance id, WITHOUT another listInstances discovery.
    expect(calls.listInstances.length).toBe(listCallsBefore);
    const restore = calls.patchFields.at(-1)!;
    expect(restore.eventId).toContain('__inst'); // the stored instance id, un-cancelled/moved back
  });

  it('a child whose master is NOT synced is skipped — no listInstances, no patch, no orphan event', async () => {
    const { client, calls } = makeExceptionClient();
    setCalendarClientForTesting(client);
    await seedConnection();
    // Only the child exists (no master activity) → not pushable → skipped.
    await createActivity(base({ parentActivityId: 'ghost-master', date: OCC }));

    await useCalendarSyncStore().syncNow();

    expect(calls.listInstances).toHaveLength(0);
    expect(calls.patch).toHaveLength(0);
    expect(calls.patchFields).toHaveLength(0);
    expect(calls.insert).toHaveLength(0); // never a standalone top-level event for the child
  });
});
