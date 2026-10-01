/* global process, Buffer */
/**
 * A thin Stripe REST client for the billing Lambda (#95 Phase 5). No `stripe` npm package:
 * every Lambda in this repo is a zero-dependency zip, and the integration needs five calls.
 *
 * Every request:
 *   * is form-encoded (Stripe's wire format; nested params use bracket notation),
 *   * carries `Stripe-Version: STRIPE_API_VERSION` so a Dashboard default-version bump can
 *     never change the shape of what we read back (the webhook endpoint is created on the
 *     same version, see the runbook),
 *   * carries `AbortSignal.timeout(STRIPE_TIMEOUT_MS)` (the older Lambdas call fetch with no
 *     timeout; do not copy that),
 *   * turns any non-2xx, abort or network failure into ONE error class, `BillingUpstreamError`,
 *     which the handler maps to 502 `billing_upstream` and logs with its `action`.
 *
 * Reads `STRIPE_SECRET_KEY` at CALL time so tests can toggle it per case.
 */

/**
 * Pinned. `2026-03-25.dahlia` renamed Checkout's `ui_mode` enum (`embedded` -> `embedded_page`)
 * and the Stripe.js mount call; the client (`StripeCheckoutFrame.vue`, `@stripe/stripe-js` 9.x)
 * is written to the same train. Bumping this means re-reading both.
 */
export const STRIPE_API_VERSION = '2026-08-26.dahlia';
export const STRIPE_BASE_URL = 'https://api.stripe.com';
// Checkout makes THREE Stripe calls in a row (prices, create, stamp); 3 x 8 s plus two DynamoDB
// reads fits inside the function's 29 s, so a slow Stripe returns the typed 502 instead of a
// killed function (and an orphaned, unstampable session).
export const STRIPE_TIMEOUT_MS = 8_000;

export const UPSTREAM_REMEDIATION =
  'Check STRIPE_SECRET_KEY on the billing Lambda (modules/billing/main.tf), the Stripe status ' +
  "page (status.stripe.com), and the Lambda's outbound network. A 4xx here is a request our " +
  'code built wrongly or a missing Dashboard object (Price lookup_key, coupon, portal config).';

export class BillingUpstreamError extends Error {
  /**
   * @param {string} action   which call failed (`list_prices`, `create_checkout_session`, ...)
   * @param {number} httpStatus  Stripe's status, or 0 for a network/abort failure
   * @param {string} detail   Stripe's `error.message` (never sent to the client)
   * @param {string} [stripeCode]  Stripe's `error.code`, when present
   */
  constructor(action, httpStatus, detail, stripeCode) {
    super(`stripe ${action} failed (${httpStatus}): ${detail}`);
    this.name = 'BillingUpstreamError';
    this.action = action;
    this.httpStatus = httpStatus;
    this.detail = detail;
    this.stripeCode = stripeCode ?? null;
  }
}

/**
 * Flatten `{ a: { b: 1 }, c: [ { d: 'x' } ] }` into `a[b]=1&c[0][d]=x`. `null`/`undefined`
 * values are omitted; booleans become `true`/`false`; everything else is `String()`ed.
 */
export function encodeForm(obj) {
  const pairs = [];
  const walk = (value, key) => {
    if (value === null || value === undefined) return;
    if (Array.isArray(value)) {
      value.forEach((v, i) => walk(v, `${key}[${i}]`));
    } else if (typeof value === 'object') {
      for (const [k, v] of Object.entries(value)) walk(v, key ? `${key}[${k}]` : k);
    } else {
      pairs.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
    }
  };
  walk(obj, '');
  return pairs.join('&');
}

/**
 * One Stripe call. `params` is form-encoded into the body for POST and into the query for GET.
 * Returns the parsed JSON body. Throws `BillingUpstreamError` on every failure shape.
 */
export async function stripeRequest({ method, path, params, action, fetchImpl }) {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    throw new BillingUpstreamError(action, 0, 'STRIPE_SECRET_KEY is unset', 'config');
  }
  const doFetch = fetchImpl ?? globalThis.fetch;
  const encoded = params ? encodeForm(params) : '';
  const url = `${STRIPE_BASE_URL}${path}${method === 'GET' && encoded ? `?${encoded}` : ''}`;
  const headers = {
    Authorization: `Basic ${Buffer.from(`${secretKey}:`, 'utf8').toString('base64')}`,
    'Stripe-Version': STRIPE_API_VERSION,
    Accept: 'application/json',
  };
  const init = { method, headers, signal: AbortSignal.timeout(STRIPE_TIMEOUT_MS) };
  if (method !== 'GET') {
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
    init.body = encoded;
  }

  let res;
  try {
    res = await doFetch(url, init);
  } catch (err) {
    // AbortError (timeout) and every network failure land here.
    throw new BillingUpstreamError(
      action,
      0,
      err?.name === 'TimeoutError' || err?.name === 'AbortError'
        ? 'timeout'
        : String(err?.message ?? err)
    );
  }

  let body = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  if (!res.ok) {
    const e = body?.error ?? {};
    throw new BillingUpstreamError(action, res.status, e.message ?? `HTTP ${res.status}`, e.code);
  }
  return body;
}

// ── The five calls ───────────────────────────────────────────────────────────

/**
 * Prices are addressed by `lookup_key` (`<cohort>.<plan>.<interval>.<currency>`), never by id,
 * so no Price id lives in Terraform and the live cutover is "same lookup_keys in live".
 * Memoised per Lambda instance ON HITS ONLY: a miss is a config error worth re-checking on the
 * next request, after someone creates the Price.
 */
const priceCache = new Map();
export function __resetPriceCacheForTests() {
  priceCache.clear();
}

export async function findPriceByLookupKey(lookupKey, opts = {}) {
  if (priceCache.has(lookupKey)) return priceCache.get(lookupKey);
  const body = await stripeRequest({
    method: 'GET',
    path: '/v1/prices',
    params: { lookup_keys: [lookupKey], active: true, limit: 1 },
    action: 'list_prices',
    fetchImpl: opts.fetchImpl,
  });
  const price = body?.data?.[0] ?? null;
  if (price) priceCache.set(lookupKey, price);
  return price;
}

export function createCheckoutSession(params, opts = {}) {
  return stripeRequest({
    method: 'POST',
    path: '/v1/checkout/sessions',
    params,
    action: 'create_checkout_session',
    fetchImpl: opts.fetchImpl,
  });
}

/** `POST /v1/checkout/sessions/{id}`: only `metadata` is ever updated here (the claim proof). */
export function updateCheckoutSession(sessionId, params, opts = {}) {
  return stripeRequest({
    method: 'POST',
    path: `/v1/checkout/sessions/${encodeURIComponent(sessionId)}`,
    params,
    action: 'update_checkout_session',
    fetchImpl: opts.fetchImpl,
  });
}

export function retrieveCheckoutSession(sessionId, opts = {}) {
  return stripeRequest({
    method: 'GET',
    path: `/v1/checkout/sessions/${encodeURIComponent(sessionId)}`,
    action: 'retrieve_checkout_session',
    fetchImpl: opts.fetchImpl,
  });
}

export function retrieveSubscription(subscriptionId, opts = {}) {
  return stripeRequest({
    method: 'GET',
    path: `/v1/subscriptions/${encodeURIComponent(subscriptionId)}`,
    action: 'retrieve_subscription',
    fetchImpl: opts.fetchImpl,
  });
}

export function createPortalSession(params, opts = {}) {
  return stripeRequest({
    method: 'POST',
    path: '/v1/billing_portal/sessions',
    params,
    action: 'create_portal_session',
    fetchImpl: opts.fetchImpl,
  });
}
