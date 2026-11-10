/* global process */
/**
 * The flight-status dispatcher, as a factory (#143). `index.mjs` is the Lambda entry point and
 * carries the design header (and the module map); read it first.
 *
 * WHY A FACTORY: the provider adapter is a dependency, not a global. `index.mjs` wires the real
 * AeroDataBox adapter; `__tests__/handler.test.mjs` passes a fake one plus an `env` object and a
 * clock, so the handler suite needs no network, no module mocking and no edits to the adapter.
 * Everything the handler reads from the environment is read ONCE, at cold start.
 *
 * This file owns two things: the Phase 1 PROXY (`POST /flight-status`: validation, the limits and
 * the cache) and the DISPATCH to the Phase 2 modules, one job each (plan 2026-11-09, "one module
 * per job, one factory shape"): `alerts.mjs` (subscribe/unsubscribe), `webhook.mjs` (the
 * provider's callback) and `cleanup.mjs` (the 6-hourly sweep). No vendor field is named here:
 * the adapter returns beanies `FlightLeg`s and throws `ProviderError { code, httpStatus? }`.
 */

import {
  BUDGET_EXHAUSTED_PREFIX,
  CACHE_UNAVAILABLE_PREFIX,
  RATE_STORE_UNAVAILABLE_PREFIX,
  cacheKey,
  getCached,
  putCached,
  takeToken,
  ttlSecondsFor,
} from './store.mjs';
import {
  DEFAULT_DAILY_PROVIDER_CAP,
  DEFAULT_IP_LIMIT,
  STATUS_FOR_CODE,
  UPSTREAM_CODES,
  checkDate,
  corsHeaders,
  errorResponse,
  errorText,
  jsonResponse,
  logLine,
  normaliseFlight,
  parseOrigins,
  positiveInt,
  readJsonBody,
  softKeyOk,
} from './http.mjs';
import { STORE_UNAVAILABLE_PREFIX } from './alertsStore.mjs';
import { PROVIDER_SUBSCRIBE_FAILED_PREFIX, createAlerts } from './alerts.mjs';
import { PUSH_SEND_FAILED_PREFIX, WEBHOOK_REJECTED_PREFIX, createWebhook } from './webhook.mjs';
import { PROVIDER_CANCEL_FAILED_PREFIX, createCleanup } from './cleanup.mjs';
import { CREDIT_EXHAUSTED_PREFIX, CREDIT_REFILL_FAILED_PREFIX } from './credits.mjs';
import { createSenders } from './push/index.mjs';

export {
  STATUS_FOR_CODE,
  ERROR_CODES,
  FLIGHT_RE,
  DATE_RE,
  normaliseFlight,
  checkDate,
} from './http.mjs';
export { CLEANUP_HEARTBEAT_PREFIX } from './cleanup.mjs';

// ── Alarmed log prefixes ─────────────────────────────────────────────────────────────────────
// ⚠️ Each is matched VERBATIM by a metric filter in the ops repo's modules/flight-status/main.tf,
// pinned by its __tests__/alarm-prefixes.test.mjs. Rewording one is a change to both repos.
export const PROVIDER_AUTH_FAILED_PREFIX = '[flight-status] provider auth FAILED';
export const PROVIDER_RATE_LIMITED_PREFIX = '[flight-status] provider rate limited';
export { BUDGET_EXHAUSTED_PREFIX };

export const ALARMING_PREFIXES = Object.freeze({
  providerAuthFailed: PROVIDER_AUTH_FAILED_PREFIX,
  providerRateLimited: PROVIDER_RATE_LIMITED_PREFIX,
  cacheUnavailable: CACHE_UNAVAILABLE_PREFIX,
  rateStoreUnavailable: RATE_STORE_UNAVAILABLE_PREFIX,
  budgetExhausted: BUDGET_EXHAUSTED_PREFIX,
  // Phase 2 (flight change push). Each lives beside the code that writes it.
  webhookRejected: WEBHOOK_REJECTED_PREFIX,
  pushSendFailed: PUSH_SEND_FAILED_PREFIX,
  providerSubscribeFailed: PROVIDER_SUBSCRIBE_FAILED_PREFIX,
  providerCancelFailed: PROVIDER_CANCEL_FAILED_PREFIX,
  alertsStoreUnavailable: STORE_UNAVAILABLE_PREFIX,
  creditBalanceExhausted: CREDIT_EXHAUSTED_PREFIX,
  creditRefillFailed: CREDIT_REFILL_FAILED_PREFIX,
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

// ── Routes ───────────────────────────────────────────────────────────────────────────────────
/** API Gateway `routeKey`s, as modules/flight-status/main.tf declares them. */
export const ROUTES = Object.freeze({
  proxy: 'POST /flight-status',
  subscribe: 'POST /flight-status/subscribe',
  unsubscribe: 'POST /flight-status/unsubscribe',
  webhook: 'POST /flight-status/webhook/{secret}',
});

// ── Proxy input rules ────────────────────────────────────────────────────────────────────────
/** `{ "flight": "SQ318", "date": "2026-12-13" }` is ~40 bytes. */
export const MAX_BODY_BYTES = 1024;

export const DEFAULT_MODE = 'direct';

/** The adapter's own fetch is capped at 8 s; never hand it more than the function has left. */
const PROVIDER_BUDGET_MS = 8000;
/** Kept back from the deadline for the cache write and the response. */
const DEADLINE_SLACK_MS = 1500;

/**
 * One retry of a 429, after this wait. The provider enforces a short-burst limit beside the
 * plan's units, and one trip's flights are checked together, so two of four parallel checks
 * were refused with thousands of units left (2026-11-10). The wait clears a per-second window;
 * the jitter keeps two refused requests from landing on the same instant again.
 */
export const RATE_LIMIT_RETRY_MS = 1100;
export const RATE_LIMIT_RETRY_JITTER_MS = 600;
/** The retry is skipped unless this much of the invocation is left after the wait. */
const RATE_LIMIT_RETRY_MIN_BUDGET_MS = 2000;
/** Logged at `warn` (NOT alarmed) when a 429 cleared on the retry. */
export const PROVIDER_BURST_RETRIED_PREFIX = '[flight-status] provider burst limit, retry ok';

/** An array, a Set or a frozen map of values → array. Tolerant of how the adapter exports a list. */
function listOf(x) {
  if (!x) return [];
  if (Array.isArray(x)) return x;
  if (x instanceof Set) return [...x];
  return typeof x === 'object' ? Object.values(x) : [];
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
 * @param {object}   deps.provider   The adapter module namespace: `{ fetchLegs, PROVIDER_MODES,
 *                                   createAlertsClient?, parseWebhook? }`.
 * @param {object=}  deps.env        Defaults to `process.env`; read once, here.
 * @param {Function=} deps.now       Clock (epoch ms). Injectable so tests need no clock control.
 * @param {Function=} deps.fetchImpl Passed to the adapter; defaults to global fetch.
 * @param {Function=} deps.sleep     `(ms) => Promise`; the wait before the one 429 retry.
 * @param {Function=} deps.random    `() => [0, 1)`; the retry's jitter.
 * @param {object=}  deps.ddb        `{ send, commands }`; otherwise ddb.mjs's seam/default client.
 * @param {object=}  deps.alertsProvider  The bound alerts client (tests inject a fake); otherwise
 *                                   built from `provider.createAlertsClient`.
 * @param {object=}  deps.senders    `{ senderFor, close }` (tests inject fakes); otherwise
 *                                   `push/index.mjs`'s `createSenders(env)`.
 */
export function createHandler({
  provider,
  env = process.env,
  now = () => Date.now(),
  fetchImpl = globalThis.fetch,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  random = Math.random,
  ddb,
  alertsProvider,
  senders,
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
  const ALLOWED_ORIGINS = parseOrigins(env.CORS_ORIGINS);

  // Phase 2 modules: one factory each, the same process-level deps.
  const alertsClient =
    alertsProvider ??
    (typeof provider.createAlertsClient === 'function'
      ? provider.createAlertsClient({ apiKey: PROVIDER_KEY, mode: MODE, fetchImpl })
      : null);
  const moduleDeps = {
    provider: alertsClient,
    env,
    ddb,
    now,
    senders: senders ?? createSenders(env),
  };
  const alerts = createAlerts(moduleDeps);
  const webhook = createWebhook(moduleDeps);
  const cleanup = createCleanup(moduleDeps);

  async function proxy(event, context) {
    const headers = corsHeaders(event, ALLOWED_ORIGINS);
    const method = event?.requestContext?.http?.method;

    // Every log line carries the same field set, so a Logs Insights query never meets a gap
    // (plus `units_remaining` on a provider answer, when the provider reported its units).
    const log = {
      route: ROUTES.proxy,
      flight: null,
      date: null,
      outcome: 'bad_request',
      status: 0,
      legs: null,
      provider_ms: null,
      ttl_s: null,
    };
    const fail = (code, outcome, extra = {}) => {
      logLine('flight-status', { ...log, outcome, status: STATUS_FOR_CODE[code].status, code });
      return errorResponse(code, headers, extra);
    };

    if (method !== 'POST') return fail('method_not_allowed', 'bad_request');
    if (!softKeyOk(event, API_KEY)) return fail('unauthorized', 'bad_request');

    try {
      const read = readJsonBody(event, MAX_BODY_BYTES);
      if (!read.ok) return fail(read.code, 'bad_request');
      const parsed = read.body;

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
        return jsonResponse(
          200,
          { legs: hit.legs, fetchedAt: hit.fetchedAt, cached: true },
          headers
        );
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

      // 4. The provider. One retry, and only of a 429: the provider has a short-burst limit beside
      //    the plan's units, and a trip's flights arrive together (see RATE_LIMIT_RETRY_MS). Every
      //    other failure is answered at once; the client's backoff ladder already waits. The retry
      //    takes no second day token: the refused call was not served.
      const remainingMs = () =>
        typeof context?.getRemainingTimeInMillis === 'function'
          ? context.getRemainingTimeInMillis()
          : Infinity;
      const callProvider = () =>
        provider.fetchLegs({
          flight,
          date,
          apiKey: PROVIDER_KEY,
          mode: MODE,
          fetchImpl,
          signal: AbortSignal.timeout(
            Math.max(1000, Math.min(PROVIDER_BUDGET_MS, remainingMs() - DEADLINE_SLACK_MS))
          ),
        });
      const started = Date.now();
      let legs;
      let quota = null;
      try {
        let result;
        try {
          result = await callProvider();
        } catch (err) {
          const waitMs = RATE_LIMIT_RETRY_MS + Math.floor(random() * RATE_LIMIT_RETRY_JITTER_MS);
          const canRetry =
            err?.code === 'upstream_rate_limited' &&
            remainingMs() - DEADLINE_SLACK_MS - waitMs >= RATE_LIMIT_RETRY_MIN_BUDGET_MS;
          if (!canRetry) throw err;
          log.rate_limit_retry = true;
          await sleep(waitMs);
          result = await callProvider();
          console.warn(
            `${PROVIDER_BURST_RETRIED_PREFIX} wait_ms=${waitMs} mode=${MODE}: a 429 cleared on the one retry, so it was the short-burst limit, not the plan's units.`
          );
        }
        if (!Array.isArray(result?.legs)) throw new TypeError('provider returned no legs array');
        legs = result.legs;
        quota = result.quota ?? null;
      } catch (err) {
        log.provider_ms = Date.now() - started;
        const code = UPSTREAM_CODES.has(err?.code) ? err.code : null;
        const httpStatus = Number.isFinite(err?.httpStatus) ? err.httpStatus : '-';
        if (!code) {
          // The adapter is contracted to throw only ProviderError; anything else is a bug.
          console.error(`[flight-status] unhandled provider error mode=${MODE}: ${errorText(err)}`);
          return fail('internal_error', 'provider_error');
        }
        if (code === 'upstream_auth') {
          console.error(
            `${PROVIDER_AUTH_FAILED_PREFIX} http_status=${httpStatus} mode=${MODE}\n` +
              'The provider rejected AERODATABOX_API_KEY (revoked, expired, wrong mode, or the plan lapsed). EVERY live flight check is failing. Check the subscription, then TF_VAR_aerodatabox_api_key and var.aerodatabox_mode.'
          );
        } else if (code === 'upstream_rate_limited') {
          console.error(
            `${PROVIDER_RATE_LIMITED_PREFIX} http_status=${httpStatus} mode=${MODE} ` +
              `retried=${log.rate_limit_retry === true}\n` +
              "The provider answered 429 and the one retry did not clear it (or there was no time left to retry). Either its short-burst limit is under sustained load, or the plan's monthly units are spent: the last `units_remaining` in the request lines says which. Check the provider dashboard and size var.daily_provider_call_cap to the plan."
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
      return jsonResponse(
        200,
        { legs, fetchedAt: new Date(nowMs).toISOString(), cached: false },
        headers
      );
    } catch (err) {
      // Nothing above is meant to throw (the store fails open, the provider is caught); if
      // something does, the caller still gets a clean CORS-bearing 500 rather than a gateway error.
      console.error(`[flight-status] unhandled error: ${errorText(err)}`);
      return fail('internal_error', 'internal_error');
    }
  }

  /**
   * THE DISPATCH. `event.task === 'cleanup'` FIRST: the EventBridge rule's constant input
   * REPLACES the scheduled event, so the sweep arrives as exactly `{ task: 'cleanup' }`. An HTTP
   * invocation can never carry a top-level `task` (payload 2.0 puts the body in `event.body`, a
   * string), so this cannot be reached from the internet. Then `event.routeKey`, which API
   * Gateway HTTP APIs always set; anything else is 404.
   */
  return async function handler(event, context) {
    if (event?.task === 'cleanup') return cleanup(event);

    if (event?.requestContext?.http?.method === 'OPTIONS') {
      return jsonResponse(204, null, corsHeaders(event, ALLOWED_ORIGINS));
    }

    switch (event?.routeKey) {
      case ROUTES.proxy:
        return proxy(event, context);
      case ROUTES.subscribe:
        return alerts.subscribe(event);
      case ROUTES.unsubscribe:
        return alerts.unsubscribe(event);
      case ROUTES.webhook:
        return webhook(event);
      default:
        logLine('flight-status', { route: null, outcome: 'not_found', status: 404 });
        return errorResponse('not_found', corsHeaders(event, ALLOWED_ORIGINS));
    }
  };
}
