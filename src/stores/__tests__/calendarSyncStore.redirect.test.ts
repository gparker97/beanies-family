import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { installInlineBackend } from '@/services/automerge/worker/__tests__/inlineHarness';
import {
  createCalendarConnection,
  getCalendarConnectionById,
} from '@/services/automerge/repositories/calendarRepository';
import { useCalendarSyncStore, setCalendarClientForTesting } from '../calendarSyncStore';
import { makeCalendarClientStub } from '@/services/calendar/__tests__/fakeCalendarClient';
import { pendingCredential } from '@/services/calendar/pendingCredential';

// P2 — the store's redirect handoff (connect/reconnect → 'redirecting') + the
// post-redirect resume. A fresh connect's resume ends with the consent PENDING in
// memory and nothing written (view-only calendars plan 2026-11-17, A2); a
// reconnect's resume commits in place via finalizeConnected, as before.
// The auth seam is mocked; the CRDT commit runs against the real inline backend.

const {
  redirectSurface,
  startCalendarRedirectAuth,
  completeCalendarRedirectAuth,
  connectGoogleCalendar,
} = vi.hoisted(() => ({
  redirectSurface: { value: false },
  startCalendarRedirectAuth: vi.fn<
    (returnPath: string, loginHint: string | undefined, mode: string) => Promise<void>
  >(async () => {}),
  completeCalendarRedirectAuth: vi.fn(),
  connectGoogleCalendar: vi.fn(),
}));

vi.mock('@/services/calendar/calendarAuth', () => ({
  connectGoogleCalendar,
  startCalendarRedirectAuth,
  completeCalendarRedirectAuth,
}));
vi.mock('@/services/google/googleAuth', () => ({
  shouldUseRedirectAuth: () => redirectSurface.value,
  getGoogleAccountEmail: () => 'me@example.com',
  // Consulted by the reconnect/disconnect Drive-safety guard (#62).
  hasRefreshToken: () => false,
}));
vi.mock('@/utils/errorReporter', () => ({ reportError: vi.fn() }));

const noopClient = makeCalendarClientStub();

const connected = {
  status: 'connected' as const,
  email: 'me@example.com',
  refreshToken: 'rt-new',
  grantedScopes: ['https://www.googleapis.com/auth/calendar.events.owned'],
};

describe('calendarSyncStore — redirect handoff + resume (P2)', () => {
  beforeEach(async () => {
    setActivePinia(createPinia());
    await installInlineBackend();
    setCalendarClientForTesting(noopClient);
    localStorage.setItem('beanies:flag:googleCalendarSync', 'true');
    redirectSurface.value = false;
    pendingCredential.clear();
  });
  afterEach(() => {
    setCalendarClientForTesting(null);
    localStorage.clear();
    vi.clearAllMocks();
  });

  describe('connect() / reconnect() on a redirect surface', () => {
    it('beginConnect hands off to the redirect transport (calResume=connect, mode create) and returns redirecting', async () => {
      redirectSurface.value = true;
      const store = useCalendarSyncStore();

      const result = await store.beginConnect();

      expect(result).toEqual({ status: 'redirecting' });
      expect(connectGoogleCalendar).not.toHaveBeenCalled();
      expect(startCalendarRedirectAuth).toHaveBeenCalledOnce();
      const [returnPath, loginHint, mode] = startCalendarRedirectAuth.mock.calls[0];
      expect(returnPath).toContain('open=calendar-sync');
      expect(returnPath).toContain('calResume=connect');
      expect(loginHint).toBe('me@example.com');
      expect(mode).toBe('create');
      // Nothing is held or written before the round trip.
      expect(store.pendingConnect).toBeNull();
      expect(store.connections).toHaveLength(0);
    });

    it('reconnect hands off with calResume=<connectionId> + mode reconnect', async () => {
      redirectSurface.value = true;
      const conn = await createCalendarConnection({
        provider: 'google',
        accountEmail: 'mum@example.com',
        destinationCalendarId: 'primary',
        refreshToken: 'rt-old',
        grantedScopes: ['https://www.googleapis.com/auth/calendar.events.owned'],
        status: 'needs_reconnect',
      });
      const store = useCalendarSyncStore();

      const result = await store.reconnect(conn.id);

      expect(result).toEqual({ status: 'redirecting' });
      const [returnPath, loginHint, mode] = startCalendarRedirectAuth.mock.calls[0];
      expect(returnPath).toContain(`calResume=${conn.id}`);
      expect(loginHint).toBe('mum@example.com');
      expect(mode).toBe('reconnect');
    });

    it('desktop (popup) surface still runs connectGoogleCalendar — no redirect handoff', async () => {
      redirectSurface.value = false;
      connectGoogleCalendar.mockResolvedValue(connected);
      const store = useCalendarSyncStore();

      const result = await store.beginConnect();

      expect(startCalendarRedirectAuth).not.toHaveBeenCalled();
      expect(connectGoogleCalendar).toHaveBeenCalledOnce();
      expect(result).toEqual({ status: 'pending' });
      expect(store.connections).toHaveLength(0);
    });
  });

  describe('resumeRedirectConnect()', () => {
    it("intent 'connect' → holds the redeemed token as PENDING and writes no connection", async () => {
      completeCalendarRedirectAuth.mockResolvedValue(connected);
      const store = useCalendarSyncStore();

      const result = await store.resumeRedirectConnect('connect');

      expect(result).toEqual({ status: 'pending' });
      expect(store.connections).toHaveLength(0);
      expect(store.pendingConnect).toEqual({ accountEmail: 'me@example.com' });
      expect(pendingCredential.peek()).toMatchObject({ kind: 'sync', refreshToken: 'rt-new' });
    });

    it("intent 'connect' → the add step can then list and confirm the chosen calendar", async () => {
      completeCalendarRedirectAuth.mockResolvedValue({
        ...connected,
        grantedScopes: [
          ...connected.grantedScopes,
          'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
        ],
      });
      setCalendarClientForTesting(
        makeCalendarClientStub({
          async listCalendars() {
            return [
              { id: 'me@example.com', summary: 'Me', primary: true },
              { id: 'family@group.calendar.google.com', summary: 'Family', primary: false },
            ];
          },
        })
      );
      const store = useCalendarSyncStore();
      await store.resumeRedirectConnect('connect');

      const calendars = await store.listPendingCalendars();
      const confirmed = await store.confirmConnect(calendars[1].id);

      expect(confirmed).toEqual({ status: 'connected' });
      expect(store.connections).toHaveLength(1);
      expect(store.connections[0]).toMatchObject({
        destinationCalendarId: 'family@group.calendar.google.com',
        refreshToken: 'rt-new',
      });
      expect(store.pendingConnect).toBeNull();
    });

    it('intent <connectionId> → updates that connection in place, clearing needs_reconnect', async () => {
      const conn = await createCalendarConnection({
        provider: 'google',
        accountEmail: 'me@example.com',
        destinationCalendarId: 'primary',
        refreshToken: 'rt-old',
        grantedScopes: ['https://www.googleapis.com/auth/calendar.events.owned'],
        status: 'needs_reconnect',
      });
      completeCalendarRedirectAuth.mockResolvedValue(connected);
      const store = useCalendarSyncStore();

      await store.resumeRedirectConnect(conn.id);

      const updated = await getCalendarConnectionById(conn.id);
      expect(updated).toMatchObject({ status: 'ok', refreshToken: 'rt-new' });
      expect(store.connections).toHaveLength(1); // updated in place, no duplicate
    });

    it('intent <connectionId> that vanished → falls back to a fresh create', async () => {
      completeCalendarRedirectAuth.mockResolvedValue(connected);
      const store = useCalendarSyncStore();

      await store.resumeRedirectConnect('a-removed-id');

      expect(store.connections).toHaveLength(1);
      expect(store.connections[0]).toMatchObject({ status: 'ok' });
    });

    it('returns null and commits nothing when there is no pending code', async () => {
      completeCalendarRedirectAuth.mockResolvedValue(null);
      const store = useCalendarSyncStore();

      const result = await store.resumeRedirectConnect('connect');

      expect(result).toBeNull();
      expect(store.connections).toHaveLength(0);
    });

    it('surfaces a failed redemption without committing', async () => {
      completeCalendarRedirectAuth.mockResolvedValue({
        status: 'failed',
        code: 'exchange_failed',
        message: 'boom',
      });
      const store = useCalendarSyncStore();

      const result = await store.resumeRedirectConnect('connect');

      expect(result).toMatchObject({ status: 'failed' });
      expect(store.connections).toHaveLength(0);
      expect(store.pendingConnect).toBeNull();
    });
  });
});
