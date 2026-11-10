/**
 * Typed client for the anonymous `flight-status` proxy Lambda (#143, ADR-045):
 * `POST https://api.beanies.family/flight-status` with `{ flight, date }` only. No family id,
 * no route, no names: the Settings privacy sentence ("beanies sends only the flight number and
 * date") is literally true. The provider key lives in the Lambda; the client never sees vendor
 * fields, only the normalised `FlightLeg[]`.
 *
 * Phase 2 (ADR-046) adds the two alert routes beside it, `/subscribe` and `/unsubscribe`
 * (`subscribeAlert` / `unsubscribeAlert`): a flight number, a date, the provider's leg codes,
 * the revision this device knows, a push address and the entitlement token. Still no family
 * id and no names. All three calls share ONE request path, `postFlightStatus`.
 *
 * Pinia-free (the `recipeFetchService` pattern): only `flightStatusStore` calls this, and only
 * the store decides what an answer means, logs it, or retries (there are no retries in here).
 * Every failure is a typed `FlightStatusApiError` whose `devHint` is the developer's next step.
 *
 * `VITE_FLIGHT_STATUS_URL` / `VITE_FLIGHT_STATUS_API_KEY` are read at CALL time, so a test can
 * stub the env and nothing caches a stale endpoint. Either unset = `not_configured`, which the
 * store treats as a refresh skip (logged once), never a failure on the backoff ladder.
 */
import type { FlightLeg, FlightStatusErrorCode } from '@/types/flightStatus';
import { RemoteFetchError } from '@/services/remoteFetchError';
import { isNetworkError } from '@/utils/transientFailure';
import { timeoutSignal } from '@/utils/timing';
import { isFlightLeg, isObject } from '@/utils/flightStatus/guards';

/** One request's deadline: the Lambda's own provider timeout is 8 s inside a 10 s function. */
export const FLIGHT_STATUS_TIMEOUT_MS = 12_000;

/**
 * Every `code` the Lambda documents (`STATUS_FOR_CODE` in
 * `infrastructure/lambda/flight-status/createHandler.mjs`). A parity test imports the real
 * `ERROR_CODES` and fails on any drift.
 */
export const FLIGHT_STATUS_CODES = [
  'method_not_allowed',
  'unauthorized',
  'too_large',
  'bad_request',
  'bad_flight',
  'bad_date',
  'date_out_of_range',
  'rate_limited',
  'budget_exhausted',
  'upstream_timeout',
  'upstream_network',
  'upstream_auth',
  'upstream_rate_limited',
  'upstream_unavailable',
  'upstream_http',
  'internal_error',
  // Phase 2 (ADR-046): routing, the alert routes and the webhook.
  'not_found',
  'alert_token_rejected',
  'subscription_full',
  'alerts_unavailable',
  'webhook_rejected',
  'bad_platform',
  'bad_token',
  'bad_codes',
] as const;
export type FlightStatusLambdaCode = (typeof FLIGHT_STATUS_CODES)[number];

/**
 * Lambda code → the client's failure class (which drives the backoff ladder). Frozen and
 * exhaustively typed, so a code added to the Lambda cannot silently fall through.
 *  - Every refusal of OUR request is `http_4xx` (a bug or a stale build, never retried faster).
 *  - Both quota answers are `rate_limited`, which waits the full hour: the per-IP limit, the
 *    global daily cap (`budget_exhausted`), and the provider's own limit.
 *  - Every upstream failure is `http_5xx`, including the PROVIDER's timeout: `timeout` is kept
 *    for this client's own deadline, so the firehose can tell the two apart.
 */
export const CODE_TO_ERROR: Readonly<Record<FlightStatusLambdaCode, FlightStatusErrorCode>> =
  Object.freeze({
    method_not_allowed: 'http_4xx',
    unauthorized: 'http_4xx',
    too_large: 'http_4xx',
    bad_request: 'http_4xx',
    bad_flight: 'http_4xx',
    bad_date: 'http_4xx',
    date_out_of_range: 'http_4xx',
    rate_limited: 'rate_limited',
    budget_exhausted: 'rate_limited',
    upstream_timeout: 'http_5xx',
    upstream_network: 'http_5xx',
    upstream_auth: 'http_5xx',
    upstream_rate_limited: 'rate_limited',
    upstream_unavailable: 'http_5xx',
    upstream_http: 'http_5xx',
    internal_error: 'http_5xx',
    not_found: 'http_4xx',
    alert_token_rejected: 'http_4xx',
    subscription_full: 'http_4xx',
    alerts_unavailable: 'http_5xx',
    webhook_rejected: 'http_4xx',
    bad_platform: 'http_4xx',
    bad_token: 'http_4xx',
    bad_codes: 'http_4xx',
  });

/** A flight-status call that failed, classified. Only this service and the store import it. */
export class FlightStatusApiError extends RemoteFetchError<FlightStatusErrorCode> {
  /** The Lambda's `code`, when it sent one (console only). */
  readonly lambdaCode?: string;

  constructor(
    code: FlightStatusErrorCode,
    devHint: string,
    httpStatus?: number,
    lambdaCode?: string
  ) {
    super('flight-status', code, devHint, httpStatus);
    // Literal string, never a class name: the prod build minifies class names.
    this.name = 'FlightStatusApiError';
    this.lambdaCode = lambdaCode;
  }
}

export interface FlightLegsAnswer {
  legs: FlightLeg[];
  /** The Lambda's fetch time (ISO), which is older than now on a cache hit. */
  fetchedAt: string;
  /** Served from the Lambda's result cache (no provider units spent). */
  cached: boolean;
}

function endpoint(): { url: string; key: string } | null {
  const url = (import.meta.env.VITE_FLIGHT_STATUS_URL ?? '').trim();
  const key = (import.meta.env.VITE_FLIGHT_STATUS_API_KEY ?? '').trim();
  return url && key ? { url, key } : null;
}

/** True when this build can call the Lambda (both env values set). */
export function isFlightStatusConfigured(): boolean {
  return endpoint() !== null;
}

function errorName(e: unknown): string {
  return typeof e === 'object' && e !== null && 'name' in e ? String((e as Error).name) : '';
}

/** A rejected fetch or body read. The CALLER's signal decides `aborted`; any other abort is our
 *  deadline (the `openMeteo.classifyThrown` rule). */
function classifyThrown(
  e: unknown,
  signal: AbortSignal,
  callerSignal: AbortSignal | undefined,
  phase: 'request' | 'body'
): FlightStatusApiError {
  if (callerSignal?.aborted) return new FlightStatusApiError('aborted', 'The caller cancelled it');
  const name = errorName(e);
  if (name === 'TimeoutError' || name === 'AbortError' || signal.aborted) {
    return new FlightStatusApiError(
      'timeout',
      `No answer from the flight-status Lambda within ${FLIGHT_STATUS_TIMEOUT_MS / 1000}s`
    );
  }
  if (phase === 'body' && !isNetworkError(e)) {
    return new FlightStatusApiError('parse', 'The flight-status response body could not be read');
  }
  return new FlightStatusApiError(
    'network',
    'The request never reached the flight-status Lambda (offline, DNS, or a CORS or content blocker)'
  );
}

function statusClass(status: number): FlightStatusErrorCode {
  if (status === 429) return 'rate_limited';
  return status >= 500 ? 'http_5xx' : 'http_4xx';
}

/**
 * POST `body` to the flight-status Lambda at `path` ('' = the proxy, `/subscribe`,
 * `/unsubscribe`) and return the parsed 200 body, which is always a JSON object. The one
 * request path: endpoint, deadline, soft key, body read and code mapping live only here.
 * Throws `FlightStatusApiError` for everything else (a non-object 200 is `parse`).
 */
export async function postFlightStatus(
  path: '' | '/subscribe' | '/unsubscribe',
  body: Record<string, unknown>,
  callerSignal?: AbortSignal
): Promise<Record<string, unknown>> {
  const target = endpoint();
  if (!target) {
    throw new FlightStatusApiError(
      'not_configured',
      'Set VITE_FLIGHT_STATUS_URL and VITE_FLIGHT_STATUS_API_KEY (the flight_status_url terraform output)'
    );
  }
  const signal = timeoutSignal(FLIGHT_STATUS_TIMEOUT_MS, callerSignal);
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
    // An abort landing while the BODY streams rejects here, not at the fetch: a slow
    // connection (`timeout`), not a broken response (the `recipeFetchService.post` rule).
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
    const code = isObject(parsed) && typeof parsed.code === 'string' ? parsed.code : undefined;
    const mapped =
      code && Object.prototype.hasOwnProperty.call(CODE_TO_ERROR, code)
        ? CODE_TO_ERROR[code as FlightStatusLambdaCode]
        : statusClass(res.status);
    throw new FlightStatusApiError(
      mapped,
      `flight-status${path} answered HTTP ${res.status}${code ? ` (${code})` : ''}`,
      res.status,
      code
    );
  }
  if (!ok || !isObject(parsed)) {
    throw new FlightStatusApiError(
      'parse',
      `flight-status${path} answered 200 with a body that is not a JSON object`,
      res.status
    );
  }
  return parsed;
}

/**
 * Ask the Lambda for the legs of `flight` (e.g. "SQ318", already normalised by
 * `normaliseFlightNumber`) departing on `date` (`YYYY-MM-DD`, the departure airport's local
 * date). An empty `legs` is a valid answer (the provider has no such flight). Throws
 * `FlightStatusApiError` for everything else.
 */
export async function fetchFlightLegs(input: {
  flight: string;
  date: string;
  signal?: AbortSignal;
}): Promise<FlightLegsAnswer> {
  const body = await postFlightStatus('', { flight: input.flight, date: input.date }, input.signal);
  if (!Array.isArray(body.legs) || !body.legs.every(isFlightLeg)) {
    throw new FlightStatusApiError(
      'parse',
      'flight-status answered 200 with an unexpected shape: compare with providers/aerodatabox.mjs mapLeg',
      200
    );
  }
  return {
    legs: body.legs,
    fetchedAt: typeof body.fetchedAt === 'string' ? body.fetchedAt : new Date().toISOString(),
    cached: body.cached === true,
  };
}

/** What `/flight-status/subscribe` takes (plan requirement 15). */
export interface SubscribeAlertBody {
  flight: string;
  date: string;
  /** The provider's departure IATA of the leg this device matched. */
  dep: string;
  /** The provider's arrival IATA; absent = no arrival half. */
  arr?: string;
  /** The revision this device's plan holds (`registrationRev`). */
  rev: string;
  platform: 'ios' | 'android';
  lang: 'en' | 'zh';
  /** The push token. */
  token: string;
  /** The entitlement's alert token (`entitlement.flightAlertToken`). */
  alert: string;
}

/**
 * Register this device for pushes about one flight. `provider` is the server's own side
 * (`ready`: it holds a provider subscription; `pending`: another request is filling it):
 * either way the server holds this device's address, so the caller records the registration.
 * Only a literal `ready` confirms it: a literal `pending` is pending; anything else (missing,
 * misspelled, a future value) is `unknown`, which the caller records unconfirmed.
 */
export async function subscribeAlert(
  body: SubscribeAlertBody,
  signal?: AbortSignal
): Promise<{ provider: 'ready' | 'pending' | 'unknown' }> {
  const answer = await postFlightStatus('/subscribe', { ...body }, signal);
  return {
    provider:
      answer.provider === 'ready' || answer.provider === 'pending' ? answer.provider : 'unknown',
  };
}

/** Stop pushes about one flight to this push token. Needs no alert token (a lapsed family
 *  must still be able to leave); a repeat is a no-op on the server. */
export async function unsubscribeAlert(
  body: { flight: string; date: string; token: string },
  signal?: AbortSignal
): Promise<void> {
  await postFlightStatus('/unsubscribe', { ...body }, signal);
}
