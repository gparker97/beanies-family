/**
 * Google adapter for the place-search Lambda (#150).
 *
 * The ONLY file that knows Google's shapes. It builds two fixed requests and maps the answers to
 * the small beanies shapes the client understands:
 *
 *   suggestPlaces  POST places.googleapis.com/v1/places:autocomplete  (Places API (New))
 *                  → { suggestions: [{ placeId, main, secondary }] }
 *   resolvePlace   GET  maps.googleapis.com/maps/api/geocode/json?place_id=…  (Geocoding)
 *                  → { address }   (`formatted_address`, storable under Geocoding terms 6.3.2)
 *
 * Nothing from the client is relayed: the handler validates every input first and this module
 * copies only the named fields into a request it builds itself. The Autocomplete key travels in
 * a header; the Geocoding key has to travel in the query string, so that URL is built with
 * URLSearchParams and is NEVER logged, thrown or returned. This module never logs at all: the
 * handler owns every log line.
 *
 * Contract with the handler: both functions resolve the beanies shape or throw `ProviderError`
 * whose `code` is one of `PROVIDER_ERROR_CODES` and whose `reason` (when set) is one of the fixed
 * words in `PROVIDER_REASONS`. Neither carries provider body text: Node's JSON parse error quotes
 * the body, so parse failures are caught HERE and mapped, never passed on as a cause.
 */

/** Our own ceiling on one provider call, combined with the caller's `signal`. */
export const PROVIDER_TIMEOUT_MS = 6000;

export const AUTOCOMPLETE_URL = 'https://places.googleapis.com/v1/places:autocomplete';
export const GEOCODE_URL = 'https://maps.googleapis.com/maps/api/geocode/json';

/** Exactly the fields the client gets. Billing is per request, but a narrow mask is the rule. */
export const AUTOCOMPLETE_FIELD_MASK = [
  'suggestions.placePrediction.placeId',
  'suggestions.placePrediction.structuredFormat.mainText.text',
  'suggestions.placePrediction.structuredFormat.secondaryText.text',
].join(',');

/** The locationBias circle radius (Google's maximum for a circle bias). */
export const BIAS_RADIUS_M = 50000;

export const PROVIDER_ERROR_CODES = Object.freeze([
  'upstream_timeout',
  'upstream_network',
  'upstream_auth',
  'upstream_rate_limited',
  'upstream_unavailable',
  'upstream_http',
]);

/** The only words a `ProviderError.reason` can hold (safe to log: our vocabulary, not Google's text). */
export const PROVIDER_REASONS = Object.freeze([
  'bad_json',
  'bad_shape',
  'zero_results',
  'invalid_request',
  'request_denied',
  'over_query_limit',
  'over_daily_limit',
  'unknown_error',
  'unexpected_status',
]);

/** A classified upstream failure. `httpStatus` is set when the provider answered. */
export class ProviderError extends Error {
  /**
   * @param {(typeof PROVIDER_ERROR_CODES)[number]} code
   * @param {{ httpStatus?: number, reason?: (typeof PROVIDER_REASONS)[number] }} [opts]
   */
  constructor(code, opts = {}) {
    super(`google ${code}${opts.httpStatus ? ` (HTTP ${opts.httpStatus})` : ''}`);
    this.name = 'ProviderError';
    this.code = code;
    if (opts.httpStatus !== undefined) this.httpStatus = opts.httpStatus;
    if (opts.reason !== undefined) this.reason = opts.reason;
  }
}

/**
 * Google API error envelope words that mean "this key cannot be used here" even when the HTTP
 * status is 400 (an invalid key answers 400 INVALID_ARGUMENT with reason API_KEY_INVALID, and
 * that is exactly the fault the auth alarm exists for).
 */
const AUTH_STATUSES = new Set(['PERMISSION_DENIED', 'UNAUTHENTICATED']);
const AUTH_REASONS = new Set([
  'API_KEY_INVALID',
  'API_KEY_SERVICE_BLOCKED',
  'API_KEY_HTTP_REFERRER_BLOCKED',
  'API_KEY_IP_ADDRESS_BLOCKED',
  'API_KEY_ANDROID_APP_BLOCKED',
  'API_KEY_IOS_APP_BLOCKED',
  'SERVICE_DISABLED',
  'BILLING_DISABLED',
  'ACCESS_TOKEN_SCOPE_INSUFFICIENT',
]);

/** HTTP status (+ the error envelope's status/reason words) → error code for a non-2xx answer. */
function codeForError(status, envelope) {
  const gStatus = envelope?.status;
  const reasons = Array.isArray(envelope?.details) ? envelope.details.map((d) => d?.reason) : [];
  if (status === 401 || status === 403) return 'upstream_auth';
  if (AUTH_STATUSES.has(gStatus) || reasons.some((r) => AUTH_REASONS.has(r)))
    return 'upstream_auth';
  if (status === 429 || gStatus === 'RESOURCE_EXHAUSTED') return 'upstream_rate_limited';
  if (status >= 500) return 'upstream_unavailable';
  return 'upstream_http';
}

/** Combine the caller's deadline with our own ceiling. */
function deadline(signal) {
  const timeout = AbortSignal.timeout(PROVIDER_TIMEOUT_MS);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

/** fetch, with every throw classified (any abort is a timeout; anything else is the network). */
async function send(fetchImpl, url, init, combined) {
  try {
    return await fetchImpl(url, { ...init, signal: combined });
  } catch {
    // No cause is attached: a fetch error can carry the request URL, and the Geocoding URL
    // carries the key.
    throw new ProviderError(combined.aborted ? 'upstream_timeout' : 'upstream_network');
  }
}

/** Parse a JSON body, mapping a failure to upstream_http (or a timeout) with no body text. */
async function readJson(res, combined) {
  try {
    return await res.json();
  } catch {
    // Node's SyntaxError message quotes the body, so it is dropped here, not passed on.
    if (combined.aborted) throw new ProviderError('upstream_timeout', { httpStatus: res.status });
    throw new ProviderError('upstream_http', { httpStatus: res.status, reason: 'bad_json' });
  }
}

/** Release a body we will not read, so the socket returns to the pool. Never throws. */
async function discard(res) {
  try {
    await res.body?.cancel();
  } catch {
    // A body that cannot be cancelled is already closed; there is nothing to release.
  }
}

/** The Autocomplete request body. Exported for tests; carries no key. */
export function autocompleteBody({ q, lang, bias }) {
  const body = { input: q, languageCode: lang };
  if (bias) {
    body.locationBias = {
      circle: { center: { latitude: bias.lat, longitude: bias.lon }, radius: BIAS_RADIUS_M },
    };
    if (bias.countryCode) body.regionCode = bias.countryCode.toLowerCase();
  }
  return body;
}

/** A `{ text }` leaf of structuredFormat, or undefined. */
const textOf = (node) => (typeof node?.text === 'string' ? node.text : undefined);

/**
 * Autocomplete suggestions for a validated query.
 *
 * @param {object} args
 * @param {string} args.q       Validated, trimmed query.
 * @param {string} args.lang    An allowlisted language tag.
 * @param {{ lat: number, lon: number, countryCode?: string }=} args.bias  Already rounded.
 * @param {string} args.apiKey
 * @param {typeof fetch} [args.fetchImpl]
 * @param {AbortSignal} [args.signal]
 * @returns {Promise<{ suggestions: Array<{ placeId: string, main: string, secondary: string }> }>}
 */
export async function suggestPlaces({ q, lang, bias, apiKey, fetchImpl = fetch, signal }) {
  const combined = deadline(signal);
  const res = await send(
    fetchImpl,
    AUTOCOMPLETE_URL,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': AUTOCOMPLETE_FIELD_MASK,
      },
      body: JSON.stringify(autocompleteBody({ q, lang, bias })),
    },
    combined
  );

  const status = res.status;
  if (status < 200 || status >= 300) {
    // Read the error envelope ONLY for its fixed status/reason words; it is never logged.
    let envelope;
    try {
      envelope = (await res.json())?.error;
    } catch {
      // No readable envelope: classify on the HTTP status alone.
      envelope = undefined;
    }
    throw new ProviderError(codeForError(status, envelope), { httpStatus: status });
  }

  const body = await readJson(res, combined);
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new ProviderError('upstream_http', { httpStatus: status, reason: 'bad_shape' });
  }
  // proto3 JSON omits an empty repeated field: no `suggestions` key is an empty answer.
  if (body.suggestions === undefined) return { suggestions: [] };
  if (!Array.isArray(body.suggestions)) {
    throw new ProviderError('upstream_http', { httpStatus: status, reason: 'bad_shape' });
  }

  const suggestions = [];
  for (const item of body.suggestions) {
    const p = item?.placePrediction;
    if (!p || typeof p.placeId !== 'string') continue; // a query prediction, or junk
    const main = textOf(p.structuredFormat?.mainText);
    if (!main) continue;
    suggestions.push({
      placeId: p.placeId,
      main,
      secondary: textOf(p.structuredFormat?.secondaryText) ?? '',
    });
  }
  return { suggestions };
}

/** Geocoding answer `status` → error code + reason word, for every non-OK status. */
const GEOCODE_STATUS = Object.freeze({
  ZERO_RESULTS: ['upstream_http', 'zero_results'],
  INVALID_REQUEST: ['upstream_http', 'invalid_request'],
  REQUEST_DENIED: ['upstream_auth', 'request_denied'],
  // "Key missing or invalid, billing not enabled, or a self-imposed cap exceeded": a key or
  // billing fault far more often than a quota (the console quota sits above the Lambda cap).
  OVER_DAILY_LIMIT: ['upstream_auth', 'over_daily_limit'],
  OVER_QUERY_LIMIT: ['upstream_rate_limited', 'over_query_limit'],
  UNKNOWN_ERROR: ['upstream_unavailable', 'unknown_error'],
});

/** The Geocoding URL. Exported for tests ONLY: it carries the key, so it is never logged. */
export function geocodeUrl({ placeId, lang, apiKey }) {
  return `${GEOCODE_URL}?${new URLSearchParams({ place_id: placeId, language: lang, key: apiKey })}`;
}

/**
 * Google's formatted address for a validated place id.
 *
 * @param {object} args
 * @param {string} args.placeId  Validated against the handler's PLACE_ID_RE.
 * @param {string} args.lang
 * @param {string} args.apiKey
 * @param {typeof fetch} [args.fetchImpl]
 * @param {AbortSignal} [args.signal]
 * @returns {Promise<{ address: string }>}
 */
export async function resolvePlace({ placeId, lang, apiKey, fetchImpl = fetch, signal }) {
  const combined = deadline(signal);
  const res = await send(
    fetchImpl,
    geocodeUrl({ placeId, lang, apiKey }),
    { method: 'GET', headers: { Accept: 'application/json' } },
    combined
  );

  const status = res.status;
  if (status < 200 || status >= 300) {
    await discard(res);
    throw new ProviderError(codeForError(status, undefined), { httpStatus: status });
  }

  const body = await readJson(res, combined);
  if (!body || typeof body !== 'object' || typeof body.status !== 'string') {
    throw new ProviderError('upstream_http', { httpStatus: status, reason: 'bad_shape' });
  }
  if (body.status !== 'OK') {
    const [code, reason] = GEOCODE_STATUS[body.status] ?? ['upstream_http', 'unexpected_status'];
    throw new ProviderError(code, { httpStatus: status, reason });
  }
  const address = Array.isArray(body.results) ? body.results[0]?.formatted_address : undefined;
  if (typeof address !== 'string' || address.trim() === '') {
    throw new ProviderError('upstream_http', { httpStatus: status, reason: 'bad_shape' });
  }
  return { address };
}
