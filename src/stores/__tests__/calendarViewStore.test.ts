/**
 * `calendarViewStore` (view-only calendars plan 2026-11-17, A4), against the real
 * doc layer (inline backend) and a fake CalendarClient.
 *
 * Load-bearing promises:
 *  - flag off = inert: no projection, no poller, no Google read;
 *  - exactly two windows (standing + screen), each read on its own;
 *  - a transient failure keeps the last good events; only `unavailable` and
 *    `needs_reconnect` clear them; an orphaned calendar is `needs_reconnect`;
 *  - only calendars in `viewedCalendars` are ever read;
 *  - add from a consent creates the account on first use and reuses it after;
 *    removing the last calendar removes the account and asks the revoke guard;
 *  - the unhealthy kinds are reported reactively (`unhealthyStates`); the store
 *    never toasts them or navigates (useCalendarViewHealthToast does);
 *  - no calendar id, name, email, event id, title or location in any telemetry.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { nextTick, watch } from 'vue';
import { setActivePinia, createPinia } from 'pinia';
import { installInlineBackend } from '@/services/automerge/worker/__tests__/inlineHarness';
import {
  createCalendarViewAccount,
  createViewedCalendar,
  getAllCalendarViewAccounts,
  getAllViewedCalendars,
  removeCalendarViewAccount,
  updateViewedCalendar as updateViewedCalendarRecord,
} from '@/services/automerge/repositories/calendarViewRepository';
import { beaniesEventIds } from '@/utils/calendar/beaniesEventIds';
import { createCalendarConnection } from '@/services/automerge/repositories/calendarRepository';
import { makeCalendarClientStub } from '@/services/calendar/__tests__/fakeCalendarClient';
import { setCalendarClientForTesting } from '@/services/calendar/clientInstance';
import { pendingCredential } from '@/services/calendar/pendingCredential';
import {
  CalendarApiError,
  type CalendarClient,
  type CalendarViewEvent,
} from '@/services/calendar/CalendarClient';
import { ASSIGNABLE_MEMBER_COLORS, NEUTRAL_MEMBER_COLOR } from '@/constants/memberColors';
import { addDaysYmd, localToday } from '@/utils/date';
import type { ViewedCalendar } from '@/types/models';

const h = vi.hoisted(() => ({
  driveEmail: { value: 'drive@example.com' as string | null },
  redirect: { value: false },
  connectGoogleCalendar: vi.fn(),
  startCalendarRedirectAuth: vi.fn(async (..._args: unknown[]) => {}),
  completeCalendarRedirectAuth: vi.fn(),
  revokeGrant: vi.fn(async () => ({ ok: true, reason: 'revoked' })),
  logTokenLifecycle: vi.fn(),
  logEvent: vi.fn(),
  reportError: vi.fn(),
  showToast: vi.fn(),
  perf: vi.fn(),
  poll: null as null | { cb: () => unknown; ms: number; opts: unknown },
  pollStop: vi.fn(),
  failCreateCalendar: { value: false },
}));

vi.mock('@/services/calendar/calendarAuth', () => ({
  connectGoogleCalendar: h.connectGoogleCalendar,
  startCalendarRedirectAuth: h.startCalendarRedirectAuth,
  completeCalendarRedirectAuth: h.completeCalendarRedirectAuth,
}));
vi.mock('@/services/google/googleAuth', () => ({
  shouldUseRedirectAuth: () => h.redirect.value,
  getGoogleAccountEmail: () => h.driveEmail.value,
}));
vi.mock('@/services/google/googleRevoke', () => ({
  revokeGrant: h.revokeGrant,
  logTokenLifecycle: h.logTokenLifecycle,
}));
vi.mock('@/services/telemetry', () => ({ logEvent: h.logEvent }));
vi.mock('@/utils/errorReporter', () => ({ reportError: h.reportError }));
vi.mock('@/composables/useToast', () => ({ showToast: h.showToast }));
vi.mock('@/utils/perfTiming', () => ({ record: h.perf }));
vi.mock('@/services/automerge/repositories/calendarViewRepository', async (importOriginal) => {
  const real =
    await importOriginal<
      typeof import('@/services/automerge/repositories/calendarViewRepository')
    >();
  return {
    ...real,
    createViewedCalendar: vi.fn((input: Parameters<typeof real.createViewedCalendar>[0]) =>
      h.failCreateCalendar.value
        ? Promise.reject(new Error('idb write failed'))
        : real.createViewedCalendar(input)
    ),
  };
});
vi.mock('@/utils/calendar/beaniesEventIds', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/utils/calendar/beaniesEventIds')>();
  return { ...real, beaniesEventIds: vi.fn(real.beaniesEventIds) };
});
vi.mock('@/composables/usePollWhileVisible', () => ({
  usePollWhileVisible: (cb: () => unknown, ms: number, opts: unknown) => {
    h.poll = { cb, ms, opts };
    return { stop: h.pollStop };
  },
}));

import { useCalendarViewStore } from '../calendarViewStore';

const READONLY = 'https://www.googleapis.com/auth/calendar.events.readonly';
const LIST = 'https://www.googleapis.com/auth/calendar.calendarlist.readonly';

// Identifying values that must never reach telemetry.
const EMAIL = 'grandma@example.com';
const CAL_ID = 'grandma.babysitting@group.calendar.google.com';
const CAL_NAME = 'Grandma babysitting';
const EVENT_ID = 'evt-secret-123';
const TITLE = 'Pick up Leo from school';
const LOCATION = '12 Secret Lane';
const SECRETS = [EMAIL, CAL_ID, CAL_NAME, EVENT_ID, TITLE, LOCATION];

const today = localToday();

function eventToday(id = EVENT_ID): CalendarViewEvent {
  const [y, m, d] = today.split('-').map(Number) as [number, number, number];
  return {
    id,
    summary: TITLE,
    location: LOCATION,
    start: { dateTime: new Date(y, m - 1, d, 15).toISOString() },
    end: { dateTime: new Date(y, m - 1, d, 16).toISOString() },
    htmlLink: 'https://calendar.google.com/event?eid=x',
  };
}

type ViewReader = CalendarClient['listEventsForView'];
let reader: ReturnType<typeof vi.fn<ViewReader>>;
let latched: Set<string>;
let listedWith: string[];

function installClient(): void {
  setCalendarClientForTesting(
    makeCalendarClientStub({
      listEventsForView: reader,
      hasPermanentAuthFailure: (id) => latched.has(id),
      async listCalendars(credential) {
        listedWith.push(credential);
        return [
          { id: CAL_ID, summary: CAL_NAME, primary: false, accessRole: 'reader' },
          { id: 'work@example.com', summary: 'Work', primary: false, accessRole: 'freeBusyReader' },
          { id: EMAIL, summary: EMAIL, primary: true, accessRole: 'owner' },
        ];
      },
    })
  );
}

function installClientWith(overrides: Partial<CalendarClient>): void {
  setCalendarClientForTesting(
    makeCalendarClientStub({
      listEventsForView: reader,
      hasPermanentAuthFailure: (id) => latched.has(id),
      ...overrides,
    })
  );
}

async function seedAccount(accountEmail = EMAIL) {
  return createCalendarViewAccount({
    provider: 'google',
    accountEmail,
    refreshToken: `view-rt-${accountEmail}`,
    grantedScopes: [READONLY, LIST],
  });
}

async function seedCalendar(
  viewAccountId: string,
  overrides: Partial<ViewedCalendar> = {}
): Promise<ViewedCalendar> {
  return createViewedCalendar({
    viewAccountId,
    calendarId: CAL_ID,
    name: CAL_NAME,
    accessRole: 'reader',
    detailLevel: 'details',
    color: NEUTRAL_MEMBER_COLOR,
    inBriefing: false,
    inWidgets: false,
    ...overrides,
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Move `Date.now` forward by `ms` from wherever it is now (real timers keep running). */
function later(ms: number): void {
  const now = Date.now();
  vi.spyOn(Date, 'now').mockReturnValue(now + ms);
}

/** A read that waits until the test releases it. */
function deferredRead(): {
  release: (value?: Awaited<ReturnType<ViewReader>>) => void;
  fail: (e: unknown) => void;
} {
  let release!: (value?: Awaited<ReturnType<ViewReader>>) => void;
  let fail!: (e: unknown) => void;
  reader.mockImplementationOnce(
    () =>
      new Promise((resolve, reject) => {
        release = (value) => resolve(value ?? { events: [eventToday()], truncated: false });
        fail = reject;
      })
  );
  return {
    release: (v) => release(v),
    fail: (e) => fail(e),
  };
}

function readsFor(win: 'standing' | 'screen', screenStartYmd?: string): number {
  const standingMin = new Date(`${addDaysYmd(today, -1)}T00:00:00`).toISOString();
  return reader.mock.calls.filter(([, , min]) =>
    win === 'standing'
      ? min === standingMin
      : screenStartYmd
        ? min === new Date(`${screenStartYmd}T00:00:00`).toISOString()
        : min !== standingMin
  ).length;
}

function telemetryText(): string {
  return JSON.stringify([
    ...h.logEvent.mock.calls.map(([e]) => ({ m: e.message, c: e.context })),
    ...h.reportError.mock.calls.map(([e]) => ({ m: e.message, c: e.context })),
    ...h.logTokenLifecycle.mock.calls,
  ]);
}

function actions(): string[] {
  return h.logEvent.mock.calls
    .map(([e]) => (e as { context?: { action?: string } }).context?.action ?? '')
    .filter(Boolean);
}

beforeEach(async () => {
  setActivePinia(createPinia());
  await installInlineBackend();
  localStorage.setItem('beanies:flag:viewOnlyCalendars', 'true');
  pendingCredential.clear();
  h.driveEmail.value = 'drive@example.com';
  h.redirect.value = false;
  h.failCreateCalendar.value = false;
  h.poll = null;
  latched = new Set();
  listedWith = [];
  reader = vi.fn<ViewReader>(async () => ({ events: [eventToday()], truncated: false }));
  installClient();
  h.connectGoogleCalendar.mockResolvedValue({
    status: 'connected',
    email: EMAIL,
    refreshToken: 'rt-pending',
    grantedScopes: [READONLY, LIST],
  });
});

afterEach(() => {
  // Cancel a pending debounced refresh AND stop the store's watchers: the projection
  // is module-global, so a live store from this test would react to the next test's
  // seeding and read through its client.
  const store = useCalendarViewStore();
  store.stop();
  store.$dispose();
  setCalendarClientForTesting(null);
  localStorage.removeItem('beanies:flag:viewOnlyCalendars');
  vi.restoreAllMocks();
  h.logEvent.mockClear();
  h.reportError.mockClear();
  h.showToast.mockClear();
  h.revokeGrant.mockClear();
  h.logTokenLifecycle.mockClear();
  h.connectGoogleCalendar.mockReset();
  h.perf.mockClear();
});

describe('calendarViewStore: gating', () => {
  it('flag off: inert, no poller, no Google read, even with a viewed calendar in the doc', async () => {
    // Every flag is on in a dev build, so "off" is an explicit override.
    localStorage.setItem('beanies:flag:viewOnlyCalendars', 'false');
    const account = await seedAccount();
    await seedCalendar(account.id);
    const store = useCalendarViewStore();
    expect(store.isActive).toBe(false);
    expect(store.calendars).toEqual([]);
    await store.refresh({ force: true });
    expect(reader).not.toHaveBeenCalled();
    expect(h.poll).toBeNull();
    expect(store.events).toEqual([]);
  });

  it('flag on: polls through usePollWhileVisible at the TTL, firing on return to the app', async () => {
    const account = await seedAccount();
    await seedCalendar(account.id);
    const store = useCalendarViewStore();
    expect(store.isActive).toBe(true);
    expect(h.poll?.ms).toBe(300_000);
    expect(h.poll?.opts).toMatchObject({ fireImmediatelyOnVisible: true });
  });
});

describe('calendarViewStore: windows and cache', () => {
  it('reads the standing and screen windows separately', async () => {
    const account = await seedAccount();
    await seedCalendar(account.id);
    const store = useCalendarViewStore();
    store.setScreenWindow({ startYmd: '2027-06-01', endYmd: '2027-06-30' });
    await store.refresh();
    expect(readsFor('standing')).toBe(1);
    expect(readsFor('screen', '2027-06-01')).toBe(1);
    expect(reader).toHaveBeenCalledTimes(2);
    expect(store.standingSettled).toBe(true);
  });

  it('debounces window changes: rapid paging reads only where it settles', async () => {
    const account = await seedAccount();
    await seedCalendar(account.id);
    const store = useCalendarViewStore();
    await store.refresh();
    reader.mockClear();
    store.setScreenWindow({ startYmd: '2027-01-01', endYmd: '2027-01-31' });
    store.setScreenWindow({ startYmd: '2027-02-01', endYmd: '2027-02-28' });
    store.setScreenWindow({ startYmd: '2027-03-01', endYmd: '2027-03-31' });
    expect(reader).not.toHaveBeenCalled();
    await sleep(400);
    expect(reader).toHaveBeenCalledTimes(1);
    expect(readsFor('screen', '2027-03-01')).toBe(1);
  });

  it('serves the cache within the TTL, re-reads after it, and the poll re-reads past the minimum age', async () => {
    const account = await seedAccount();
    await seedCalendar(account.id);
    const store = useCalendarViewStore();
    await store.refresh();
    await store.refresh();
    expect(reader).toHaveBeenCalledTimes(1);

    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now + 300_001);
    await store.refresh();
    expect(reader).toHaveBeenCalledTimes(2);

    vi.spyOn(Date, 'now').mockReturnValue(now + 300_001 + 61_000);
    await h.poll!.cb();
    expect(reader).toHaveBeenCalledTimes(3);
    expect(h.perf).toHaveBeenCalledWith('calendar-view-fetch', expect.any(Number));
  });

  it('exposes events through every selector', async () => {
    const account = await seedAccount();
    const cal = await seedCalendar(account.id, { inBriefing: true });
    const store = useCalendarViewStore();
    await store.refresh();
    expect(store.events).toHaveLength(1);
    expect(store.events[0]).toMatchObject({ title: TITLE, viewedCalendarId: cal.id });
    expect(store.eventsForDate(today)).toHaveLength(1);
    expect(store.timedForDate(today)).toHaveLength(1);
    expect(store.allDayForDate(today)).toHaveLength(0);
    expect(store.briefingEvents).toHaveLength(1);
    expect(store.widgetEvents).toHaveLength(0);
    expect(store.calendarState(cal.id)).toBe('ok');
  });

  it('merges the two windows without duplicates', async () => {
    const account = await seedAccount();
    await seedCalendar(account.id);
    const store = useCalendarViewStore();
    // The screen window overlaps today, so both windows return the same event.
    store.setScreenWindow({ startYmd: today, endYmd: today });
    await store.refresh();
    expect(reader).toHaveBeenCalledTimes(2);
    expect(store.events).toHaveLength(1);
  });

  it('strips titles and locations for a busy-only calendar before they reach the cache', async () => {
    const account = await seedAccount();
    await seedCalendar(account.id, { detailLevel: 'busy' });
    const store = useCalendarViewStore();
    await store.refresh();
    expect(store.events[0]).toMatchObject({ busyOnly: true });
    expect(store.events[0]).not.toHaveProperty('title');
    expect(store.events[0]).not.toHaveProperty('location');
  });

  it('drops beanies-origin events (a pushed activity) and logs the dedupe count', async () => {
    const account = await seedAccount();
    await seedCalendar(account.id);
    reader.mockResolvedValue({
      events: [eventToday('theirs'), eventToday('bpushed-by-beanies')],
      truncated: false,
    });
    await createCalendarConnection({
      provider: 'google',
      accountEmail: 'mum@example.com',
      destinationCalendarId: 'primary',
      refreshToken: 'r',
      grantedScopes: [],
      status: 'ok',
    });
    const { createCalendarEventLink } =
      await import('@/services/automerge/repositories/calendarRepository');
    await createCalendarEventLink({
      connectionId: 'c1',
      activityId: 'a1',
      googleEventId: 'bpushed-by-beanies',
      lastPushedHash: 'h',
      lastPushedAt: new Date().toISOString(),
    });
    const store = useCalendarViewStore();
    await store.refresh();
    expect(store.events.map((e) => e.id)).toEqual(['theirs']);
    const dedupe = h.logEvent.mock.calls.find(([e]) => e.context?.action === 'dedupe');
    expect(dedupe?.[0].context).toMatchObject({ count: 1 });
  });
});

describe('calendarViewStore: health', () => {
  it('a transient failure (a throttling 403) keeps the last good events, marked stale', async () => {
    const account = await seedAccount();
    const cal = await seedCalendar(account.id);
    const store = useCalendarViewStore();
    await store.refresh();
    reader.mockRejectedValue(new CalendarApiError('rate_limited', 'Google Calendar HTTP 403', 403));
    await store.refresh({ force: true });
    expect(store.calendarState(cal.id)).toBe('stale');
    expect(store.events).toHaveLength(1);
    const failed = h.reportError.mock.calls.find(([e]) => e.context?.action === 'fetch-failed');
    expect(failed?.[0]).toMatchObject({ severity: 'warning' });
    expect(failed?.[0].context).toMatchObject({ error_code: 'rate_limited', http_status: 403 });
    expect(h.showToast).not.toHaveBeenCalled();
  });

  it('a single auth failure without the latch is stale, not needs_reconnect', async () => {
    const account = await seedAccount();
    const cal = await seedCalendar(account.id);
    const store = useCalendarViewStore();
    await store.refresh();
    reader.mockRejectedValue(new CalendarApiError('auth', 'Google Calendar HTTP 401', 401));
    await store.refresh({ force: true });
    expect(store.calendarState(cal.id)).toBe('stale');
    expect(store.events).toHaveLength(1);
  });

  it('one refusal (forbidden) alone is stale: events kept, nothing raised (review L4)', async () => {
    const account = await seedAccount();
    const cal = await seedCalendar(account.id);
    const store = useCalendarViewStore();
    await store.refresh();
    reader.mockRejectedValue(new CalendarApiError('forbidden', 'Google Calendar HTTP 403', 403));
    await store.refresh({ force: true });
    expect(store.calendarState(cal.id)).toBe('stale');
    expect(store.events).toHaveLength(1);
    expect(actions()).not.toContain('calendar-unavailable');
    expect([...store.unhealthyStates]).toEqual([]);
    // A success in between resets the count: the next single refusal is stale again.
    reader.mockResolvedValueOnce({ events: [eventToday()], truncated: false });
    await store.refresh({ force: true });
    await store.refresh({ force: true });
    expect(store.calendarState(cal.id)).toBe('stale');
  });

  it('sharing stopped (a second forbidden, a minute or more later) clears the events, logs it, and reports it as unhealthy', async () => {
    const account = await seedAccount();
    const cal = await seedCalendar(account.id);
    const store = useCalendarViewStore();
    await store.refresh();
    reader.mockRejectedValue(new CalendarApiError('forbidden', 'Google Calendar HTTP 403', 403));
    await store.refresh({ force: true });
    // An immediate second refusal is the same blip: one strike, events kept.
    await store.refresh({ force: true });
    expect(store.calendarState(cal.id)).toBe('stale');
    expect(store.events).toHaveLength(1);
    later(61_000);
    await store.refresh({ force: true });
    expect(store.calendarState(cal.id)).toBe('unavailable');
    expect(store.events).toEqual([]);
    expect(actions()).toContain('calendar-unavailable');
    expect([...store.unhealthyStates]).toEqual(['unavailable']);
    // The store never toasts it: the view layer does (useCalendarViewHealthToast).
    expect(h.showToast).not.toHaveBeenCalled();
  });

  it('a latched dead token is needs_reconnect: events cleared, no further Google reads', async () => {
    const account = await seedAccount();
    const cal = await seedCalendar(account.id);
    const store = useCalendarViewStore();
    await store.refresh();
    latched.add(account.id);
    reader.mockRejectedValue(new CalendarApiError('auth', 'token refresh failed', undefined));
    await store.refresh({ force: true });
    expect(store.calendarState(cal.id)).toBe('needs_reconnect');
    expect(store.events).toEqual([]);
    expect(actions()).toContain('account-needs-reconnect');
    const reads = reader.mock.calls.length;
    await store.refresh({ force: true });
    expect(reader.mock.calls.length).toBe(reads);
  });

  it('a calendar whose account record is gone is needs_reconnect and is never read', async () => {
    const cal = await seedCalendar('missing-account-id');
    const store = useCalendarViewStore();
    expect(store.calendarState(cal.id)).toBe('needs_reconnect');
    await store.refresh();
    expect(reader).not.toHaveBeenCalled();
    expect(store.events).toEqual([]);
  });

  it('unhealthyStates tracks the unhealthy kinds reactively, and only those', async () => {
    const account = await seedAccount();
    await seedCalendar(account.id);
    const orphan = await seedCalendar('missing-account-id', { calendarId: 'other@example.com' });
    const store = useCalendarViewStore();
    // The orphan is needs_reconnect before any read.
    expect([...store.unhealthyStates]).toEqual(['needs_reconnect']);
    const seen: string[][] = [];
    const stopWatch = watch(
      () => store.unhealthyStates,
      (states) => seen.push([...states].sort())
    );
    reader.mockRejectedValue(new CalendarApiError('not_found', 'Google Calendar HTTP 404', 404));
    await store.refresh();
    later(61_000);
    await store.refresh({ force: true }); // the second refusal, a minute later
    await nextTick();
    expect([...store.unhealthyStates].sort()).toEqual(['needs_reconnect', 'unavailable']);
    expect(seen.at(-1)).toEqual(['needs_reconnect', 'unavailable']);

    // A transient failure is not unhealthy; a recovery clears the kind.
    reader.mockRejectedValue(new CalendarApiError('rate_limited', 'Google Calendar HTTP 403', 403));
    await store.refresh({ force: true });
    reader.mockResolvedValue({ events: [eventToday()], truncated: false });
    await store.refresh({ force: true });
    await nextTick();
    expect(store.calendarState(orphan.id)).toBe('needs_reconnect');
    expect([...store.unhealthyStates]).toEqual(['needs_reconnect']);
    expect(seen.at(-1)).toEqual(['needs_reconnect']);
    stopWatch();
  });

  it('standingSettled turns true after a FAILED first standing read too', async () => {
    const account = await seedAccount();
    await seedCalendar(account.id);
    reader.mockRejectedValue(new CalendarApiError('transient', 'HTTP 503', 503));
    const store = useCalendarViewStore();
    expect(store.standingSettled).toBe(false);
    await store.refresh();
    expect(store.standingSettled).toBe(true);
  });

  it('truncation is a state and a once-per-session log', async () => {
    const account = await seedAccount();
    const cal = await seedCalendar(account.id);
    reader.mockResolvedValue({ events: [eventToday()], truncated: true });
    const store = useCalendarViewStore();
    await store.refresh();
    await store.refresh({ force: true });
    expect(store.calendarState(cal.id)).toBe('truncated');
    expect(actions().filter((a) => a === 'truncated')).toHaveLength(1);
  });
});

describe('calendarViewStore: which calendars are read', () => {
  it('shows a calendar added twice (two devices) once and reads it once per window', async () => {
    const account = await seedAccount();
    await seedCalendar(account.id);
    await seedCalendar(account.id);
    const store = useCalendarViewStore();
    expect(store.calendars).toHaveLength(1);
    await store.refresh();
    expect(reader).toHaveBeenCalledTimes(1);
  });

  it('only ever reads calendars in viewedCalendars, never the rest of the account', async () => {
    const account = await seedAccount();
    await seedCalendar(account.id);
    const store = useCalendarViewStore();
    const listed = await store.listCalendarsForAccount(account.id);
    expect(listed.status === 'ok' && listed.calendars.length).toBe(3);
    await store.refresh({ force: true });
    const readIds = new Set(reader.mock.calls.map(([, calendarId]) => calendarId));
    expect([...readIds]).toEqual([CAL_ID]);
  });
});

describe('calendarViewStore: add, update, remove', () => {
  it('add from a consent creates the account and calendar; a second calendar reuses the account', async () => {
    const store = useCalendarViewStore();
    expect(await store.beginViewConnect(EMAIL)).toEqual({ status: 'pending' });
    expect(h.connectGoogleCalendar).toHaveBeenCalledWith({ loginHint: EMAIL, kind: 'view' });
    expect(await getAllCalendarViewAccounts()).toHaveLength(0); // nothing written at consent

    const listed = await store.listPendingViewCalendars();
    expect(listed.status).toBe('ok');
    expect(listedWith[0]).toMatch(/^pending-/);

    const first = await store.addViewedCalendar({
      viewAccountId: 'pending',
      calendar: { id: CAL_ID, summary: CAL_NAME, primary: false, accessRole: 'reader' },
    });
    expect(first.status).toBe('added');
    expect(pendingCredential.peek()).toBeNull();
    const accounts = await getAllCalendarViewAccounts();
    expect(accounts).toHaveLength(1);
    expect(accounts[0]).toMatchObject({ accountEmail: EMAIL, refreshToken: 'rt-pending' });
    const [cal] = await getAllViewedCalendars();
    expect(cal).toMatchObject({
      viewAccountId: accounts[0]!.id,
      detailLevel: 'details',
      color: NEUTRAL_MEMBER_COLOR,
      inBriefing: false,
      inWidgets: false,
    });

    // A second consent on the same account, then a second calendar: no second account.
    h.connectGoogleCalendar.mockResolvedValue({
      status: 'connected',
      email: EMAIL.toUpperCase(),
      refreshToken: 'rt-second',
      grantedScopes: [READONLY, LIST],
    });
    await store.beginViewConnect(EMAIL);
    const second = await store.addViewedCalendar({
      viewAccountId: 'pending',
      calendar: { id: 'work@example.com', summary: 'Work', primary: false, accessRole: 'reader' },
    });
    expect(second.status).toBe('added');
    expect(await getAllCalendarViewAccounts()).toHaveLength(1);
    const calendars = await getAllViewedCalendars();
    expect(calendars).toHaveLength(2);
    expect(calendars.find((c) => c.calendarId === 'work@example.com')?.color).toBe(
      ASSIGNABLE_MEMBER_COLORS[0]
    );

    // From the known account (no consent), a third calendar also reuses it.
    const third = await store.addViewedCalendar({
      viewAccountId: accounts[0]!.id,
      calendar: { id: 'third@example.com', summary: 'Third', primary: false, accessRole: 'reader' },
    });
    expect(third.status).toBe('added');
    expect(await getAllCalendarViewAccounts()).toHaveLength(1);
    expect(actions().filter((a) => a === 'add')).toHaveLength(3);
  });

  it('refuses to add a calendar that is already viewed', async () => {
    const account = await seedAccount();
    await seedCalendar(account.id);
    const store = useCalendarViewStore();
    const result = await store.addViewedCalendar({
      viewAccountId: account.id,
      calendar: { id: CAL_ID, summary: CAL_NAME, primary: false },
    });
    expect(result).toEqual({ status: 'failed', reason: 'already-added' });
  });

  it('add from pending with no pending consent is refused, and nothing is written', async () => {
    const store = useCalendarViewStore();
    const result = await store.addViewedCalendar({
      viewAccountId: 'pending',
      calendar: { id: CAL_ID, summary: CAL_NAME, primary: false },
    });
    expect(result).toEqual({ status: 'failed', reason: 'no-pending' });
    expect(await getAllCalendarViewAccounts()).toHaveLength(0);
  });

  it('a free/busy calendar is added busy only, and "Show details" is refused for it', async () => {
    const store = useCalendarViewStore();
    await store.beginViewConnect();
    const added = await store.addViewedCalendar({
      viewAccountId: 'pending',
      calendar: {
        id: 'work@example.com',
        summary: 'Work',
        primary: false,
        accessRole: 'freeBusyReader',
      },
    });
    expect(added.status).toBe('added');
    const [cal] = await getAllViewedCalendars();
    expect(cal).toMatchObject({ accessRole: 'freeBusyReader', detailLevel: 'busy' });
    expect(await store.updateViewedCalendar(cal!.id, { detailLevel: 'details' })).toEqual({
      status: 'failed',
      reason: 'busy-only',
    });
  });

  it('a settings change is written and logged by field name', async () => {
    const account = await seedAccount();
    const cal = await seedCalendar(account.id);
    const store = useCalendarViewStore();
    expect(await store.updateViewedCalendar(cal.id, { inWidgets: true, color: '#3b82f6' })).toEqual(
      {
        status: 'updated',
      }
    );
    const [saved] = await getAllViewedCalendars();
    expect(saved).toMatchObject({ inWidgets: true, color: '#3b82f6' });
    const details = h.logEvent.mock.calls
      .filter(([e]) => e.context?.action === 'settings-change')
      .map(([e]) => e.context.detail);
    expect(details.sort()).toEqual(['color', 'inWidgets']);
  });

  it('removing the last calendar removes its account and revokes through the guard', async () => {
    const account = await seedAccount();
    const cal = await seedCalendar(account.id);
    const store = useCalendarViewStore();
    expect(await store.removeViewedCalendar(cal.id)).toEqual({ status: 'removed' });
    expect(await getAllViewedCalendars()).toHaveLength(0);
    expect(await getAllCalendarViewAccounts()).toHaveLength(0);
    expect(h.revokeGrant).toHaveBeenCalledWith(`view-rt-${EMAIL}`, {
      grant: 'calendar',
      trigger: 'disconnect',
    });
  });

  it('the guard skips the revoke when a sync connection shares the Google account', async () => {
    await createCalendarConnection({
      provider: 'google',
      accountEmail: EMAIL,
      destinationCalendarId: 'primary',
      refreshToken: 'sync-rt',
      grantedScopes: [],
      status: 'ok',
    });
    const account = await seedAccount();
    const cal = await seedCalendar(account.id);
    const store = useCalendarViewStore();
    await store.removeViewedCalendar(cal.id);
    expect(await getAllCalendarViewAccounts()).toHaveLength(0);
    expect(h.revokeGrant).not.toHaveBeenCalled();
    expect(h.logTokenLifecycle).toHaveBeenCalledWith(
      expect.objectContaining({ op: 'revoke', outcome: 'skipped', reason: 'shared-account-grant' })
    );
  });

  it('removing one of two calendars keeps the account and revokes nothing', async () => {
    const account = await seedAccount();
    const cal = await seedCalendar(account.id);
    await seedCalendar(account.id, { calendarId: 'other@example.com', name: 'Other' });
    const store = useCalendarViewStore();
    await store.removeViewedCalendar(cal.id);
    expect(await getAllCalendarViewAccounts()).toHaveLength(1);
    expect(h.revokeGrant).not.toHaveBeenCalled();
  });

  it('abandoning the add step clears the consent, revokes it through the guard and logs it', async () => {
    const store = useCalendarViewStore();
    await store.beginViewConnect();
    expect(store.pendingViewConnect).toEqual({ accountEmail: EMAIL });
    store.abandonViewConnect();
    expect(pendingCredential.peek()).toBeNull();
    expect(h.revokeGrant).toHaveBeenCalledWith('rt-pending', {
      grant: 'calendar',
      trigger: 'abandon',
    });
    const outcomes = h.logEvent.mock.calls
      .filter(([e]) => e.context?.action === 'consent-outcome')
      .map(([e]) => e.context.detail);
    expect(outcomes).toEqual(['consented', 'abandoned']);
  });

  it('a failed save is critical, toasted, typed, and leaves no account without a calendar', async () => {
    const store = useCalendarViewStore();
    await store.beginViewConnect();
    h.failCreateCalendar.value = true;
    const result = await store.addViewedCalendar({
      viewAccountId: 'pending',
      calendar: { id: CAL_ID, summary: CAL_NAME, primary: false },
    });
    expect(result).toEqual({ status: 'failed', reason: 'write-failed' });
    // The account created for this first calendar was rolled back.
    expect(await getAllCalendarViewAccounts()).toHaveLength(0);
    // The consent is kept, so the member can try again.
    expect(pendingCredential.peek()).not.toBeNull();
    expect(h.reportError).toHaveBeenCalledWith(
      expect.objectContaining({ severity: 'critical', surface: 'calendar-view' })
    );
    expect(h.showToast).toHaveBeenCalledWith('error', expect.any(String), expect.any(String), {
      silent: true,
    });
  });
});

describe('calendarViewStore: reconnect and redirect', () => {
  it('a redirect connect hands off with the view intent and the view scopes', async () => {
    h.redirect.value = true;
    const store = useCalendarViewStore();
    expect(await store.beginViewConnect(EMAIL)).toEqual({ status: 'redirecting' });
    const [returnPath, hint, mode, kind] = h.startCalendarRedirectAuth.mock.calls[0]!;
    expect(new URL(returnPath as string, 'https://x').searchParams.get('calResume')).toBe('view');
    expect([hint, mode, kind]).toEqual([EMAIL, 'create', 'view']);
  });

  it('resuming a view redirect fills the pending slot with a view credential', async () => {
    h.completeCalendarRedirectAuth.mockResolvedValue({
      status: 'connected',
      email: EMAIL,
      refreshToken: 'rt-redirect',
      grantedScopes: [READONLY, LIST],
    });
    const store = useCalendarViewStore();
    expect(await store.resumeViewRedirect('view')).toEqual({ status: 'pending' });
    expect(h.completeCalendarRedirectAuth).toHaveBeenCalledWith('view');
    expect(pendingCredential.peek()).toMatchObject({ kind: 'view', refreshToken: 'rt-redirect' });
  });

  it('a sync intent is not the view store’s to resume', async () => {
    const store = useCalendarViewStore();
    expect(await store.resumeViewRedirect('connect')).toBeNull();
  });

  it('reconnect writes the new token in place and refuses a different account', async () => {
    const account = await seedAccount();
    await seedCalendar(account.id);
    const store = useCalendarViewStore();
    h.connectGoogleCalendar.mockResolvedValueOnce({
      status: 'connected',
      email: 'someone-else@example.com',
      refreshToken: 'rt-wrong',
      grantedScopes: [READONLY, LIST],
    });
    expect((await store.reconnectViewAccount(account.id)).status).toBe('failed');
    expect((await getAllCalendarViewAccounts())[0]!.refreshToken).toBe(`view-rt-${EMAIL}`);

    h.connectGoogleCalendar.mockResolvedValueOnce({
      status: 'connected',
      email: EMAIL,
      refreshToken: 'rt-fresh',
      grantedScopes: [READONLY, LIST],
    });
    expect(await store.reconnectViewAccount(account.id)).toEqual({ status: 'reconnected' });
    const accounts = await getAllCalendarViewAccounts();
    expect(accounts).toHaveLength(1);
    expect(accounts[0]!.refreshToken).toBe('rt-fresh');
  });
});

describe('calendarViewStore: privacy', () => {
  it('no calendar id, name, email, event id, title or location in any telemetry', async () => {
    const store = useCalendarViewStore();
    await store.beginViewConnect(EMAIL);
    await store.listPendingViewCalendars();
    await store.addViewedCalendar({
      viewAccountId: 'pending',
      calendar: { id: CAL_ID, summary: CAL_NAME, primary: false, accessRole: 'reader' },
    });
    await store.refresh({ force: true });
    reader.mockRejectedValue(new CalendarApiError('forbidden', 'Google Calendar HTTP 403', 403));
    await store.refresh({ force: true });
    const [cal] = await getAllViewedCalendars();
    await store.updateViewedCalendar(cal!.id, { detailLevel: 'busy' });
    await store.removeViewedCalendar(cal!.id);

    expect(h.logEvent).toHaveBeenCalled();
    const text = telemetryText();
    for (const secret of SECRETS) expect(text).not.toContain(secret);
  });

  it('stop() clears every event and the session state', async () => {
    const account = await seedAccount();
    await seedCalendar(account.id);
    const store = useCalendarViewStore();
    await store.refresh();
    expect(store.events).toHaveLength(1);
    store.stop();
    expect(store.events).toEqual([]);
    expect(store.standingSettled).toBe(false);
    expect(h.pollStop).toHaveBeenCalled();
  });
});

describe('calendarViewStore: review fixes', () => {
  it('F3: a detailLevel change that keeps updatedAt (a concurrent merge) still hides titles at once', async () => {
    // Freeze the clock so the write carries the SAME updatedAt as the record had, the
    // way a merge keeps one device's timestamp while the other's field survives.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date());
    try {
      const account = await seedAccount();
      const cal = await seedCalendar(account.id);
      const store = useCalendarViewStore();
      await store.refresh();
      expect(store.events[0]).toMatchObject({ title: TITLE });
      const before = (await getAllViewedCalendars())[0]!.updatedAt;

      await updateViewedCalendarRecord(cal.id, { detailLevel: 'busy' });
      expect((await getAllViewedCalendars())[0]!.updatedAt).toBe(before);

      expect(store.calendars[0]!.detailLevel).toBe('busy');
      expect(store.events[0]).toMatchObject({ busyOnly: true });
      expect(store.events[0]!.title).toBeUndefined();
      expect(store.events[0]!.location).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it('F3: a switch to busy only re-strips the cached events and keeps their times, even when the refetch fails', async () => {
    const account = await seedAccount();
    const cal = await seedCalendar(account.id);
    const store = useCalendarViewStore();
    await store.refresh();
    reader.mockRejectedValue(new CalendarApiError('transient', 'HTTP 503', 503));
    await store.updateViewedCalendar(cal.id, { detailLevel: 'busy' });
    await nextTick();
    // Busy only needs no read (R4: stripping is client side); a forced one that fails
    // still leaves the times showing without titles.
    expect(store.events).toHaveLength(1);
    expect(store.events[0]).toMatchObject({ busyOnly: true });
    expect(store.events[0]!.title).toBeUndefined();
    await store.refresh({ force: true });
    expect(store.events).toHaveLength(1);
    expect(store.events[0]!.title).toBeUndefined();
    expect(store.calendarState(cal.id)).toBe('stale');
  });

  it('F10: a return to the app skips a read younger than the minimum, and reads an older one', async () => {
    const account = await seedAccount();
    await seedCalendar(account.id);
    const store = useCalendarViewStore();
    await store.refresh();
    expect(reader).toHaveBeenCalledTimes(1);
    await h.poll!.cb(); // back in the app seconds later
    expect(reader).toHaveBeenCalledTimes(1);
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now + 61_000);
    await h.poll!.cb();
    expect(reader).toHaveBeenCalledTimes(2);
  });

  it('F10: the beanies-origin id set is built once per refresh batch, not per calendar and window', async () => {
    const account = await seedAccount();
    await seedCalendar(account.id);
    await seedCalendar(account.id, { calendarId: 'other@example.com', name: 'Other' });
    const store = useCalendarViewStore();
    store.setScreenWindow({ startYmd: '2027-06-01', endYmd: '2027-06-30' });
    vi.mocked(beaniesEventIds).mockClear();
    await store.refresh();
    expect(reader).toHaveBeenCalledTimes(4);
    expect(beaniesEventIds).toHaveBeenCalledTimes(1);
  });

  it('F7: activation reads the standing window once even while the document is hidden (the poll never fires)', async () => {
    const account = await seedAccount();
    await seedCalendar(account.id);
    const store = useCalendarViewStore();
    expect(store.standingSettled).toBe(false);
    await sleep(400);
    expect(readsFor('standing')).toBe(1);
    expect(store.standingSettled).toBe(true);
  });

  it('F7: with the document visible the activation read does not double the poll read', async () => {
    const account = await seedAccount();
    await seedCalendar(account.id);
    const store = useCalendarViewStore();
    await h.poll!.cb(); // fireImmediatelyOnVisible
    await sleep(400); // the activation read finds the entry fresh
    expect(reader).toHaveBeenCalledTimes(1);
    expect(store.standingSettled).toBe(true);
  });

  it('L5: disconnecting a calendar removes every record for it, so a hidden duplicate cannot take its place', async () => {
    const first = await seedAccount();
    const second = await seedAccount('dad@example.com');
    const winner = await seedCalendar(first.id);
    await seedCalendar(second.id); // the same Google calendar through another account
    const store = useCalendarViewStore();
    expect(store.calendars).toHaveLength(1);
    expect(await store.removeViewedCalendar(winner.id)).toEqual({ status: 'removed' });
    expect(await getAllViewedCalendars()).toHaveLength(0);
    expect(store.calendars).toHaveLength(0);
    // Both accounts were left with no calendar, so both go (each through the guard).
    expect(await getAllCalendarViewAccounts()).toHaveLength(0);
    expect(h.revokeGrant).toHaveBeenCalledTimes(2);
  });

  it('L1: a vanished record is logged on every path', async () => {
    const account = await seedAccount();
    const cal = await seedCalendar(account.id);
    const store = useCalendarViewStore();
    await removeCalendarViewAccount(account.id);
    expect(await store.listCalendarsForAccount(account.id)).toEqual({
      status: 'failed',
      reason: 'no-account',
    });
    expect(await store.reconnectViewAccount(account.id)).toMatchObject({ code: 'no_account' });
    expect(
      await store.addViewedCalendar({
        viewAccountId: account.id,
        calendar: { id: 'x@example.com', summary: 'X', primary: false },
      })
    ).toEqual({ status: 'failed', reason: 'no-account' });
    expect(await store.updateViewedCalendar('gone-id', { inWidgets: true })).toEqual({
      status: 'failed',
      reason: 'not-found',
    });
    const gone = h.logEvent.mock.calls
      .map(([e]) => e.context)
      .filter((c) => c?.detail === 'no-account' || c?.detail === 'not-found')
      .map((c) => c.action);
    expect(gone.sort()).toEqual(['add', 'list-account-calendars', 'reconnect', 'settings-change']);
    // The settings change tells the member (the add step toasts its own).
    expect(h.showToast).toHaveBeenCalledWith(
      'error',
      expect.any(String),
      expect.stringContaining('removed on another device'),
      { silent: true }
    );
    void cal;
  });

  it('L3: a failed list read is reported but not toasted by the store (the add step toasts it with a retry)', async () => {
    const store = useCalendarViewStore();
    await store.beginViewConnect(EMAIL);
    installClientWith({
      async listCalendars() {
        throw new CalendarApiError('transient', 'HTTP 503', 503);
      },
    });
    expect(await store.listPendingViewCalendars()).toEqual({
      status: 'failed',
      reason: 'read-failed',
    });
    expect(h.reportError).toHaveBeenCalled();
    expect(h.showToast).not.toHaveBeenCalled();
    // The consent is kept for the retry.
    expect(store.pendingViewConnect).toEqual({ accountEmail: EMAIL });
  });
});

describe('calendarViewStore: second review round', () => {
  /** Every output the store has, as text (what search, widgets, briefing and clashes read). */
  function outputs(store: ReturnType<typeof useCalendarViewStore>): string {
    return JSON.stringify({
      events: store.events,
      byDate: [...store.eventsByDate.entries()],
      forDate: store.eventsForDate(today),
      briefing: store.briefingEvents,
      widget: store.widgetEvents,
    });
  }

  it('R3: N polls with unchanged data keep every selector array, so consumers (the widget publisher) do nothing', async () => {
    const account = await seedAccount();
    const cal = await seedCalendar(account.id, { inBriefing: true, inWidgets: true });
    await seedCalendar(account.id, { calendarId: 'other@example.com', name: 'Other' });
    const store = useCalendarViewStore();
    await store.refresh();
    const before = {
      events: store.events,
      byDate: store.eventsByDate,
      briefing: store.briefingEvents,
      widget: store.widgetEvents,
    };
    expect(before.widget).toHaveLength(1);
    const fired = vi.fn();
    const stops = [
      watch(() => store.events, fired),
      watch(() => store.eventsByDate, fired),
      watch(() => store.briefingEvents, fired),
      watch(() => store.widgetEvents, fired),
    ];
    for (let i = 1; i <= 4; i++) {
      later(i * 301_000);
      await h.poll!.cb(); // every entry is a TTL old: a real re-read, same data
      await nextTick();
    }
    expect(reader.mock.calls.length).toBeGreaterThanOrEqual(8);
    expect(fired).not.toHaveBeenCalled();
    expect(store.events).toBe(before.events);
    expect(store.eventsByDate).toBe(before.byDate);
    expect(store.briefingEvents).toBe(before.briefing);
    expect(store.widgetEvents).toBe(before.widget);
    // A real change does reach them.
    reader.mockResolvedValue({ events: [eventToday('changed')], truncated: false });
    await store.refresh({ force: true });
    await nextTick();
    expect(store.widgetEvents).not.toBe(before.widget);
    stops.forEach((s) => s());
    void cal;
  });

  it('R3: with no calendar in the widgets, view-store activity never changes widgetEvents', async () => {
    const account = await seedAccount();
    await seedCalendar(account.id);
    const store = useCalendarViewStore();
    const initial = store.widgetEvents;
    const fired = vi.fn();
    const stop = watch(() => store.widgetEvents, fired);
    await store.refresh();
    reader.mockResolvedValue({ events: [eventToday('changed')], truncated: false });
    await store.refresh({ force: true });
    await nextTick();
    expect(store.events).toHaveLength(1);
    expect(fired).not.toHaveBeenCalled();
    expect(store.widgetEvents).toBe(initial);
    stop();
  });

  it('R4 case 1: switching a new calendar to busy only while its first read is in flight shows its times at once, without titles anywhere', async () => {
    const account = await seedAccount();
    const cal = await seedCalendar(account.id, { inBriefing: true, inWidgets: true });
    const read = deferredRead();
    const store = useCalendarViewStore();
    const refreshing = store.refresh();
    await updateViewedCalendarRecord(cal.id, { detailLevel: 'busy' });
    await nextTick();
    read.release();
    await refreshing;
    expect(store.events).toHaveLength(1);
    expect(store.events[0]).toMatchObject({ busyOnly: true });
    expect(store.briefingEvents).toHaveLength(1);
    expect(store.widgetEvents).toHaveLength(1);
    const text = outputs(store);
    expect(text).not.toContain(TITLE);
    expect(text).not.toContain(LOCATION);
    // No second read was needed for it.
    await sleep(400);
    expect(reader).toHaveBeenCalledTimes(1);
  });

  it('R4 case 2: busy -> details while a read is in flight: that read lands with titles; no marker is lost, no poll wait', async () => {
    const account = await seedAccount();
    const cal = await seedCalendar(account.id);
    const store = useCalendarViewStore();
    await store.refresh();
    const read = deferredRead();
    later(301_000);
    const polling = h.poll!.cb() as Promise<void>; // a poll read, now in flight
    await updateViewedCalendarRecord(cal.id, { detailLevel: 'busy' });
    await nextTick();
    expect(outputs(store)).not.toContain(TITLE);
    await sleep(350); // past the debounce: the refresh finds the read in flight and skips
    await updateViewedCalendarRecord(cal.id, { detailLevel: 'details' });
    await nextTick();
    read.release();
    await polling;
    await sleep(350);
    expect(store.events[0]).toMatchObject({ title: TITLE, busyOnly: false });
    expect(reader).toHaveBeenCalledTimes(2);
  });

  it('R4: busy -> details with nothing in flight reads again and the titles come back', async () => {
    const account = await seedAccount();
    const cal = await seedCalendar(account.id, { detailLevel: 'busy' });
    const store = useCalendarViewStore();
    await store.refresh();
    expect(outputs(store)).not.toContain(TITLE);
    await updateViewedCalendarRecord(cal.id, { detailLevel: 'details' });
    await nextTick();
    await sleep(400);
    expect(reader).toHaveBeenCalledTimes(2);
    expect(store.events[0]).toMatchObject({ title: TITLE });
  });

  it('R4: a busy-only or free/busy calendar never puts a title or location in any output', async () => {
    const account = await seedAccount();
    await seedCalendar(account.id, { detailLevel: 'busy', inBriefing: true, inWidgets: true });
    await seedCalendar(account.id, {
      calendarId: 'fb@example.com',
      name: 'FB',
      accessRole: 'freeBusyReader',
      detailLevel: 'busy',
      inBriefing: true,
      inWidgets: true,
    });
    const store = useCalendarViewStore();
    await store.refresh();
    expect(store.widgetEvents).toHaveLength(2);
    expect(store.briefingEvents).toHaveLength(2);
    const text = outputs(store);
    expect(text).not.toContain(TITLE);
    expect(text).not.toContain(LOCATION);
  });

  it('R7: health is per calendar: one blip across both windows and quick page flips is one strike, and unavailable hides every window', async () => {
    const account = await seedAccount();
    const cal = await seedCalendar(account.id);
    const store = useCalendarViewStore();
    store.setScreenWindow({ startYmd: today, endYmd: addDaysYmd(today, 60) });
    await store.refresh();
    expect(store.events).toHaveLength(1);
    reader.mockRejectedValue(new CalendarApiError('forbidden', 'Google Calendar HTTP 403', 403));
    await store.refresh({ force: true }); // both windows refused
    store.setScreenWindow({ startYmd: addDaysYmd(today, 1), endYmd: addDaysYmd(today, 61) });
    await store.refresh(); // a page flip in the same blip
    store.setScreenWindow({ startYmd: addDaysYmd(today, 2), endYmd: addDaysYmd(today, 62) });
    await store.refresh(); // and another
    expect(store.calendarState(cal.id)).toBe('stale');
    expect(store.events).toHaveLength(1);
    expect([...store.unhealthyStates]).toEqual([]);

    // A refusal a minute later, seen by the screen window only (a new page; the standing
    // window is still fresh and not re-read): the calendar is unavailable, and the
    // standing window's events are hidden with it.
    later(61_000);
    store.setScreenWindow({ startYmd: addDaysYmd(today, 3), endYmd: addDaysYmd(today, 63) });
    await store.refresh();
    expect(store.calendarState(cal.id)).toBe('unavailable');
    expect(store.events).toEqual([]);
    expect(store.eventsForDate(today)).toEqual([]);
    expect([...store.unhealthyStates]).toEqual(['unavailable']);
    expect(actions().filter((a) => a === 'calendar-unavailable')).toHaveLength(1);
  });

  it('R9: a token synced in while a read is in flight never raises needs_reconnect for the repaired account; it reads again with the new token', async () => {
    const account = await seedAccount();
    const cal = await seedCalendar(account.id);
    const dead = new Set<string>();
    installClientWith({
      hasPermanentAuthFailure: (_id, token) => dead.has(token),
    });
    const store = useCalendarViewStore();
    await store.refresh();
    const read = deferredRead();
    const refreshing = store.refresh({ force: true });
    // The mint for the old token is refused for good; meanwhile a reconnect elsewhere syncs in.
    dead.add(`view-rt-${EMAIL}`);
    const { updateCalendarViewAccount } =
      await import('@/services/automerge/repositories/calendarViewRepository');
    await updateCalendarViewAccount(account.id, { refreshToken: 'rt-reconnected' });
    read.fail(new CalendarApiError('auth', 'token refresh failed', undefined));
    await refreshing;
    expect(store.calendarState(cal.id)).not.toBe('needs_reconnect');
    expect([...store.unhealthyStates]).toEqual([]);
    expect(actions()).not.toContain('account-needs-reconnect');
    expect(store.events).toHaveLength(1);
    await sleep(400); // the superseded read scheduled a read with the new token
    expect(reader).toHaveBeenCalledTimes(3);
    expect(store.calendarState(cal.id)).toBe('ok');
  });

  it('R2 (state machine): a screen window cleared while its first read is in flight gets no entry back', async () => {
    const account = await seedAccount();
    await seedCalendar(account.id);
    const store = useCalendarViewStore();
    await store.refresh(); // standing
    const owner = store.setScreenWindow({ startYmd: '2027-06-01', endYmd: '2027-06-30' });
    const read = deferredRead();
    const refreshing = store.refresh();
    store.clearScreenWindow(owner);
    read.release({
      events: [
        {
          ...eventToday('screen-only'),
          start: { date: '2027-06-10' },
          end: { date: '2027-06-11' },
        },
      ],
      truncated: false,
    });
    await refreshing;
    expect(store.events.map((e) => e.id)).toEqual([EVENT_ID]);
  });

  it('R10: a client-side refusal (invalid) is reported as a programming error and leaves no cached events, never stale', async () => {
    const account = await seedAccount();
    const cal = await seedCalendar(account.id);
    const store = useCalendarViewStore();
    await store.refresh();
    expect(store.events).toHaveLength(1);
    reader.mockRejectedValue(
      new CalendarApiError('invalid', 'view read refused: the calendar is not a viewed calendar')
    );
    await store.refresh({ force: true });
    expect(store.calendarState(cal.id)).toBeNull();
    expect(store.events).toEqual([]);
    const reported = h.reportError.mock.calls.find(([e]) => e.context?.error_code === 'invalid');
    expect(reported?.[0]).toMatchObject({ severity: 'warning', surface: 'calendar-view' });
  });
});
