/**
 * The flight-alert credit balance (#143 Phase 2, requirement 28).
 *
 * The provider bills alerts from a SEPARATE credit balance refilled from the API unit quota
 * (1 credit = 1 unit), and at zero every subscription pauses silently. Nobody should have to watch
 * it, so `ensureCredits(creditsRemaining, source)` keeps it above `ALERT_CREDIT_FLOOR`: the
 * webhook calls it with each notification's `balance.creditsRemaining`, the sweep with the free
 * `GET /subscriptions/balance`. It is the ONLY caller of `takeRefillToken` and
 * `provider.refillCredits`.
 *
 * An absent or unparseable balance (`null`: the provider answers an empty body until the first
 * refill) counts as ZERO, so the first sweep after the apply seeds the balance with no manual step.
 * That rule is for the sweep's own `GET /subscriptions/balance` ONLY: the webhook never calls
 * this with `null` (a payload without a balance is not the provider's; `webhook.mjs topUp`).
 *
 * WHAT BOUNDS IT: a global daily counter (`ALERT_REFILL_DAILY_CAP`, default 2 refills of
 * `ALERT_CREDIT_REFILL`, default 200 credits). A runaway subscription can burn at most that many
 * units a day on top of the check cap. The counter FAILS CLOSED (a store fault refills nothing):
 * an unbounded refill is the one failure it exists to prevent.
 */

import { logLine, positiveInt } from './http.mjs';
import { createAlertsStore } from './alertsStore.mjs';
import { utcDay } from './store.mjs';

// ⚠️ The two alarmed prefixes are matched verbatim by metric filters in the ops repo's
// modules/flight-status/main.tf (pinned through createHandler.mjs's ALARMING_PREFIXES).
export const CREDIT_EXHAUSTED_PREFIX = '[flight-alerts] credit balance exhausted';
export const CREDIT_REFILL_FAILED_PREFIX = '[flight-alerts] credit refill FAILED';
/** Info, not alarmed: the refill happened. */
export const CREDITS_REFILLED_PREFIX = '[flight-alerts] credits refilled';

export const DEFAULT_CREDIT_FLOOR = 100;
export const DEFAULT_CREDIT_REFILL = 200;
export const DEFAULT_REFILL_DAILY_CAP = 2;

/**
 * @param {object} deps  The common factory deps (`provider` = the bound alerts client).
 * @returns {(creditsRemaining: number | null, source: 'webhook' | 'cleanup') =>
 *   Promise<{ creditsRemaining: number | null, refilled: boolean }>}  Never throws.
 */
export function createCredits({ provider, env, ddb, now = () => Date.now() }) {
  const FLOOR = positiveInt(env.ALERT_CREDIT_FLOOR, DEFAULT_CREDIT_FLOOR, 'ALERT_CREDIT_FLOOR');
  const REFILL = positiveInt(env.ALERT_CREDIT_REFILL, DEFAULT_CREDIT_REFILL, 'ALERT_CREDIT_REFILL');
  const CAP = positiveInt(
    env.ALERT_REFILL_DAILY_CAP,
    DEFAULT_REFILL_DAILY_CAP,
    'ALERT_REFILL_DAILY_CAP'
  );
  const store = createAlertsStore({ table: env.ALERTS_TABLE, ddb });

  return async function ensureCredits(creditsRemaining, source) {
    const before = Number.isFinite(creditsRemaining) ? creditsRemaining : null;
    if (before !== null && before >= FLOOR) return { creditsRemaining: before, refilled: false };

    const token = await store.takeRefillToken(utcDay(now()), CAP);
    // A store fault was logged with the alarmed store prefix; fail closed.
    if (!token.ok) return { creditsRemaining: before, refilled: false };
    if (!token.allowed) {
      console.error(
        `${CREDIT_EXHAUSTED_PREFIX} source=${source} before=${before ?? 'null'} cap=${CAP}/day: ` +
          'the daily refill cap is spent and the alert balance is under the floor. At zero every flight ' +
          'alert pauses silently until a refill. Expected only under a runaway subscription: read the ' +
          'cleanup heartbeat (own vs numbers, foreign) and the provider list before raising var.alert_refill_daily_cap.'
      );
      return { creditsRemaining: before, refilled: false };
    }

    try {
      const { creditsRemaining: after, quota } = await provider.refillCredits(REFILL);
      logLine(CREDITS_REFILLED_PREFIX, {
        source,
        before,
        added: REFILL,
        credits_remaining: after,
        units_remaining: Number.isFinite(quota?.remaining) ? quota.remaining : null,
      });
      return { creditsRemaining: after, refilled: true };
    } catch (err) {
      console.error(
        `${CREDIT_REFILL_FAILED_PREFIX} source=${source} code=${err?.code ?? err?.name ?? 'error'} ` +
          `http_status=${Number.isFinite(err?.httpStatus) ? err.httpStatus : '-'} before=${before ?? 'null'}: ` +
          'the alert balance is under the floor and could not be refilled; at zero every flight alert pauses. ' +
          'Check the provider key and plan (POST /subscriptions/balance/refill).'
      );
      return { creditsRemaining: before, refilled: false };
    }
  };
}
