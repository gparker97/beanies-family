/**
 * `createGoogleTokenProvider` — dedupe + permanent-failure latch.
 *
 * Regression suite for the 2026-07-09 calendar refresh storm: with a dead
 * refresh token, every queued calendar op (`eventExists`, `insertEvent`,
 * `deleteEvent`) independently re-asked Google about the same token, producing
 * HUNDREDS of `POST /oauth/google/refresh` 400s per page load. `googleAuth` had
 * dedupe + a permanent short-circuit all along; the calendar client did not.
 *
 * See docs/plans/2026-07-09-drive-refresh-token-telemetry-and-calendar-storm.md
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createGoogleTokenProvider } from '../googleCalendarClient';
import { CalendarApiError } from '../CalendarClient';

const CONNECTION_ID = 'conn-1';
const OTHER_CONNECTION_ID = 'conn-2';

vi.mock('@/services/automerge/repositories/calendarRepository', () => ({
  getCalendarConnectionById: vi.fn(async (id: string) => ({
    id,
    refreshToken: 'stored-refresh-token',
  })),
  updateCalendarConnection: vi.fn(async () => {}),
}));

vi.mock('../calendarAuth', () => ({
  refreshCalendarToken: vi.fn(),
}));

const REVOKED = 'invalid_grant — Token has been expired or revoked.';

async function refreshMock() {
  const { refreshCalendarToken } = await import('../calendarAuth');
  return vi.mocked(refreshCalendarToken);
}

/** Swallow the rejection so `expect(...).rejects` isn't required at every call. */
const settle = (p: Promise<unknown>) => p.then(() => 'ok' as const).catch((e) => e);

describe('createGoogleTokenProvider', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    (await refreshMock()).mockResolvedValue({
      access_token: 'access-1',
      expires_in: 3600,
    } as never);
  });

  describe('in-flight dedupe', () => {
    it('coalesces concurrent callers onto ONE refresh', async () => {
      const provider = createGoogleTokenProvider();

      const tokens = await Promise.all(
        Array.from({ length: 20 }, () => provider.getAccessToken(CONNECTION_ID))
      );

      expect(tokens.every((t) => t === 'access-1')).toBe(true);
      expect(await refreshMock()).toHaveBeenCalledTimes(1);
    });

    it('does not coalesce across different connections', async () => {
      const provider = createGoogleTokenProvider();

      await Promise.all([
        provider.getAccessToken(CONNECTION_ID),
        provider.getAccessToken(OTHER_CONNECTION_ID),
      ]);

      expect(await refreshMock()).toHaveBeenCalledTimes(2);
    });

    it('serves the cached token without a second refresh', async () => {
      const provider = createGoogleTokenProvider();

      await provider.getAccessToken(CONNECTION_ID);
      await provider.getAccessToken(CONNECTION_ID);

      expect(await refreshMock()).toHaveBeenCalledTimes(1);
    });
  });

  describe('permanent-failure latch', () => {
    it('hits the OAuth proxy exactly ONCE for a revoked token, however many callers', async () => {
      (await refreshMock()).mockRejectedValue(new Error(REVOKED));
      const provider = createGoogleTokenProvider();

      // 20 concurrent (one flight) …
      const concurrent = await Promise.all(
        Array.from({ length: 20 }, () => settle(provider.getAccessToken(CONNECTION_ID)))
      );
      // … then 20 sequential (all latched).
      for (let i = 0; i < 20; i++) await settle(provider.getAccessToken(CONNECTION_ID));

      // THE regression: before the latch this was 40 network calls.
      expect(await refreshMock()).toHaveBeenCalledTimes(1);
      for (const result of concurrent) {
        expect(result).toBeInstanceOf(CalendarApiError);
        expect((result as CalendarApiError).kind).toBe('auth');
      }
    });

    it('re-throws the classified auth error on the fast-fail path (never swallows)', async () => {
      (await refreshMock()).mockRejectedValue(new Error(REVOKED));
      const provider = createGoogleTokenProvider();

      await settle(provider.getAccessToken(CONNECTION_ID)); // latch it
      const latched = await settle(provider.getAccessToken(CONNECTION_ID));

      // The reconcile engine routes on `kind === 'auth'` → needs_reconnect.
      expect(latched).toBeInstanceOf(CalendarApiError);
      expect((latched as CalendarApiError).kind).toBe('auth');
      // And the short-circuit is visible to a developer.
      expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('skipping token refresh'));
    });

    it('latches per connection — a dead conn-1 does not block conn-2', async () => {
      const refresh = await refreshMock();
      refresh.mockImplementation(async (token: string) => {
        void token;
        throw new Error(REVOKED);
      });
      const provider = createGoogleTokenProvider();
      await settle(provider.getAccessToken(CONNECTION_ID));

      refresh.mockResolvedValue({ access_token: 'access-2', expires_in: 3600 } as never);
      await expect(provider.getAccessToken(OTHER_CONNECTION_ID)).resolves.toBe('access-2');
    });

    it('does NOT latch a transient failure — it stays retryable', async () => {
      const refresh = await refreshMock();
      refresh.mockRejectedValueOnce(new Error('Failed to fetch'));
      const provider = createGoogleTokenProvider();

      const first = await settle(provider.getAccessToken(CONNECTION_ID));
      expect((first as CalendarApiError).kind).toBe('transient');

      // A brief network blip must not strand the connection until reconnect.
      refresh.mockResolvedValue({ access_token: 'access-2', expires_in: 3600 } as never);
      await expect(provider.getAccessToken(CONNECTION_ID)).resolves.toBe('access-2');
      expect(refresh).toHaveBeenCalledTimes(2);
    });

    it('invalidate() clears the latch so a reconnect can recover', async () => {
      const refresh = await refreshMock();
      refresh.mockRejectedValue(new Error(REVOKED));
      const provider = createGoogleTokenProvider();
      await settle(provider.getAccessToken(CONNECTION_ID));

      // Simulate a successful reconnect: new refresh token, latch cleared.
      refresh.mockResolvedValue({ access_token: 'access-fresh', expires_in: 3600 } as never);
      provider.invalidate(CONNECTION_ID);

      await expect(provider.getAccessToken(CONNECTION_ID)).resolves.toBe('access-fresh');
    });

    it('without invalidate(), a reconnect stays bricked (guards the wiring)', async () => {
      const refresh = await refreshMock();
      refresh.mockRejectedValue(new Error(REVOKED));
      const provider = createGoogleTokenProvider();
      await settle(provider.getAccessToken(CONNECTION_ID));

      // Token is healthy again at Google, but nobody cleared the latch.
      refresh.mockResolvedValue({ access_token: 'access-fresh', expires_in: 3600 } as never);
      const stillDead = await settle(provider.getAccessToken(CONNECTION_ID));

      expect(stillDead).toBeInstanceOf(CalendarApiError);
      // This is why `calendarSyncStore.reconnect()` MUST call invalidateConnection.
      expect(refresh).toHaveBeenCalledTimes(1);
    });
  });
});
