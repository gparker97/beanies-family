/**
 * The Open-Meteo service (#134) against the 2026-10-16 spike fixtures, with `fetch` mocked:
 * the success paths, the request it builds (free vs customer endpoint, language, ZIP
 * narrowing, rounded coordinates), and every failure class with its developer hint.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import forecastPortland from '@/utils/weather/__tests__/fixtures/forecast-portland-or.json';
import forecastWellington from '@/utils/weather/__tests__/fixtures/forecast-wellington-nz.json';
import geocodePortland from '@/utils/weather/__tests__/fixtures/geocode-portland.json';
import geocode97201 from '@/utils/weather/__tests__/fixtures/geocode-97201.json';
import geocodeMiss from '@/utils/weather/__tests__/fixtures/geocode-miss.json';

const h = vi.hoisted(() => ({ native: false }));
vi.mock('@/services/sync/capabilities', () => ({ isNative: () => h.native }));

import {
  WEATHER_REQUEST_TIMEOUT_MS,
  WeatherFetchError,
  fetchForecast,
  searchPlaces,
} from '../openMeteo';

interface FakeResponse {
  ok: boolean;
  status: number;
  text: () => Promise<string>;
  json: () => Promise<unknown>;
}

function respond(body: unknown, status = 200): FakeResponse {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => text,
    json: async () => JSON.parse(text) as unknown,
  };
}

const fetchMock = vi.fn();

function lastUrl(): URL {
  return new URL(fetchMock.mock.calls.at(-1)![0] as string);
}

/** Run `fn` and return the `WeatherFetchError` it rejects with. */
async function failure(fn: () => Promise<unknown>): Promise<WeatherFetchError> {
  try {
    await fn();
  } catch (e) {
    expect(e).toBeInstanceOf(WeatherFetchError);
    const err = e as WeatherFetchError;
    expect(err.devHint.length).toBeGreaterThan(0);
    return err;
  }
  throw new Error('expected a rejection');
}

const forecast = () => fetchForecast({ lat: 45.52, lon: -122.68 }, 'America/Los_Angeles');

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  h.native = false;
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe('fetchForecast', () => {
  it('maps the Portland fixture to an observation, keyed by the home-zone dates', async () => {
    fetchMock.mockResolvedValue(respond(forecastPortland));
    const before = Date.now();
    const obs = await forecast();
    expect(obs.fetchedAt).toBeGreaterThanOrEqual(before);
    expect(obs.current).toEqual({ tempC: 16.9, code: 0, isDay: false });
    expect(obs.daily).toHaveLength(5);
    expect(obs.daily[1]).toEqual({ ymd: '2026-10-16', code: 3, maxC: 25.1, minC: 13.4 });
  });

  it('reads is_day 1 as day (Wellington fixture)', async () => {
    fetchMock.mockResolvedValue(respond(forecastWellington));
    const obs = await fetchForecast({ lat: -41.29, lon: 174.78 }, 'Pacific/Auckland');
    expect(obs.current).toEqual({ tempC: 9.1, code: 2, isDay: true });
  });

  it('asks the FREE endpoint for current + 5 home-zone days with rounded coordinates', async () => {
    fetchMock.mockResolvedValue(respond(forecastPortland));
    await fetchForecast({ lat: 45.523451, lon: -122.676219 }, 'America/Los_Angeles');
    const url = lastUrl();
    expect(url.origin).toBe('https://api.open-meteo.com');
    expect(url.pathname).toBe('/v1/forecast');
    expect(url.searchParams.get('latitude')).toBe('45.52');
    expect(url.searchParams.get('longitude')).toBe('-122.68');
    expect(url.searchParams.get('current')).toBe('temperature_2m,weather_code,is_day');
    expect(url.searchParams.get('daily')).toBe(
      'weather_code,temperature_2m_max,temperature_2m_min'
    );
    expect(url.searchParams.get('timezone')).toBe('America/Los_Angeles');
    expect(url.searchParams.get('forecast_days')).toBe('5');
    expect(url.searchParams.has('apikey')).toBe(false);
    // No custom headers, so no CORS preflight.
    expect(fetchMock.mock.calls[0]![1]).toEqual({ signal: expect.any(Object) });
  });

  it('uses the customer endpoint with &apikey= when a key is configured', async () => {
    vi.stubEnv('VITE_OPEN_METEO_API_KEY', 'test-key');
    fetchMock.mockResolvedValue(respond(forecastPortland));
    await forecast();
    expect(lastUrl().origin).toBe('https://customer-api.open-meteo.com');
    expect(lastUrl().searchParams.get('apikey')).toBe('test-key');
  });

  it('drops a day the model has no data for, rather than failing the reading', async () => {
    const body = structuredClone(forecastPortland) as unknown as {
      daily: { temperature_2m_max: Array<number | null> };
    };
    body.daily.temperature_2m_max[4] = null;
    fetchMock.mockResolvedValue(respond(body));
    const obs = await forecast();
    expect(obs.daily.map((d) => d.ymd)).toEqual([
      '2026-10-15',
      '2026-10-16',
      '2026-10-17',
      '2026-10-18',
    ]);
  });

  describe('failures', () => {
    it('401 is http_4xx with the key hint', async () => {
      fetchMock.mockResolvedValue(respond({ error: true, reason: 'bad key' }, 401));
      const err = await failure(forecast);
      expect(err.code).toBe('http_4xx');
      expect(err.httpStatus).toBe(401);
      expect(err.devHint).toContain('VITE_OPEN_METEO_API_KEY');
    });

    it('429 is rate_limited with the Standard-plan hint', async () => {
      fetchMock.mockResolvedValue(respond({ error: true, reason: 'limit' }, 429));
      const err = await failure(forecast);
      expect(err.code).toBe('rate_limited');
      expect(err.httpStatus).toBe(429);
      expect(err.devHint).toContain('Standard-plan');
    });

    it('400 carries the provider reason in the hint', async () => {
      fetchMock.mockResolvedValue(
        respond({ error: true, reason: 'Invalid timezone identifier' }, 400)
      );
      const err = await failure(forecast);
      expect(err.code).toBe('http_4xx');
      expect(err.devHint).toContain('Invalid timezone identifier');
    });

    it('500 is http_5xx', async () => {
      fetchMock.mockResolvedValue(respond('oops', 500));
      const err = await failure(forecast);
      expect(err.code).toBe('http_5xx');
      expect(err.httpStatus).toBe(500);
    });

    it('a request that never answers is a timeout at 10s', async () => {
      vi.useFakeTimers();
      // The feature-detect fallback (old WebKit), whose deadline is a plain faked setTimeout.
      vi.stubGlobal('AbortSignal', class {});
      fetchMock.mockImplementation(
        (_url: string, init: { signal: AbortSignal }) =>
          new Promise((_resolve, reject) => {
            init.signal.addEventListener('abort', () => reject(init.signal.reason));
          })
      );
      const pending = failure(forecast);
      await vi.advanceTimersByTimeAsync(WEATHER_REQUEST_TIMEOUT_MS);
      const err = await pending;
      expect(err.code).toBe('timeout');
    });

    it("the caller's abort is aborted (never a failure to show)", async () => {
      const caller = new AbortController();
      fetchMock.mockImplementation(
        (_url: string, init: { signal: AbortSignal }) =>
          new Promise((_resolve, reject) => {
            init.signal.addEventListener('abort', () =>
              reject(new DOMException('aborted', 'AbortError'))
            );
          })
      );
      const pending = failure(() => fetchForecast({ lat: 1, lon: 2 }, 'UTC', caller.signal));
      caller.abort();
      expect((await pending).code).toBe('aborted');
    });

    it('a network TypeError is network, with the CORS hint on native', async () => {
      fetchMock.mockRejectedValue(new TypeError('Load failed'));
      expect((await failure(forecast)).code).toBe('network');
      h.native = true;
      const native = await failure(forecast);
      expect(native.code).toBe('network');
      expect(native.devHint).toContain('CORS');
    });

    it('a body that is not JSON is parse, with the fixtures hint', async () => {
      fetchMock.mockResolvedValue(respond('<html>'));
      const err = await failure(forecast);
      expect(err.code).toBe('parse');
      expect(err.devHint).toContain('fixtures');
    });

    it.each([
      ['no current', { daily: forecastPortland.daily }],
      [
        'a non-finite temperature',
        { ...forecastPortland, current: { ...forecastPortland.current, temperature_2m: null } },
      ],
      [
        'a boolean is_day',
        { ...forecastPortland, current: { ...forecastPortland.current, is_day: true } },
      ],
      [
        'mismatched daily arrays',
        { ...forecastPortland, daily: { ...forecastPortland.daily, weather_code: [1, 2] } },
      ],
      [
        'no usable day',
        {
          ...forecastPortland,
          daily: { time: [], weather_code: [], temperature_2m_max: [], temperature_2m_min: [] },
        },
      ],
    ])('a malformed body (%s) is parse', async (_name, body) => {
      fetchMock.mockResolvedValue(respond(body));
      expect((await failure(forecast)).code).toBe('parse');
    });

    it('an abort while the body streams is a timeout, not parse', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        text: () => Promise.reject(new DOMException('The operation timed out.', 'TimeoutError')),
        json: () => Promise.reject(new Error('unused')),
      });
      expect((await failure(forecast)).code).toBe('timeout');
    });
  });
});

describe('searchPlaces', () => {
  it('maps the Portland fixture, rounding coordinates, keeping admin1 + country', async () => {
    fetchMock.mockResolvedValue(respond(geocodePortland));
    const places = await searchPlaces('Portland', 'en', 'US');
    expect(places).toHaveLength(6);
    expect(places[0]).toEqual({
      id: 5746545,
      name: 'Portland',
      admin1: 'Oregon',
      country: 'United States',
      countryCode: 'US',
      lat: 45.52,
      lon: -122.68,
    });
    expect(places[1]!.admin1).toBe('Maine');
    expect(places[3]!.name).toBe('Blue Island');
  });

  it('asks the free geocoder for 6 results in the app language, no countryCode for a name', async () => {
    fetchMock.mockResolvedValue(respond(geocodePortland));
    await searchPlaces('  Portland ', 'zh', 'US');
    const url = lastUrl();
    expect(url.origin).toBe('https://geocoding-api.open-meteo.com');
    expect(url.pathname).toBe('/v1/search');
    expect(url.searchParams.get('name')).toBe('Portland');
    expect(url.searchParams.get('count')).toBe('6');
    expect(url.searchParams.get('language')).toBe('zh');
    expect(url.searchParams.has('countryCode')).toBe(false);
  });

  it('narrows an all-digit (ZIP) query by the family country', async () => {
    fetchMock.mockResolvedValue(respond(geocode97201));
    const places = await searchPlaces('97201', 'en', 'us');
    expect(lastUrl().searchParams.get('countryCode')).toBe('US');
    expect(places.map((p) => p.id)).toEqual([5746545]);
  });

  it('uses the customer geocoder with a key', async () => {
    vi.stubEnv('VITE_OPEN_METEO_API_KEY', 'k');
    fetchMock.mockResolvedValue(respond(geocodeMiss));
    await searchPlaces('Portland', 'en', null);
    expect(lastUrl().origin).toBe('https://customer-geocoding-api.open-meteo.com');
    expect(lastUrl().searchParams.get('apikey')).toBe('k');
  });

  it('a miss (no results key) is an empty list', async () => {
    fetchMock.mockResolvedValue(respond(geocodeMiss));
    expect(await searchPlaces('Portlnad', 'en', null)).toEqual([]);
  });

  it('a query under 2 characters asks nothing', async () => {
    expect(await searchPlaces(' P ', 'en', null)).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('falls back to the country code without a country name, and drops a record with neither', async () => {
    fetchMock.mockResolvedValue(
      respond({
        results: [
          // Fort-de-France, MQ: neither admin1 nor country (spike finding).
          {
            id: 3570675,
            name: 'Fort-de-France',
            latitude: 14.60892,
            longitude: -61.07334,
            country_code: 'MQ',
          },
          { id: 1, name: 'Nowhere', latitude: 1, longitude: 2 },
          { id: 2, name: 'No coordinates', country: 'X' },
          { name: 'No id', latitude: 1, longitude: 2, country: 'X' },
        ],
      })
    );
    const places = await searchPlaces('Fort-de-France', 'en', null);
    expect(places).toEqual([
      {
        id: 3570675,
        name: 'Fort-de-France',
        country: 'MQ',
        countryCode: 'MQ',
        lat: 14.61,
        lon: -61.07,
      },
    ]);
  });

  it('a results value that is not a list is parse', async () => {
    fetchMock.mockResolvedValue(respond({ results: 'nope' }));
    expect((await failure(() => searchPlaces('Portland', 'en', null))).code).toBe('parse');
  });

  it('429 on the geocoder is rate_limited', async () => {
    fetchMock.mockResolvedValue(respond({ error: true }, 429));
    expect((await failure(() => searchPlaces('Portland', 'en', null))).code).toBe('rate_limited');
  });
});
