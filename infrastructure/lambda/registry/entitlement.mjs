/**
 * What a family is entitled to right now: beta, trial, active or read-only (#95).
 *
 * THE ONLY PLACE THE TRIAL AND LAPSE RULES LIVE
 * Every client (web, iOS, Android) learns its plan from the registry GET it already makes, and
 * the registry answers by calling this function. The client never computes the trial clock; it
 * only applies the 14-day offline rule to a cached answer. A second copy of these rules (in the
 * client, in the billing Lambda, in the trial-reminder job) would be a second clock that can
 * disagree with this one, and the day they disagree a family is told two different things about
 * whether it can still write. So anything that needs the rule imports this file.
 *
 * PURE, ON PURPOSE
 * No AWS imports, no `process.env`, no clock, no logging. The caller passes `now`, `launchAt` and
 * `enforce` in, which is what lets the table test pin every branch without a mock, and what lets
 * `lambdaContractParity.test.ts` import the state vocabulary straight from here. The registry
 * handler owns the I/O (the billing GetItem, the env vars, the structured log line).
 *
 * THE RULES, IN ORDER (first match wins)
 *   1. Billing status active | trialing | past_due       -> `active`, reason `subscribed`,
 *      whether or not V1_LAUNCH_AT is set: a family that is paying is active, before launch too
 *      (which is also what lets the Phase 5 sandbox run end to end pre-launch). `past_due` is
 *      still paying: Stripe's Smart Retries are running. Lapse is `unpaid` or `canceled`, which
 *      fall through to the trial clock below.
 *   2. A valid `billing.trialEndsAt` override             -> that is the trial end, even with no
 *      launch date. It is written only by scripts/billing-cohort.mjs, and it is how the prod
 *      soak runs before launch (greg's test family) and the only support lever for extending a
 *      trial. `now < trialEndsAt` -> `trial`; otherwise `read_only` as in rule 4.
 *   3. No valid `launchAt` (V1_LAUNCH_AT unset)          -> `beta`, reason `no_launch`,
 *      trialEndsAt null. No trial clock runs for anyone else until launch.
 *   4. trialEndsAt = max(createdAt, launchAt) + TRIAL_DAYS. Beta families get a fresh 90 days
 *      from launch, which is what the `max` does. `now < trialEndsAt` -> `trial`, reason
 *      `in_trial`; otherwise `read_only`, reason `lapsed` when a subscription ever existed (the
 *      billing row carries `stripeSubscriptionId`), else `trial_ended`.
 *
 * For `active`, `trialEndsAt` is still reported (the override, or the launch-derived date) when
 * one exists, else null.
 *
 * NEVER THROWS
 * A missing or unparseable `createdAt` is treated as `now`: the family gets the full trial, never
 * an instant read-only. That is the generous failure, and the caller logs it (see
 * `isValidInstant`, which the registry uses to decide whether to warn). An unparseable override
 * is ignored in favour of the computed date; an unparseable `launchAt` is treated as unset.
 *
 * DATES
 * Every date in and out is an ISO-8601 string (or null). The billing row stores `trialEndsAt` and
 * `currentPeriodEnd` as ISO strings; the Phase 5 webhook converts Stripe's epoch seconds before
 * writing, so no reader ever has to guess whether a number is seconds or milliseconds.
 */

/** The trial length the pricing page sells. Mirrored by `@beanies/brand/pricing` (Phase 2). */
export const TRIAL_DAYS = 90;

const DAY_MS = 24 * 60 * 60 * 1000;

/** The four states the client renders. The client type is asserted against these (Phase 4). */
export const ENTITLEMENT_STATES = Object.freeze({
  beta: 'beta',
  trial: 'trial',
  active: 'active',
  readOnly: 'read_only',
});

/** Why the state is what it is. One reason per branch above, so a log line explains itself. */
export const ENTITLEMENT_REASONS = Object.freeze({
  noLaunch: 'no_launch',
  inTrial: 'in_trial',
  subscribed: 'subscribed',
  trialEnded: 'trial_ended',
  lapsed: 'lapsed',
});

/**
 * Stripe subscription statuses that still count as paying. Everything else (`unpaid`,
 * `canceled`, `incomplete`, `incomplete_expired`, `paused`, or no row at all) falls through to
 * the trial clock.
 */
export const SUBSCRIBED_STATUSES = new Set(['active', 'trialing', 'past_due']);

/** Epoch ms for an ISO string, or null when it is absent or does not parse. */
function toMs(value) {
  if (typeof value !== 'string' || value === '') return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * True when `value` is an ISO date string that parses. Exported so the registry can log the
 * "createdAt was unusable, trial computed from now" case without re-deriving the parse rule.
 */
export function isValidInstant(value) {
  return toMs(value) !== null;
}

/**
 * A #125 step-1 row: sign-up started, no pod ever created (its trial has not started). Every other
 * live row is a pod, including legacy rows with neither field.
 *
 * THE ONE DEFINITION of "pod exists". It lives here because this module already says what
 * `createdAt` means, and the registry handler, `scripts/billing-cohort.mjs` and the ops scripts
 * (through `scripts/lib/registryRows.mjs`) all import it. Never key on `fileId` instead: a
 * local-file pod has none.
 */
export const isNeverFinishedRow = (row) => !!row?.signupStartedAt && !row?.createdAt;

/** ISO string for a valid instant, else null. Normalises the billing row's dates on the way out. */
function toIso(value) {
  const ms = toMs(value);
  return ms === null ? null : new Date(ms).toISOString();
}

/**
 * @param {object}  args
 * @param {string=} args.createdAt  The registry row's server-stamped creation time (ISO).
 * @param {object=} args.billing    The billing-table row, or null/undefined when there is none.
 * @param {string=} args.launchAt   V1_LAUNCH_AT (ISO). Empty/unset means beta, unless the
 *                                  family is subscribed or has a trialEndsAt override.
 * @param {number=} args.now        Epoch ms. Injectable so tests need no clock control.
 * @param {boolean=} args.enforce   BILLING_ENFORCE. Passed through untouched: the client
 *                                  displays the state in dry-run and acts only when true.
 * @returns {{
 *   state: 'beta'|'trial'|'active'|'read_only',
 *   reason: 'no_launch'|'in_trial'|'subscribed'|'trial_ended'|'lapsed',
 *   plan: string|null, cohort: string|null, trialEndsAt: string|null,
 *   currentPeriodEnd: string|null, cancelAt: string|null, pastDue: boolean,
 *   interval: 'month'|'year'|null, currency: string|null, enforced: boolean, serverTime: string }}
 */
export function computeEntitlement({
  createdAt,
  billing,
  launchAt,
  now = Date.now(),
  enforce,
} = {}) {
  const nowMs = Number.isFinite(now) ? now : Date.now();
  const row = billing && typeof billing === 'object' ? billing : null;

  const base = {
    plan: null,
    cohort: row?.cohort ?? null,
    trialEndsAt: null,
    currentPeriodEnd: null,
    // Subscription detail, meaningful only when `active` (null/false otherwise):
    //   cancelAt   the family cancelled; everything stays included until this instant, then
    //              the subscription ends (Stripe fires `deleted` and the row reads `canceled`).
    //   pastDue    a renewal payment failed and Stripe is retrying; still entitled.
    //   interval / currency  what they are paying, for the card's wording.
    cancelAt: null,
    pastDue: false,
    interval: null,
    currency: null,
    enforced: enforce === true,
    serverTime: new Date(nowMs).toISOString(),
  };

  const launchMs = toMs(launchAt);
  const overrideMs = toMs(row?.trialEndsAt);
  // Missing or garbage createdAt => now: a full trial, never an instant read-only.
  const createdMs = toMs(createdAt) ?? nowMs;
  // Rules 2 and 4: the override wins; else the launch-derived date; else no trial clock at all.
  const trialEndsMs =
    overrideMs ?? (launchMs === null ? null : Math.max(createdMs, launchMs) + TRIAL_DAYS * DAY_MS);
  const trialEndsAt = trialEndsMs === null ? null : new Date(trialEndsMs).toISOString();

  // Rule 1: paying is active, launch or no launch.
  if (row && SUBSCRIBED_STATUSES.has(row.status)) {
    return {
      ...base,
      state: ENTITLEMENT_STATES.active,
      reason: ENTITLEMENT_REASONS.subscribed,
      plan: row.plan ?? null,
      trialEndsAt,
      currentPeriodEnd: toIso(row.currentPeriodEnd),
      // `cancelAt` is what the billing Lambda writes now; rows written before 2026-10-01 carry
      // only the boolean `cancelAtPeriodEnd` marker, for which the end is the period end.
      cancelAt:
        toIso(row.cancelAt) ??
        (row.cancelAtPeriodEnd === 'true' || row.cancelAtPeriodEnd === true
          ? toIso(row.currentPeriodEnd)
          : null),
      pastDue: row.status === 'past_due',
      interval: row.interval === 'month' || row.interval === 'year' ? row.interval : null,
      currency: typeof row.currency === 'string' && row.currency ? row.currency : null,
    };
  }

  // Rule 3: no override and no launch date means beta.
  if (trialEndsMs === null) {
    return { ...base, state: ENTITLEMENT_STATES.beta, reason: ENTITLEMENT_REASONS.noLaunch };
  }

  if (nowMs < trialEndsMs) {
    return {
      ...base,
      state: ENTITLEMENT_STATES.trial,
      reason: ENTITLEMENT_REASONS.inTrial,
      trialEndsAt,
    };
  }

  return {
    ...base,
    state: ENTITLEMENT_STATES.readOnly,
    reason: row?.stripeSubscriptionId ? ENTITLEMENT_REASONS.lapsed : ENTITLEMENT_REASONS.trialEnded,
    trialEndsAt,
  };
}
