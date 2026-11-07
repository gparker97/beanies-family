/**
 * flightStatusApi (#143): the request it sends (flight number and date only), the answer
 * shape it accepts, and how every failure is classified. `fetch` is stubbed; the env is
 * stubbed per test (read at call time).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  FLIGHT_STATUS_TIMEOUT_MS,
  FlightStatusApiError,
  fetchFlightLegs,
  isFlightStatusConfigured,
} from '../flightStatusApi';
import { RemoteFetchError } from '@/services/remoteFetchError';
import { WeatherFetchError } from '@/services/weather/openMeteo';
import { makeLeg } from '@/utils/flightStatus/__tests__/fixtures';

const URL_ = 'https://api.example.test/flight-status';
const fetchMock = vi.fn();

function respond(status: number, body: unknown): Response {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function failure(p: Promise<unknown>): Promise<FlightStatusApiError> {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(FlightStatusApiError);
    return e as FlightStatusApiError;
  }
  throw new Error('expected a rejection');
}

const ask = (signal?: AbortSignal) =>
  fetchFlightLegs({ flight: 'SQ318', date: '2026-12-13', signal });

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  vi.stubEnv('VITE_FLIGHT_STATUS_URL', URL_);
  vi.stubEnv('VITE_FLIGHT_STATUS_API_KEY', 'soft-key');
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe('configuration', () => {
  it('not_configured when either value is unset, without a request', async () => {
    vi.stubEnv('VITE_FLIGHT_STATUS_API_KEY', '');
    expect(isFlightStatusConfigured()).toBe(false);
    expect((await failure(ask())).code).toBe('not_configured');
    vi.stubEnv('VITE_FLIGHT_STATUS_API_KEY', 'soft-key');
    vi.stubEnv('VITE_FLIGHT_STATUS_URL', ' ');
    expect((await failure(ask())).code).toBe('not_configured');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('the request', () => {
  it('POSTs only the flight number and date, with the soft key', async () => {
    fetchMock.mockResolvedValue(respond(200, { legs: [], fetchedAt: 'x', cached: false }));
    await ask();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(URL_);
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({ 'Content-Type': 'application/json', 'x-api-key': 'soft-key' });
    expect(JSON.parse(init.body)).toEqual({ flight: 'SQ318', date: '2026-12-13' });
    expect(init.signal).toBeDefined();
  });
});

describe('the answer', () => {
  it('returns the legs, fetchedAt and cached', async () => {
    const leg = makeLeg({});
    fetchMock.mockResolvedValue(
      respond(200, { legs: [leg], fetchedAt: '2026-12-12T09:00:00Z', cached: true })
    );
    expect(await ask()).toEqual({ legs: [leg], fetchedAt: '2026-12-12T09:00:00Z', cached: true });
  });

  it('an empty answer is a valid answer', async () => {
    fetchMock.mockResolvedValue(respond(200, { legs: [], fetchedAt: 'x', cached: false }));
    expect((await ask()).legs).toEqual([]);
  });

  it.each([
    ['not JSON', 'oops'],
    ['no legs', { fetchedAt: 'x' }],
    ['a malformed leg', { legs: [{ number: 'SQ 318' }] }],
  ])('parse for %s', async (_name, body) => {
    fetchMock.mockResolvedValue(respond(200, body));
    expect((await failure(ask())).code).toBe('parse');
  });
});

describe('failures', () => {
  it.each([
    [400, 'bad_flight', 'http_4xx'],
    [401, 'unauthorized', 'http_4xx'],
    [429, 'rate_limited', 'rate_limited'],
    [503, 'budget_exhausted', 'rate_limited'],
    [503, 'upstream_rate_limited', 'rate_limited'],
    [504, 'upstream_timeout', 'http_5xx'],
    [502, 'upstream_auth', 'http_5xx'],
    [500, 'internal_error', 'http_5xx'],
  ])('HTTP %d %s → %s', async (status, code, want) => {
    fetchMock.mockResolvedValue(respond(status, { error: 'x', code }));
    const e = await failure(ask());
    expect(e.code).toBe(want);
    expect(e.httpStatus).toBe(status);
    expect(e.lambdaCode).toBe(code);
  });

  it('an unknown code, or none, is classified by status', async () => {
    fetchMock.mockResolvedValue(respond(502, { code: 'something_new' }));
    expect((await failure(ask())).code).toBe('http_5xx');
    fetchMock.mockResolvedValue(respond(429, 'not json'));
    expect((await failure(ask())).code).toBe('rate_limited');
    fetchMock.mockResolvedValue(respond(404, { code: 'toString' }));
    expect((await failure(ask())).code).toBe('http_4xx');
  });

  it('network', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    expect((await failure(ask())).code).toBe('network');
  });

  it('timeout: our own deadline', async () => {
    vi.useFakeTimers();
    // The feature-detect fallback (old WebKit), whose deadline is a plain faked setTimeout.
    vi.stubGlobal('AbortSignal', class {});
    fetchMock.mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_res, rej) =>
          init.signal!.addEventListener('abort', () => rej(init.signal!.reason))
        )
    );
    const p = failure(ask());
    await vi.advanceTimersByTimeAsync(FLIGHT_STATUS_TIMEOUT_MS + 1);
    expect((await p).code).toBe('timeout');
  });

  it('aborted: the caller moved on', async () => {
    const controller = new AbortController();
    fetchMock.mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_res, rej) =>
          init.signal!.addEventListener('abort', () => rej(new DOMException('x', 'AbortError')))
        )
    );
    const p = failure(ask(controller.signal));
    controller.abort();
    expect((await p).code).toBe('aborted');
  });
});

describe('the shared error class', () => {
  it('both services extend RemoteFetchError, and instanceof stays per service', () => {
    const f = new FlightStatusApiError('timeout', 'hint');
    const w = new WeatherFetchError('timeout', 'hint', 504);
    expect(f).toBeInstanceOf(RemoteFetchError);
    expect(w).toBeInstanceOf(RemoteFetchError);
    expect(f).not.toBeInstanceOf(WeatherFetchError);
    expect(w).not.toBeInstanceOf(FlightStatusApiError);
    expect(f.name).toBe('FlightStatusApiError');
    expect(w.name).toBe('WeatherFetchError');
    expect(w.message).toBe('weather request failed: timeout (HTTP 504)');
    expect(f.service).toBe('flight-status');
  });
});
