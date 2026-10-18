/**
 * Slack lines for subscription events (#95): a new subscription, a cancellation being scheduled,
 * and a subscription ending, posted to #beanies-joiners beside the client's "Family pod created!"
 * line. The family is identified the way the other Slack surfaces already do it: the family name
 * (as the join post shows it) or, without one, the owner's email DOMAIN only, plus the last 8
 * characters of the family id (the `id …tail` the telemetry error pages use). Never a full email.
 *
 * `formatSubscriptionMessage` is pure (unit-tested); `postToSlack` never throws and carries a
 * timeout, so a slow or dead webhook can only cost the webhook a few seconds, never a 500.
 */

/** A Slack post is a side channel; Stripe's webhook must not wait long for it. */
export const SLACK_TIMEOUT_MS = 3_000;

/**
 * What the Slack line needs beyond the row, expanded on the second retrieve (the row write's
 * retrieve stays unexpanded, so a bad expand can never fail the apply). On `2026-08-26.dahlia`
 * the coupon lives at `discount.source.coupon`, and `subscription.discounts` is an id array.
 */
export const SLACK_SUBSCRIPTION_EXPAND = Object.freeze([
  'latest_invoice',
  'discounts.source.coupon',
  'discounts.promotion_code',
]);

export const SLACK_KINDS = new Set(['created', 'cancel_scheduled', 'ended']);

const PLAN_LABELS = { basic: 'beanies basic', full: 'magic beans' };
const INTERVAL_LABELS = { month: 'monthly', year: 'yearly' };

/** Slack mrkdwn control characters (the telemetry Lambda's escape). */
export function slackEscape(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** `999, 'usd'` -> `USD 9.99`. USD/SGD only here, both two-decimal. Null when unusable. */
export function formatMoney(minor, currency) {
  if (typeof minor !== 'number' || !Number.isFinite(minor) || typeof currency !== 'string')
    return null;
  return `${currency.toUpperCase()} ${(minor / 100).toFixed(2)}`;
}

const isoDay = (iso) => (typeof iso === 'string' && iso.length >= 10 ? iso.slice(0, 10) : null);
const unixDay = (s) =>
  typeof s === 'number' && Number.isFinite(s)
    ? new Date(s * 1000).toISOString().slice(0, 10)
    : null;
const asObject = (v) => (v && typeof v === 'object' ? v : null);

/** `The Parkers · id …55555555`, or `owner @gmail.com · id …55555555` with no family name. */
export function familyIdentity({ familyId, familyName, ownerEmail } = {}) {
  const domain =
    typeof ownerEmail === 'string' && ownerEmail.includes('@') ? ownerEmail.split('@')[1] : null;
  const who = familyName
    ? slackEscape(familyName)
    : domain
      ? `owner @${slackEscape(domain)}`
      : 'unnamed family';
  return typeof familyId === 'string' && familyId
    ? `${who} · id …${slackEscape(familyId.slice(-8))}`
    : who;
}

/** The first expanded discount, from `discounts[]` (current) or the legacy single `discount`. */
function firstDiscount(sub) {
  const list = Array.isArray(sub?.discounts) ? sub.discounts.map(asObject).filter(Boolean) : [];
  return list[0] ?? asObject(sub?.discount);
}

/** `50% off forever · coupon \`PRE_V1_50\` (pre-v1) · code \`BEANIEV1\``, or `none`. */
function discountLine(sub) {
  const d = firstDiscount(sub);
  if (!d) {
    // Unexpanded ids still say "there is a discount", which beats a wrong "none".
    return Array.isArray(sub?.discounts) && sub.discounts.length
      ? 'yes (details unavailable)'
      : 'none';
  }
  const rawCoupon = d.source?.coupon ?? d.coupon;
  const coupon = asObject(rawCoupon);
  const couponId = coupon?.id ?? (typeof rawCoupon === 'string' ? rawCoupon : null);
  const off =
    typeof coupon?.percent_off === 'number'
      ? `${coupon.percent_off}% off`
      : typeof coupon?.amount_off === 'number'
        ? `${formatMoney(coupon.amount_off, coupon.currency) ?? coupon.amount_off} off`
        : null;
  const duration =
    coupon?.duration === 'repeating' && typeof coupon.duration_in_months === 'number'
      ? `for ${coupon.duration_in_months} month${coupon.duration_in_months === 1 ? '' : 's'}`
      : coupon?.duration === 'forever'
        ? 'forever'
        : coupon?.duration === 'once'
          ? 'once'
          : null;
  const promo = asObject(d.promotion_code)?.code;
  const parts = [
    [off, duration].filter(Boolean).join(' ') || null,
    couponId
      ? `coupon \`${slackEscape(couponId)}\`${coupon?.name ? ` (${slackEscape(coupon.name)})` : ''}`
      : null,
    promo ? `code \`${slackEscape(promo)}\`` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : 'yes';
}

/** The latest invoice's charge, else the item's list price, else `unknown`. */
function chargeLine(sub) {
  const invoice = asObject(sub?.latest_invoice);
  const paid = formatMoney(invoice?.amount_paid, invoice?.currency);
  if (paid) {
    const total = formatMoney(invoice.total, invoice.currency);
    return total && invoice.total !== invoice.amount_paid
      ? `${paid} (invoice total ${total}, ${slackEscape(invoice.status ?? 'unknown')})`
      : paid;
  }
  const price = sub?.items?.data?.[0]?.price;
  const list = formatMoney(price?.unit_amount, price?.currency);
  return list ? `${list} (list)` : 'unknown';
}

function trialLine(attrs, sub, now) {
  const end = typeof sub?.trial_end === 'number' ? sub.trial_end : null;
  if (end !== null && (attrs?.status === 'trialing' || end * 1000 > now.getTime()))
    return `yes, until ${unixDay(end)}`;
  return attrs?.status === 'trialing' ? 'yes' : 'no';
}

/**
 * One Slack mrkdwn message for a subscription event.
 *
 * @param {'created'|'cancel_scheduled'|'ended'} kind
 * @param {object} attrs   `subscriptionAttrs()` of the subscription just applied
 * @param {object} extras  `{ familyId, familyName?, ownerEmail?, cohort?, sub?, now? }`; `sub` is
 *   the subscription retrieved with `SLACK_SUBSCRIPTION_EXPAND`, or null when that read failed.
 */
export function formatSubscriptionMessage(kind, attrs, extras = {}) {
  const { sub = null, cohort = null, now = new Date() } = extras;
  const headline =
    kind === 'created'
      ? ':tada: *New subscription*'
      : kind === 'cancel_scheduled'
        ? `:wave: *Subscription cancelled, ends ${isoDay(attrs?.cancelAt) ?? 'unknown'}*`
        : ':no_entry: *Subscription ended*';
  const plan = PLAN_LABELS[attrs?.plan] ?? 'unknown plan';
  const interval = INTERVAL_LABELS[attrs?.interval] ?? 'unknown interval';
  const periodEnd = isoDay(attrs?.currentPeriodEnd) ?? 'unknown';
  const lines = [
    headline,
    `*Family:* ${familyIdentity(extras)}`,
    `*Plan:* ${plan} · ${interval}`,
    `*${kind === 'created' ? 'Charged' : 'Last charged'}:* ${chargeLine(sub)}`,
    `*Discount:* ${discountLine(sub)}`,
    kind === 'created'
      ? `*Renews on:* ${periodEnd}`
      : kind === 'cancel_scheduled'
        ? `*Paid through:* ${periodEnd}`
        : `*Ended:* ${unixDay(sub?.ended_at) ?? now.toISOString().slice(0, 10)}`,
    `*Cohort:* ${slackEscape(cohort ?? 'list')}`,
    `*Trial:* ${trialLine(attrs, sub, now)}`,
  ];
  // A created subscription that is not yet paying (incomplete, past_due) must not read as money in.
  if (kind === 'created' && attrs?.status && !['active', 'trialing'].includes(attrs.status))
    lines.push(`*Status:* ${slackEscape(attrs.status)}`);
  return lines.join('\n');
}

/**
 * POST `{ text }` to a Slack incoming webhook. Never throws. Awaited by the caller (a Lambda can
 * be frozen the moment the handler returns, dropping an in-flight socket), bounded by
 * `SLACK_TIMEOUT_MS`.
 *
 * @returns {Promise<{ ok: true } | { ok: false, reason: 'no_url'|'http_error'|'timeout'|'network', httpStatus?: number }>}
 */
export async function postToSlack(url, text, { fetchImpl } = {}) {
  if (!url) return { ok: false, reason: 'no_url' };
  const doFetch = fetchImpl ?? globalThis.fetch;
  try {
    const res = await doFetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
      signal: AbortSignal.timeout(SLACK_TIMEOUT_MS),
    });
    return res.ok ? { ok: true } : { ok: false, reason: 'http_error', httpStatus: res.status };
  } catch (err) {
    return {
      ok: false,
      reason: err?.name === 'TimeoutError' || err?.name === 'AbortError' ? 'timeout' : 'network',
    };
  }
}
