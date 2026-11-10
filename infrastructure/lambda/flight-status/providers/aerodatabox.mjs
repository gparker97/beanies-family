/**
 * AeroDataBox adapter for the `flight-status` Lambda (#143).
 *
 * The ONLY file that knows AeroDataBox's shape. It fetches `GET /flights/number/{flight}/{date}`
 * and maps each vendor `FlightContract` to the small beanies `FlightLeg` the client understands
 * (`src/types/flightStatus.ts`). A provider swap is a new sibling of this file plus terraform
 * variables; the client never sees a vendor field.
 *
 * Three channels sell the same API under the same path and query; only the base URL and the
 * auth header differ (`PROVIDER_MODES`). The key travels ONLY in a header, never in the URL, and
 * this module never logs: the handler owns every log line (it knows the request context).
 *
 * Contract with the handler: `fetchLegs` resolves `{ legs, status, quota }` or throws `ProviderError`
 * whose `code` is one of `PROVIDER_ERROR_CODES`. An unknown `mode` throws a plain `Error`
 * (a configuration bug, not an upstream failure).
 *
 * Also imported by Spike 0 (`scripts/spikes/flight-status-spike.mts`), so it stays dependency-free.
 */

// Provider number spellings ("SQ 318", "sq318") → "SQ318" by the request rule, one zip, one rule.
import { normaliseFlight } from '../http.mjs';

/** Our own ceiling on one provider call, combined with the caller's `signal`. */
export const PROVIDER_TIMEOUT_MS = 8000;

export const PROVIDER_MODES = Object.freeze(['direct', 'rapidapi', 'apimarket']);

const RAPIDAPI_HOST = 'aerodatabox.p.rapidapi.com';

/** Base URL and auth headers per channel. Same path and query on every one. */
const MODE_CONFIG = Object.freeze({
  direct: {
    base: 'https://api.aerodatabox.com',
    headers: (apiKey) => ({ 'X-Api-Key': apiKey }),
  },
  rapidapi: {
    base: `https://${RAPIDAPI_HOST}`,
    headers: (apiKey) => ({ 'X-RapidAPI-Key': apiKey, 'X-RapidAPI-Host': RAPIDAPI_HOST }),
  },
  apimarket: {
    base: 'https://prod.api.market/api/v1/aedbx/aerodatabox',
    headers: (apiKey) => ({ 'x-api-market-key': apiKey }),
  },
});

/** Fixed query: departure-local date, and nothing we do not use (`withFlightPlan` must stay
 *  false under the provider terms; it also costs more). */
const QUERY =
  'dateLocalRole=Departure&withLocation=false&withAircraftImage=false&withFlightPlan=false';

export const PROVIDER_ERROR_CODES = Object.freeze([
  'upstream_timeout',
  'upstream_network',
  'upstream_auth',
  'upstream_rate_limited',
  'upstream_unavailable',
  'upstream_http',
]);

/** A classified upstream failure. `httpStatus` is set when the provider answered. */
export class ProviderError extends Error {
  /**
   * @param {(typeof PROVIDER_ERROR_CODES)[number]} code
   * @param {{ httpStatus?: number, cause?: unknown }} [opts]
   */
  constructor(code, opts = {}) {
    super(`aerodatabox ${code}${opts.httpStatus ? ` (HTTP ${opts.httpStatus})` : ''}`, {
      cause: opts.cause,
    });
    this.name = 'ProviderError';
    this.code = code;
    if (opts.httpStatus !== undefined) this.httpStatus = opts.httpStatus;
  }
}

/**
 * Response headers that report the plan's units, as `[limit, remaining]` header names.
 * RapidAPI sends these on every answer for AeroDataBox (seen in Spike 0). No equivalent is
 * known for the direct or API.market channels, so there the answer carries `quota: null`.
 */
const QUOTA_HEADERS = Object.freeze([
  'x-ratelimit-api-units-limit',
  'x-ratelimit-api-units-remaining',
]);

/** A non-negative integer header value, else undefined. */
function unitCount(headers, name) {
  const raw = headers?.get?.(name);
  if (typeof raw !== 'string' || !/^\s*\d+\s*$/.test(raw)) return undefined;
  const n = Number(raw);
  return Number.isSafeInteger(n) ? n : undefined;
}

/**
 * The plan's units from a provider response's headers: `{ limit?, remaining? }` with only the
 * parseable fields, or null when neither header is present and parseable. Exported for tests.
 *
 * @param {Headers | undefined} headers
 * @returns {{ limit?: number, remaining?: number } | null}
 */
export function parseQuota(headers) {
  const limit = unitCount(headers, QUOTA_HEADERS[0]);
  const remaining = unitCount(headers, QUOTA_HEADERS[1]);
  if (limit === undefined && remaining === undefined) return null;
  return clean({ limit, remaining });
}

/** HTTP status → error code for a non-2xx answer. */
function codeForStatus(status) {
  if (status === 401 || status === 403) return 'upstream_auth';
  if (status === 429) return 'upstream_rate_limited';
  if (status >= 500) return 'upstream_unavailable';
  return 'upstream_http';
}

/** The request URL for a mode (exported for tests and the spike's printout; carries no key). */
export function buildUrl(mode, flight, date) {
  const cfg = MODE_CONFIG[mode];
  if (!cfg) {
    throw new Error(
      `aerodatabox: unknown mode "${mode}" (expected one of ${PROVIDER_MODES.join('|')})`
    );
  }
  return `${cfg.base}/flights/number/${encodeURIComponent(flight)}/${encodeURIComponent(date)}?${QUERY}`;
}

/**
 * Fetch every leg the provider has for `flight` departing (local) on `date`.
 *
 * @param {object} args
 * @param {string} args.flight   Normalised designator, e.g. "SQ318".
 * @param {string} args.date     YYYY-MM-DD, the departure-local date.
 * @param {string} args.apiKey
 * @param {'direct'|'rapidapi'|'apimarket'} [args.mode]
 * @param {typeof fetch} [args.fetchImpl]
 * @param {AbortSignal} [args.signal]  Caller's deadline; combined with `PROVIDER_TIMEOUT_MS`.
 * @returns {Promise<{ legs: object[], status: number,
 *   quota: { limit?: number, remaining?: number } | null }>}  204 → `legs: []`.
 */
export async function fetchLegs({
  flight,
  date,
  apiKey,
  mode = 'direct',
  fetchImpl = fetch,
  signal,
}) {
  const url = buildUrl(mode, flight, date);
  const timeout = AbortSignal.timeout(PROVIDER_TIMEOUT_MS);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;

  let res;
  try {
    res = await fetchImpl(url, {
      method: 'GET',
      headers: { Accept: 'application/json', ...MODE_CONFIG[mode].headers(apiKey) },
      signal: combined,
    });
  } catch (err) {
    // Any abort (our 8 s, or the handler's deadline) is a timeout: the handler has no
    // "caller went away" code, and from the client's side it is one.
    throw new ProviderError(combined.aborted ? 'upstream_timeout' : 'upstream_network', {
      cause: err,
    });
  }

  const status = res.status;
  if (status === 204) {
    await discard(res);
    return { legs: [], status, quota: parseQuota(res.headers) };
  }
  if (status < 200 || status >= 300) {
    await discard(res);
    throw new ProviderError(codeForStatus(status), { httpStatus: status });
  }

  let body;
  try {
    body = await res.json();
  } catch (err) {
    if (combined.aborted)
      throw new ProviderError('upstream_timeout', { httpStatus: status, cause: err });
    throw new ProviderError('upstream_http', { httpStatus: status, cause: err });
  }
  if (!Array.isArray(body)) throw new ProviderError('upstream_http', { httpStatus: status });

  const legs = [];
  for (const vendorLeg of body) {
    const leg = mapLeg(vendorLeg);
    if (leg) legs.push(leg);
  }
  return { legs, status, quota: parseQuota(res.headers) };
}

/** Release a body we will not read, so the socket returns to the pool. Never throws. */
async function discard(res) {
  try {
    await res.body?.cancel();
  } catch {
    // A body that cannot be cancelled is already closed; there is nothing to release.
  }
}

const str = (v) => (typeof v === 'string' && v.trim() !== '' ? v : undefined);

/** Drop undefined keys so the cached JSON carries only what the provider said. */
function clean(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) if (v !== undefined) out[k] = v;
  return out;
}

function mapSide(side, extraKey) {
  const s = side && typeof side === 'object' ? side : {};
  const airport = s.airport && typeof s.airport === 'object' ? s.airport : {};
  return clean({
    iata: str(airport.iata),
    icao: str(airport.icao),
    name: str(airport.name),
    timeZone: str(airport.timeZone),
    scheduledLocal: str(s.scheduledTime?.local),
    scheduledUtc: str(s.scheduledTime?.utc),
    revisedLocal: str(s.revisedTime?.local),
    terminal: str(s.terminal),
    gate: str(s.gate),
    [extraKey]: str(s[extraKey]),
    quality: Array.isArray(s.quality) ? s.quality.filter((q) => typeof q === 'string') : [],
  });
}

/**
 * One vendor `FlightContract` → beanies `FlightLeg`, or null for a cargo leg or a non-object.
 * `status` and `codeshareStatus` pass through verbatim (the vendor enums; see the `FlightLeg`
 * type comments), defaulting to `Unknown` when absent.
 */
export function mapLeg(vendorLeg) {
  if (!vendorLeg || typeof vendorLeg !== 'object' || Array.isArray(vendorLeg)) return null;
  if (vendorLeg.isCargo === true) return null;
  const airline =
    vendorLeg.airline && typeof vendorLeg.airline === 'object'
      ? clean({
          name: str(vendorLeg.airline.name),
          iata: str(vendorLeg.airline.iata),
          icao: str(vendorLeg.airline.icao),
        })
      : undefined;
  return clean({
    number: str(vendorLeg.number) ?? '',
    airline,
    status: str(vendorLeg.status) ?? 'Unknown',
    codeshareStatus: str(vendorLeg.codeshareStatus) ?? 'Unknown',
    isCargo: false,
    lastUpdatedUtc: str(vendorLeg.lastUpdatedUtc),
    departure: mapSide(vendorLeg.departure, 'checkInDesk'),
    arrival: mapSide(vendorLeg.arrival, 'baggageBelt'),
  });
}

// ── Flight Alert API (#143 Phase 2) ──────────────────────────────────────────────────────────
//
// Webhook subscriptions per flight NUMBER (no date), a separate credit balance, and the
// notification payload. Spike 1 (a)-(c): same paths on every channel, the usual auth headers; a
// subscription never expires and bills 1 credit per flight item per notification (retries
// again); at zero credits every subscription pauses; the provider signs nothing (the secret
// callback path is the authentication); the payload carries full legs (`mapLeg` reads them).
//
// `listAlerts` is the only function that sees a subscription's callback url. That url carries
// the webhook secret: it is returned to the sweep for matching and NEVER logged (this module logs
// nothing; the sweep logs counts only).

/** Each alerts call is capped at 3 s: the webhook must answer the provider inside its 10 s. */
export const ALERT_TIMEOUT_MS = 3000;
/** One retry on a non-2xx or a 10 s timeout; the webhook's claim-before-send makes it harmless. */
export const ALERT_MAX_DELIVERY_RETRIES = 1;
/** Ceiling on the notification id we key a replay guard on (a uuid in practice). */
const MAX_EVENT_ID = 128;

const finiteOrNull = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/**
 * The notification body → `{ eventId, flight, legs, creditsRemaining, attempt }`, or null when it
 * is not a notification we can act on. `flight` is the subscription subject's number (the
 * number we subscribed), falling back to the first item's; `legs` are beanies `FlightLeg`s.
 *
 * @param {unknown} body  The parsed JSON body.
 */
export function parseWebhook(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const eventId = typeof body.id === 'string' ? body.id.trim() : '';
  if (!eventId || eventId.length > MAX_EVENT_ID || !/^[\w-]+$/.test(eventId)) return null;
  const items = Array.isArray(body.flights) ? body.flights : null;
  if (!items) return null;
  const subject = body.subscription?.subject;
  const flight =
    (subject?.type === 'FlightByNumber' ? normaliseFlight(subject?.id) : null) ??
    normaliseFlight(items[0]?.number);
  if (!flight) return null;
  const legs = [];
  for (const item of items) {
    const leg = mapLeg(item);
    if (leg) legs.push(leg);
  }
  return {
    eventId,
    flight,
    legs,
    creditsRemaining: finiteOrNull(body.balance?.creditsRemaining),
    attempt: finiteOrNull(body.deliveryAttempt?.seqNo),
  };
}

/**
 * The alerts calls, bound to one key and channel, with the signatures the handlers use.
 * Each throws `ProviderError` exactly as `fetchLegs` does (an unset key is `upstream_auth`
 * before any network call).
 *
 * @param {{ apiKey: string, mode?: string, fetchImpl?: typeof fetch }} cfg
 */
export function createAlertsClient({ apiKey, mode = 'direct', fetchImpl = fetch } = {}) {
  const cfg = MODE_CONFIG[mode];
  if (!cfg) {
    throw new Error(
      `aerodatabox: unknown mode "${mode}" (expected one of ${PROVIDER_MODES.join('|')})`
    );
  }

  /** One call. Returns `{ status, body, quota }`; `body` is null for 204 or an empty answer. */
  async function call(method, path, payload) {
    if (!apiKey) throw new ProviderError('upstream_auth');
    const signal = AbortSignal.timeout(ALERT_TIMEOUT_MS);
    let res;
    try {
      res = await fetchImpl(`${cfg.base}${path}`, {
        method,
        headers: {
          Accept: 'application/json',
          ...(payload ? { 'Content-Type': 'application/json' } : {}),
          ...cfg.headers(apiKey),
        },
        ...(payload ? { body: JSON.stringify(payload) } : {}),
        signal,
      });
    } catch (err) {
      throw new ProviderError(signal.aborted ? 'upstream_timeout' : 'upstream_network', {
        cause: err,
      });
    }
    const status = res.status;
    if (status < 200 || status >= 300) {
      await discard(res);
      throw new ProviderError(codeForStatus(status), { httpStatus: status });
    }
    let text = '';
    try {
      text = await res.text();
    } catch (err) {
      throw new ProviderError(signal.aborted ? 'upstream_timeout' : 'upstream_http', {
        httpStatus: status,
        cause: err,
      });
    }
    let body = null;
    if (text.trim() !== '') {
      try {
        body = JSON.parse(text);
      } catch (err) {
        throw new ProviderError('upstream_http', { httpStatus: status, cause: err });
      }
    }
    return { status, body, quota: parseQuota(res.headers) };
  }

  return {
    /** Subscribe the number's webhook. @returns {Promise<{ id: string }>} */
    async subscribeAlert(flight, callbackUrl) {
      const { status, body } = await call(
        'POST',
        `/subscriptions/webhook/FlightByNumber/${encodeURIComponent(flight)}`,
        { url: callbackUrl, maxDeliveryRetries: ALERT_MAX_DELIVERY_RETRIES }
      );
      const id = typeof body?.id === 'string' ? body.id : null;
      if (!id) throw new ProviderError('upstream_http', { httpStatus: status });
      return { id };
    },

    /** Cancel one subscription. A 404 (already gone) counts as done. */
    async cancelAlert(id) {
      try {
        await call('DELETE', `/subscriptions/webhook/${encodeURIComponent(id)}`);
      } catch (err) {
        if (err?.httpStatus === 404) return;
        throw err;
      }
    },

    /**
     * Every webhook subscription on this key (global to the key, not to this Lambda):
     * `[{ id, flight, url }]`. `url` is the subscriber id of a webhook subscriber (the spec puts
     * it in `subscriber.id`; a top-level `url` is read too). `flight` is null for a subject that
     * is not a flight number. NEVER log a `url`.
     */
    async listAlerts() {
      const { body } = await call('GET', '/subscriptions/webhook');
      if (body === null) return [];
      if (!Array.isArray(body)) throw new ProviderError('upstream_http', { httpStatus: 200 });
      const out = [];
      for (const s of body) {
        const id = typeof s?.id === 'string' ? s.id : null;
        if (!id) continue;
        const url =
          typeof s.url === 'string'
            ? s.url
            : /webhook/i.test(String(s.subscriber?.type ?? '')) &&
                typeof s.subscriber?.id === 'string'
              ? s.subscriber.id
              : '';
        const flight = s.subject?.type === 'FlightByNumber' ? normaliseFlight(s.subject?.id) : null;
        out.push({ id, flight, url });
      }
      return out;
    },

    /** The credit balance, or null when the provider has no balance row yet (its empty 200/204). */
    async getBalance() {
      const { body } = await call('GET', '/subscriptions/balance');
      return finiteOrNull(body?.creditsRemaining);
    },

    /**
     * Move `credits` units of API quota into the alert balance.
     * @returns {Promise<{ creditsRemaining: number | null, quota: object | null }>}
     */
    async refillCredits(credits) {
      const { body, quota } = await call('POST', '/subscriptions/balance/refill', { credits });
      return { creditsRemaining: finiteOrNull(body?.creditsRemaining), quota };
    },

    parseWebhook,
  };
}
