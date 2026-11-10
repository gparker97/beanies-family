/* global Buffer */
/**
 * HTTP and cold-start plumbing shared by every handler in the flight-status Lambda (#143).
 *
 * Extracted from `createHandler.mjs` (Phase 2 plan, Commit 1) so the proxy, the alert routes and
 * the webhook build responses, read bodies, log and compare secrets through ONE set of functions
 * rather than event-bound closures handed around as dependencies.
 *
 * `STATUS_FOR_CODE` is THE code table: every non-2xx body is `{ error, code }` with a code from
 * here. It is re-exported from `createHandler.mjs` and `index.mjs`; the client parity test
 * (`src/services/flightStatus/__tests__/flightStatusApiParity.test.ts`) imports it through
 * `createHandler.mjs` and asserts the client's `FLIGHT_STATUS_CODES` lists exactly these codes.
 *
 * No vendor field and no DynamoDB call lives here.
 */

import { timingSafeEqual } from 'node:crypto';

// ── Error codes ──────────────────────────────────────────────────────────────────────────────
/**
 * code → HTTP status + a short human message. One mapping, so no branch invents its own.
 * Adding a code here means adding it to the client's `FLIGHT_STATUS_CODES` / `CODE_TO_ERROR`.
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
  // Phase 2 (flight change push).
  not_found: { status: 404, message: 'Not found' },
  alert_token_rejected: { status: 401, message: 'Alert token rejected' },
  subscription_full: { status: 409, message: 'Too many devices watch this flight' },
  alerts_unavailable: { status: 503, message: 'Flight alerts are unavailable' },
  webhook_rejected: { status: 401, message: 'Webhook rejected' },
  bad_platform: { status: 400, message: 'Platform must be ios or android' },
  bad_token: { status: 400, message: 'Push token not recognised' },
  bad_codes: { status: 400, message: 'Airport codes not recognised' },
});

/** Every `code` this Lambda can return. */
export const ERROR_CODES = Object.freeze(Object.keys(STATUS_FOR_CODE));

/** The `ProviderError.code`s the adapter may throw; anything else thrown is a bug → 500. */
export const UPSTREAM_CODES = new Set([
  'upstream_timeout',
  'upstream_network',
  'upstream_auth',
  'upstream_rate_limited',
  'upstream_unavailable',
  'upstream_http',
]);

// ── Shared limits (the proxy, subscribe/unsubscribe and the sweep read the same env) ─────────
export const DEFAULT_IP_LIMIT = 240;
export const DEFAULT_DAILY_PROVIDER_CAP = 600;

// ── Input rules ──────────────────────────────────────────────────────────────────────────────
/** Two-character carrier (IATA, may contain a digit: `U2`, `3K`) + 1-4 digits, after normalising. */
export const FLIGHT_RE = /^[A-Z0-9]{2}\d{1,4}$/;
export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const PAST_DAYS = 2;
const FUTURE_DAYS = 365;
const DAY_MS = 86_400_000;

/** Upper-case, strip spaces and hyphens, then FLIGHT_RE. `sq 318` / `SQ-318` → `SQ318`. */
export function normaliseFlight(raw) {
  if (typeof raw !== 'string' || raw.length > 16) return null;
  const value = raw.toUpperCase().replace(/[\s-]/g, '');
  return FLIGHT_RE.test(value) ? value : null;
}

/** True for a well-formed, real calendar date (2026-02-30 is not). */
export function isRealDate(raw) {
  if (typeof raw !== 'string' || !DATE_RE.test(raw)) return false;
  const t = Date.parse(`${raw}T00:00:00Z`);
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === raw;
}

/** `bad_date` for a malformed or impossible date (2026-02-30), `date_out_of_range` outside the window. */
export function checkDate(raw, nowMs) {
  if (!isRealDate(raw)) return 'bad_date';
  const t = Date.parse(`${raw}T00:00:00Z`);
  const n = new Date(nowMs);
  const today = Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate());
  if (t < today - PAST_DAYS * DAY_MS || t > today + FUTURE_DAYS * DAY_MS)
    return 'date_out_of_range';
  return null;
}

/** A positive integer env value, else `fallback` with one warning naming the variable. */
export function positiveInt(raw, fallback, name) {
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (Number.isInteger(n) && n > 0) return n;
  console.warn(`[flight-status] ${name} is not a positive integer; using ${fallback}`);
  return fallback;
}

/** `CORS_ORIGINS` → list; the PWA origin when unset. */
export function parseOrigins(raw) {
  return (raw || 'https://app.beanies.family')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
}

// ── Responses ────────────────────────────────────────────────────────────────────────────────

/** CORS exactly as content-fetch: echo an allowed origin, else the first one. */
export function corsHeaders(event, allowedOrigins) {
  const origin = event?.headers?.origin || allowedOrigins[0];
  const allowedOrigin = allowedOrigins.includes(origin) ? origin : allowedOrigins[0];
  return {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Headers': 'Content-Type, x-api-key',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };
}

/** A proxy-integration answer. `body === null` → empty body (the OPTIONS 204). */
export function jsonResponse(status, body, headers) {
  return { statusCode: status, headers, body: body === null ? '' : JSON.stringify(body) };
}

/** The `{ error, code, ...extra }` body and status for a code from `STATUS_FOR_CODE`. */
export function errorResponse(code, headers, extra = {}) {
  const { status, message } = STATUS_FOR_CODE[code];
  return jsonResponse(status, { error: message, code, ...extra }, headers);
}

/**
 * The soft `x-api-key` check. `!apiKey ||` so an unset key refuses everything rather than
 * accepting an absent header. The key ships in the bundle: this is a gate on casual use, not a
 * secret, so a plain compare is enough.
 */
export function softKeyOk(event, apiKey) {
  return !!apiKey && event?.headers?.['x-api-key'] === apiKey;
}

/**
 * Read a JSON object body under a byte ceiling, written once for every route.
 * The proxy passes 1 KB, subscribe/unsubscribe 2 KB, the webhook 64 KB.
 *
 * @returns {{ ok: true, body: object } | { ok: false, code: 'too_large' | 'bad_request' }}
 */
export function readJsonBody(event, maxBytes) {
  let rawBody = typeof event?.body === 'string' ? event.body : '';
  // Cheap guard before decoding anything: base64 is 4/3 of the bytes it carries.
  if (rawBody.length > maxBytes * 2) return { ok: false, code: 'too_large' };
  if (event?.isBase64Encoded) rawBody = Buffer.from(rawBody, 'base64').toString('utf8');
  if (Buffer.byteLength(rawBody, 'utf8') > maxBytes) return { ok: false, code: 'too_large' };

  let parsed;
  try {
    parsed = JSON.parse(rawBody || '{}');
  } catch {
    // Not JSON: a client fault, answered with its own code. Nothing to log beyond the request line.
    return { ok: false, code: 'bad_request' };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, code: 'bad_request' };
  }
  return { ok: true, body: parsed };
}

// ── Logging and comparison ───────────────────────────────────────────────────────────────────

/**
 * One structured JSON line. Flight and date are public data and no family id exists in this
 * Lambda. NEVER a header, a key, a push token, `rawPath` or a provider subscription url.
 */
export function logLine(msg, fields = {}) {
  // eslint-disable-next-line no-console -- structured decision line, read by CloudWatch
  console.log(JSON.stringify({ msg, ...fields }));
}

/**
 * Constant-time string compare. Restated from `email-unsubscribe/token.mjs` rather than
 * imported: every Lambda is its own zero-dependency zip (header rule in `billing/ddb.mjs`).
 * `timingSafeEqual` throws on unequal lengths, hence the length check first.
 */
export function safeEqual(a, b) {
  const left = Buffer.from(String(a ?? ''), 'utf8');
  const right = Buffer.from(String(b ?? ''), 'utf8');
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/** `err.name: message` clipped for a log line; never a stack, never an object dump. */
export function errorText(err) {
  return `${err?.name ?? 'Error'}: ${String(err?.message ?? err).slice(0, 200)}`;
}
