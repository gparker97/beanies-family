/* global process, Buffer */
/**
 * Billing Lambda (#95 Phase 5): the one place beanies.family talks to Stripe.
 *
 * Four routes on the shared HTTP API (`api.beanies.family`):
 *
 *   POST /billing/checkout-session  { familyId, plan, interval, currency, theme? }
 *                                   -> { sessionId, clientSecret }     (x-api-key)
 *   POST /billing/claim             { familyId, sessionId, clientSecret }
 *                                   -> { planToken } once, then {}      (x-api-key)
 *   POST /billing/portal-session    { familyId, planToken }
 *                                   -> { url }                          (x-api-key)
 *   POST /billing/webhook           Stripe event                        (Stripe-Signature ONLY)
 *
 * THE WEBHOOK ROUTE IS THE FIRST IN THIS REPO THAT SKIPS `x-api-key`. Its authentication is the
 * HMAC signature over the exact bytes Stripe sent (`webhookSignature.mjs`); Stripe cannot send
 * our bundle key, and a shared soft key on that route would add nothing to a real signature.
 *
 * WHAT THE ROW LOOKS LIKE AND WHO WRITES IT: `modules/billing/main.tf` header. Every write here
 * is an `UpdateItem SET` on this Lambda's own attributes (`ddb.mjs` `updateSetInput`), never a
 * PutItem, so the cohort script's `cohort`/`trialEndsAt` survive every webhook.
 *
 * ORDERING IS NOT A CONCERN, BY CONSTRUCTION: a webhook (and a claim) never trusts the event's
 * snapshot. Both retrieve the subscription from Stripe and write ITS CURRENT STATE, so a late
 * `created` cannot overwrite an earlier `updated`; duplicates converge. There is therefore no
 * event ledger and no second item shape in the table.
 *
 * DRY-RUN: nothing here enforces anything. The row is DATA; `BILLING_ENFORCE` (registry) and
 * the `pricing` flag (client) decide whether anyone acts on it.
 *
 * Every log line is either a JSON decision line (`msg`, `family_id_hash`, closed-enum fields)
 * or a `[billing] <prefix>` triage line with a remediation sentence. `WEBHOOK_APPLY_FAILED_PREFIX`
 * has a CloudWatch metric filter + alarm (`alarms.mjs` pins the string to the Terraform).
 */

import { hash, getRow, updateSetInput, resolveClient } from './ddb.mjs';
import { verifyStripeSignature, safeEqual } from './webhookSignature.mjs';
import {
  BillingUpstreamError,
  UPSTREAM_REMEDIATION,
  findPriceByLookupKey,
  createCheckoutSession,
  retrieveCheckoutSession,
  updateCheckoutSession,
  retrieveSubscription,
  createPortalSession,
} from './stripeApi.mjs';
import { WEBHOOK_APPLY_FAILED_PREFIX, UPSTREAM_ERROR_PREFIX } from './alarms.mjs';
import { randomBytes } from 'node:crypto';

// ── Vocabulary ───────────────────────────────────────────────────────────────

export const ROUTES = Object.freeze({
  checkout: '/billing/checkout-session',
  claim: '/billing/claim',
  portal: '/billing/portal-session',
  webhook: '/billing/webhook',
});

export const PLANS = new Set(['basic', 'full']);
export const INTERVALS = new Set(['month', 'year']);
export const CURRENCIES = new Set(['usd', 'sgd']);
export const COHORTS = new Set(['pre_v1', 'first_ten']);
/** The only cohort that is a COUPON; `first_ten` is its own set of Prices. */
export const COUPON_COHORT = 'pre_v1';
/** Statuses that block a second checkout. Mirrors registry `SUBSCRIBED_STATUSES`. */
export const SUBSCRIBED_STATUSES = new Set(['active', 'trialing', 'past_due']);
/** A subscription in one of these can never become the family's current one again. */
export const TERMINAL_STATUSES = new Set(['canceled', 'incomplete_expired']);
export const WEBHOOK_EVENTS = new Set([
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
]);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PLAN_TOKEN_RE = /^[A-Za-z0-9_-]{32,64}$/;

/**
 * Colours the embedded Checkout is asked to paint (`branding_settings`, per session). Embedded
 * Checkout has NO Appearance API on dahlia, so "dark mode" is these flat colours: page ground
 * and the house orange. Values mirror `packages/brand/theme.css` (`surface-raised` on dark).
 */
export const BRANDING = Object.freeze({
  light: {
    background_color: '#ffffff',
    button_color: '#f15d22',
    border_style: 'rounded',
    font_family: 'inter',
  },
  dark: {
    background_color: '#1e2a36',
    button_color: '#f15d22',
    border_style: 'rounded',
    font_family: 'inter',
  },
});

const CLAIM_REMEDIATION =
  'The payment completed but no plan token was issued. Re-run the claim from the Plan page, or ' +
  'mint one by hand: node scripts/billing-cohort.mjs --reissue-token <familyId> --apply.';
const WEBHOOK_APPLY_REMEDIATION =
  'Stripe will retry this event. Check BILLING_TABLE_NAME, the Lambda dynamodb:UpdateItem grant ' +
  'on the billing table, and STRIPE_SECRET_KEY (the subscription is re-read from Stripe on apply).';

// ── Env (read at call time) ──────────────────────────────────────────────────

const env = () => ({
  apiKey: process.env.BILLING_API_KEY || '',
  webhookSecret: process.env.STRIPE_WEBHOOK_SECRET || '',
  billingTable: process.env.BILLING_TABLE_NAME || '',
  registryTable: process.env.REGISTRY_TABLE_NAME || '',
  // The registry keeps localhost families in a separate DEV table (`tableForOrigin` in the
  // registry Lambda); checkout must look a family up where it registered.
  registryDevTable: process.env.REGISTRY_DEV_TABLE_NAME || '',
  // The `dev_origin` refusal protects MONEY: it fires only when this Lambda holds a LIVE key.
  // Before the live flip prod runs sandbox keys, and a localhost checkout against the sandbox is
  // exactly how the pricing flow is tested.
  // `sk_live_` or a restricted `rk_live_` (Stripe's recommended key shape for a narrow server).
  liveKey: /^(sk|rk)_live_/.test(process.env.STRIPE_SECRET_KEY || ''),
  coupon: process.env.STRIPE_PRE_V1_COUPON || '',
  allowedOrigins: (process.env.CORS_ORIGINS || 'https://app.beanies.family')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean),
  // Parsed EXACTLY as the registry Lambda parses the same variable (`||`: unset OR empty means
  // the localhost pair), so the two can never disagree on which registry table a localhost
  // family lives in.
  devOrigins: new Set(
    (process.env.DEV_ORIGINS || 'http://localhost:5173,http://localhost:4173')
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean)
  ),
});

// ── HTTP plumbing ────────────────────────────────────────────────────────────

function headersFor(event, allowedOrigins) {
  const origin = event?.headers?.origin;
  const allowedOrigin = origin && allowedOrigins.includes(origin) ? origin : allowedOrigins[0];
  return {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Headers': 'Content-Type, x-api-key',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };
}

function response(statusCode, body, event, allowedOrigins) {
  return {
    statusCode,
    headers: headersFor(event, allowedOrigins),
    body: body === null ? '' : JSON.stringify(body),
  };
}

/** The raw bytes of the request body. API Gateway v2 may base64-encode it. */
export function rawBodyOf(event) {
  if (typeof event?.body !== 'string') return Buffer.alloc(0);
  return event.isBase64Encoded
    ? Buffer.from(event.body, 'base64')
    : Buffer.from(event.body, 'utf8');
}

function parseJson(raw) {
  try {
    const v = JSON.parse(raw.toString('utf8') || '{}');
    return v && typeof v === 'object' ? v : null;
  } catch {
    return null;
  }
}

/** One structured JSON line. Hash only, never the family id, never a token or secret. */
function logLine(msg, familyId, fields = {}) {
  // eslint-disable-next-line no-console -- structured decision line, read by CloudWatch
  console.log(JSON.stringify({ msg, family_id_hash: familyId ? hash(familyId) : null, ...fields }));
}

function logUpstream(err, familyId) {
  console.error(
    `${UPSTREAM_ERROR_PREFIX} action=${err.action} http_status=${err.httpStatus} stripe_code=${err.stripeCode ?? '-'}\n${UPSTREAM_REMEDIATION}`,
    err.detail
  );
  logLine('billing_upstream_error', familyId, {
    action: err.action,
    http_status: err.httpStatus,
    stripe_code: err.stripeCode,
  });
}

// ── Row shaping ──────────────────────────────────────────────────────────────

/** `list.full.month.usd` -> `{ cohort: null, plan, interval, currency }`; null when malformed. */
export function parseLookupKey(lookupKey) {
  if (typeof lookupKey !== 'string') return null;
  const [cohort, plan, interval, currency, ...rest] = lookupKey.split('.');
  if (rest.length || !PLANS.has(plan) || !INTERVALS.has(interval) || !CURRENCIES.has(currency))
    return null;
  if (cohort !== 'list' && !COHORTS.has(cohort)) return null;
  return { cohort: cohort === 'list' ? null : cohort, plan, interval, currency };
}

export function lookupKeyFor({ cohort, plan, interval, currency }) {
  return `${cohort ?? 'list'}.${plan}.${interval}.${currency}`;
}

const idOf = (v) => (typeof v === 'string' ? v : v && typeof v === 'object' ? v.id : null);

/**
 * The subscription fields this Lambda owns, from Stripe's CURRENT subscription object.
 * `current_period_end` lives on the item since `2025-03-31.basil`.
 */
export function subscriptionAttrs(sub, now = new Date()) {
  const item = sub?.items?.data?.[0] ?? null;
  const parsed = parseLookupKey(item?.price?.lookup_key);
  const periodEnd =
    typeof item?.current_period_end === 'number'
      ? new Date(item.current_period_end * 1000).toISOString()
      : null;
  return {
    status: sub?.status ?? null,
    plan: parsed?.plan ?? null,
    interval: parsed?.interval ?? null,
    currency: parsed?.currency ?? null,
    currentPeriodEnd: periodEnd,
    stripeCustomerId: idOf(sub?.customer),
    stripeSubscriptionId: sub?.id ?? null,
    // When the subscription will END: flexible billing mode sets `cancel_at` (an instant);
    // classic sets `cancel_at_period_end` (then the end is the item's period end). Null when
    // it renews, in which case `applySubscription` REMOVES the attribute (an undone cancel).
    cancelAt:
      typeof sub?.cancel_at === 'number'
        ? new Date(sub.cancel_at * 1000).toISOString()
        : sub?.cancel_at_period_end === true
          ? periodEnd
          : null,
    updatedAt: now.toISOString(),
  };
}

/** Attributes a webhook REMOVES when the subscription no longer carries them. */
const CLEARABLE_SUBSCRIPTION_ATTRS = ['cancelAt', 'cancelAtPeriodEnd'];

/** Retrieve the subscription from Stripe and write its current state. Throws on any failure. */
async function applySubscription(familyId, subscriptionId, ddb) {
  const sub = await retrieveSubscription(subscriptionId);
  const attrs = subscriptionAttrs(sub);
  const { send, commands } = await resolveClient(ddb);
  const input = updateSetInput(
    env().billingTable,
    familyId,
    attrs,
    undefined,
    CLEARABLE_SUBSCRIPTION_ATTRS
  );
  await send(new commands.UpdateItemCommand(input));
  return attrs;
}

// ── Route handlers ───────────────────────────────────────────────────────────

async function handleCheckout(body, event, cfg, ddb) {
  const { familyId, plan, interval, currency, theme } = body;
  if (
    !UUID_RE.test(String(familyId)) ||
    !PLANS.has(plan) ||
    !INTERVALS.has(interval) ||
    !CURRENCIES.has(currency)
  ) {
    return { status: 400, body: { error: 'Invalid request', code: 'invalid_request' } };
  }
  // basic is sold by the year only (packages/brand/pricing.ts MODEL note).
  if (plan === 'basic' && interval !== 'year') {
    return { status: 400, body: { error: 'basic is yearly only', code: 'invalid_request' } };
  }
  const origin = event?.headers?.origin;
  const isDevOrigin = Boolean(origin && cfg.devOrigins.has(origin));
  if (isDevOrigin && cfg.liveKey) {
    // This module holds ONE key pair. A localhost checkout against LIVE keys would take real
    // money; after the live flip the local harness (local.mjs, sandbox keys) is the only place a
    // dev origin may check out. With a sandbox key there is no money to protect.
    logLine('checkout_refused', familyId, { reason: 'dev_origin' });
    return {
      status: 403,
      body: { error: 'Checkout is not available from a dev origin', code: 'dev_origin' },
    };
  }
  const registryTable =
    isDevOrigin && cfg.registryDevTable ? cfg.registryDevTable : cfg.registryTable;

  const [registry, billing] = await Promise.all([
    getRow(registryTable, familyId, ddb),
    getRow(cfg.billingTable, familyId, ddb),
  ]);
  if (!registry || registry.deletedAt) {
    logLine('checkout_refused', familyId, { reason: 'unknown_family' });
    return { status: 404, body: { error: 'Family not found', code: 'unknown_family' } };
  }
  if (billing && SUBSCRIBED_STATUSES.has(billing.status)) {
    logLine('checkout_refused', familyId, { reason: 'already_subscribed' });
    return {
      status: 409,
      body: { error: 'This family already has a plan', code: 'already_subscribed' },
    };
  }

  const cohort = billing && COHORTS.has(billing.cohort) ? billing.cohort : null;
  const lookupKey = lookupKeyFor({ cohort, plan, interval, currency });
  const price = await findPriceByLookupKey(lookupKey);
  if (!price) {
    console.error(
      `[billing] price_missing lookup_key=${lookupKey}\nCreate a Price with this lookup_key in the Stripe Dashboard (docs/runbooks/pricing-launch.md), same key in sandbox and live.`
    );
    logLine('checkout_refused', familyId, {
      reason: 'price_missing',
      cohort,
      plan,
      interval,
      currency,
    });
    return {
      status: 502,
      body: { error: 'That plan is not available right now', code: 'price_missing' },
    };
  }

  const params = {
    ui_mode: 'embedded_page',
    redirect_on_completion: 'never',
    mode: 'subscription',
    client_reference_id: familyId,
    line_items: [{ price: price.id, quantity: 1 }],
    metadata: { familyId },
    subscription_data: { metadata: { familyId }, billing_mode: { type: 'flexible' } },
    branding_settings: BRANDING[theme === 'dark' ? 'dark' : 'light'],
  };
  if (billing?.stripeCustomerId) params.customer = billing.stripeCustomerId;
  else if (registry.ownerEmail) params.customer_email = registry.ownerEmail;
  if (cohort === COUPON_COHORT) {
    if (!cfg.coupon) {
      console.error(
        '[billing] coupon_unset: STRIPE_PRE_V1_COUPON is empty; set TF_VAR_stripe_pre_v1_coupon and re-apply.'
      );
      logLine('checkout_refused', familyId, { reason: 'coupon_unset' });
      return {
        status: 502,
        body: { error: 'That plan is not available right now', code: 'coupon_unset' },
      };
    }
    params.discounts = [{ coupon: cfg.coupon }];
  }

  const session = await createCheckoutSession(params);
  // THE CLAIM PROOF TRAVELS WITH THE SESSION. Stripe does not echo `client_secret` once a session
  // completes, so the sha256 of the secret is stamped into the session's own metadata now, and
  // the claim compares the secret it is handed against `session.metadata.secretHash`. On the
  // session, not on the family's row: a row slot is last-writer-wins, and a family with two tabs
  // (or a remount racing a cold Lambda) pays in the session whose hash was just overwritten.
  if (typeof session?.client_secret === 'string') {
    await updateCheckoutSession(session.id, {
      metadata: { familyId, secretHash: hash(session.client_secret) },
    });
  }
  logLine('checkout_session_created', familyId, {
    plan,
    interval,
    currency,
    cohort,
    theme: theme === 'dark' ? 'dark' : 'light',
  });
  return { status: 200, body: { sessionId: session.id, clientSecret: session.client_secret } };
}

async function handleClaim(body, cfg, ddb) {
  const { familyId, sessionId, clientSecret } = body;
  if (
    !UUID_RE.test(String(familyId)) ||
    typeof sessionId !== 'string' ||
    !/^cs_[A-Za-z0-9_]+$/.test(sessionId) ||
    typeof clientSecret !== 'string' ||
    !clientSecret
  ) {
    return { status: 400, body: { error: 'Invalid request', code: 'invalid_request' } };
  }
  let session;
  try {
    session = await retrieveCheckoutSession(sessionId);
  } catch (err) {
    // An unknown session id is a bad claim, not a Stripe outage: never `billing_upstream`.
    if (err instanceof BillingUpstreamError && err.httpStatus === 404) {
      logLine('claim_refused', familyId, { reason: 'unknown_session' });
      return {
        status: 403,
        body: { error: 'That checkout does not belong to this family', code: 'mismatch' },
      };
    }
    throw err;
  }
  // WHAT PROVES THE CALLER PAID. Stripe does NOT echo `client_secret` on retrieve once a session
  // is complete (verified 2026-10-01 on dahlia: `client_secret: null`), so the secret is compared
  // against the sha256 THIS Lambda stamped into the session's metadata when it created it
  // (`handleCheckout`). The proof travels with the session, so two open sessions cannot clobber
  // each other; a session id alone (a Dashboard export, a support screenshot) is not enough. The
  // id is bound to this family by `client_reference_id`, the session must be `complete`, and the
  // token is minted once per subscription (atomic compare-and-set below).
  const stampedHash = session?.metadata?.secretHash;
  const secretOk =
    typeof session?.client_secret === 'string'
      ? safeEqual(session.client_secret, clientSecret)
      : typeof stampedHash === 'string' && safeEqual(hash(clientSecret), stampedHash);
  if (!secretOk || session?.client_reference_id !== familyId) {
    logLine('claim_refused', familyId, { reason: 'mismatch' });
    return {
      status: 403,
      body: { error: 'That checkout does not belong to this family', code: 'mismatch' },
    };
  }
  if (session.status !== 'complete') {
    logLine('claim_refused', familyId, { reason: 'not_complete', detail: session.status });
    return { status: 409, body: { error: 'Payment is not complete yet', code: 'not_complete' } };
  }
  const subscriptionId = idOf(session.subscription);
  if (!subscriptionId) {
    logLine('claim_refused', familyId, { reason: 'no_subscription' });
    return {
      status: 409,
      body: { error: 'No subscription on that checkout', code: 'no_subscription' },
    };
  }

  // Land the subscription NOW rather than waiting for the webhook: the client refreshes its
  // entitlement right after this call, and a webhook that arrives a few seconds later writes
  // the same current state (retrieve-then-upsert converges).
  await applySubscription(familyId, subscriptionId, ddb);

  // ONE atomic mint PER SUBSCRIPTION: the SET only lands when no token was claimed for this
  // subscription yet. Two concurrent claims (a double-tapped retry, two tabs) cannot both mint;
  // the loser gets `{}` exactly like a deliberate replay, and the token the winner's browser
  // stored is the one on the row. A family that cancels and later subscribes again gets a fresh
  // token for the new subscription (its old doc token stops working, which is correct).
  const planToken = randomBytes(32).toString('base64url');
  const { send, commands } = await resolveClient(ddb);
  try {
    const input = updateSetInput(
      cfg.billingTable,
      familyId,
      {
        planTokenHash: hash(planToken),
        tokenClaimedAt: new Date().toISOString(),
        claimedSubscriptionId: subscriptionId,
      },
      'attribute_not_exists(tokenClaimedAt) OR #claimedSubscriptionId <> :claimedSubscriptionId'
    );
    await send(new commands.UpdateItemCommand(input));
  } catch (err) {
    if (err?.name === 'ConditionalCheckFailedException') {
      logLine('claim_ok', familyId, { detail: 'already_claimed' });
      return { status: 200, body: {} };
    }
    throw err;
  }
  logLine('claim_ok', familyId, { detail: 'token_issued' });
  return { status: 200, body: { planToken } };
}

async function handlePortal(body, event, cfg, ddb) {
  const { familyId, planToken } = body;
  if (
    !UUID_RE.test(String(familyId)) ||
    typeof planToken !== 'string' ||
    !PLAN_TOKEN_RE.test(planToken)
  ) {
    return { status: 400, body: { error: 'Invalid request', code: 'invalid_request' } };
  }
  const billing = await getRow(cfg.billingTable, familyId, ddb);
  const tokenOk =
    typeof billing?.planTokenHash === 'string' && safeEqual(hash(planToken), billing.planTokenHash);
  if (!tokenOk) {
    logLine('portal_refused', familyId, { reason: 'bad_token' });
    return { status: 403, body: { error: 'That plan token is not valid', code: 'bad_token' } };
  }
  if (!billing.stripeCustomerId) {
    logLine('portal_refused', familyId, { reason: 'no_customer' });
    return { status: 409, body: { error: 'No billing account yet', code: 'no_customer' } };
  }
  const origin = event?.headers?.origin;
  const returnOrigin =
    origin && cfg.allowedOrigins.includes(origin) ? origin : cfg.allowedOrigins[0];
  const portal = await createPortalSession({
    customer: billing.stripeCustomerId,
    return_url: `${returnOrigin}/settings/plan`,
  });
  logLine('portal_session_created', familyId);
  return { status: 200, body: { url: portal.url } };
}

async function handleWebhook(event, cfg, ddb) {
  const raw = rawBodyOf(event);
  const header = event?.headers?.['stripe-signature'];
  if (!cfg.webhookSecret) {
    console.error(
      '[billing] webhook_secret_unset: STRIPE_WEBHOOK_SECRET is empty; set TF_VAR_stripe_webhook_secret from the Dashboard endpoint and re-apply.'
    );
    return { status: 500, body: { error: 'Webhook not configured', code: 'webhook_secret_unset' } };
  }
  const verdict = verifyStripeSignature({ header, rawBody: raw, secret: cfg.webhookSecret });
  if (!verdict.ok) {
    logLine('webhook_signature_failed', null, { reason: verdict.reason });
    return { status: 400, body: { error: 'Bad signature', code: 'bad_signature' } };
  }
  const evt = parseJson(raw);
  const type = evt?.type;
  const object = evt?.data?.object;
  logLine('webhook_received', object?.metadata?.familyId, { kind: type ?? 'unknown' });
  if (!WEBHOOK_EVENTS.has(type)) {
    logLine('webhook_ignored', null, { reason: 'unknown_type', kind: type ?? 'unknown' });
    return { status: 200, body: { ignored: 'unknown_type' } };
  }
  const familyId = object?.metadata?.familyId;
  if (!UUID_RE.test(String(familyId))) {
    logLine('webhook_ignored', null, { reason: 'no_family_id', kind: type });
    return { status: 200, body: { ignored: 'no_family_id' } };
  }
  try {
    // "Retrieve-then-upsert converges" holds PER SUBSCRIPTION. A retried event for an OLD
    // subscription (cancelled, then the family re-subscribed) must not overwrite the current
    // one's row with `canceled`; it is acknowledged and ignored.
    const current = await getRow(cfg.billingTable, familyId, ddb);
    if (current?.stripeSubscriptionId && current.stripeSubscriptionId !== object.id) {
      const old = await retrieveSubscription(object.id);
      if (TERMINAL_STATUSES.has(old?.status)) {
        logLine('webhook_ignored', familyId, { reason: 'superseded_subscription', kind: type });
        return { status: 200, body: { ignored: 'superseded_subscription' } };
      }
    }
    // The event's snapshot is deliberately ignored: applySubscription re-reads the subscription.
    const attrs = await applySubscription(familyId, object.id, ddb);
    logLine('webhook_applied', familyId, { kind: type, status: attrs.status, plan: attrs.plan });
    return { status: 200, body: { ok: true } };
  } catch (err) {
    // 500 so Stripe retries (up to three days live). The alarmed prefix pages once.
    console.error(`${WEBHOOK_APPLY_FAILED_PREFIX} kind=${type}\n${WEBHOOK_APPLY_REMEDIATION}`, err);
    logLine('webhook_apply_failed', familyId, {
      kind: type,
      action: err instanceof BillingUpstreamError ? err.action : 'ddb_update',
    });
    return { status: 500, body: { error: 'Could not apply event', code: 'apply_failed' } };
  }
}

// ── Entry ────────────────────────────────────────────────────────────────────

/**
 * @param {object} event  HTTP API v2 proxy event. The SECOND Lambda argument is the runtime
 * `context`, never a dependency: tests inject DynamoDB through `__setDdbClientForTests` only.
 * (An earlier draft took an injected client here, and the runtime's context object was
 * resolved as the client in prod: `commands` undefined on the first real request.)
 */
export async function handler(event) {
  const ddb = undefined;
  const cfg = env();
  const respond = (status, body) => response(status, body, event, cfg.allowedOrigins);
  const method = event?.requestContext?.http?.method;
  const path = event?.requestContext?.http?.path ?? event?.rawPath ?? '';
  if (method === 'OPTIONS') return respond(204, null);
  if (method !== 'POST') return respond(405, { error: 'Method not allowed' });

  if (path === ROUTES.webhook) {
    const r = await handleWebhook(event, cfg, ddb);
    return respond(r.status, r.body);
  }

  // Soft API key on the three client routes, failing closed when unset (ai-extract's shape).
  const key = event?.headers?.['x-api-key'];
  if (!cfg.apiKey || key !== cfg.apiKey) return respond(401, { error: 'Unauthorized' });
  if (!cfg.billingTable) {
    console.error(
      '[billing] table_unset: BILLING_TABLE_NAME is empty; wire module.billing.table_name into the Lambda env.'
    );
    return respond(500, { error: 'Billing not configured', code: 'table_unset' });
  }

  const body = parseJson(rawBodyOf(event));
  if (!body) return respond(400, { error: 'Invalid JSON', code: 'invalid_request' });

  try {
    let r;
    if (path === ROUTES.checkout) r = await handleCheckout(body, event, cfg, ddb);
    else if (path === ROUTES.claim) r = await handleClaim(body, cfg, ddb);
    else if (path === ROUTES.portal) r = await handlePortal(body, event, cfg, ddb);
    else return respond(404, { error: 'Not found' });
    return respond(r.status, r.body);
  } catch (err) {
    if (err instanceof BillingUpstreamError) {
      logUpstream(err, body.familyId);
      return respond(502, { error: 'Stripe could not be reached', code: 'billing_upstream' });
    }
    if (path === ROUTES.claim) {
      console.error(`[billing] claim_failed\n${CLAIM_REMEDIATION}`, err);
      logLine('claim_failed', body.familyId, { action: 'ddb' });
    } else {
      console.error(
        '[billing] store_error: check BILLING_TABLE_NAME / REGISTRY_TABLE_NAME and the Lambda dynamodb:GetItem / UpdateItem grants.',
        err
      );
      logLine('billing_store_error', body.familyId, { path });
    }
    return respond(500, { error: 'Billing is unavailable right now', code: 'billing_store' });
  }
}
