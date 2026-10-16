/**
 * Open-Meteo, called directly from the device (#134, ADR-043): the home-town geocoder and
 * the forecast. Pinia-free: only `weatherStore` calls this, and only the store decides what
 * an answer means, logs it, or retries (there are no retries in here).
 *
 * ENDPOINTS AND KEY. `VITE_OPEN_METEO_API_KEY` set = the "API Standard" customer endpoints
 * with `&apikey=`; unset or empty = the keyless free endpoints, which Open-Meteo licenses for
 * non-commercial use only. Moving to Standard is a configuration change, not a code change.
 * The key ships in the bundle, so it is NEVER logged, and neither is a URL that carries it.
 *
 * PRIVACY. Only the typed query (to find the town) and the town's coordinates rounded to two
 * decimals (about 1.1km) are ever sent. Nothing here reads the device's location.
 *
 * Every request carries `timeoutSignal` (10s), which feature-detects the abort-signal
 * combinators old WebKit lacks. Every failure is a typed `WeatherFetchError` whose `devHint`
 * is the developer's next step; the store prints it with the `[weather]` prefix.
 */
import type { LanguageCode, WeatherPlace } from '@/types/models';
import type { WeatherDaily, WeatherErrorCode, WeatherObservation } from '@/types/weather';
import { isNetworkError } from '@/utils/transientFailure';
import { timeoutSignal } from '@/utils/timing';
import { isNative } from '@/services/sync/capabilities';

/** One request's deadline. Measured p95 was about 1.1s on the free tier (2026-10-16 spike). */
export const WEATHER_REQUEST_TIMEOUT_MS = 10_000;
/** Today plus four days, so a reading taken before midnight still has today + 3 after it. */
export const FORECAST_DAYS = 5;
/** Suggestions shown under the home-town field. */
const SEARCH_COUNT = 6;
/** The geocoder matches exactly at 2 characters and fuzzily from 3. */
export const SEARCH_MIN_CHARS = 2;

const FREE_FORECAST = 'https://api.open-meteo.com';
const FREE_GEOCODING = 'https://geocoding-api.open-meteo.com';
const CUSTOMER_FORECAST = 'https://customer-api.open-meteo.com';
const CUSTOMER_GEOCODING = 'https://customer-geocoding-api.open-meteo.com';

const FIXTURES_HINT = 'compare with src/utils/weather/__tests__/fixtures';

/** A provider call that failed, classified. Only the service and the store import it. */
export class WeatherFetchError extends Error {
  readonly code: WeatherErrorCode;
  readonly httpStatus?: number;
  /** The developer's next step, for the console only (never the firehose). */
  readonly devHint: string;

  constructor(code: WeatherErrorCode, devHint: string, httpStatus?: number) {
    super(`weather request failed: ${code}${httpStatus ? ` (HTTP ${httpStatus})` : ''}`);
    // Literal string, never a class name: the prod build minifies class names.
    this.name = 'WeatherFetchError';
    this.code = code;
    this.httpStatus = httpStatus;
    this.devHint = devHint;
  }
}

/** Read at call time, so a test can stub the env and nothing caches a stale key. */
function apiKey(): string {
  return (import.meta.env.VITE_OPEN_METEO_API_KEY ?? '').trim();
}

function buildUrl(kind: 'forecast' | 'geocoding', path: string, params: Record<string, string>) {
  const key = apiKey();
  const base =
    kind === 'forecast'
      ? key
        ? CUSTOMER_FORECAST
        : FREE_FORECAST
      : key
        ? CUSTOMER_GEOCODING
        : FREE_GEOCODING;
  const url = new URL(path, base);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  if (key) url.searchParams.set('apikey', key);
  return url.toString();
}

/** Coordinates to 2 decimals: coarse location by Apple's definition, enough for a city. */
export function roundCoord(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Search for a home town. `lang` is the app's own `LanguageCode` (`en`/`zh`), which the
 * geocoder accepts as is and uses to localize names. `countryCode` narrows an all-digit
 * (ZIP/postcode) query; a name query is never narrowed, so a family can pick a town abroad.
 * A query under 2 characters, or a miss (no `results` key), is `[]`.
 */
export async function searchPlaces(
  query: string,
  lang: LanguageCode,
  countryCode: string | null,
  signal?: AbortSignal
): Promise<WeatherPlace[]> {
  const q = query.trim();
  if (q.length < SEARCH_MIN_CHARS) return [];
  const params: Record<string, string> = {
    name: q,
    count: String(SEARCH_COUNT),
    language: lang,
    format: 'json',
  };
  if (countryCode && /^\d+$/.test(q)) params.countryCode = countryCode.toUpperCase();
  const body = await getJson(buildUrl('geocoding', '/v1/search', params), signal);
  return parsePlaces(body);
}

/**
 * The forecast for a place in the family's home zone: current conditions plus `FORECAST_DAYS`
 * home-zone days, all Celsius. Returns only the provider's observation; the store stamps the
 * cache identity. The response echoes its grid cell, not the request, so nothing here keys on
 * the response's coordinates.
 */
export async function fetchForecast(
  coords: { lat: number; lon: number },
  zone: string,
  signal?: AbortSignal
): Promise<WeatherObservation> {
  const url = buildUrl('forecast', '/v1/forecast', {
    latitude: String(roundCoord(coords.lat)),
    longitude: String(roundCoord(coords.lon)),
    current: 'temperature_2m,weather_code,is_day',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min',
    timezone: zone,
    forecast_days: String(FORECAST_DAYS),
  });
  const body = await getJson(url, signal);
  return parseForecast(body, Date.now());
}

// ── Transport ────────────────────────────────────────────────────────────────

async function getJson(url: string, callerSignal?: AbortSignal): Promise<unknown> {
  const signal = timeoutSignal(WEATHER_REQUEST_TIMEOUT_MS, callerSignal);
  let res: Response;
  try {
    res = await fetch(url, { signal });
  } catch (e) {
    throw classifyThrown(e, signal, callerSignal, 'request');
  }
  if (!res.ok) throw await httpError(res);
  let text: string;
  try {
    text = await res.text();
  } catch (e) {
    // An abort landing while the BODY streams rejects here, not at the fetch: that is a slow
    // connection (`timeout`), not a broken response (the `recipeFetchService.post` rule).
    throw classifyThrown(e, signal, callerSignal, 'body');
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new WeatherFetchError('parse', `Response was not JSON: ${FIXTURES_HINT}`, res.status);
  }
}

function errorName(e: unknown): string {
  return typeof e === 'object' && e !== null && 'name' in e ? String((e as Error).name) : '';
}

/**
 * Classify a rejected fetch or body read. The CALLER's signal decides `aborted` (the person
 * kept typing, or the place changed): checked first, because an engine without abort reasons
 * reports every abort as a bare `AbortError`, whichever side fired. Any other abort is our
 * deadline (`timeout`).
 */
function classifyThrown(
  e: unknown,
  signal: AbortSignal,
  callerSignal: AbortSignal | undefined,
  phase: 'request' | 'body'
): WeatherFetchError {
  if (callerSignal?.aborted) return new WeatherFetchError('aborted', 'The caller cancelled it');
  const name = errorName(e);
  if (name === 'TimeoutError' || name === 'AbortError' || signal.aborted) {
    return new WeatherFetchError(
      'timeout',
      `No answer from Open-Meteo within ${WEATHER_REQUEST_TIMEOUT_MS / 1000}s ` +
        '(free-tier latency or a slow connection)'
    );
  }
  if (phase === 'body' && !isNetworkError(e)) {
    return new WeatherFetchError('parse', `Response body could not be read: ${FIXTURES_HINT}`);
  }
  return new WeatherFetchError(
    'network',
    isNative()
      ? "Check the spike's CORS result for this WebView origin"
      : 'The request never reached Open-Meteo (offline, DNS, or a CORS or content blocker)'
  );
}

async function httpError(res: Response): Promise<WeatherFetchError> {
  const status = res.status;
  // 429 is OBSERVED behaviour, not documented: Open-Meteo's docs describe only 400 with
  // `{ error: true, reason }`, but the free tier answers 429 over its limits. It is the
  // Standard-plan trigger, so it gets its own code and the hour-long backoff.
  if (status === 429) {
    return new WeatherFetchError(
      'rate_limited',
      'Quota reached: this is the Standard-plan trigger in ADR-043',
      status
    );
  }
  if (status === 401 || status === 403) {
    return new WeatherFetchError(
      'http_4xx',
      'Open-Meteo rejected the request: check VITE_OPEN_METEO_API_KEY and the plan status (ADR-043)',
      status
    );
  }
  if (status >= 500) {
    return new WeatherFetchError(
      'http_5xx',
      `Open-Meteo is failing (HTTP ${status}); the store backs off and retries`,
      status
    );
  }
  // The documented error shape: HTTP 400 with `{ error: true, reason }`. The reason is the
  // provider's own text about OUR request (a bad parameter), so it goes in the console hint.
  const reason = await providerReason(res);
  return new WeatherFetchError(
    'http_4xx',
    `Open-Meteo refused the request (HTTP ${status})${reason ? `: ${reason}` : ''}`,
    status
  );
}

/** The `reason` of an Open-Meteo error body, or '' when the body has none or cannot be read. */
async function providerReason(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { reason?: unknown } | null;
    return typeof body?.reason === 'string' ? body.reason.slice(0, 200) : '';
  } catch (e) {
    // The status already classifies the failure; an unreadable body only loses the detail.
    console.warn('[weather] could not read the error body', e);
    return '';
  }
}

// ── Parsing ──────────────────────────────────────────────────────────────────

const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isNonEmptyString = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '';

function parseError(what: string): WeatherFetchError {
  return new WeatherFetchError('parse', `Response shape changed (${what}): ${FIXTURES_HINT}`);
}

/**
 * Geocoder results to places. `admin1`, `country` and `postcodes` are all optional in the
 * provider's results (a Fort-de-France, MQ record has neither admin1 nor country): a missing
 * country falls back to the country code, and a record with neither, or without a usable id,
 * name or coordinates, is dropped rather than shown half-empty.
 */
function parsePlaces(body: unknown): WeatherPlace[] {
  if (typeof body !== 'object' || body === null) throw parseError('geocoding body');
  const results = (body as { results?: unknown }).results;
  if (results === undefined) return [];
  if (!Array.isArray(results)) throw parseError('geocoding results');
  const places: WeatherPlace[] = [];
  for (const raw of results as Array<Record<string, unknown> | null>) {
    if (!raw || typeof raw !== 'object') continue;
    const { id, name, latitude, longitude } = raw;
    if (!isFiniteNumber(id) || !isNonEmptyString(name)) continue;
    if (!isFiniteNumber(latitude) || !isFiniteNumber(longitude)) continue;
    const countryCode = isNonEmptyString(raw.country_code) ? raw.country_code.toUpperCase() : '';
    const country = isNonEmptyString(raw.country) ? raw.country : countryCode;
    if (!country) continue;
    places.push({
      id,
      name,
      ...(isNonEmptyString(raw.admin1) ? { admin1: raw.admin1 } : {}),
      country,
      countryCode,
      lat: roundCoord(latitude),
      lon: roundCoord(longitude),
    });
  }
  return places;
}

/**
 * The forecast body to an observation. `current` must be complete (it is what every surface
 * leads with); `is_day` is 0/1, not a boolean. The daily arrays must line up, and a day whose
 * values are not all finite numbers (Open-Meteo sends `null` where a model has no data) is
 * dropped rather than failing the whole reading; no usable day at all is a parse failure.
 */
function parseForecast(body: unknown, fetchedAt: number): WeatherObservation {
  if (typeof body !== 'object' || body === null) throw parseError('forecast body');
  const { current, daily } = body as { current?: Record<string, unknown>; daily?: unknown };
  if (!current || typeof current !== 'object') throw parseError('current');
  const tempC = current.temperature_2m;
  const code = current.weather_code;
  const isDay = current.is_day;
  if (!isFiniteNumber(tempC) || !isFiniteNumber(code) || (isDay !== 0 && isDay !== 1)) {
    throw parseError('current values');
  }
  if (!daily || typeof daily !== 'object') throw parseError('daily');
  const d = daily as Record<string, unknown>;
  const time = d.time;
  const codes = d.weather_code;
  const max = d.temperature_2m_max;
  const min = d.temperature_2m_min;
  if (
    !Array.isArray(time) ||
    !Array.isArray(codes) ||
    !Array.isArray(max) ||
    !Array.isArray(min) ||
    codes.length !== time.length ||
    max.length !== time.length ||
    min.length !== time.length
  ) {
    throw parseError('daily arrays');
  }
  const days: WeatherDaily[] = [];
  time.forEach((ymd: unknown, i) => {
    const c = codes[i] as unknown;
    const hi = max[i] as unknown;
    const lo = min[i] as unknown;
    if (typeof ymd !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return;
    if (!isFiniteNumber(c) || !isFiniteNumber(hi) || !isFiniteNumber(lo)) return;
    days.push({ ymd, code: c, maxC: hi, minC: lo });
  });
  if (days.length === 0) throw parseError('no usable day');
  return { fetchedAt, current: { tempC, code, isDay: isDay === 1 }, daily: days };
}
