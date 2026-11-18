/**
 * Typed client for the anonymous `place-search` proxy Lambda (#150, ADR-049):
 * `POST <VITE_PLACE_SEARCH_URL>/suggest` with `{ q, lang, bias? }` and
 * `POST <VITE_PLACE_SEARCH_URL>/resolve` with `{ placeId, lang }`. No family id, no member id,
 * no token: the Lambda builds the Google request itself and the client never sees vendor
 * fields, only `{ placeId, main, secondary }` and `{ placeId, address }`.
 *
 * Pinia-free (the `flightStatusApi` pattern): only `placeSearchStore` calls this, and only the
 * store decides what an answer means, logs it, or goes quiet. There are no retries in here.
 * Every failure is a typed `PlaceSearchApiError` whose `devHint` is the developer's next step
 * (console only, never the firehose).
 *
 * `VITE_PLACE_SEARCH_URL` / `VITE_PLACE_SEARCH_API_KEY` are read at CALL time, so a test can
 * stub the env and nothing caches a stale endpoint. Either unset = `not_configured`, a skip.
 */
import { RemoteFetchError } from '@/services/remoteFetchError';
import {
  PLACE_SEARCH_LAMBDA_CODES,
  type PlaceBias,
  type PlaceSearchErrorCode,
  type PlaceSearchLambdaCode,
  type PlaceSuggestion,
} from '@/types/placeSearch';
import { isNetworkError } from '@/utils/transientFailure';
import { timeoutSignal } from '@/utils/timing';

/** One request's deadline: the Lambda's provider budget is 6 s inside a 10 s function, so the
 *  server classifies a slow provider before the client gives up. */
export const PLACE_SEARCH_TIMEOUT_MS = 10_000;

/** Same shape the Lambda enforces (`PLACE_ID_RE`). */
const PLACE_ID_SHAPE = /^[\w-]{1,512}$/;

/** The developer's next step for every Lambda code (console only). Frozen and exhaustive. */
export const DEV_HINT_FOR_CODE: Readonly<Record<PlaceSearchLambdaCode, string>> = Object.freeze({
  method_not_allowed: 'The Lambda only takes POST; check the request in placeSearchApi.ts',
  unauthorized: "VITE_PLACE_SEARCH_API_KEY does not match the Lambda's PLACE_SEARCH_API_KEY",
  not_found:
    'VITE_PLACE_SEARCH_URL should end in /place-search (the client adds /suggest and /resolve)',
  too_large: 'The request body is over 1 KB; the query is capped at 200 characters',
  bad_request: 'The Lambda could not read the JSON body; check postPlaceSearch',
  bad_query:
    'The query was refused (3 to 200 characters, no line break, no link, no email); usePlaceSearch should have skipped it',
  bad_bias: 'The home-town bias point was refused; check settingsStore.weatherPlace',
  bad_place_id: 'The place id does not have the provider id shape',
  rate_limited:
    'This address hit the per-IP hourly limit; suggestions resume after retryAfterSeconds',
  budget_exhausted:
    'The global daily cap is used up (the daily-budget-exhausted alarm); suggestions resume at 00:00 UTC',
  budget_unavailable:
    'The Lambda cannot reach its counter table (rate-limit-store-unavailable alarm); check the table name and dynamodb:UpdateItem',
  upstream_timeout: 'The provider did not answer within the Lambda budget (6 s)',
  upstream_network: 'The Lambda could not reach the provider',
  upstream_auth:
    'The provider key is wrong, revoked or not enabled; see the provider-auth-failed alarm',
  upstream_rate_limited:
    "The provider is rate limiting the Lambda's key (provider-rate-limited alarm)",
  upstream_unavailable: 'The provider answered unavailable; usually transient',
  upstream_http: 'The provider answered an error or an unexpected shape; see the Lambda logs',
  internal_error: 'The Lambda threw; see the internal-error alarm and the Lambda logs',
});

/** A place-search call that failed, classified. Only this service and the store import it. */
export class PlaceSearchApiError extends RemoteFetchError<PlaceSearchErrorCode> {
  /** The Lambda's `retryAfterSeconds`, for the quiet period. */
  readonly retryAfterSeconds?: number;

  constructor(
    code: PlaceSearchErrorCode,
    devHint: string,
    httpStatus?: number,
    retryAfterSeconds?: number
  ) {
    super('place-search', code, devHint, httpStatus);
    // Literal string, never a class name: the prod build minifies class names.
    this.name = 'PlaceSearchApiError';
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

function endpoint(): { url: string; key: string } | null {
  const url = (import.meta.env.VITE_PLACE_SEARCH_URL ?? '').trim();
  const key = (import.meta.env.VITE_PLACE_SEARCH_API_KEY ?? '').trim();
  return url && key ? { url, key } : null;
}

/** True when this build can call the Lambda (both env values set). */
export function isPlaceSearchConfigured(): boolean {
  return endpoint() !== null;
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

function errorName(e: unknown): string {
  return typeof e === 'object' && e !== null && 'name' in e ? String((e as Error).name) : '';
}

/** A rejected fetch or body read. The CALLER's signal decides `aborted`; any other abort is our
 *  deadline. */
function classifyThrown(
  e: unknown,
  signal: AbortSignal,
  callerSignal: AbortSignal | undefined,
  phase: 'request' | 'body'
): PlaceSearchApiError {
  if (callerSignal?.aborted) return new PlaceSearchApiError('aborted', 'The caller cancelled it');
  const name = errorName(e);
  if (name === 'TimeoutError' || name === 'AbortError' || signal.aborted) {
    return new PlaceSearchApiError(
      'timeout',
      `No answer from the place-search Lambda within ${PLACE_SEARCH_TIMEOUT_MS / 1000}s`
    );
  }
  if (phase === 'body' && !isNetworkError(e)) {
    return new PlaceSearchApiError('parse', 'The place-search response body could not be read');
  }
  return new PlaceSearchApiError(
    'network',
    'The request never reached the place-search Lambda (offline, DNS, or a CORS or content blocker)'
  );
}

const isLambdaCode = (code: string): code is PlaceSearchLambdaCode =>
  (PLACE_SEARCH_LAMBDA_CODES as readonly string[]).includes(code);

/**
 * POST `body` to `<url><path>` and return the parsed 200 body (always a JSON object). The one
 * request path: endpoint, deadline, soft key, body read and code mapping live only here.
 */
async function postPlaceSearch(
  path: '/suggest' | '/resolve',
  body: Record<string, unknown>,
  callerSignal?: AbortSignal
): Promise<Record<string, unknown>> {
  const target = endpoint();
  if (!target) {
    throw new PlaceSearchApiError(
      'not_configured',
      'Set VITE_PLACE_SEARCH_URL and VITE_PLACE_SEARCH_API_KEY (the place_search_url terraform output)'
    );
  }
  if (callerSignal?.aborted) throw new PlaceSearchApiError('aborted', 'The caller cancelled it');
  const signal = timeoutSignal(PLACE_SEARCH_TIMEOUT_MS, callerSignal);
  let res: Response;
  try {
    res = await fetch(`${target.url.replace(/\/+$/, '')}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': target.key },
      body: JSON.stringify(body),
      signal,
    });
  } catch (e) {
    throw classifyThrown(e, signal, callerSignal, 'request');
  }

  let text: string;
  try {
    text = await res.text();
  } catch (e) {
    throw classifyThrown(e, signal, callerSignal, 'body');
  }
  let parsed: unknown = null;
  let ok = true;
  try {
    parsed = text ? (JSON.parse(text) as unknown) : null;
  } catch {
    ok = false;
  }

  if (!res.ok) {
    const raw = isObject(parsed) && typeof parsed.code === 'string' ? parsed.code : undefined;
    const retry =
      isObject(parsed) &&
      typeof parsed.retryAfterSeconds === 'number' &&
      Number.isFinite(parsed.retryAfterSeconds) &&
      parsed.retryAfterSeconds > 0
        ? parsed.retryAfterSeconds
        : undefined;
    if (raw && isLambdaCode(raw)) {
      throw new PlaceSearchApiError(
        raw,
        `place-search${path} answered HTTP ${res.status} (${raw}): ${DEV_HINT_FOR_CODE[raw]}`,
        res.status,
        retry
      );
    }
    const code = res.status === 429 ? 'rate_limited' : res.status >= 500 ? 'http_5xx' : 'http_4xx';
    throw new PlaceSearchApiError(
      code,
      `place-search${path} answered HTTP ${res.status} with no recognised code (a stale build or a gateway answer)`,
      res.status,
      retry
    );
  }
  if (!ok || !isObject(parsed)) {
    throw new PlaceSearchApiError(
      'parse',
      `place-search${path} answered 200 with a body that is not a JSON object`,
      res.status
    );
  }
  return parsed;
}

function isSuggestion(v: unknown): v is PlaceSuggestion {
  return (
    isObject(v) &&
    typeof v.placeId === 'string' &&
    PLACE_ID_SHAPE.test(v.placeId) &&
    typeof v.main === 'string' &&
    v.main.trim() !== '' &&
    typeof v.secondary === 'string'
  );
}

/**
 * Address suggestions for `q` (already trimmed; the Lambda refuses under 3 characters, links,
 * emails and line breaks). An empty list is a valid answer. Throws `PlaceSearchApiError`.
 */
export async function suggestPlaces(input: {
  q: string;
  lang: string;
  bias?: PlaceBias;
  signal?: AbortSignal;
}): Promise<PlaceSuggestion[]> {
  const body = await postPlaceSearch(
    '/suggest',
    { q: input.q, lang: input.lang, ...(input.bias ? { bias: input.bias } : {}) },
    input.signal
  );
  if (!Array.isArray(body.suggestions) || !body.suggestions.every(isSuggestion)) {
    throw new PlaceSearchApiError(
      'parse',
      'place-search/suggest answered 200 with an unexpected shape: compare with createHandler.mjs capSuggestions',
      200
    );
  }
  return body.suggestions.map((s) => ({
    placeId: s.placeId,
    main: s.main,
    secondary: s.secondary,
  }));
}

/**
 * The provider's formatted address for a picked suggestion (D2: the place line is Google's
 * formatted address, one Geocoding call on pick). Throws `PlaceSearchApiError`.
 */
export async function fetchPlaceAddress(input: {
  placeId: string;
  lang: string;
  signal?: AbortSignal;
}): Promise<{ placeId: string; address: string }> {
  const body = await postPlaceSearch(
    '/resolve',
    { placeId: input.placeId, lang: input.lang },
    input.signal
  );
  if (
    body.placeId !== input.placeId ||
    typeof body.address !== 'string' ||
    body.address.trim() === ''
  ) {
    throw new PlaceSearchApiError(
      'parse',
      'place-search/resolve answered 200 with an unexpected shape: compare with createHandler.mjs',
      200
    );
  }
  return { placeId: input.placeId, address: body.address.trim() };
}
