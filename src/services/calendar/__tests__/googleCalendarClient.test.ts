import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createGoogleCalendarClient } from '../googleCalendarClient';
import { CalendarApiError, type TokenProvider } from '../CalendarClient';
import type { GoogleEventResource } from '@/utils/calendar/activityToGoogleEvent';

/** Minimal valid event resource — the REST client doesn't inspect it. */
const RESOURCE: GoogleEventResource = {
  summary: 'x',
  start: { date: '2026-06-10' },
  end: { date: '2026-06-11' },
  recurrence: [],
  reminders: { useDefault: false, overrides: [] },
  status: 'confirmed',
};

/** A token provider that mints a fresh token each call and counts invalidations. */
function makeTokenProvider() {
  let mints = 0;
  const invalidated: string[] = [];
  const provider: TokenProvider = {
    async getAccessToken() {
      mints++;
      return `token-${mints}`;
    },
    invalidate(connectionId: string) {
      invalidated.push(connectionId);
    },
  };
  return { provider, getMints: () => mints, invalidated };
}

/** A token provider whose mint always throws `err`, counting mint attempts. */
function makeThrowingTokenProvider(err: unknown) {
  let mints = 0;
  const provider: TokenProvider = {
    async getAccessToken() {
      mints++;
      throw err;
    },
    invalidate() {},
  };
  return { provider, getMints: () => mints };
}

function jsonResponse(status: number, body: unknown = {}): Response {
  return { status, ok: status >= 200 && status < 300, json: async () => body } as Response;
}

describe('googleCalendarClient authedFetch — 401 handling (F4)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('re-mints and retries once on a single 401, then succeeds', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(401))
      .mockResolvedValueOnce(jsonResponse(200, { id: 'evt' }));
    vi.stubGlobal('fetch', fetchMock);

    const { provider, getMints, invalidated } = makeTokenProvider();
    const client = createGoogleCalendarClient(provider);

    await expect(client.insertEvent('conn-1', 'primary', 'evt', RESOURCE)).resolves.toBeUndefined();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(getMints()).toBe(2); // re-minted after the cached token was invalidated
    expect(invalidated).toContain('conn-1');
  });

  it('throws a classified auth error when the 401 persists after the one-shot retry', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(401));
    vi.stubGlobal('fetch', fetchMock);

    const { provider } = makeTokenProvider();
    const client = createGoogleCalendarClient(provider);

    await expect(client.insertEvent('conn-1', 'primary', 'evt', RESOURCE)).rejects.toMatchObject({
      kind: 'auth',
    });

    // Original attempt + one re-mint retry = 2 calls; no further retries for auth.
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('classifies a CalendarApiError instance with the auth kind', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(401));
    vi.stubGlobal('fetch', fetchMock);

    const { provider } = makeTokenProvider();
    const client = createGoogleCalendarClient(provider);

    await client
      .insertEvent('conn-1', 'primary', 'evt', RESOURCE)
      .then(() => {
        throw new Error('expected rejection');
      })
      .catch((e) => {
        expect(e).toBeInstanceOf(CalendarApiError);
        expect((e as CalendarApiError).kind).toBe('auth');
      });
  });
});

describe('googleCalendarClient authedFetch — mint-failure kind preservation (2026-07-08)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("surfaces a dead refresh token as 'auth' (not 'transient') and does NOT retry", async () => {
    // The token mint throws the classified auth error the real provider raises for
    // a revoked grant. Pre-fix this was clobbered to 'transient' and retried 3×,
    // hiding the reconnect signal from settleConnectionStatus.
    const authErr = new CalendarApiError(
      'auth',
      'token refresh failed: Token refresh failed: Token has been expired or revoked.'
    );
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const { provider, getMints } = makeThrowingTokenProvider(authErr);
    const client = createGoogleCalendarClient(provider);

    await expect(client.insertEvent('conn-1', 'primary', 'evt', RESOURCE)).rejects.toMatchObject({
      kind: 'auth',
    });

    // Exactly one mint attempt — a dead refresh token is not retried into life.
    expect(getMints()).toBe(1);
    // The request never reached the network (the mint failed first).
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("retries a 'transient' mint failure across the backoff budget, then throws 'transient'", async () => {
    vi.useFakeTimers();
    const transientErr = new CalendarApiError('transient', 'refresh proxy 503');
    const { provider, getMints } = makeThrowingTokenProvider(transientErr);
    const client = createGoogleCalendarClient(provider);

    const p = client.insertEvent('conn-1', 'primary', 'evt', RESOURCE);
    const assertion = expect(p).rejects.toMatchObject({ kind: 'transient' });
    await vi.runAllTimersAsync();
    await assertion;

    // Initial attempt + 2 backoff retries (RETRY_BACKOFF_MS has length 2) = 3 mints.
    expect(getMints()).toBe(3);
  });

  it("wraps a raw network throw from fetch as 'transient' and retries (unchanged)", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockRejectedValue(new Error('network down'));
    vi.stubGlobal('fetch', fetchMock);

    const { provider } = makeTokenProvider(); // mint succeeds; fetch is what fails
    const client = createGoogleCalendarClient(provider);

    const p = client.insertEvent('conn-1', 'primary', 'evt', RESOURCE);
    const assertion = expect(p).rejects.toMatchObject({ kind: 'transient' });
    await vi.runAllTimersAsync();
    await assertion;

    // Initial attempt + 2 backoff retries = 3 fetches for a raw network transient.
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});

describe('googleCalendarClient authedFetch — HTTP 400 classification + reason capture (2026-08-29)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("classifies a 400 as 'invalid', never retries, and surfaces Google's reason", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(400, {
        error: {
          message: 'Invalid value for: recurrence',
          errors: [{ reason: 'invalidParameter' }],
        },
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    const { provider } = makeTokenProvider();
    const client = createGoogleCalendarClient(provider);

    await expect(
      client.patchEventFields('conn-1', 'primary', 'inst_1', { status: 'cancelled' })
    ).rejects.toMatchObject({
      kind: 'invalid',
      status: 400,
      message: expect.stringContaining('invalidParameter: Invalid value for: recurrence'),
    });

    // Deterministic rejection — retrying the same body is pointless.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("a 400 whose body is unreadable still classifies 'invalid' with the bare status", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 400,
      ok: false,
      json: async () => {
        throw new Error('not json');
      },
    } as unknown as Response);
    vi.stubGlobal('fetch', fetchMock);

    const { provider } = makeTokenProvider();
    const client = createGoogleCalendarClient(provider);

    await expect(
      client.patchEventFields('conn-1', 'primary', 'inst_1', { status: 'cancelled' })
    ).rejects.toMatchObject({ kind: 'invalid', message: 'Google Calendar HTTP 400' });
  });
});
