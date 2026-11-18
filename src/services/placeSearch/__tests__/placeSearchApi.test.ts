/**
 * placeSearchApi (#150): the request bodies it sends (no family data), the answer shapes it
 * accepts, and how every failure is classified. `fetch` and the env are stubbed per test.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PLACE_SEARCH_TIMEOUT_MS,
  PlaceSearchApiError,
  fetchPlaceAddress,
  isPlaceSearchConfigured,
  suggestPlaces,
} from '../placeSearchApi';
import { RemoteFetchError } from '@/services/remoteFetchError';

const BASE = 'https://api.example.test/place-search';
const fetchMock = vi.fn();

function respond(status: number, body: unknown): Response {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function failure(p: Promise<unknown>): Promise<PlaceSearchApiError> {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(PlaceSearchApiError);
    return e as PlaceSearchApiError;
  }
  throw new Error('expected a rejection');
}

const ROW = { placeId: 'ChIJabc_1-x', main: '127 South Bridge Road', secondary: 'Singapore' };

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  vi.stubEnv('VITE_PLACE_SEARCH_URL', `${BASE}/`);
  vi.stubEnv('VITE_PLACE_SEARCH_API_KEY', 'soft-key');
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('suggestPlaces', () => {
  it('posts only q, lang and the bias to <base>/suggest with the soft key', async () => {
    fetchMock.mockResolvedValue(respond(200, { suggestions: [ROW] }));
    const rows = await suggestPlaces({
      q: '127 south',
      lang: 'en',
      bias: { lat: 1.29, lon: 103.85, countryCode: 'SG' },
    });
    expect(rows).toEqual([ROW]);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(`${BASE}/suggest`);
    expect(init.method).toBe('POST');
    expect(init.headers['x-api-key']).toBe('soft-key');
    expect(JSON.parse(init.body)).toEqual({
      q: '127 south',
      lang: 'en',
      bias: { lat: 1.29, lon: 103.85, countryCode: 'SG' },
    });
  });

  it('omits the bias entirely when there is none', async () => {
    fetchMock.mockResolvedValue(respond(200, { suggestions: [] }));
    expect(await suggestPlaces({ q: 'abc', lang: 'zh' })).toEqual([]);
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body)).toEqual({ q: 'abc', lang: 'zh' });
  });

  it('drops any extra field a row carries', async () => {
    fetchMock.mockResolvedValue(respond(200, { suggestions: [{ ...ROW, extra: 'x' }] }));
    expect(await suggestPlaces({ q: 'abc', lang: 'en' })).toEqual([ROW]);
  });

  it.each([
    ['no suggestions array', { rows: [] }],
    ['a row with a bad place id', { suggestions: [{ ...ROW, placeId: 'a/b' }] }],
    ['a row with no main text', { suggestions: [{ ...ROW, main: ' ' }] }],
    ['a row with no secondary string', { suggestions: [{ placeId: 'p', main: 'm' }] }],
    ['an array body', [ROW]],
    ['not JSON', 'oops'],
  ])('an unexpected 200 (%s) is parse, never an empty list', async (_label, body) => {
    fetchMock.mockResolvedValue(respond(200, body));
    expect((await failure(suggestPlaces({ q: 'abc', lang: 'en' }))).code).toBe('parse');
  });

  it('unset env is not_configured, naming both variables, and sends nothing', async () => {
    vi.stubEnv('VITE_PLACE_SEARCH_API_KEY', '');
    expect(isPlaceSearchConfigured()).toBe(false);
    const err = await failure(suggestPlaces({ q: 'abc', lang: 'en' }));
    expect(err.code).toBe('not_configured');
    expect(err.devHint).toContain('VITE_PLACE_SEARCH_URL');
    expect(err.devHint).toContain('VITE_PLACE_SEARCH_API_KEY');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('error classification', () => {
  it('keeps the Lambda code, its status, a dev hint and retryAfterSeconds', async () => {
    fetchMock.mockResolvedValue(
      respond(503, { error: 'x', code: 'budget_exhausted', retryAfterSeconds: 3600 })
    );
    const err = await failure(suggestPlaces({ q: 'abc', lang: 'en' }));
    expect(err).toBeInstanceOf(RemoteFetchError);
    expect(err.name).toBe('PlaceSearchApiError');
    expect(err.code).toBe('budget_exhausted');
    expect(err.httpStatus).toBe(503);
    expect(err.retryAfterSeconds).toBe(3600);
    expect(err.devHint).toContain('00:00 UTC');
  });

  it('unauthorized names the two keys that must match', async () => {
    fetchMock.mockResolvedValue(respond(401, { code: 'unauthorized' }));
    const err = await failure(suggestPlaces({ q: 'abc', lang: 'en' }));
    expect(err.devHint).toContain("Lambda's PLACE_SEARCH_API_KEY");
  });

  it.each([
    [429, 'rate_limited'],
    [502, 'http_5xx'],
    [403, 'http_4xx'],
  ])('HTTP %i with no recognised code is %s', async (status, code) => {
    fetchMock.mockResolvedValue(respond(status, { code: 'something_new' }));
    expect((await failure(suggestPlaces({ q: 'abc', lang: 'en' }))).code).toBe(code);
  });

  it('a network failure is network', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    expect((await failure(suggestPlaces({ q: 'abc', lang: 'en' }))).code).toBe('network');
  });

  it("the caller's abort is aborted", async () => {
    const caller = new AbortController();
    fetchMock.mockImplementation(
      (_u: string, init: RequestInit) =>
        new Promise((_r, reject) =>
          init.signal!.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError'))
          )
        )
    );
    const pending = failure(suggestPlaces({ q: 'abc', lang: 'en', signal: caller.signal }));
    caller.abort();
    expect((await pending).code).toBe('aborted');
  });

  it('our own deadline is timeout', async () => {
    vi.useFakeTimers();
    try {
      // The feature-detect fallback, whose deadline is a plain faked setTimeout.
      vi.stubGlobal('AbortSignal', class {});
      fetchMock.mockImplementation(
        (_u: string, init: RequestInit) =>
          new Promise((_r, reject) =>
            init.signal!.addEventListener('abort', () => reject(init.signal!.reason))
          )
      );
      const pending = failure(suggestPlaces({ q: 'abc', lang: 'en' }));
      await vi.advanceTimersByTimeAsync(PLACE_SEARCH_TIMEOUT_MS + 1);
      expect((await pending).code).toBe('timeout');
    } finally {
      vi.useRealTimers();
    }
  });

  it('an already-aborted signal sends nothing', async () => {
    const caller = new AbortController();
    caller.abort();
    expect(
      (await failure(suggestPlaces({ q: 'abc', lang: 'en', signal: caller.signal }))).code
    ).toBe('aborted');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('fetchPlaceAddress', () => {
  it('posts only placeId and lang to <base>/resolve and returns the trimmed address', async () => {
    fetchMock.mockResolvedValue(
      respond(200, { placeId: ROW.placeId, address: ' 127 S Bridge Rd, Singapore 058285 ' })
    );
    expect(await fetchPlaceAddress({ placeId: ROW.placeId, lang: 'en' })).toEqual({
      placeId: ROW.placeId,
      address: '127 S Bridge Rd, Singapore 058285',
    });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(`${BASE}/resolve`);
    expect(JSON.parse(init.body)).toEqual({ placeId: ROW.placeId, lang: 'en' });
  });

  it.each([
    ['another place id', { placeId: 'other', address: 'x' }],
    ['an empty address', { placeId: ROW.placeId, address: ' ' }],
    ['no address', { placeId: ROW.placeId }],
  ])('%s is parse', async (_label, body) => {
    fetchMock.mockResolvedValue(respond(200, body));
    expect((await failure(fetchPlaceAddress({ placeId: ROW.placeId, lang: 'en' }))).code).toBe(
      'parse'
    );
  });
});
