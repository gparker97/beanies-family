/**
 * A reconcile whose outcome matches what is already stored writes NOTHING (2026-11-12).
 *
 * The incident this guards: one always-on wall tablet re-stamped the connection's
 * freshness claim on every 5-minute poll, because the "skip the write" return only held
 * while the stored stamp was younger than 120 s and the poll is 300 s. That was ~288
 * family-doc changes and ~288 Drive saves a day from a calendar that changed nothing.
 *
 * `updateCalendarConnection` is wrapped (pass-through) so each test can count the
 * connection writes a reconcile makes.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { installInlineBackend } from '@/services/automerge/worker/__tests__/inlineHarness';
import { toISODateString } from '@/utils/date';
import {
  createActivity,
  updateActivity,
} from '@/services/automerge/repositories/activityRepository';
import {
  createCalendarConnection,
  updateCalendarConnection,
  getCalendarConnectionById,
} from '@/services/automerge/repositories/calendarRepository';
import { useCalendarSyncStore, setCalendarClientForTesting } from '../calendarSyncStore';
import { CalendarApiError, type CalendarErrorKind } from '@/services/calendar/CalendarClient';
import { makeCalendarClientStub } from '@/services/calendar/__tests__/fakeCalendarClient';
import type { CalendarConnection, CreateFamilyActivityInput } from '@/types/models';

const { logEventMock } = vi.hoisted(() => ({ logEventMock: vi.fn() }));

vi.mock('@/utils/errorReporter', () => ({ reportError: vi.fn() }));
vi.mock('@/services/telemetry', () => ({ logEvent: logEventMock }));
vi.mock('@/services/automerge/repositories/calendarRepository', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/services/automerge/repositories/calendarRepository')>();
  return { ...actual, updateCalendarConnection: vi.fn(actual.updateCalendarConnection) };
});

const OWNED = 'https://www.googleapis.com/auth/calendar.events.owned';
// Midday, so moving the clock 10 minutes can never cross midnight and move the window.
const NOON = new Date(2026, 10, 12, 12, 0, 0);

/**
 * A client whose `eventExists` (the verify probe on an unchanged event) can be made to
 * fail with any error kind, so a reconcile can be driven between a clean no-op and an
 * error without changing the activity set.
 */
function makeClient() {
  const existing = new Set<string>();
  const state = { failWith: null as CalendarErrorKind | null };
  const client = makeCalendarClientStub({
    async insertEvent(_c, _cal, eventId) {
      existing.add(eventId);
    },
    async eventExists(_c, _cal, eventId) {
      if (state.failWith)
        throw new CalendarApiError(state.failWith, 'Google Calendar HTTP 403', 403);
      return existing.has(eventId);
    },
  });
  return { client, state };
}

function activityInput(title = 'Soccer practice'): CreateFamilyActivityInput {
  return {
    title,
    date: toISODateString(new Date()).slice(0, 10),
    recurrence: 'none',
    category: 'sports',
    feeSchedule: 'none',
    reminderMinutes: 0,
    isActive: true,
    createdBy: 'm0',
  } as unknown as CreateFamilyActivityInput;
}

async function connect(overrides: Partial<CalendarConnection> = {}) {
  const connection = await createCalendarConnection({
    provider: 'google',
    accountEmail: 'mum@example.com',
    destinationCalendarId: 'primary',
    refreshToken: 'refresh-xyz',
    grantedScopes: [OWNED],
    status: 'ok',
    ...overrides,
  } as Parameters<typeof createCalendarConnection>[0]);
  return connection!;
}

const writes = () => vi.mocked(updateCalendarConnection).mock.calls;

const outcomeDetails = () =>
  logEventMock.mock.calls
    .map(([e]) => e as { context?: { action?: string; detail?: string } })
    .filter((e) => e.context?.action === 'reconcile-outcome')
    .map((e) => e.context?.detail);

async function calendarSeverities() {
  const { reportError } = await import('@/utils/errorReporter');
  return vi
    .mocked(reportError)
    .mock.calls.map((c) => c[0] as { surface: string; severity?: string })
    .filter((a) => a.surface === 'calendar-sync')
    .map((a) => a.severity);
}

const OK_PATCH = {
  status: 'ok',
  lastError: undefined,
  lastSyncedAt: expect.any(String),
  lastReconciledAt: expect.any(String),
  lastReconciledBy: expect.any(String),
};

describe('calendarSyncStore: a reconcile that changes nothing writes nothing', () => {
  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOON);
    setActivePinia(createPinia());
    await installInlineBackend();
    localStorage.setItem('beanies:flag:googleCalendarSync', 'true');
    logEventMock.mockClear();
    const { reportError } = await import('@/utils/errorReporter');
    vi.mocked(reportError).mockClear();
    vi.mocked(updateCalendarConnection).mockClear();
  });

  afterEach(() => {
    useCalendarSyncStore().stop();
    setCalendarClientForTesting(null);
    localStorage.clear();
    vi.useRealTimers();
  });

  it('🔴 a clean no-op on an ok connection makes zero connection writes, with a stamp 10 minutes old', async () => {
    const { client } = makeClient();
    setCalendarClientForTesting(client);
    const connection = await connect();
    await createActivity(activityInput());
    const store = useCalendarSyncStore();

    await store.syncNow(); // first push: writes the ok patch and the claim
    expect(writes()).toHaveLength(1);
    const stamp = (await getCalendarConnectionById(connection.id))?.lastReconciledAt;
    expect(stamp).toBeDefined();

    // The always-on tablet: the stored stamp is far older than the 120 s window.
    vi.setSystemTime(new Date(NOON.getTime() + 10 * 60_000));
    vi.mocked(updateCalendarConnection).mockClear();

    expect(await store.syncNow(connection.id)).toBe('ok');
    await store.syncNow(connection.id);

    expect(writes()).toHaveLength(0);
    expect((await getCalendarConnectionById(connection.id))?.lastReconciledAt).toBe(stamp);
  });

  it('emits the reconcile outcome on change plus heartbeat, not on every poll', async () => {
    const { client } = makeClient();
    setCalendarClientForTesting(client);
    const connection = await connect();
    await createActivity(activityInput());
    const store = useCalendarSyncStore();

    await store.syncNow(connection.id);
    await store.syncNow(connection.id);
    await store.syncNow(connection.id); // identical to the one before: suppressed

    expect(outcomeDetails()).toEqual([
      'outcome=ok;changed=1;wrote=1;verify=1',
      'outcome=ok;changed=0;wrote=0;verify=1',
    ]);

    // A gate that survived a session switch would swallow the next session's first event.
    store.stop();
    setCalendarClientForTesting(client); // stop() resets the client along with the gates
    await store.syncNow(connection.id);
    expect(outcomeDetails()).toHaveLength(3);
    expect(outcomeDetails()[2]).toBe('outcome=ok;changed=0;wrote=0;verify=1');
  });

  it('a reconcile that changed something still writes the full ok patch', async () => {
    const { client } = makeClient();
    setCalendarClientForTesting(client);
    const connection = await connect();
    const activity = await createActivity(activityInput());
    const store = useCalendarSyncStore();
    await store.syncNow(connection.id);
    vi.mocked(updateCalendarConnection).mockClear();

    await updateActivity(activity.id, { title: 'Soccer, new field' });
    await store.syncNow(connection.id);

    expect(writes()).toEqual([[connection.id, OK_PATCH]]);
  });

  it('a status transition back to ok still writes the full ok patch', async () => {
    const { client } = makeClient();
    setCalendarClientForTesting(client);
    const connection = await connect({ status: 'error', lastError: 'forbidden' });
    vi.mocked(updateCalendarConnection).mockClear();

    // Nothing to push: the only thing that differs from storage is the status.
    await useCalendarSyncStore().syncNow(connection.id);

    expect(writes()).toEqual([[connection.id, OK_PATCH]]);
    const after = await getCalendarConnectionById(connection.id);
    expect(after?.status).toBe('ok');
    expect(after?.lastError).toBeUndefined();
  });

  it('a lastError change on an ok connection (a throttle that healed) still writes', async () => {
    const { client } = makeClient();
    setCalendarClientForTesting(client);
    const connection = await connect({ status: 'ok', lastError: 'rate_limited' });
    vi.mocked(updateCalendarConnection).mockClear();

    await useCalendarSyncStore().syncNow(connection.id);

    expect(writes()).toEqual([[connection.id, OK_PATCH]]);
    expect((await getCalendarConnectionById(connection.id))?.lastError).toBeUndefined();
    expect(outcomeDetails()).toEqual(['outcome=ok;changed=0;wrote=1;verify=1']);
  });

  it('🔴 a repeated identical error does not rewrite the connection; paging is unchanged', async () => {
    const { client, state } = makeClient();
    setCalendarClientForTesting(client);
    const connection = await connect();
    await createActivity(activityInput());
    const store = useCalendarSyncStore();
    await store.syncNow(connection.id); // pushed cleanly
    vi.mocked(updateCalendarConnection).mockClear();

    state.failWith = 'forbidden';
    for (let i = 0; i < 4; i++) {
      expect(await store.syncNow(connection.id)).toBe('error');
    }

    // Only the first error writes (the transition to `error` + `lastError`).
    expect(writes()).toHaveLength(1);
    expect(writes()[0]?.[1]).toMatchObject({ status: 'error', lastError: 'forbidden' });
    // The counter and the page behave exactly as before: critical on the 3rd only.
    const sev = await calendarSeverities();
    expect(sev).toHaveLength(4);
    expect(sev[0]).not.toBe('critical');
    expect(sev[1]).not.toBe('critical');
    expect(sev[2]).toBe('critical');
    expect(sev[3]).not.toBe('critical');
    expect(outcomeDetails().slice(-2)).toEqual([
      'outcome=error;changed=0;wrote=1;verify=1',
      'outcome=error;changed=0;wrote=0;verify=1',
    ]);
  });

  it('a repeated identical throttle does not rewrite the connection either', async () => {
    const { client, state } = makeClient();
    setCalendarClientForTesting(client);
    const connection = await connect();
    await createActivity(activityInput());
    const store = useCalendarSyncStore();
    await store.syncNow(connection.id);
    vi.mocked(updateCalendarConnection).mockClear();

    state.failWith = 'rate_limited';
    await store.syncNow(connection.id);
    await store.syncNow(connection.id);

    expect(writes()).toHaveLength(1);
    expect(writes()[0]?.[1]).not.toHaveProperty('status');
    expect((await getCalendarConnectionById(connection.id))?.status).toBe('ok');
  });

  it('🔴 a clean no-op resets the error counter even when another device restored ok', async () => {
    const { client, state } = makeClient();
    setCalendarClientForTesting(client);
    const connection = await connect();
    await createActivity(activityInput());
    const store = useCalendarSyncStore();
    await store.syncNow(connection.id); // pushed cleanly

    state.failWith = 'forbidden';
    await store.syncNow(connection.id); // n=1
    await store.syncNow(connection.id); // n=2

    // Another device (or reconnect()) puts the shared status back to healthy.
    await updateCalendarConnection(connection.id, { status: 'ok', lastError: undefined });

    state.failWith = null;
    vi.mocked(updateCalendarConnection).mockClear();
    expect(await store.syncNow(connection.id)).toBe('ok'); // clean no-op
    expect(writes()).toHaveLength(0); // proves the no-op return path was taken

    state.failWith = 'forbidden';
    await store.syncNow(connection.id); // must be n=1 again, not a "sustained" n=3

    const sev = await calendarSeverities();
    expect(sev).toHaveLength(3);
    expect(sev).not.toContain('critical');
  });

  it('the needs_reconnect park stamps lastReconciledAt and lastReconciledBy', async () => {
    const { client, state } = makeClient();
    setCalendarClientForTesting(client);
    const connection = await connect();
    await createActivity(activityInput());
    const store = useCalendarSyncStore();
    await store.syncNow(connection.id);
    vi.mocked(updateCalendarConnection).mockClear();

    state.failWith = 'auth';
    await store.syncNow(connection.id); // n=1: below the threshold, no write
    expect(writes()).toHaveLength(0);
    await store.syncNow(connection.id); // n=2: parks

    expect(writes()).toEqual([
      [
        connection.id,
        {
          status: 'needs_reconnect',
          lastError: 'auth',
          lastReconciledAt: new Date(NOON).toISOString(),
          lastReconciledBy: expect.any(String),
        },
      ],
    ]);
    expect(outcomeDetails().slice(-2)).toEqual([
      'outcome=needs_reconnect;changed=0;wrote=0;verify=1',
      'outcome=needs_reconnect;changed=0;wrote=1;verify=1',
    ]);
  });
});
