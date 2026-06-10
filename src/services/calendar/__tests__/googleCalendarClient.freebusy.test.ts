import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createGoogleCalendarClient } from '../googleCalendarClient';
import { type TokenProvider } from '../CalendarClient';

function makeTokenProvider() {
  let mints = 0;
  const provider: TokenProvider = {
    async getAccessToken() {
      mints++;
      return `token-${mints}`;
    },
    invalidate() {},
  };
  return { provider, getMints: () => mints };
}

function jsonResponse(status: number, body: unknown = {}): Response {
  return { status, ok: status >= 200 && status < 300, json: async () => body } as Response;
}

describe('googleCalendarClient.queryFreeBusy (#34)', () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it('POSTs the freeBusy body and parses busy per calendar', async () => {
    const busy = [{ start: '2026-06-10T14:00:00Z', end: '2026-06-10T15:00:00Z' }];
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { calendars: { primary: { busy } } }));
    vi.stubGlobal('fetch', fetchMock);

    const { provider } = makeTokenProvider();
    const client = createGoogleCalendarClient(provider);
    const result = await client.queryFreeBusy(
      'conn-1',
      ['primary'],
      '2026-06-10T00:00:00Z',
      '2026-06-11T00:00:00Z'
    );

    expect(result).toEqual({ primary: busy });
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('/freeBusy');
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body);
    expect(body).toEqual({
      timeMin: '2026-06-10T00:00:00Z',
      timeMax: '2026-06-11T00:00:00Z',
      items: [{ id: 'primary' }],
    });
  });

  it('throws a classified error when a calendar reports a per-calendar error (HTTP 200)', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(200, { calendars: { work: { errors: [{ reason: 'notFound' }] } } })
      );
    vi.stubGlobal('fetch', fetchMock);

    const { provider } = makeTokenProvider();
    const client = createGoogleCalendarClient(provider);
    await expect(client.queryFreeBusy('conn-1', ['work'], 't0', 't1')).rejects.toMatchObject({
      kind: 'not_found',
    });
  });

  it('maps accessDenied → forbidden', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(200, { calendars: { work: { errors: [{ reason: 'accessDenied' }] } } })
      );
    vi.stubGlobal('fetch', fetchMock);
    const { provider } = makeTokenProvider();
    const client = createGoogleCalendarClient(provider);
    await expect(client.queryFreeBusy('conn-1', ['work'], 't0', 't1')).rejects.toMatchObject({
      kind: 'forbidden',
    });
  });

  it('re-mints once on a transient 401 then succeeds (shared authedFetch path)', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(401))
      .mockResolvedValueOnce(jsonResponse(200, { calendars: { primary: { busy: [] } } }));
    vi.stubGlobal('fetch', fetchMock);

    const { provider, getMints } = makeTokenProvider();
    const client = createGoogleCalendarClient(provider);
    await expect(client.queryFreeBusy('conn-1', ['primary'], 't0', 't1')).resolves.toEqual({
      primary: [],
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(getMints()).toBe(2);
  });
});
