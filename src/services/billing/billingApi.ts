/**
 * The client's three calls to the billing Lambda (#95 Phase 5), over one `post()` helper.
 *
 * The routes sit on the shared registry API (`VITE_REGISTRY_API_URL`) and take the registry's
 * soft key, so no new bundle key. `VITE_BILLING_BASE_URL` is an OPTIONAL override read only
 * here: it exists so `npm run dev` can point at the local harness
 * (`infrastructure/lambda/billing/local.mjs`, `http://localhost:8787`) after the live-key
 * flip, when the prod Lambda can no longer be used for sandbox testing.
 *
 * Every failure, HTTP or network, becomes a `BillingApiError { code, httpStatus }` so the UI
 * maps one error shape to copy. The plan token travels in the BODY, never a header: the shared
 * API's CORS preflight allows only `Content-Type` and `x-api-key`.
 */

import type { PlanId, PlanInterval } from '@beanies/brand/pricing';
import { logEvent } from '@/services/telemetry';

const BASE_URL = import.meta.env.VITE_BILLING_BASE_URL || import.meta.env.VITE_REGISTRY_API_URL;
const API_KEY = import.meta.env.VITE_REGISTRY_API_KEY;

/** Lambda `code` values the UI distinguishes, plus the two client-side ones. */
export type BillingErrorCode =
  | 'invalid_request'
  | 'dev_origin'
  | 'unknown_family'
  | 'already_subscribed'
  | 'price_missing'
  | 'coupon_unset'
  | 'billing_upstream'
  | 'billing_store'
  | 'mismatch'
  | 'not_complete'
  | 'no_subscription'
  | 'bad_token'
  | 'no_customer'
  | 'unauthorized'
  | 'rate_limited'
  | 'network'
  | 'not_configured'
  | 'unknown';

export class BillingApiError extends Error {
  readonly code: BillingErrorCode;
  readonly httpStatus: number;
  constructor(code: BillingErrorCode, httpStatus: number, message?: string) {
    super(message ?? `billing ${code} (${httpStatus})`);
    this.name = 'BillingApiError';
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

export interface CheckoutSessionRequest {
  familyId: string;
  plan: PlanId;
  interval: PlanInterval;
  /** Lower-case ISO code, the Lambda's vocabulary (`usd` | `sgd`). */
  currency: 'usd' | 'sgd';
  /** Colours the embedded Checkout paints; there is no Appearance API on Embedded Checkout. */
  theme: 'light' | 'dark';
}

export interface CheckoutSession {
  sessionId: string;
  clientSecret: string;
}

const KNOWN: ReadonlySet<string> = new Set<BillingErrorCode>([
  'invalid_request',
  'dev_origin',
  'unknown_family',
  'already_subscribed',
  'price_missing',
  'coupon_unset',
  'billing_upstream',
  'billing_store',
  'mismatch',
  'not_complete',
  'no_subscription',
  'bad_token',
  'no_customer',
]);

async function post<T>(path: string, body: object, signal?: AbortSignal): Promise<T> {
  if (!BASE_URL || !API_KEY)
    throw new BillingApiError('not_configured', 0, 'billing endpoint unset');
  let res: Response;
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY },
      body: JSON.stringify(body),
      signal,
    });
  } catch (err) {
    throw new BillingApiError('network', 0, err instanceof Error ? err.message : String(err));
  }
  let json: { code?: string; error?: string } & Record<string, unknown> = {};
  try {
    json = (await res.json()) as typeof json;
  } catch (err) {
    // A non-JSON body (an API Gateway 429/503 page) is classified by status below; say so.
    logEvent({
      level: 'debug',
      surface: 'billing-ui',
      message: 'billing response body was not JSON',
      context: { action: 'non_json_body', http_status: res.status },
      error: err,
    });
    json = {};
  }
  if (!res.ok) {
    // 429 comes from the API Gateway route throttle (burst 5 / 2 rps), not the Lambda: no `code`.
    const code: BillingErrorCode =
      res.status === 401
        ? 'unauthorized'
        : res.status === 429
          ? 'rate_limited'
          : json.code && KNOWN.has(json.code)
            ? (json.code as BillingErrorCode)
            : 'unknown';
    throw new BillingApiError(
      code,
      res.status,
      typeof json.error === 'string' ? json.error : undefined
    );
  }
  return json as T;
}

export function createCheckoutSession(
  req: CheckoutSessionRequest,
  signal?: AbortSignal
): Promise<CheckoutSession> {
  return post<CheckoutSession>('/billing/checkout-session', req, signal);
}

/** `{ planToken }` on the first claim, `{}` on any later one. */
export function claim(
  req: { familyId: string; sessionId: string; clientSecret: string },
  signal?: AbortSignal
): Promise<{ planToken?: string }> {
  return post<{ planToken?: string }>('/billing/claim', req, signal);
}

export function createPortalSession(
  req: { familyId: string; planToken: string },
  signal?: AbortSignal
): Promise<{ url: string }> {
  return post<{ url: string }>('/billing/portal-session', req, signal);
}
