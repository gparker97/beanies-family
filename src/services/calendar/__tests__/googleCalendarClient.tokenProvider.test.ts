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
import {
  createCredentialResolver,
  createGoogleTokenProvider,
  DEFAULT_CREDENTIAL_SOURCES,
} from '../googleCalendarClient';
import { CalendarApiError } from '../CalendarClient';
import { pendingCredential, type PendingCalendarCredential } from '../pendingCredential';

const CONNECTION_ID = 'conn-1';
const OTHER_CONNECTION_ID = 'conn-2';
const PENDING_ID = 'pending-1';
const VIEW_ACCOUNT_ID = 'view-account-1';

const defaultConnectionLookup = async (id: string) =>
  ({ id, refreshToken: 'stored-refresh-token' }) as never;

vi.mock('@/services/automerge/repositories/calendarRepository', () => ({
  getCalendarConnectionById: vi.fn(async (id: string) => ({
    id,
    refreshToken: 'stored-refresh-token',
  })),
  updateCalendarConnection: vi.fn(async () => {}),
}));

// View-only accounts (plan 2026-11-17, P3): unknown by default, so every existing case
// resolves exactly as before; the view-account cases below opt in per test.
vi.mock('@/services/automerge/repositories/calendarViewRepository', () => ({
  getCalendarViewAccountById: vi.fn(async () => undefined),
  updateCalendarViewAccount: vi.fn(async () => {}),
}));

vi.mock('../calendarAuth', () => ({
  refreshCalendarToken: vi.fn(),
}));

const REVOKED = 'invalid_grant — Token has been expired or revoked.';

async function refreshMock() {
  const { refreshCalendarToken } = await import('../calendarAuth');
  return vi.mocked(refreshCalendarToken);
}

async function repoMock() {
  const repo = await import('@/services/automerge/repositories/calendarRepository');
  return {
    getCalendarConnectionById: vi.mocked(repo.getCalendarConnectionById),
    updateCalendarConnection: vi.mocked(repo.updateCalendarConnection),
  };
}

async function viewRepoMock() {
  const repo = await import('@/services/automerge/repositories/calendarViewRepository');
  return {
    getCalendarViewAccountById: vi.mocked(repo.getCalendarViewAccountById),
    updateCalendarViewAccount: vi.mocked(repo.updateCalendarViewAccount),
  };
}

function pending(overrides: Partial<PendingCalendarCredential> = {}): PendingCalendarCredential {
  return {
    id: PENDING_ID,
    kind: 'view',
    accountEmail: 'me@example.com',
    refreshToken: 'pending-refresh-token',
    grantedScopes: ['https://www.googleapis.com/auth/calendar.events.readonly'],
    ...overrides,
  };
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

    it('isPermanentlyFailed reads the latch: set only by a permanent failure, cleared by invalidate()', async () => {
      const refresh = await refreshMock();
      const provider = createGoogleTokenProvider();

      refresh.mockRejectedValueOnce(new Error('network down'));
      await settle(provider.getAccessToken(CONNECTION_ID));
      expect(provider.isPermanentlyFailed?.(CONNECTION_ID, 'stored-refresh-token')).toBe(false);

      refresh.mockRejectedValueOnce(new Error(REVOKED));
      await settle(provider.getAccessToken(CONNECTION_ID));
      expect(provider.isPermanentlyFailed?.(CONNECTION_ID, 'stored-refresh-token')).toBe(true);
      expect(provider.isPermanentlyFailed?.('other-connection', 'stored-refresh-token')).toBe(
        false
      );

      provider.invalidate(CONNECTION_ID);
      expect(provider.isPermanentlyFailed?.(CONNECTION_ID, 'stored-refresh-token')).toBe(false);
    });

    it('latches a dead PENDING credential the same way, keyed on its id', async () => {
      const { getCalendarConnectionById } = await repoMock();
      getCalendarConnectionById.mockResolvedValue(undefined as never);
      pendingCredential.set(pending());
      const refresh = await refreshMock();
      refresh.mockRejectedValue(new Error(REVOKED));
      const provider = createGoogleTokenProvider();

      await settle(provider.getAccessToken(PENDING_ID));
      await settle(provider.getAccessToken(PENDING_ID));

      expect(refresh).toHaveBeenCalledTimes(1);
      getCalendarConnectionById.mockImplementation(defaultConnectionLookup);
      pendingCredential.clear();
    });

    it('a NEW stored refresh token (a reconnect synced from another device) clears the latch without invalidate()', async () => {
      const { getCalendarConnectionById } = await repoMock();
      const refresh = await refreshMock();
      refresh.mockRejectedValue(new Error(REVOKED));
      const provider = createGoogleTokenProvider();
      await settle(provider.getAccessToken(CONNECTION_ID)); // latched on the old token
      expect(provider.isPermanentlyFailed?.(CONNECTION_ID, 'stored-refresh-token')).toBe(true);

      // Another device reconnected: only the synced record changed on this one.
      getCalendarConnectionById.mockImplementation(
        async (id: string) => ({ id, refreshToken: 'reconnected-token' }) as never
      );
      refresh.mockResolvedValue({ access_token: 'access-fresh', expires_in: 3600 } as never);

      expect(provider.isPermanentlyFailed?.(CONNECTION_ID, 'reconnected-token')).toBe(false);
      await expect(provider.getAccessToken(CONNECTION_ID)).resolves.toBe('access-fresh');
      expect(refresh).toHaveBeenLastCalledWith('reconnected-token');
      getCalendarConnectionById.mockImplementation(defaultConnectionLookup);
    });

    it('never serves an access token minted from a refresh token that has since been replaced', async () => {
      const { getCalendarConnectionById } = await repoMock();
      const refresh = await refreshMock();
      const provider = createGoogleTokenProvider();
      await expect(provider.getAccessToken(CONNECTION_ID)).resolves.toBe('access-1');

      getCalendarConnectionById.mockImplementation(
        async (id: string) => ({ id, refreshToken: 'replaced-token' }) as never
      );
      refresh.mockResolvedValue({ access_token: 'access-2', expires_in: 3600 } as never);

      await expect(provider.getAccessToken(CONNECTION_ID)).resolves.toBe('access-2');
      expect(refresh).toHaveBeenCalledTimes(2);
      getCalendarConnectionById.mockImplementation(defaultConnectionLookup);
    });

    it('a rotation does not force a second mint (the cache follows the rotated token)', async () => {
      const { getCalendarConnectionById, updateCalendarConnection } = await repoMock();
      let stored = 'stored-refresh-token';
      getCalendarConnectionById.mockImplementation(
        async (id: string) => ({ id, refreshToken: stored }) as never
      );
      updateCalendarConnection.mockImplementation(async (_id, patch) => {
        stored = (patch as { refreshToken: string }).refreshToken;
        return undefined as never;
      });
      const refresh = await refreshMock();
      refresh.mockResolvedValue({
        access_token: 'access-r',
        expires_in: 3600,
        refresh_token: 'rotated-token',
      } as never);
      const provider = createGoogleTokenProvider();

      await provider.getAccessToken(CONNECTION_ID);
      await provider.getAccessToken(CONNECTION_ID);

      expect(refresh).toHaveBeenCalledTimes(1);
      getCalendarConnectionById.mockImplementation(defaultConnectionLookup);
      updateCalendarConnection.mockImplementation(async () => undefined as never);
    });

    it('R8: a rotation whose write-back fails keeps the rotated token live: no old-token mint, no false latch, the write-back retried', async () => {
      const saved: string[] = [];
      let failSave = true;
      let stored = 'stored-refresh-token';
      const resolver = vi.fn(async () => ({
        refreshToken: stored,
        saveRotated: async (token: string) => {
          if (failSave) throw new Error('doc write failed');
          saved.push(token);
          stored = token;
        },
      }));
      const refresh = await refreshMock();
      // Google rotates, and from then on rejects the OLD token (as it may on rotation).
      refresh.mockImplementation(async (token: string) => {
        if (token === 'stored-refresh-token') {
          return {
            access_token: 'access-1',
            expires_in: 1,
            refresh_token: 'rotated-token',
          } as never;
        }
        if (token === 'rotated-token')
          return { access_token: 'access-2', expires_in: 3600 } as never;
        throw new Error(REVOKED);
      });
      const provider = createGoogleTokenProvider(resolver);

      // The first call succeeds although the write-back failed (the token in hand is good).
      await expect(provider.getAccessToken(CONNECTION_ID)).resolves.toBe('access-1');
      expect(saved).toEqual([]);

      // The access token expired: the next mint uses the ROTATED token, never the old one,
      // and the stored (old) token is not reported as dead.
      failSave = false;
      await expect(provider.getAccessToken(CONNECTION_ID)).resolves.toBe('access-2');
      expect(refresh.mock.calls.map(([t]) => t)).toEqual(['stored-refresh-token', 'rotated-token']);
      expect(provider.isPermanentlyFailed?.(CONNECTION_ID, 'stored-refresh-token')).toBe(false);
      // The write-back was retried and landed; the held rotation then retires.
      await vi.waitFor(() => expect(saved).toEqual(['rotated-token']));
      await expect(provider.getAccessToken(CONNECTION_ID)).resolves.toBe('access-2');
      expect(refresh).toHaveBeenCalledTimes(2);
      refresh.mockReset();
      refresh.mockResolvedValue({ access_token: 'access-1', expires_in: 3600 } as never);
    });

    it('R8: a held rotation never survives a reconnect (a different stored token wins)', async () => {
      let stored = 'stored-refresh-token';
      const resolver = vi.fn(async () => ({
        refreshToken: stored,
        saveRotated: async () => {
          throw new Error('doc write failed');
        },
      }));
      const refresh = await refreshMock();
      refresh.mockResolvedValueOnce({
        access_token: 'access-1',
        expires_in: 1,
        refresh_token: 'rotated-token',
      } as never);
      const provider = createGoogleTokenProvider(resolver);
      await provider.getAccessToken(CONNECTION_ID);

      stored = 'reconnected-token';
      refresh.mockResolvedValue({ access_token: 'access-r', expires_in: 3600 } as never);
      await expect(provider.getAccessToken(CONNECTION_ID)).resolves.toBe('access-r');
      expect(refresh).toHaveBeenLastCalledWith('reconnected-token');
      refresh.mockResolvedValue({ access_token: 'access-1', expires_in: 3600 } as never);
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

describe('credential resolver (view-only calendars, A3)', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    pendingCredential.clear();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    (await refreshMock()).mockResolvedValue({
      access_token: 'access-1',
      expires_in: 3600,
    } as never);
    (await repoMock()).getCalendarConnectionById.mockImplementation(defaultConnectionLookup);
    (await viewRepoMock()).getCalendarViewAccountById.mockResolvedValue(undefined);
  });

  it('connection hit: mints from the stored token and writes a rotation back to the connection', async () => {
    const refresh = await refreshMock();
    refresh.mockResolvedValue({
      access_token: 'access-1',
      expires_in: 3600,
      refresh_token: 'rotated-token',
    } as never);
    const provider = createGoogleTokenProvider();

    await expect(provider.getAccessToken(CONNECTION_ID)).resolves.toBe('access-1');

    expect(refresh).toHaveBeenCalledWith('stored-refresh-token');
    const { updateCalendarConnection } = await repoMock();
    expect(updateCalendarConnection).toHaveBeenCalledWith(CONNECTION_ID, {
      refreshToken: 'rotated-token',
    });
  });

  it('connection hit with an unchanged token writes nothing', async () => {
    (await refreshMock()).mockResolvedValue({
      access_token: 'access-1',
      expires_in: 3600,
      refresh_token: 'stored-refresh-token',
    } as never);
    await createGoogleTokenProvider().getAccessToken(CONNECTION_ID);
    expect((await repoMock()).updateCalendarConnection).not.toHaveBeenCalled();
  });

  it('pending hit: mints from the in-memory slot, and a rotation stays in the slot (no doc write)', async () => {
    const { getCalendarConnectionById, updateCalendarConnection } = await repoMock();
    getCalendarConnectionById.mockResolvedValue(undefined as never);
    pendingCredential.set(pending());
    const refresh = await refreshMock();
    refresh.mockResolvedValue({
      access_token: 'access-p',
      expires_in: 3600,
      refresh_token: 'pending-rotated',
    } as never);

    await expect(createGoogleTokenProvider().getAccessToken(PENDING_ID)).resolves.toBe('access-p');

    expect(refresh).toHaveBeenCalledWith('pending-refresh-token');
    expect(updateCalendarConnection).not.toHaveBeenCalled();
    expect(pendingCredential.peek()?.refreshToken).toBe('pending-rotated');
  });

  it('a pending rotation after the slot was taken does not bring the credential back', async () => {
    (await repoMock()).getCalendarConnectionById.mockResolvedValue(undefined as never);
    pendingCredential.set(pending());
    const handle = await createCredentialResolver()(PENDING_ID);
    pendingCredential.take();

    await handle!.saveRotated('late-rotation');

    expect(pendingCredential.peek()).toBeNull();
  });

  it('miss: neither a connection nor the pending slot knows the id', async () => {
    (await repoMock()).getCalendarConnectionById.mockResolvedValue(undefined as never);
    pendingCredential.set(pending()); // a DIFFERENT id is held
    const err = await settle(createGoogleTokenProvider().getAccessToken('nobody'));

    expect(err).toBeInstanceOf(CalendarApiError);
    expect((err as CalendarApiError).kind).toBe('unknown');
    expect(await refreshMock()).not.toHaveBeenCalled();
  });

  it('an injected resolver replaces the default lookups entirely', async () => {
    const saveRotated = vi.fn();
    const resolver = vi.fn(async () => ({ refreshToken: 'injected', saveRotated }));
    (await refreshMock()).mockResolvedValue({
      access_token: 'access-i',
      expires_in: 3600,
      refresh_token: 'injected-rotated',
    } as never);

    await createGoogleTokenProvider(resolver).getAccessToken('any-id');

    expect(resolver).toHaveBeenCalledWith('any-id');
    expect(saveRotated).toHaveBeenCalledWith('injected-rotated');
    expect((await repoMock()).getCalendarConnectionById).not.toHaveBeenCalled();
  });

  it('view-account hit: mints from the account record and writes a rotation back to it, never to a connection', async () => {
    const { getCalendarConnectionById, updateCalendarConnection } = await repoMock();
    getCalendarConnectionById.mockResolvedValue(undefined as never);
    const { getCalendarViewAccountById, updateCalendarViewAccount } = await viewRepoMock();
    getCalendarViewAccountById.mockResolvedValue({
      id: VIEW_ACCOUNT_ID,
      refreshToken: 'view-refresh-token',
    } as never);
    const refresh = await refreshMock();
    refresh.mockResolvedValue({
      access_token: 'access-v',
      expires_in: 3600,
      refresh_token: 'view-rotated',
    } as never);

    await expect(createGoogleTokenProvider().getAccessToken(VIEW_ACCOUNT_ID)).resolves.toBe(
      'access-v'
    );

    expect(getCalendarViewAccountById).toHaveBeenCalledWith(VIEW_ACCOUNT_ID);
    expect(refresh).toHaveBeenCalledWith('view-refresh-token');
    expect(updateCalendarViewAccount).toHaveBeenCalledWith(VIEW_ACCOUNT_ID, {
      refreshToken: 'view-rotated',
    });
    expect(updateCalendarConnection).not.toHaveBeenCalled();
  });

  it('view-account hit with an unchanged token writes nothing', async () => {
    (await repoMock()).getCalendarConnectionById.mockResolvedValue(undefined as never);
    const { getCalendarViewAccountById, updateCalendarViewAccount } = await viewRepoMock();
    getCalendarViewAccountById.mockResolvedValue({
      id: VIEW_ACCOUNT_ID,
      refreshToken: 'view-refresh-token',
    } as never);
    (await refreshMock()).mockResolvedValue({
      access_token: 'access-v',
      expires_in: 3600,
      refresh_token: 'view-refresh-token',
    } as never);
    await createGoogleTokenProvider().getAccessToken(VIEW_ACCOUNT_ID);
    expect(updateCalendarViewAccount).not.toHaveBeenCalled();
  });

  it('a connection hit answers before the view accounts are asked', async () => {
    await createGoogleTokenProvider().getAccessToken(CONNECTION_ID);
    expect((await viewRepoMock()).getCalendarViewAccountById).not.toHaveBeenCalled();
  });

  it('a view-account miss falls through to the pending slot', async () => {
    (await repoMock()).getCalendarConnectionById.mockResolvedValue(undefined as never);
    pendingCredential.set(pending());
    await createGoogleTokenProvider().getAccessToken(PENDING_ID);
    expect((await viewRepoMock()).getCalendarViewAccountById).toHaveBeenCalledWith(PENDING_ID);
    expect(await refreshMock()).toHaveBeenCalledWith('pending-refresh-token');
  });

  it('the default sources are connections, then view accounts, then pending', () => {
    expect(DEFAULT_CREDENTIAL_SOURCES.map((source) => source.name)).toEqual([
      'credentialFromConnections',
      'credentialFromViewAccounts',
      'credentialFromPending',
    ]);
  });
});
