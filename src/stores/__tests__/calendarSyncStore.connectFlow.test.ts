/**
 * A fresh sync connect no longer writes a record at consent (view-only calendars
 * plan 2026-11-17, P2): the credential waits in the pending slot, the add step lists
 * that account's calendars, and only `confirmConnect` creates the connection, on
 * the CHOSEN calendar. Closing the add step abandons (guarded revoke).
 *
 * Also the shared revoke guard: disconnecting or reconnecting one connection must
 * never revoke a grant a sibling connection on the same Google account still uses.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { installInlineBackend } from '@/services/automerge/worker/__tests__/inlineHarness';
import { toISODateString } from '@/utils/date';
import { createActivity } from '@/services/automerge/repositories/activityRepository';
import {
  createCalendarConnection,
  getCalendarConnectionById,
} from '@/services/automerge/repositories/calendarRepository';
import { createCalendarViewAccount } from '@/services/automerge/repositories/calendarViewRepository';
import { makeCalendarClientStub } from '@/services/calendar/__tests__/fakeCalendarClient';
import { pendingCredential } from '@/services/calendar/pendingCredential';
import type { CreateFamilyActivityInput } from '@/types/models';

const h = vi.hoisted(() => ({
  driveEmail: { value: 'drive@example.com' as string | null },
  failCreate: { value: false },
  connectGoogleCalendar: vi.fn(),
  revokeGrant: vi.fn(async () => ({ ok: true, reason: 'revoked' })),
  logTokenLifecycle: vi.fn(),
  logEvent: vi.fn(),
  reportError: vi.fn(),
}));

vi.mock('@/services/calendar/calendarAuth', () => ({
  connectGoogleCalendar: h.connectGoogleCalendar,
  startCalendarRedirectAuth: vi.fn(async () => {}),
  completeCalendarRedirectAuth: vi.fn(),
}));
vi.mock('@/services/google/googleAuth', () => ({
  shouldUseRedirectAuth: () => false,
  getGoogleAccountEmail: () => h.driveEmail.value,
}));
vi.mock('@/services/google/googleRevoke', () => ({
  revokeGrant: h.revokeGrant,
  logTokenLifecycle: h.logTokenLifecycle,
}));
vi.mock('@/services/telemetry', () => ({ logEvent: h.logEvent }));
vi.mock('@/utils/errorReporter', () => ({ reportError: h.reportError }));
vi.mock('@/services/automerge/repositories/calendarRepository', async (importOriginal) => {
  const real =
    await importOriginal<typeof import('@/services/automerge/repositories/calendarRepository')>();
  return {
    ...real,
    createCalendarConnection: vi.fn((input: Parameters<typeof real.createCalendarConnection>[0]) =>
      h.failCreate.value
        ? Promise.reject(new Error('idb write failed'))
        : real.createCalendarConnection(input)
    ),
  };
});

import { useCalendarSyncStore, setCalendarClientForTesting } from '../calendarSyncStore';

const OWNED = 'https://www.googleapis.com/auth/calendar.events.owned';
const LIST = 'https://www.googleapis.com/auth/calendar.calendarlist.readonly';

const consent = {
  status: 'connected' as const,
  email: 'mum@example.com',
  refreshToken: 'rt-pending',
  grantedScopes: [OWNED, LIST],
};

function consentOutcomes(): unknown[] {
  return h.logEvent.mock.calls
    .map(([e]) => e as { context?: { action?: string; detail?: string } })
    .filter((e) => e.context?.action === 'consent-outcome')
    .map((e) => e.context?.detail);
}

function activityInput(): CreateFamilyActivityInput {
  return {
    title: 'Soccer practice',
    date: toISODateString(new Date()).slice(0, 10),
    recurrence: 'none',
    category: 'sports',
    feeSchedule: 'none',
    reminderMinutes: 0,
    isActive: true,
    createdBy: 'm0',
  } as unknown as CreateFamilyActivityInput;
}

function connection(accountEmail: string) {
  return createCalendarConnection({
    provider: 'google',
    accountEmail,
    destinationCalendarId: 'primary',
    refreshToken: `rt-${accountEmail}`,
    grantedScopes: [OWNED],
    status: 'ok',
  });
}

function viewAccount(accountEmail: string) {
  return createCalendarViewAccount({
    provider: 'google',
    accountEmail,
    refreshToken: `view-rt-${accountEmail}`,
    grantedScopes: ['https://www.googleapis.com/auth/calendar.events.readonly'],
  });
}

let inserted: Array<{ credential: string; calendar: string }>;
let listedWith: string[];

beforeEach(async () => {
  setActivePinia(createPinia());
  await installInlineBackend();
  localStorage.setItem('beanies:flag:googleCalendarSync', 'true');
  pendingCredential.clear();
  h.driveEmail.value = 'drive@example.com';
  h.failCreate.value = false;
  inserted = [];
  listedWith = [];
  setCalendarClientForTesting(
    makeCalendarClientStub({
      async insertEvent(credential, calendar) {
        inserted.push({ credential, calendar });
      },
      async listCalendars(credential) {
        listedWith.push(credential);
        return [
          { id: 'mum@example.com', summary: 'Mum', primary: true, accessRole: 'owner' },
          { id: 'kids@group.calendar.google.com', summary: 'Kids', primary: false },
        ];
      },
    })
  );
  h.connectGoogleCalendar.mockResolvedValue(consent);
});

afterEach(() => {
  setCalendarClientForTesting(null);
  localStorage.clear();
  vi.clearAllMocks();
});

describe('fresh connect: consent writes nothing until a calendar is confirmed', () => {
  it('beginConnect holds the consent as pending and creates no connection', async () => {
    const store = useCalendarSyncStore();

    const result = await store.beginConnect();

    expect(result).toEqual({ status: 'pending' });
    expect(store.connections).toHaveLength(0);
    expect(store.pendingConnect).toEqual({ accountEmail: 'mum@example.com' });
    expect(pendingCredential.peek()).toMatchObject({ kind: 'sync', refreshToken: 'rt-pending' });
    expect(consentOutcomes()).toEqual(['consented']);
  });

  it('lists the pending account’s calendars through the pending credential id', async () => {
    const store = useCalendarSyncStore();
    await store.beginConnect();

    const calendars = await store.listPendingCalendars();

    expect(calendars.map((c) => c.id)).toEqual([
      'mum@example.com',
      'kids@group.calendar.google.com',
    ]);
    expect(listedWith).toEqual([pendingCredential.peek()!.id]);
  });

  it('offers primary only when the calendar-list scope was not granted', async () => {
    h.connectGoogleCalendar.mockResolvedValue({ ...consent, grantedScopes: [OWNED] });
    const store = useCalendarSyncStore();
    await store.beginConnect();

    const calendars = await store.listPendingCalendars();

    expect(calendars).toEqual([{ id: 'primary', summary: '', primary: true }]);
    expect(listedWith).toEqual([]);
  });

  it('confirmConnect creates the connection on the CHOSEN calendar and reconciles onto it', async () => {
    await createActivity(activityInput());
    const store = useCalendarSyncStore();
    await store.beginConnect();

    const result = await store.confirmConnect('kids@group.calendar.google.com');

    expect(result).toEqual({ status: 'connected' });
    expect(store.connections).toHaveLength(1);
    expect(store.connections[0]).toMatchObject({
      accountEmail: 'mum@example.com',
      destinationCalendarId: 'kids@group.calendar.google.com',
      refreshToken: 'rt-pending',
      status: 'ok',
    });
    expect(pendingCredential.peek()).toBeNull();
    // The immediate reconcile pushes to the chosen calendar, never 'primary' first.
    await vi.waitFor(() => expect(inserted.length).toBeGreaterThan(0));
    expect(inserted.every((i) => i.calendar === 'kids@group.calendar.google.com')).toBe(true);
    expect(consentOutcomes()).toEqual(['consented', 'connected']);
  });

  it('a failed write is critical and keeps the pending consent so the member can retry', async () => {
    const store = useCalendarSyncStore();
    await store.beginConnect();
    h.failCreate.value = true;

    const result = await store.confirmConnect('mum@example.com');

    expect(result).toEqual({ status: 'failed', reason: 'write-failed' });
    expect(h.reportError).toHaveBeenCalledWith(
      expect.objectContaining({
        severity: 'critical',
        surface: 'calendar-sync',
        context: expect.objectContaining({ action: 'confirm-connect' }),
      })
    );
    expect(store.pendingConnect).not.toBeNull();

    h.failCreate.value = false;
    expect(await store.confirmConnect('mum@example.com')).toEqual({ status: 'connected' });
  });

  it('refuses a calendar that is already a sync destination', async () => {
    // The same Google calendar, reached through another account that it is shared with.
    await createCalendarConnection({
      provider: 'google',
      accountEmail: 'dad@example.com',
      destinationCalendarId: 'kids@group.calendar.google.com',
      refreshToken: 'rt-dad',
      grantedScopes: [OWNED],
      status: 'ok',
    });
    const store = useCalendarSyncStore();
    await store.beginConnect();

    expect(await store.confirmConnect('kids@group.calendar.google.com')).toEqual({
      status: 'failed',
      reason: 'already-connected',
    });
    expect(store.connections).toHaveLength(1);
    expect(store.pendingConnect).not.toBeNull();
  });

  it('R1: a teardown stuck in disconnecting does not block connecting that calendar again, and never deletes the new connection’s events', async () => {
    const activity = await createActivity(activityInput());
    const { createCalendarEventLink, getCalendarEventLinksForConnection } =
      await import('@/services/automerge/repositories/calendarRepository');
    const { deterministicEventId } = await import('@/utils/calendar/deterministicEventId');
    const eventId = deterministicEventId(activity.id);
    // The old connection's grant is dead, so its teardown's deletes all fail.
    const stuck = await createCalendarConnection({
      provider: 'google',
      accountEmail: 'mum@example.com',
      destinationCalendarId: 'kids@group.calendar.google.com',
      refreshToken: 'rt-dead',
      grantedScopes: [OWNED],
      status: 'disconnecting',
    });
    await createCalendarEventLink({
      connectionId: stuck.id,
      activityId: activity.id,
      googleEventId: eventId,
      lastPushedHash: 'h',
      lastPushedAt: new Date().toISOString(),
    });
    const deleted: Array<{ credential: string; eventId: string }> = [];
    setCalendarClientForTesting(
      makeCalendarClientStub({
        async insertEvent(credential, calendar) {
          inserted.push({ credential, calendar });
        },
        async deleteEvent(credential, _calendar, id) {
          deleted.push({ credential, eventId: id });
        },
      })
    );
    const store = useCalendarSyncStore();
    await store.beginConnect();

    expect(await store.confirmConnect('kids@group.calendar.google.com')).toEqual({
      status: 'connected',
    });
    const fresh = store.connections.find((c) => c.id !== stuck.id)!;
    await vi.waitFor(async () =>
      expect(await getCalendarEventLinksForConnection(fresh.id)).toHaveLength(1)
    );

    // The teardown retries: the event is the new connection's now, so it is forgotten,
    // never deleted, and the stuck record finally goes.
    expect(await store.disconnect(stuck.id)).toBe(true);
    expect(deleted.filter((d) => d.eventId === eventId)).toEqual([]);
    expect(await getCalendarConnectionById(stuck.id)).toBeFalsy();
    expect(await getCalendarEventLinksForConnection(fresh.id)).toHaveLength(1);
    // Same Google account as the live connection: the guard keeps its grant alive.
    expect(h.revokeGrant).not.toHaveBeenCalledWith('rt-dead', expect.anything());
  });

  it('confirm without a pending consent writes nothing', async () => {
    const store = useCalendarSyncStore();
    expect(await store.confirmConnect('mum@example.com')).toEqual({
      status: 'failed',
      reason: 'no-pending',
    });
    expect(store.connections).toHaveLength(0);
  });

  it('a declined consent is logged with its code and nothing is held', async () => {
    h.connectGoogleCalendar.mockResolvedValue({
      status: 'failed',
      code: 'missing_scope',
      message: 'not granted',
    });
    const store = useCalendarSyncStore();

    const result = await store.beginConnect();

    expect(result).toMatchObject({ status: 'failed', code: 'missing_scope' });
    expect(store.pendingConnect).toBeNull();
    expect(consentOutcomes()).toEqual(['missing_scope']);
  });
});

describe('abandoning the add step', () => {
  it('clears the slot, revokes the unused token (another account than Drive) and logs abandoned', async () => {
    const store = useCalendarSyncStore();
    await store.beginConnect();

    store.abandonConnect();

    expect(store.pendingConnect).toBeNull();
    expect(h.revokeGrant).toHaveBeenCalledWith('rt-pending', expect.anything());
    expect(consentOutcomes()).toEqual(['consented', 'abandoned']);
    expect(store.connections).toHaveLength(0);
  });

  it('skips the revoke when Drive uses the same Google account', async () => {
    h.driveEmail.value = 'mum@example.com';
    const store = useCalendarSyncStore();
    await store.beginConnect();

    store.abandonConnect();

    expect(h.revokeGrant).not.toHaveBeenCalled();
    expect(h.logTokenLifecycle).toHaveBeenCalledWith(
      expect.objectContaining({ op: 'revoke', outcome: 'skipped', trigger: 'abandon' })
    );
  });

  it('skips the revoke when a sync connection already uses that account', async () => {
    await connection('mum@example.com');
    const store = useCalendarSyncStore();
    await store.beginConnect();

    store.abandonConnect();

    expect(h.revokeGrant).not.toHaveBeenCalled();
  });

  it('is a no-op with nothing pending', () => {
    useCalendarSyncStore().abandonConnect();
    expect(h.revokeGrant).not.toHaveBeenCalled();
    expect(consentOutcomes()).toEqual([]);
  });

  it('a second beginConnect abandons the first consent before minting', async () => {
    const store = useCalendarSyncStore();
    await store.beginConnect();
    const firstId = pendingCredential.peek()!.id;
    h.connectGoogleCalendar.mockResolvedValue({ ...consent, refreshToken: 'rt-second' });

    await store.beginConnect();

    expect(h.revokeGrant).toHaveBeenCalledWith('rt-pending', expect.anything());
    expect(pendingCredential.peek()).toMatchObject({ refreshToken: 'rt-second' });
    expect(pendingCredential.peek()!.id).not.toBe(firstId);
  });
});

describe('shared revoke guard on disconnect and reconnect', () => {
  it('🔴 disconnecting one of two same-account connections does NOT revoke the other’s grant', async () => {
    const first = await connection('mum@example.com');
    const second = await connection('mum@example.com');
    const store = useCalendarSyncStore();

    expect(await store.disconnect(first.id)).toBe(true);

    expect(h.revokeGrant).not.toHaveBeenCalled();
    expect(h.logTokenLifecycle).toHaveBeenCalledWith(
      expect.objectContaining({
        op: 'revoke',
        outcome: 'skipped',
        reason: 'shared-account-grant',
        trigger: 'disconnect',
      })
    );
    expect(await getCalendarConnectionById(second.id)).toBeDefined();
  });

  it('disconnecting the last connection on an account Drive does not use revokes it', async () => {
    const only = await connection('mum@example.com');
    const store = useCalendarSyncStore();

    await store.disconnect(only.id);

    expect(h.revokeGrant).toHaveBeenCalledWith('rt-mum@example.com', {
      grant: 'calendar',
      trigger: 'disconnect',
    });
  });

  it('🔴 disconnecting a sync connection does NOT revoke when a view-only account shares its email', async () => {
    const only = await connection('mum@example.com');
    await viewAccount('Mum@Example.com');
    const store = useCalendarSyncStore();

    expect(await store.disconnect(only.id)).toBe(true);

    expect(h.revokeGrant).not.toHaveBeenCalled();
    expect(h.logTokenLifecycle).toHaveBeenCalledWith(
      expect.objectContaining({
        op: 'revoke',
        outcome: 'skipped',
        reason: 'shared-account-grant',
        trigger: 'disconnect',
      })
    );
  });

  it('a view-only account on a DIFFERENT email does not block the revoke', async () => {
    const only = await connection('mum@example.com');
    await viewAccount('dad@example.com');
    const store = useCalendarSyncStore();

    await store.disconnect(only.id);

    expect(h.revokeGrant).toHaveBeenCalledWith('rt-mum@example.com', {
      grant: 'calendar',
      trigger: 'disconnect',
    });
  });

  it('reconnect’s revoke-before-mint skips when a sibling connection shares the account', async () => {
    const broken = await connection('mum@example.com');
    await connection('mum@example.com');
    h.connectGoogleCalendar.mockResolvedValue({ ...consent, refreshToken: 'rt-fresh' });
    const store = useCalendarSyncStore();

    await store.reconnect(broken.id);

    expect(h.revokeGrant).not.toHaveBeenCalled();
    // Reconnect still writes in place, exactly as before.
    expect((await getCalendarConnectionById(broken.id))?.refreshToken).toBe('rt-fresh');
    expect(store.connections).toHaveLength(2);
  });
});

// ── Review round 3 ──────────────────────────────────────────────────────────

describe('T2: confirmConnect uses the one already-used rule, viewed calendars included', () => {
  async function viewed(calendarId: string, accountEmail = 'grandma@example.com') {
    const { createViewedCalendar } =
      await import('@/services/automerge/repositories/calendarViewRepository');
    const account = await viewAccount(accountEmail);
    return createViewedCalendar({
      viewAccountId: account.id,
      calendarId,
      name: 'Viewed',
      accessRole: 'reader',
      detailLevel: 'details',
      color: '#6b7280',
      inBriefing: false,
      inWidgets: false,
    });
  }

  it('refuses a calendar the family already views (any account), so it is never synced and viewed', async () => {
    await viewed('kids@group.calendar.google.com');
    const store = useCalendarSyncStore();
    await store.beginConnect();

    expect(await store.confirmConnect('kids@group.calendar.google.com')).toEqual({
      status: 'failed',
      reason: 'already-connected',
    });
    expect(store.connections).toHaveLength(0);
    const refusal = h.logEvent.mock.calls.find(
      ([e]) => e.context?.action === 'confirm-connect' && e.context?.detail === 'already-viewed'
    );
    expect(refusal).toBeDefined();
  });

  it("refuses the fallback 'primary' row when that account's primary is viewed under its real id", async () => {
    // Old code compared viewed ids raw, so 'primary' never matched 'mum@example.com'.
    await viewed('mum@example.com');
    const store = useCalendarSyncStore();
    await store.beginConnect();

    expect(await store.confirmConnect('primary')).toEqual({
      status: 'failed',
      reason: 'already-connected',
    });
  });

  it('the add step reads the same records (calendarUses), viewed calendars included', async () => {
    await viewed('kids@group.calendar.google.com');
    const store = useCalendarSyncStore();
    expect(store.calendarUses.viewed).toEqual([
      { calendarId: 'kids@group.calendar.google.com', accountEmail: 'grandma@example.com' },
    ]);
  });
});

describe('T7: the destination name is stored when chosen', () => {
  it('confirmConnect stores the name the add step listed', async () => {
    const store = useCalendarSyncStore();
    await store.beginConnect();
    await store.confirmConnect('kids@group.calendar.google.com', 'Kids');
    expect(store.connections[0]).toMatchObject({ destinationCalendarName: 'Kids' });
  });

  it('a stored name is returned without any Google read', async () => {
    const store = useCalendarSyncStore();
    await store.beginConnect();
    await store.confirmConnect('kids@group.calendar.google.com', 'Kids');
    listedWith = [];
    expect(await store.resolveDestinationName(store.connections[0]!.id)).toBe('Kids');
    expect(listedWith).toEqual([]);
  });

  it('a legacy connection resolves its name from the list and writes it back (with the real primary id)', async () => {
    const legacy = await createCalendarConnection({
      provider: 'google',
      accountEmail: 'mum@example.com',
      destinationCalendarId: 'primary',
      refreshToken: 'rt-legacy',
      grantedScopes: [OWNED, LIST],
      status: 'ok',
    });
    const store = useCalendarSyncStore();
    expect(await store.resolveDestinationName(legacy.id)).toBe('Mum');
    expect(await getCalendarConnectionById(legacy.id)).toMatchObject({
      destinationCalendarName: 'Mum',
      destinationCalendarId: 'mum@example.com',
    });
  });

  it('a legacy connection whose list cannot be read gets null and nothing is written', async () => {
    const legacy = await createCalendarConnection({
      provider: 'google',
      accountEmail: 'mum@example.com',
      destinationCalendarId: 'kids@group.calendar.google.com',
      refreshToken: 'rt-legacy',
      grantedScopes: [OWNED], // no list scope
      status: 'needs_reconnect',
    });
    const store = useCalendarSyncStore();
    expect(await store.resolveDestinationName(legacy.id)).toBeNull();
    expect((await getCalendarConnectionById(legacy.id))?.destinationCalendarName).toBeUndefined();
  });
});

/**
 * T5 + T9: a teardown leaves events only to a HEALTHY sibling on the same calendar,
 * and every attempt emits one summary event (success and partial).
 */
describe('T5/T9: finishDisconnect and its siblings', () => {
  async function setup(siblingStatus: 'ok' | 'needs_reconnect' | 'error' | 'disconnecting') {
    const activity = await createActivity(activityInput());
    const { createCalendarEventLink } =
      await import('@/services/automerge/repositories/calendarRepository');
    const { deterministicEventId } = await import('@/utils/calendar/deterministicEventId');
    const eventId = deterministicEventId(activity.id);
    const make = (status: 'ok' | 'needs_reconnect' | 'error' | 'disconnecting', rt: string) =>
      createCalendarConnection({
        provider: 'google',
        accountEmail: 'mum@example.com',
        destinationCalendarId: 'kids@group.calendar.google.com',
        refreshToken: rt,
        grantedScopes: [OWNED],
        status,
      });
    const doomed = await make('ok', 'rt-doomed');
    const sibling = await make(siblingStatus, 'rt-sibling');
    for (const c of [doomed, sibling]) {
      await createCalendarEventLink({
        connectionId: c.id,
        activityId: activity.id,
        googleEventId: eventId,
        lastPushedHash: 'h',
        lastPushedAt: new Date().toISOString(),
      });
    }
    const deleted: string[] = [];
    setCalendarClientForTesting(
      makeCalendarClientStub({
        async deleteEvent(_credential, _calendar, id) {
          deleted.push(id);
        },
      })
    );
    return { doomed, eventId, deleted };
  }

  it('a healthy (ok) sibling owns the shared events: they are forgotten, not deleted', async () => {
    const { doomed, eventId, deleted } = await setup('ok');
    const store = useCalendarSyncStore();
    expect(await store.disconnect(doomed.id)).toBe(true);
    expect(deleted).not.toContain(eventId);
    const done = h.logEvent.mock.calls.find(([e]) => e.context?.action === 'disconnect-teardown');
    expect(done?.[0].context).toEqual({
      action: 'disconnect-teardown',
      detail: 'complete',
      count: 1,
      kind: 'left-to-live-sibling',
    });
  });

  it.each(['needs_reconnect', 'error', 'disconnecting'] as const)(
    'a %s sibling is no owner: the events are deleted as before',
    async (status) => {
      const { doomed, eventId, deleted } = await setup(status);
      const store = useCalendarSyncStore();
      expect(await store.disconnect(doomed.id)).toBe(true);
      expect(deleted).toContain(eventId);
      const done = h.logEvent.mock.calls.find(([e]) => e.context?.action === 'disconnect-teardown');
      expect(done?.[0].context).toEqual({
        action: 'disconnect-teardown',
        detail: 'complete',
        count: 1,
      });
    }
  );

  it('T9: failed deletes are reported ONCE per attempt with counts and a kind, never ids', async () => {
    const activity = await createActivity(activityInput());
    const second = await createActivity(activityInput());
    const { createCalendarEventLink } =
      await import('@/services/automerge/repositories/calendarRepository');
    const { CalendarApiError } = await import('@/services/calendar/CalendarClient');
    const doomed = await createCalendarConnection({
      provider: 'google',
      accountEmail: 'mum@example.com',
      destinationCalendarId: 'kids@group.calendar.google.com',
      refreshToken: 'rt-dead',
      grantedScopes: [OWNED],
      status: 'ok',
    });
    for (const a of [activity, second]) {
      await createCalendarEventLink({
        connectionId: doomed.id,
        activityId: a.id,
        googleEventId: `evt-secret-${a.id}`,
        lastPushedHash: 'h',
        lastPushedAt: new Date().toISOString(),
      });
    }
    setCalendarClientForTesting(
      makeCalendarClientStub({
        async deleteEvent() {
          throw new CalendarApiError('auth', 'dead grant', 401);
        },
      })
    );
    const store = useCalendarSyncStore();
    h.reportError.mockClear();

    expect(await store.disconnect(doomed.id)).toBe(false);

    const reports = h.reportError.mock.calls.filter(
      ([e]) => e.context?.action === 'disconnect-teardown'
    );
    expect(reports).toHaveLength(1);
    expect(reports[0]![0]).toMatchObject({
      surface: 'calendar-sync',
      severity: 'warning',
      context: { action: 'disconnect-teardown', detail: 'partial', count: 2, error_code: 'auth' },
    });
    const text = JSON.stringify(reports.map(([e]) => [e.message, e.context]));
    expect(text).not.toContain('evt-secret');
    expect(text).not.toContain('kids@group');
    expect(text).not.toContain('mum@example.com');
    expect(await getCalendarConnectionById(doomed.id)).toBeTruthy();
  });
});
