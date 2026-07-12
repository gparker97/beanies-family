import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { installInlineBackend } from '@/services/automerge/worker/__tests__/inlineHarness';
import {
  createCalendarConnection,
  getCalendarConnectionById,
} from '@/services/automerge/repositories/calendarRepository';
import { useCalendarSyncStore, setCalendarClientForTesting } from '../calendarSyncStore';
import type { CalendarClient } from '@/services/calendar/CalendarClient';

// P2 — the store's redirect handoff (connect/reconnect → 'redirecting') + the
// post-redirect resume (`resumeRedirectConnect` → CRDT commit via finalizeConnected).
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
}));
vi.mock('@/utils/errorReporter', () => ({ reportError: vi.fn() }));

const noopClient: CalendarClient = {
  invalidateConnection() {},
  async insertEvent() {},
  async patchEvent() {},
  async deleteEvent() {},
  async eventExists() {
    return true;
  },
  async listCalendars() {
    return [{ id: 'primary', summary: 'Primary', primary: true }];
  },
  async listEventTimes() {
    return [];
  },
};

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
  });
  afterEach(() => {
    setCalendarClientForTesting(null);
    localStorage.clear();
    vi.clearAllMocks();
  });

  describe('connect() / reconnect() on a redirect surface', () => {
    it('connect hands off to the redirect transport (calResume=connect, mode create) and returns redirecting', async () => {
      redirectSurface.value = true;
      const store = useCalendarSyncStore();

      const result = await store.connect();

      expect(result).toEqual({ status: 'redirecting' });
      expect(connectGoogleCalendar).not.toHaveBeenCalled();
      expect(startCalendarRedirectAuth).toHaveBeenCalledOnce();
      const [returnPath, loginHint, mode] = startCalendarRedirectAuth.mock.calls[0];
      expect(returnPath).toContain('open=calendar-sync');
      expect(returnPath).toContain('calResume=connect');
      expect(loginHint).toBe('me@example.com');
      expect(mode).toBe('create');
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

      const result = await store.connect();

      expect(startCalendarRedirectAuth).not.toHaveBeenCalled();
      expect(connectGoogleCalendar).toHaveBeenCalledOnce();
      expect(result).toMatchObject({ status: 'connected' });
    });
  });

  describe('resumeRedirectConnect()', () => {
    it("intent 'connect' → creates a new ok connection from the redeemed token", async () => {
      completeCalendarRedirectAuth.mockResolvedValue(connected);
      const store = useCalendarSyncStore();

      const result = await store.resumeRedirectConnect('connect');

      expect(result).toMatchObject({ status: 'connected' });
      expect(store.connections).toHaveLength(1);
      expect(store.connections[0]).toMatchObject({ status: 'ok', refreshToken: 'rt-new' });
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
    });
  });
});
