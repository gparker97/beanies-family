/* global process */
/**
 * The place-search handler, as a factory (#150). `index.mjs` is the Lambda entry point and
 * carries the design header; read it first.
 *
 * WHY A FACTORY: the provider adapter is a dependency, not a global. `index.mjs` wires the real
 * Google adapter; the tests pass a fake one (or the real one over a fake fetch) plus an `env`
 * object and a clock, so no suite needs the network or module mocking. Everything read from the
 * environment is read ONCE, at cold start.
 *
 * ORDER, per route (as flight-status): method + soft key → 1 KB body cap + validation → per-IP
 * hourly token → the route's GLOBAL daily token → the provider (6 s budget) → the answer. No
 * cache: Places content may not be cached.
 *
 * No vendor field is named here: the adapter returns beanies shapes and throws
 * `ProviderError { code, httpStatus?, reason? }`. The answer caps (5 suggestions, 200 characters
 * a string, the place-id shape) are applied HERE so they hold for any adapter.
 */

import { BUDGET_EXHAUSTED_PREFIX, RATE_STORE_UNAVAILABLE_PREFIX, takeToken } from './store.mjs';
import {
  STATUS_FOR_CODE,
  UPSTREAM_CODES,
  corsHeaders,
  errorResponse,
  errorText,
  jsonResponse,
  logLine,
  parseOrigins,
  positiveInt,
  readJsonBody,
  softKeyOk,
} from './http.mjs';

export { STATUS_FOR_CODE, ERROR_CODES } from './http.mjs';

// ── Alarmed log prefixes ─────────────────────────────────────────────────────────────────────
// ⚠️ Each is matched VERBATIM by a metric filter in the ops repo's modules/place-search/main.tf,
// pinned by its __tests__/alarm-prefixes.test.mjs. Rewording one is a change to both repos.
export const PROVIDER_AUTH_FAILED_PREFIX = '[place-search] provider auth FAILED';
export const PROVIDER_RATE_LIMITED_PREFIX = '[place-search] provider rate limited';
export const INTERNAL_ERROR_PREFIX = '[place-search] internal error';
export { BUDGET_EXHAUSTED_PREFIX, RATE_STORE_UNAVAILABLE_PREFIX };

export const ALARMING_PREFIXES = Object.freeze({
  providerAuthFailed: PROVIDER_AUTH_FAILED_PREFIX,
  providerRateLimited: PROVIDER_RATE_LIMITED_PREFIX,
  budgetExhausted: BUDGET_EXHAUSTED_PREFIX,
  rateStoreUnavailable: RATE_STORE_UNAVAILABLE_PREFIX,
  internalError: INTERNAL_ERROR_PREFIX,
});

/** Logged at `warn` (NOT alarmed) for every other classified provider failure. */
export const PROVIDER_ERROR_PREFIX = '[place-search] provider error';

// ── Routes and limits ────────────────────────────────────────────────────────────────────────
/** API Gateway `routeKey`s, as modules/place-search/main.tf declares them. */
export const ROUTES = Object.freeze({
  suggest: 'POST /place-search/suggest',
  resolve: 'POST /place-search/resolve',
});

export const DEFAULT_IP_LIMIT = 60;
export const DEFAULT_DAILY_SUGGEST_CAP = 650;
export const DEFAULT_DAILY_RESOLVE_CAP = 320;

/** `{ "q": "<200 chars>", "lang": "zh-TW", "bias": {...} }` is well under this. */
export const MAX_BODY_BYTES = 1024;
export const MAX_SUGGESTIONS = 5;
export const MAX_TEXT_CHARS = 200;
export const MIN_QUERY_CHARS = 3;
export const MAX_QUERY_CHARS = 200;

/** The adapter's own fetch is capped at 6 s; never hand it more than the function has left. */
const PROVIDER_BUDGET_MS = 6000;
/** Kept back from the deadline for the response. */
const DEADLINE_SLACK_MS = 1000;

// ── Input rules ──────────────────────────────────────────────────────────────────────────────

/** Provider place id shape (Google's are 27 to 134 characters in the spike). */
export const PLACE_ID_RE = /^[\w-]{1,512}$/;
const COUNTRY_RE = /^[A-Za-z]{2}$/;
const LINE_BREAK_RE = /[\r\n\u0085\u2028\u2029]/;
/** An `@` followed by a dotted host: an email address, never an address to look up. */
const EMAIL_HOST_RE = /@[^\s@]+\.[^\s@]+/;

/**
 * Languages sent to the provider. Anything else falls back (primary subtag, then `en`) rather
 * than refusing: the value we send is always one of these constants, never the client's string,
 * and a client on an unlisted locale still gets suggestions.
 */
export const LANG_ALLOWLIST = Object.freeze([
  'en',
  'zh',
  'zh-CN',
  'zh-TW',
  'ja',
  'ko',
  'ms',
  'id',
  'th',
  'vi',
  'fr',
  'de',
  'es',
  'it',
  'pt',
  'nl',
]);
const LANG_BY_LOWER = new Map(LANG_ALLOWLIST.map((l) => [l.toLowerCase(), l]));

/** A client language tag → an allowlisted tag. Never refuses. */
export function normaliseLang(raw) {
  if (typeof raw !== 'string' || raw.length > 35) return 'en';
  const tag = raw.trim().replace(/_/g, '-').toLowerCase();
  return LANG_BY_LOWER.get(tag) ?? LANG_BY_LOWER.get(tag.split('-')[0]) ?? 'en';
}

/**
 * The query, trimmed, or null when refused (`bad_query`): not a string, a line break anywhere,
 * outside 3..200 characters after trimming, or anything that looks like a link (`://`) or an
 * email (`@` + dotted host). So a link or an email never reaches the provider from any client.
 */
export function normaliseQuery(raw) {
  if (typeof raw !== 'string' || LINE_BREAK_RE.test(raw)) return null;
  const q = raw.trim();
  if (q.length < MIN_QUERY_CHARS || q.length > MAX_QUERY_CHARS) return null;
  if (q.includes('://') || EMAIL_HOST_RE.test(q)) return null;
  return q;
}

const round2 = (n) => Math.round(n * 100) / 100;
const inRange = (n, lo, hi) => typeof n === 'number' && Number.isFinite(n) && n >= lo && n <= hi;

/**
 * The ranking hint, range-checked and RE-ROUNDED to 2 decimals here (about 1 km), whatever the
 * client sent. Absent (`undefined`/`null`) → no bias. Present but malformed → `bad_bias`.
 *
 * @returns {{ ok: true, bias?: { lat: number, lon: number, countryCode?: string } } | { ok: false }}
 */
export function normaliseBias(raw) {
  if (raw === undefined || raw === null) return { ok: true };
  if (typeof raw !== 'object' || Array.isArray(raw)) return { ok: false };
  const { lat, lon, countryCode } = raw;
  if (!inRange(lat, -90, 90) || !inRange(lon, -180, 180)) return { ok: false };
  const bias = { lat: round2(lat), lon: round2(lon) };
  if (countryCode !== undefined && countryCode !== null) {
    if (typeof countryCode !== 'string' || !COUNTRY_RE.test(countryCode)) return { ok: false };
    bias.countryCode = countryCode.toUpperCase();
  }
  return { ok: true, bias };
}

/** Clip to MAX_TEXT_CHARS without leaving half a surrogate pair. */
export function clip(text) {
  if (text.length <= MAX_TEXT_CHARS) return text;
  const cut = text.slice(0, MAX_TEXT_CHARS);
  return /[\uD800-\uDBFF]$/.test(cut) ? cut.slice(0, -1) : cut;
}

/** The adapter's suggestions → at most 5 well-formed, clipped rows. */
function capSuggestions(list) {
  const out = [];
  for (const s of list) {
    if (out.length >= MAX_SUGGESTIONS) break;
    if (typeof s?.placeId !== 'string' || !PLACE_ID_RE.test(s.placeId)) continue;
    if (typeof s.main !== 'string' || s.main.trim() === '') continue;
    out.push({
      placeId: s.placeId,
      main: clip(s.main),
      secondary: typeof s.secondary === 'string' ? clip(s.secondary) : '',
    });
  }
  return out;
}

/** A 200 answer that is not the agreed shape. Mapped to upstream_http, never to an empty list. */
class ShapeError extends Error {
  constructor() {
    super('provider answer is not the expected shape');
    this.name = 'ShapeError';
  }
}

/**
 * @param {object}    deps
 * @param {object}    deps.provider  `{ suggestPlaces, resolvePlace }` (the adapter namespace).
 * @param {object=}   deps.env       Defaults to `process.env`; read once, here.
 * @param {Function=} deps.now       Clock (epoch ms).
 * @param {Function=} deps.fetchImpl Passed to the adapter; defaults to global fetch.
 * @param {object=}   deps.ddb       `{ send, commands }`; otherwise ddb.mjs's seam/default client.
 */
export function createHandler({
  provider,
  env = process.env,
  now = () => Date.now(),
  fetchImpl = globalThis.fetch,
  ddb,
} = {}) {
  if (
    typeof provider?.suggestPlaces !== 'function' ||
    typeof provider?.resolvePlace !== 'function'
  ) {
    throw new TypeError(
      'createHandler: provider.suggestPlaces and provider.resolvePlace are required'
    );
  }

  const API_KEY = env.PLACE_SEARCH_API_KEY;
  const PROVIDER_KEY = env.PLACE_PROVIDER_API_KEY;
  const TABLE = env.COUNTER_TABLE || '';
  const IP_LIMIT = positiveInt(env.IP_LIMIT, DEFAULT_IP_LIMIT, 'IP_LIMIT');
  const CAPS = {
    suggest: positiveInt(env.DAILY_SUGGEST_CAP, DEFAULT_DAILY_SUGGEST_CAP, 'DAILY_SUGGEST_CAP'),
    resolve: positiveInt(env.DAILY_RESOLVE_CAP, DEFAULT_DAILY_RESOLVE_CAP, 'DAILY_RESOLVE_CAP'),
  };
  const ALLOWED_ORIGINS = parseOrigins(env.CORS_ORIGINS);

  /**
   * Per route: `parse(body)` → `{ ok: true, input, qLen? } | { ok: false, code }`,
   * `call(input, signal)` → the adapter's promise, `answer(input, result)` → `{ body, count }`
   * (throws ShapeError on a malformed result).
   */
  const SPECS = {
    [ROUTES.suggest]: {
      name: 'suggest',
      parse(body) {
        const q = normaliseQuery(body.q);
        if (q === null) return { ok: false, code: 'bad_query' };
        const bias = normaliseBias(body.bias);
        if (!bias.ok) return { ok: false, code: 'bad_bias' };
        // ONLY these three fields go on to the adapter; every other body field is dropped here.
        return {
          ok: true,
          qLen: q.length,
          input: { q, lang: normaliseLang(body.lang), bias: bias.bias },
        };
      },
      call: (input, signal) =>
        provider.suggestPlaces({ ...input, apiKey: PROVIDER_KEY, fetchImpl, signal }),
      answer(input, result) {
        if (!Array.isArray(result?.suggestions)) throw new ShapeError();
        const suggestions = capSuggestions(result.suggestions);
        return { body: { suggestions }, count: suggestions.length };
      },
    },
    [ROUTES.resolve]: {
      name: 'resolve',
      parse(body) {
        const placeId = body.placeId;
        if (typeof placeId !== 'string' || !PLACE_ID_RE.test(placeId)) {
          return { ok: false, code: 'bad_place_id' };
        }
        return { ok: true, input: { placeId, lang: normaliseLang(body.lang) } };
      },
      call: (input, signal) =>
        provider.resolvePlace({ ...input, apiKey: PROVIDER_KEY, fetchImpl, signal }),
      answer(input, result) {
        const address = result?.address;
        if (typeof address !== 'string' || address.trim() === '') throw new ShapeError();
        return { body: { placeId: input.placeId, address: clip(address.trim()) }, count: 1 };
      },
    },
  };

  async function serve(spec, event, context, headers, log) {
    const fail = (code, outcome, extra = {}) => {
      log.outcome = outcome;
      log.status = STATUS_FOR_CODE[code].status;
      log.code = code;
      logLine('place-search', log);
      return errorResponse(code, headers, extra);
    };

    if (event?.requestContext?.http?.method !== 'POST') {
      return fail('method_not_allowed', 'bad_request');
    }
    if (!softKeyOk(event, API_KEY)) return fail('unauthorized', 'bad_request');

    const read = readJsonBody(event, MAX_BODY_BYTES);
    if (!read.ok) return fail(read.code, 'bad_request');
    const parsed = spec.parse(read.body);
    if (!parsed.ok) return fail(parsed.code, 'bad_request');
    if (parsed.qLen !== undefined) log.q_len = parsed.qLen;
    const nowMs = now();

    // 1. Per-IP hourly limit (both routes share one bucket). sourceIp, never x-forwarded-for.
    const ipToken = await takeToken({
      kind: 'ip',
      ip: event?.requestContext?.http?.sourceIp,
      now: nowMs,
      ddb,
      limit: IP_LIMIT,
      table: TABLE,
    });
    if (!ipToken.allowed) {
      return fail('rate_limited', 'rate_limited', { retryAfterSeconds: ipToken.retryAfterSeconds });
    }

    // A missing provider key would fail at Google on every call. Say so with the alarmed prefix,
    // before a day token is spent on a call that cannot succeed.
    if (!PROVIDER_KEY) {
      console.error(
        `${PROVIDER_AUTH_FAILED_PREFIX} route=${spec.name} reason=key_unset\n` +
          'PLACE_PROVIDER_API_KEY is unset on the Lambda. Set TF_VAR_place_provider_api_key and apply module.place_search.'
      );
      return fail('upstream_auth', 'provider_error');
    }

    // 2. The route's GLOBAL daily cap: the one control that bounds the bill. Fails CLOSED.
    const dayToken = await takeToken({
      kind: spec.name,
      now: nowMs,
      ddb,
      limit: CAPS[spec.name],
      table: TABLE,
    });
    if (!dayToken.allowed) {
      if (dayToken.reason === 'limit') {
        console.error(
          `${BUDGET_EXHAUSTED_PREFIX} kind=${spec.name} cap=${CAPS[spec.name]}: refusing ` +
            `${spec.name} calls until 00:00 UTC (${dayToken.retryAfterSeconds}s); address fields ` +
            'go quiet and keep working as plain text. Expected under real growth or abuse: read ' +
            `the request lines before raising var.daily_${spec.name}_cap.`
        );
        return fail('budget_exhausted', 'budget_exhausted', {
          retryAfterSeconds: dayToken.retryAfterSeconds,
        });
      }
      // takeToken has already logged the alarmed store prefix with the remediation.
      return fail('budget_unavailable', 'budget_unavailable', {
        retryAfterSeconds: dayToken.retryAfterSeconds,
      });
    }

    // 3. The provider, once. No retry here: the client's next keystroke is the retry.
    const remainingMs =
      typeof context?.getRemainingTimeInMillis === 'function'
        ? context.getRemainingTimeInMillis()
        : Infinity;
    const signal = AbortSignal.timeout(
      Math.max(1000, Math.min(PROVIDER_BUDGET_MS, remainingMs - DEADLINE_SLACK_MS))
    );
    const started = Date.now();
    let answer;
    try {
      answer = spec.answer(parsed.input, await spec.call(parsed.input, signal));
    } catch (err) {
      log.provider_ms = Date.now() - started;
      if (err instanceof ShapeError) {
        console.warn(
          `${PROVIDER_ERROR_PREFIX} route=${spec.name} code=upstream_http reason=bad_shape: a 200 answer the handler could not read`
        );
        log.reason = 'bad_shape';
        return fail('upstream_http', 'provider_error');
      }
      const code = UPSTREAM_CODES.has(err?.code) ? err.code : null;
      // The adapter is contracted to throw only ProviderError; anything else is a bug.
      if (!code) throw err;
      const httpStatus = Number.isFinite(err?.httpStatus) ? err.httpStatus : '-';
      const reason = typeof err?.reason === 'string' ? err.reason : '-';
      if (reason !== '-') log.reason = reason;
      if (code === 'upstream_auth') {
        console.error(
          `${PROVIDER_AUTH_FAILED_PREFIX} route=${spec.name} http_status=${httpStatus} reason=${reason}\n` +
            'Google rejected PLACE_PROVIDER_API_KEY (revoked, restricted away from Places API (New) or ' +
            'Geocoding API, billing off, or the API not enabled). EVERY address suggestion is failing. ' +
            'Check the key in Google Cloud, then TF_VAR_place_provider_api_key.'
        );
      } else if (code === 'upstream_rate_limited') {
        console.error(
          `${PROVIDER_RATE_LIMITED_PREFIX} route=${spec.name} http_status=${httpStatus} reason=${reason}\n` +
            "Google answered with a rate limit. Its per-minute limit is under load, or the console's per-day quota is spent: check the quotas page for Places API (New) and Geocoding API."
        );
      } else {
        console.warn(
          `${PROVIDER_ERROR_PREFIX} route=${spec.name} code=${code} http_status=${httpStatus} reason=${reason}`
        );
      }
      return fail(code, 'provider_error');
    }
    log.provider_ms = Date.now() - started;

    log.outcome = answer.count === 0 ? 'provider_empty' : 'provider_ok';
    log.status = 200;
    log.count = answer.count;
    logLine('place-search', log);
    return jsonResponse(200, answer.body, headers);
  }

  /**
   * THE DISPATCH, inside ONE outer try/catch: nothing below is meant to throw (the store never
   * throws on a fault, the adapter throws only ProviderError), so anything that does is a bug,
   * answered with a clean CORS-bearing 500 and the alarmed internal-error prefix.
   */
  return async function handler(event, context) {
    let headers = { 'Content-Type': 'application/json' };
    // Every request line carries the same field set, so a Logs Insights query never meets a gap.
    const log = {
      route: null,
      outcome: 'bad_request',
      status: 0,
      count: null,
      provider_ms: null,
      q_len: null,
    };
    try {
      headers = corsHeaders(event, ALLOWED_ORIGINS);
      if (event?.requestContext?.http?.method === 'OPTIONS') {
        return jsonResponse(204, null, headers);
      }
      const spec = SPECS[event?.routeKey];
      if (!spec) {
        log.outcome = 'not_found';
        log.status = 404;
        log.code = 'not_found';
        logLine('place-search', log);
        return errorResponse('not_found', headers);
      }
      log.route = spec.name;
      return await serve(spec, event, context, headers, log);
    } catch (err) {
      console.error(`${INTERNAL_ERROR_PREFIX} route=${log.route ?? '-'}: ${errorText(err)}`);
      log.outcome = 'internal_error';
      log.status = 500;
      log.code = 'internal_error';
      logLine('place-search', log);
      return errorResponse('internal_error', headers);
    }
  };
}
