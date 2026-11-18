/* global Buffer */
/**
 * HTTP plumbing for the place-search Lambda (#150): responses, body reading, the code table and
 * the request line.
 *
 * SIBLING, NOT SHARED. Every Lambda in this repo is its own zero-dependency zip (header rule in
 * `flight-status/ddb.mjs` and `billing/ddb.mjs`), so the generic functions below are RESTATED
 * from `flight-status/http.mjs` rather than imported:
 *
 *   parseOrigins, corsHeaders, jsonResponse, softKeyOk, readJsonBody, logLine, errorText
 *
 * `__tests__/twinDrift.test.mjs` asserts `fn.toString()` equality for each against the
 * flight-status copy. ⚠️ EDIT BOTH COPIES IN ONE COMMIT: the comparison covers comments inside a
 * function body too, so a one-word fix to either copy fails the drift test until the other
 * matches.
 *
 * OWN to this Lambda (not pinned): `STATUS_FOR_CODE`, `ERROR_CODES`, `UPSTREAM_CODES`,
 * `errorResponse` (it reads this module's table) and `positiveInt` (its warning names this
 * Lambda, so it cannot be byte-identical to the flight-status one).
 *
 * `STATUS_FOR_CODE` is THE code table: every non-2xx body is `{ error, code }` with a code from
 * here. The client parity test (`src/services/placeSearch/__tests__/*Parity*.test.ts`) pins the
 * client's code list to `ERROR_CODES`.
 *
 * No vendor field and no DynamoDB call lives here.
 */

// ── Error codes ──────────────────────────────────────────────────────────────────────────────
/**
 * code → HTTP status + a short human message. One mapping, so no branch invents its own.
 * The upstream_* names mirror flight-status's table on purpose (one vocabulary across proxies).
 */
export const STATUS_FOR_CODE = Object.freeze({
  method_not_allowed: { status: 405, message: 'Method not allowed' },
  unauthorized: { status: 401, message: 'Unauthorized' },
  not_found: { status: 404, message: 'Not found' },
  too_large: { status: 413, message: 'Payload too large' },
  bad_request: { status: 400, message: 'Malformed JSON body' },
  bad_query: { status: 400, message: 'Query not accepted' },
  bad_bias: { status: 400, message: 'Bias point not accepted' },
  bad_place_id: { status: 400, message: 'Place id not recognised' },
  rate_limited: { status: 429, message: 'Too many requests' },
  budget_exhausted: { status: 503, message: 'Daily place-search budget used up' },
  budget_unavailable: { status: 503, message: 'Place-search budget cannot be checked' },
  upstream_timeout: { status: 504, message: 'Place provider timed out' },
  upstream_network: { status: 502, message: 'Place provider unreachable' },
  upstream_auth: { status: 502, message: 'Place provider refused our credentials' },
  upstream_rate_limited: { status: 503, message: 'Place provider is rate limiting' },
  upstream_unavailable: { status: 503, message: 'Place provider unavailable' },
  upstream_http: { status: 502, message: 'Place provider error' },
  internal_error: { status: 500, message: 'Internal error' },
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

/** A positive integer env value, else `fallback` with one warning naming the variable. */
export function positiveInt(raw, fallback, name) {
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (Number.isInteger(n) && n > 0) return n;
  console.warn(`[place-search] ${name} is not a positive integer; using ${fallback}`);
  return fallback;
}

// ── Restated from flight-status/http.mjs (pinned by twinDrift.test.mjs) ─────────────────────

/** `CORS_ORIGINS` → list; the PWA origin when unset. */
export function parseOrigins(raw) {
  return (raw || 'https://app.beanies.family')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
}

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

/**
 * The soft `x-api-key` check. `!apiKey ||` so an unset key refuses everything rather than
 * accepting an absent header. The key ships in the bundle: a gate on casual use, not a secret.
 */
export function softKeyOk(event, apiKey) {
  return !!apiKey && event?.headers?.['x-api-key'] === apiKey;
}

/**
 * Read a JSON object body under a byte ceiling.
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

/**
 * One structured JSON line. Here the fields are route, outcome, status, count, provider_ms,
 * q_len and a fixed-vocabulary code/reason. NEVER the query, a place id, an address, a header,
 * a key or the source IP.
 */
export function logLine(msg, fields = {}) {
  // eslint-disable-next-line no-console -- structured decision line, read by CloudWatch
  console.log(JSON.stringify({ msg, ...fields }));
}

/** `err.name: message` clipped for a log line; never a stack, never an object dump. */
export function errorText(err) {
  return `${err?.name ?? 'Error'}: ${String(err?.message ?? err).slice(0, 200)}`;
}

// ── Own to this Lambda ───────────────────────────────────────────────────────────────────────

/** The `{ error, code, ...extra }` body and status for a code from THIS module's table. */
export function errorResponse(code, headers, extra = {}) {
  const { status, message } = STATUS_FOR_CODE[code];
  return jsonResponse(status, { error: message, code, ...extra }, headers);
}
