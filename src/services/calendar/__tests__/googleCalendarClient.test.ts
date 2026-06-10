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
