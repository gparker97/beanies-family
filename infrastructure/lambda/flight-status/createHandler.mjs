/* global process, Buffer */
/**
 * The flight-status dispatcher, as a factory (#143). `index.mjs` is the Lambda entry point and
 * carries the design header; read it first.
 *
 * WHY A FACTORY: the provider adapter is a dependency, not a global. `index.mjs` wires the real
 * AeroDataBox adapter; `__tests__/handler.test.mjs` passes a fake one plus an `env` object and a
 * clock, so the handler suite needs no network, no module mocking and no edits to the adapter.
 * Everything the handler reads from the environment is read ONCE, here, at cold start.
 *
 * This file owns HTTP shape, validation, the limits and the cache. No vendor field is named here:
 * the adapter returns beanies `FlightLeg`s and throws `ProviderError { code, httpStatus? }`.
 */

import {
  CACHE_UNAVAILABLE_PREFIX,
  RATE_STORE_UNAVAILABLE_PREFIX,
  cacheKey,
  getCached,
  putCached,
  takeToken,
  ttlSecondsFor,
} from './store.mjs';

// ── Alarmed log prefixes ─────────────────────────────────────────────────────────────────────
// ⚠️ Each is matched VERBATIM by a metric filter in the ops repo's modules/flight-status/main.tf,
// pinned by its __tests__/alarm-prefixes.test.mjs. Rewording one is a change to both repos.
export const PROVIDER_AUTH_FAILED_PREFIX = '[flight-status] provider auth FAILED';
export const PROVIDER_RATE_LIMITED_PREFIX = '[flight-status] provider rate limited';
export const BUDGET_EXHAUSTED_PREFIX = '[flight-status] daily budget exhausted';

export const ALARMING_PREFIXES = Object.freeze({
  providerAuthFailed: PROVIDER_AUTH_FAILED_PREFIX,
  providerRateLimited: PROVIDER_RATE_LIMITED_PREFIX,
  cacheUnavailable: CACHE_UNAVAILABLE_PREFIX,
  rateStoreUnavailable: RATE_STORE_UNAVAILABLE_PREFIX,
  budgetExhausted: BUDGET_EXHAUSTED_PREFIX,
});

/**
 * Logged at `warn` (NOT alarmed, so not in ALARMING_PREFIXES or the ops metric filters) on every
 * provider answer whose units remaining fall below `UNITS_LOW_FRACTION` of the plan's limit: an
 * early sign, read in the logs, before the vendor starts answering 429.
 */
export const PROVIDER_UNITS_LOW_PREFIX = '[flight-status] provider units low';
export const UNITS_LOW_FRACTION = 0.1;

/** Logged (not alarmed: terraform's validation block already refuses a bad value) at cold start. */
export const BAD_MODE_PREFIX = '[flight-status] bad AERODATABOX_MODE';

// ── Error codes ──────────────────────────────────────────────────────────────────────────────
/**
 * code → HTTP status + a short human message. One mapping, so no branch invents its own, and
 * every non-2xx body carries `{ error, code }`. The client's `FLIGHT_STATUS_CODES` parity test
 * imports `ERROR_CODES` from index.mjs.
 */
export const STATUS_FOR_CODE = Object.freeze({
  method_not_allowed: { status: 405, message: 'Method not allowed' },
  unauthorized: { status: 401, message: 'Unauthorized' },
  too_large: { status: 413, message: 'Payload too large' },
  bad_request: { status: 400, message: 'Malformed JSON body' },
  bad_flight: { status: 400, message: 'Flight number not recognised' },
  bad_date: { status: 400, message: 'Date must be YYYY-MM-DD' },
  date_out_of_range: { status: 400, message: 'Date outside the checkable range' },
  rate_limited: { status: 429, message: 'Too many requests' },
  budget_exhausted: { status: 503, message: 'Daily flight-check budget used up' },
  upstream_timeout: { status: 504, message: 'Flight data provider timed out' },
  upstream_network: { status: 502, message: 'Flight data provider unreachable' },
  upstream_auth: { status: 502, message: 'Flight data provider refused our credentials' },
  upstream_rate_limited: { status: 503, message: 'Flight data provider is rate limiting' },
  upstream_unavailable: { status: 503, message: 'Flight data provider unavailable' },
  upstream_http: { status: 502, message: 'Flight data provider error' },
  internal_error: { status: 500, message: 'Internal error' },
});

/** Every `code` this handler can return. */
export const ERROR_CODES = Object.freeze(Object.keys(STATUS_FOR_CODE));

/** The `ProviderError.code`s the adapter may throw; anything else thrown is a bug → 500. */
const UPSTREAM_CODES = new Set([
  'upstream_timeout',
  'upstream_network',
  'upstream_auth',
  'upstream_rate_limited',
  'upstream_unavailable',
  'upstream_http',
]);

// ── Input rules ──────────────────────────────────────────────────────────────────────────────
/** Two-character carrier (IATA, may contain a digit: `U2`, `3K`) + 1-4 digits, after normalising. */
export const FLIGHT_RE = /^[A-Z0-9]{2}\d{1,4}$/;
export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
/** `{ "flight": "SQ318", "date": "2026-12-13" }` is ~40 bytes. */
export const MAX_BODY_BYTES = 1024;
const PAST_DAYS = 2;
const FUTURE_DAYS = 365;
const DAY_MS = 86_400_000;

export const DEFAULT_IP_LIMIT = 240;
export const DEFAULT_DAILY_PROVIDER_CAP = 600;
export const DEFAULT_MODE = 'direct';

/** The adapter's own fetch is capped at 8 s; never hand it more than the function has left. */
const PROVIDER_BUDGET_MS = 8000;
/** Kept back from the deadline for the cache write and the response. */
const DEADLINE_SLACK_MS = 1500;

/** Upper-case, strip spaces and hyphens, then FLIGHT_RE. `sq 318` / `SQ-318` → `SQ318`. */
export function normaliseFlight(raw) {
  if (typeof raw !== 'string' || raw.length > 16) return null;
  const value = raw.toUpperCase().replace(/[\s-]/g, '');
  return FLIGHT_RE.test(value) ? value : null;
}

/** `bad_date` for a malformed or impossible date (2026-02-30), `date_out_of_range` outside the window. */
export function checkDate(raw, nowMs) {
  if (typeof raw !== 'string' || !DATE_RE.test(raw)) return 'bad_date';
  const t = Date.parse(`${raw}T00:00:00Z`);
  if (!Number.isFinite(t) || new Date(t).toISOString().slice(0, 10) !== raw) return 'bad_date';
  const n = new Date(nowMs);
  const today = Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate());
  if (t < today - PAST_DAYS * DAY_MS || t > today + FUTURE_DAYS * DAY_MS)
    return 'date_out_of_range';
  return null;
}

/** An array, a Set or a frozen map of values → array. Tolerant of how the adapter exports a list. */
function listOf(x) {
  if (!x) return [];
  if (Array.isArray(x)) return x;
  if (x instanceof Set) return [...x];
  return typeof x === 'object' ? Object.values(x) : [];
}

function positiveInt(raw, fallback, name) {
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (Number.isInteger(n) && n > 0) return n;
  console.warn(`[flight-status] ${name} is not a positive integer; using ${fallback}`);
  return fallback;
}

function resolveMode(raw, modes) {
  const allowed = listOf(modes);
  if (allowed.length === 0) allowed.push(DEFAULT_MODE);
  const wanted = raw === undefined || raw === '' ? DEFAULT_MODE : String(raw);
  if (allowed.includes(wanted)) return wanted;
  console.error(
    `${BAD_MODE_PREFIX}: "${wanted.replace(/[^\w-]/g, '').slice(0, 32)}" is not one of ` +
      `${allowed.join('|')}; falling back to "${DEFAULT_MODE}". Fix var.aerodatabox_mode.`
  );
  return DEFAULT_MODE;
}

/**
 * One structured JSON line per request. Flight and date are public data and no family id exists in
 * this Lambda. NEVER a header, the soft key or the provider key.
 */
function logLine(msg, fields = {}) {
  // eslint-disable-next-line no-console -- structured decision line, read by CloudWatch
  console.log(JSON.stringify({ msg, ...fields }));
}

/** `{ units_remaining }` for the request line when the provider reported it, else `{}`. */
function unitsFields(quota) {
  return Number.isFinite(quota?.remaining) ? { units_remaining: quota.remaining } : {};
}

/** True when the provider reported both counts and fewer than 10% of the units are left. */
function unitsLow(quota) {
  return (
    Number.isFinite(quota?.remaining) &&
    Number.isFinite(quota?.limit) &&
    quota.limit > 0 &&
    quota.remaining < quota.limit * UNITS_LOW_FRACTION
  );
}

/**
 * @param {object}   deps
 * @param {object}   deps.provider   `{ fetchLegs, PROVIDER_MODES }` (the adapter module namespace).
 * @param {object=}  deps.env        Defaults to `process.env`; read once, here.
 * @param {Function=} deps.now       Clock (epoch ms). Injectable so tests need no clock control.
 * @param {Function=} deps.fetchImpl Passed to the adapter; defaults to global fetch.
 * @param {object=}  deps.ddb        `{ send, commands }`; otherwise ddb.mjs's seam/default client.
 */
export function createHandler({
  provider,
  env = process.env,
  now = () => Date.now(),
  fetchImpl = globalThis.fetch,
  ddb,
} = {}) {
  if (typeof provider?.fetchLegs !== 'function') {
    throw new TypeError('createHandler: provider.fetchLegs is required');
  }

  const API_KEY = env.FLIGHT_STATUS_API_KEY;
  const PROVIDER_KEY = env.AERODATABOX_API_KEY;
  const TABLE = env.CACHE_TABLE || '';
  const IP_LIMIT = positiveInt(env.IP_LIMIT, DEFAULT_IP_LIMIT, 'IP_LIMIT');
  const DAILY_CAP = positiveInt(
    env.DAILY_PROVIDER_CAP,
    DEFAULT_DAILY_PROVIDER_CAP,
    'DAILY_PROVIDER_CAP'
  );
  const MODE = resolveMode(env.AERODATABOX_MODE, provider.PROVIDER_MODES);
  const ALLOWED_ORIGINS = (env.CORS_ORIGINS || 'https://app.beanies.family')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);

  // CORS exactly as content-fetch: echo an allowed origin, else the first one.
  function getHeaders(event) {
    const origin = event?.headers?.origin || ALLOWED_ORIGINS[0];
    const allowedOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
    return {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': allowedOrigin,
      'Access-Control-Allow-Headers': 'Content-Type, x-api-key',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
    };
  }

  function response(statusCode, body, event) {
    return {
      statusCode,
      headers: getHeaders(event),
      body: body === null ? '' : JSON.stringify(body),
    };
  }

  return async function handler(event, context) {
    const method = event?.requestContext?.http?.method;
    if (method === 'OPTIONS') return response(204, null, event);

    // Every log line carries the same field set, so a Logs Insights query never meets a gap
    // (plus `units_remaining` on a provider answer, when the provider reported its units).
    const log = {
      flight: null,
      date: null,
      outcome: 'bad_request',
      status: 0,
      legs: null,
      provider_ms: null,
      ttl_s: null,
    };
    const fail = (code, outcome, extra = {}) => {
      const { status, message } = STATUS_FOR_CODE[code];
      logLine('flight-status', { ...log, outcome, status, code });
      return response(status, { error: message, code, ...extra }, event);
    };

    if (method !== 'POST') return fail('method_not_allowed', 'bad_request');

    // `!API_KEY ||` so an unset key refuses everything rather than accepting an absent header.
    const key = event?.headers?.['x-api-key'];
    if (!API_KEY || key !== API_KEY) return fail('unauthorized', 'bad_request');

    try {
      let rawBody = event?.body || '';
      // Cheap guard before decoding anything: base64 is 4/3 of the bytes it carries.
      if (rawBody.length > MAX_BODY_BYTES * 2) return fail('too_large', 'bad_request');
      if (event?.isBase64Encoded) rawBody = Buffer.from(rawBody, 'base64').toString('utf8');
      if (Buffer.byteLength(rawBody, 'utf8') > MAX_BODY_BYTES) {
        return fail('too_large', 'bad_request');
      }

      let parsed;
      try {
        parsed = JSON.parse(rawBody || '{}');
      } catch {
        return fail('bad_request', 'bad_request');
      }
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return fail('bad_request', 'bad_request');
      }

      const flight = normaliseFlight(parsed.flight);
      if (!flight) return fail('bad_flight', 'bad_request');
      log.flight = flight;

      const nowMs = now();
      const dateCode = checkDate(parsed.date, nowMs);
      if (dateCode) return fail(dateCode, 'bad_request');
      const date = parsed.date;
      log.date = date;

      // 1. Per-IP hourly limit, on EVERY valid request (cache hits included): it bounds one
      //    source's share of the Lambda, not provider spend. sourceIp, never x-forwarded-for.
      const ipToken = await takeToken({
        kind: 'ip',
        ip: event?.requestContext?.http?.sourceIp,
        now: nowMs,
        ddb,
        limit: IP_LIMIT,
        table: TABLE,
      });
      if (!ipToken.allowed) {
        return fail('rate_limited', 'rate_limited', {
          retryAfterSeconds: ipToken.retryAfterSeconds,
        });
      }

      // 2. Cache. A hit is served even when the daily budget is spent.
      const pk = cacheKey(flight, date);
      const hit = await getCached(pk, { table: TABLE, now: nowMs, ddb });
      if (hit) {
        logLine('flight-status', {
          ...log,
          outcome: 'cache_hit',
          status: 200,
          legs: hit.legs.length,
        });
        return response(200, { legs: hit.legs, fetchedAt: hit.fetchedAt, cached: true }, event);
      }

      // A missing provider key would 401 at the vendor on every miss. Say so with the alarmed
      // prefix, before a day token is spent on a call that cannot succeed.
      if (!PROVIDER_KEY) {
        console.error(
          `${PROVIDER_AUTH_FAILED_PREFIX} reason=key_unset mode=${MODE}\n` +
            'AERODATABOX_API_KEY is unset on the Lambda. Set TF_VAR_aerodatabox_api_key and apply module.flight_status.'
        );
        return fail('upstream_auth', 'provider_error');
      }

      // 3. The GLOBAL daily provider-call cap: the one control that bounds paid units (see the
      //    index.mjs header). Only a miss spends a token.
      const dayToken = await takeToken({
        kind: 'day',
        now: nowMs,
        ddb,
        limit: DAILY_CAP,
        table: TABLE,
      });
      if (!dayToken.allowed) {
        console.error(
          `${BUDGET_EXHAUSTED_PREFIX} cap=${DAILY_CAP}: refusing provider calls until UTC midnight ` +
            `(${dayToken.retryAfterSeconds}s); cached answers are still served. Expected only under abuse ` +
            'or real growth: read the per-request lines for the spread of flights and IPs before raising var.daily_provider_call_cap.'
        );
        return fail('budget_exhausted', 'budget_exhausted', {
          retryAfterSeconds: dayToken.retryAfterSeconds,
        });
      }

      // 4. The provider. NO retry, on a 429 above all: the client's backoff ladder already waits,
      //    and a retry here spends a second unit of the budget the 429 is telling us about.
      const remaining =
        typeof context?.getRemainingTimeInMillis === 'function'
          ? context.getRemainingTimeInMillis()
          : Infinity;
      const budgetMs = Math.max(1000, Math.min(PROVIDER_BUDGET_MS, remaining - DEADLINE_SLACK_MS));
      const started = Date.now();
      let legs;
      let quota = null;
      try {
        const result = await provider.fetchLegs({
          flight,
          date,
          apiKey: PROVIDER_KEY,
          mode: MODE,
          fetchImpl,
          signal: AbortSignal.timeout(budgetMs),
        });
        if (!Array.isArray(result?.legs)) throw new TypeError('provider returned no legs array');
        legs = result.legs;
        quota = result.quota ?? null;
      } catch (err) {
        log.provider_ms = Date.now() - started;
        const code = UPSTREAM_CODES.has(err?.code) ? err.code : null;
        const httpStatus = Number.isFinite(err?.httpStatus) ? err.httpStatus : '-';
        if (!code) {
          // The adapter is contracted to throw only ProviderError; anything else is a bug.
          console.error(
            `[flight-status] unhandled provider error mode=${MODE}: ${err?.name}: ${String(err?.message).slice(0, 200)}`
          );
          return fail('internal_error', 'provider_error');
        }
        if (code === 'upstream_auth') {
          console.error(
            `${PROVIDER_AUTH_FAILED_PREFIX} http_status=${httpStatus} mode=${MODE}\n` +
              'The provider rejected AERODATABOX_API_KEY (revoked, expired, wrong mode, or the plan lapsed). EVERY live flight check is failing. Check the subscription, then TF_VAR_aerodatabox_api_key and var.aerodatabox_mode.'
          );
        } else if (code === 'upstream_rate_limited') {
          console.error(
            `${PROVIDER_RATE_LIMITED_PREFIX} http_status=${httpStatus} mode=${MODE}\n` +
              "The provider is refusing on quota or rate: the plan's monthly units may be spent. Check the provider dashboard and size var.daily_provider_call_cap to the plan."
          );
        } else {
          console.warn(
            `[flight-status] provider error code=${code} http_status=${httpStatus} mode=${MODE}`
          );
        }
        return fail(code, 'provider_error');
      }
      log.provider_ms = Date.now() - started;
      const units = unitsFields(quota);
      if (unitsLow(quota)) {
        console.warn(
          `${PROVIDER_UNITS_LOW_PREFIX} remaining=${quota.remaining} limit=${quota.limit} mode=${MODE}: ` +
            "under 10% of the plan's units left; 429s follow when they run out. Check the plan and var.daily_provider_call_cap."
        );
      }

      // 5. Cache write (fails open inside putCached), then answer. An empty answer (the provider's
      //    204) is a valid answer and is cached too, for less time.
      const ttl = ttlSecondsFor(legs, nowMs);
      await putCached(pk, legs, ttl, { table: TABLE, now: nowMs, ddb });
      logLine('flight-status', {
        ...log,
        outcome: legs.length === 0 ? 'provider_empty' : 'provider_ok',
        status: 200,
        legs: legs.length,
        ttl_s: ttl,
        ...units,
      });
      return response(
        200,
        { legs, fetchedAt: new Date(nowMs).toISOString(), cached: false },
        event
      );
    } catch (err) {
      // Nothing above is meant to throw (the store fails open, the provider is caught); if
      // something does, the caller still gets a clean CORS-bearing 500 rather than a gateway error.
      console.error(
        `[flight-status] unhandled error: ${err?.name}: ${String(err?.message).slice(0, 200)}`
      );
      return fail('internal_error', 'internal_error');
    }
  };
}
