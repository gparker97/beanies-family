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
  getCalendarEventLink,
} from '@/services/automerge/repositories/calendarRepository';
import { deterministicEventId } from '@/utils/calendar/deterministicEventId';
import { useCalendarSyncStore, setCalendarClientForTesting } from '../calendarSyncStore';
import { CalendarApiError } from '@/services/calendar/CalendarClient';
import { makeCalendarClientStub } from '@/services/calendar/__tests__/fakeCalendarClient';
import { getCalendarEventLinksForConnection } from '@/services/automerge/repositories/calendarRepository';
import type { CreateFamilyActivityInput } from '@/types/models';

// Mock the reporter so we can assert the sustained-only paging severity without
// hitting the real Slack webhook. Other tests in this file don't assert on it.
vi.mock('@/utils/errorReporter', () => ({ reportError: vi.fn() }));

// `reconnect()` drives a real OAuth consent flow; stub the seam so the store's
// post-consent bookkeeping (which is what we're testing) can run headless.
vi.mock('@/services/calendar/calendarAuth', () => ({
  connectGoogleCalendar: vi.fn(),
  isCalendarConnectSupported: vi.fn(() => true),
}));

function makeFakeClient() {
  const calls = { insert: [] as string[], patch: [] as string[], delete: [] as string[] };
  const existing = new Set<string>();
  const client = makeCalendarClientStub({
    async insertEvent(_c, _cal, eventId) {
      calls.insert.push(eventId);
      existing.add(eventId);
    },
    async patchEvent(_c, _cal, eventId) {
      calls.patch.push(eventId);
    },
    async deleteEvent(_c, _cal, eventId) {
      calls.delete.push(eventId);
      existing.delete(eventId);
    },
    async eventExists(_c, _cal, eventId) {
      return existing.has(eventId);
    },
  });
  return { client, calls };
}

function todayYmd(): string {
  return toISODateString(new Date()).slice(0, 10);
}

function activityInput(title = 'Soccer practice'): CreateFamilyActivityInput {
  return {
    title,
    date: todayYmd(),
    recurrence: 'none',
    category: 'sports',
    feeSchedule: 'none',
    reminderMinutes: 0,
    isActive: true,
    createdBy: 'm0',
  } as unknown as CreateFamilyActivityInput;
}

describe('calendarSyncStore reconcile engine (fake client)', () => {
  beforeEach(async () => {
    setActivePinia(createPinia());
    await installInlineBackend();
    // Force the flag on regardless of env.
    localStorage.setItem('beanies:flag:googleCalendarSync', 'true');
  });

  afterEach(() => {
    setCalendarClientForTesting(null);
    localStorage.clear();
  });

  it('creates, updates, deletes events and links across the activity lifecycle', async () => {
    const { client, calls } = makeFakeClient();
    setCalendarClientForTesting(client);

    const connection = await createCalendarConnection({
      provider: 'google',
      accountEmail: 'mum@example.com',
      destinationCalendarId: 'primary',
      refreshToken: 'refresh-xyz',
      grantedScopes: ['https://www.googleapis.com/auth/calendar.events.owned'],
      status: 'ok',
    });

    const activity = await createActivity(activityInput());
    const eventId = deterministicEventId(activity.id);
    const store = useCalendarSyncStore();

    // 1. First sync → INSERT + link created.
    await store.syncNow();
    expect(calls.insert).toContain(eventId);
    expect(await getCalendarEventLink(connection.id, activity.id)).toBeDefined();

    // 2. Edit the activity → PATCH (hash changed).
    await updateActivity(activity.id, { title: 'Soccer — new field' });
    await store.syncNow();
    expect(calls.patch).toContain(eventId);

    // 3. Deactivate → DELETE + link removed (GC).
    await updateActivity(activity.id, { isActive: false });
    await store.syncNow();
    expect(calls.delete).toContain(eventId);
    expect(await getCalendarEventLink(connection.id, activity.id)).toBeUndefined();

    // Connection settled to ok (no errors).
    expect((await getCalendarConnectionById(connection.id))?.status).toBe('ok');
  });

  // Regression guard for the 2026-07-09 storm fix. The Google token provider
  // latches an `invalid_grant` so a dead grant stops hammering the OAuth proxy.
  // That latch survives the session and ONLY `invalidateConnection` clears it —
  // so if `reconnect()` forgets the call, a user who re-consents sees calendar
  // sync stay dead until they reload the page. Strictly worse than the storm.
  it('reconnect() invalidates the connection so the permanent-failure latch clears', async () => {
    const { connectGoogleCalendar } = await import('@/services/calendar/calendarAuth');
    const { client } = makeFakeClient();
    const invalidateSpy = vi.spyOn(client, 'invalidateConnection');
    setCalendarClientForTesting(client);

    const connection = await createCalendarConnection({
      provider: 'google',
      accountEmail: 'mum@example.com',
      destinationCalendarId: 'primary',
      refreshToken: 'dead-refresh-token',
      grantedScopes: ['https://www.googleapis.com/auth/calendar.events.owned'],
      status: 'needs_reconnect',
    });

    vi.mocked(connectGoogleCalendar).mockResolvedValue({
      status: 'connected',
      email: 'mum@example.com',
      refreshToken: 'fresh-refresh-token',
      grantedScopes: ['https://www.googleapis.com/auth/calendar.events.owned'],
    } as never);

    await useCalendarSyncStore().reconnect(connection.id);

    expect(invalidateSpy).toHaveBeenCalledWith(connection.id);
    expect((await getCalendarConnectionById(connection.id))?.status).toBe('ok');
  });

  // The App-level reconnect toast + bell entry are driven by these two computeds.
  // They must key on `needs_reconnect` ONLY (a dead grant re-consent can fix) —
  // never `error` (written on the first transient reconcile blip; re-auth can't
  // fix a network failure). Pure computed off persisted status ⇒ self-heals.
  it('showCalendarReconnect keys on needs_reconnect only, tracks the broken one, and self-heals', async () => {
    const base = {
      provider: 'google' as const,
      destinationCalendarId: 'primary',
      refreshToken: 'rt',
      grantedScopes: ['https://www.googleapis.com/auth/calendar.events.owned'],
    };
    const store = useCalendarSyncStore();
    expect(store.showCalendarReconnect).toBe(false);

    await createCalendarConnection({ ...base, accountEmail: 'ok@example.com', status: 'ok' });
    expect(store.showCalendarReconnect).toBe(false);

    // Pass-4 guard: a transient `error` must NOT raise the signal.
    await createCalendarConnection({ ...base, accountEmail: 'err@example.com', status: 'error' });
    expect(store.showCalendarReconnect).toBe(false);

    // A dead grant does — and reconnectNeededConnection points at it.
    const broken = await createCalendarConnection({
      ...base,
      accountEmail: 'broken@example.com',
      status: 'needs_reconnect',
    });
    expect(store.showCalendarReconnect).toBe(true);
    expect(store.reconnectNeededConnection?.id).toBe(broken.id);

    // Self-heal: back to ok → the signal clears with no extra bookkeeping.
    await updateCalendarConnection(broken.id, { status: 'ok' });
    expect(store.showCalendarReconnect).toBe(false);
    expect(store.reconnectNeededConnection).toBeNull();
  });

  // Before the abort, every queued op independently re-asked Google about the
  // same dead token — hundreds of `POST /oauth/google/refresh` 400s per load.
  it('aborts the reconcile run on the first auth failure instead of running every task', async () => {
    const attempted: string[] = [];
    const deadToken = makeCalendarClientStub({
      async insertEvent(_c: string, _cal: string, eventId: string) {
        attempted.push(eventId);
        throw new CalendarApiError('auth', 'token refresh failed: invalid_grant');
      },
      async eventExists() {
        return false;
      },
      async listCalendars() {
        return [];
      },
    });
    setCalendarClientForTesting(deadToken);

    await createCalendarConnection({
      provider: 'google',
      accountEmail: 'mum@example.com',
      destinationCalendarId: 'primary',
      refreshToken: 'dead-refresh-token',
      grantedScopes: ['https://www.googleapis.com/auth/calendar.events.owned'],
      status: 'ok',
    });

    // 20 activities vs MAX_INFLIGHT=5. The pool's first 5 workers all dispatch
    // before any error lands — that's fine, the provider's `dead` latch makes
    // them fail locally with no network call. What must NOT happen is the
    // remaining 15 being dispatched once the auth failure is known.
    const TASKS = 20;
    for (let i = 0; i < TASKS; i++) {
      await createActivity(activityInput(`Activity ${i}`));
    }

    await useCalendarSyncStore().syncNow();

    expect(attempted.length).toBeLessThan(TASKS);
    // Bounded by the pool width: one in-flight batch, then abort.
    expect(attempted.length).toBeLessThanOrEqual(5);
  });

  it('pages Slack for a reconcile error only when sustained (critical on the 3rd, not before/after)', async () => {
    const { reportError } = await import('@/utils/errorReporter');
    const mockReport = vi.mocked(reportError);
    mockReport.mockClear();

    // insertEvent always 403s → every reconcile ends in a non-auth error.
    const failing = makeCalendarClientStub({
      async insertEvent() {
        throw new CalendarApiError('forbidden', 'Google Calendar HTTP 403', 403);
      },
      async eventExists() {
        return false;
      },
    });
    setCalendarClientForTesting(failing);

    await createCalendarConnection({
      provider: 'google',
      accountEmail: 'mum@example.com',
      destinationCalendarId: 'primary',
      refreshToken: 'refresh-xyz',
      grantedScopes: ['https://www.googleapis.com/auth/calendar.events.owned'],
      status: 'ok',
    });
    await createActivity(activityInput());
    const store = useCalendarSyncStore();

    const severities = () =>
      mockReport.mock.calls
        .map((c) => c[0] as { surface: string; severity?: string })
        .filter((a) => a.surface === 'calendar-sync')
        .map((a) => a.severity);

    await store.syncNow(); // n=1
    await store.syncNow(); // n=2
    await store.syncNow(); // n=3 → crosses threshold
    await store.syncNow(); // n=4

    const sev = severities();
    expect(sev).toHaveLength(4);
    expect(sev[0]).not.toBe('critical'); // transient — log-only
    expect(sev[1]).not.toBe('critical');
    expect(sev[2]).toBe('critical'); // sustained → pages exactly once
    expect(sev[3]).not.toBe('critical'); // does not keep paging
  });

  it('parks needs_reconnect (single warning, never sustained-critical) when the token is dead', async () => {
    // Regression guard (2026-07-08): a dead refresh token reaches the engine as a
    // classified 'auth' error (googleCalendarClient no longer clobbers it to
    // 'transient'). It must park needs_reconnect after INVALID_GRANT_THRESHOLD (2)
    // and page a single 'warning' — NOT the sustained-critical non-auth path.
    const { reportError } = await import('@/utils/errorReporter');
    const mockReport = vi.mocked(reportError);
    mockReport.mockClear();

    const deadToken = makeCalendarClientStub({
      async insertEvent() {
        throw new CalendarApiError(
          'auth',
          'token refresh failed: Token has been expired or revoked.'
        );
      },
      async eventExists() {
        return false;
      },
    });
    setCalendarClientForTesting(deadToken);

    const connection = await createCalendarConnection({
      provider: 'google',
      accountEmail: 'mum@example.com',
      destinationCalendarId: 'primary',
      refreshToken: 'refresh-dead',
      grantedScopes: ['https://www.googleapis.com/auth/calendar.events.owned'],
      status: 'ok',
    });
    await createActivity(activityInput());
    const store = useCalendarSyncStore();

    await store.syncNow(); // n=1 (below threshold — no park, no page)
    await store.syncNow(); // n=2 (crosses INVALID_GRANT_THRESHOLD → park)

    // Connection parked for reconnect (drives the Settings reconnect prompt).
    expect((await getCalendarConnectionById(connection.id))?.status).toBe('needs_reconnect');

    const calendarReports = mockReport.mock.calls
      .map((c) => c[0] as { surface: string; severity?: string })
      .filter((a) => a.surface === 'calendar-sync');
    // Exactly one page — the needs_reconnect park — and it is a 'warning'.
    expect(calendarReports).toHaveLength(1);
    expect(calendarReports[0].severity).toBe('warning');
    // Never the sustained-critical non-auth path.
    expect(calendarReports.every((a) => a.severity !== 'critical')).toBe(true);
  });

  it('disconnect removes events and drops the connection', async () => {
    const { client, calls } = makeFakeClient();
    setCalendarClientForTesting(client);

    const connection = await createCalendarConnection({
      provider: 'google',
      accountEmail: 'dad@example.com',
      destinationCalendarId: 'primary',
      refreshToken: 'refresh-abc',
      grantedScopes: ['https://www.googleapis.com/auth/calendar.events.owned'],
      status: 'ok',
    });
    const activity = await createActivity(activityInput());
    const eventId = deterministicEventId(activity.id);
    const store = useCalendarSyncStore();

    await store.syncNow();
    expect(calls.insert).toContain(eventId);

    await store.disconnect(connection.id);
    expect(calls.delete).toContain(eventId);
    expect(await getCalendarConnectionById(connection.id)).toBeUndefined();
  });

  it('aborts a destination switch when the old-calendar cleanup fails, keeping all links (F6)', async () => {
    // Client inserts fine but every delete throws — the old-calendar cleanup can
    // never complete, so the switch must abort with the destination + links intact.
    const existing = new Set<string>();
    const client = makeCalendarClientStub({
      async insertEvent(_c, _cal, eventId) {
        existing.add(eventId);
      },
      async deleteEvent() {
        throw new CalendarApiError('transient', 'boom');
      },
      async eventExists(_c, _cal, eventId) {
        return existing.has(eventId);
      },
      async listCalendars() {
        return [{ id: 'cal-old', summary: 'Old', primary: true }];
      },
    });
    setCalendarClientForTesting(client);

    const connection = await createCalendarConnection({
      provider: 'google',
      accountEmail: 'mum@example.com',
      destinationCalendarId: 'cal-old',
      refreshToken: 'r',
      grantedScopes: ['https://www.googleapis.com/auth/calendar.events.owned'],
      status: 'ok',
    });
    const activity = await createActivity(activityInput());
    const store = useCalendarSyncStore();

    // Seed a link on the old calendar.
    await store.syncNow();
    expect(await getCalendarEventLink(connection.id, activity.id)).toBeDefined();

    // Switch to a new calendar — the old-calendar delete throws → abort.
    const result = await store.setDestinationCalendar(connection.id, 'cal-new');
    expect(result).toEqual({ ok: false });

    // Destination unchanged and the link is still present (reconcile self-heals).
    expect((await getCalendarConnectionById(connection.id))?.destinationCalendarId).toBe('cal-old');
    expect(await getCalendarEventLink(connection.id, activity.id)).toBeDefined();
    expect((await getCalendarEventLinksForConnection(connection.id)).length).toBe(1);
  });

  it('normalizes a "primary" destination to the concrete calendar id for the picker', async () => {
    const client = makeCalendarClientStub({
      async listCalendars() {
        return [
          { id: 'owner@example.com', summary: 'owner@example.com', primary: true },
          { id: 'work', summary: 'Work', primary: false },
        ];
      },
    });
    setCalendarClientForTesting(client);

    const connection = await createCalendarConnection({
      provider: 'google',
      accountEmail: 'owner@example.com',
      destinationCalendarId: 'primary',
      refreshToken: 'r',
      grantedScopes: ['https://www.googleapis.com/auth/calendar.calendarlist.readonly'],
      status: 'ok',
    });
    const store = useCalendarSyncStore();

    const cals = await store.listCalendarsFor(connection.id);
    expect(cals.map((c) => c.id)).toContain('owner@example.com');
    // 'primary' is normalized to the real primary id so the picker shows it selected.
    expect((await getCalendarConnectionById(connection.id))?.destinationCalendarId).toBe(
      'owner@example.com'
    );
  });
});
