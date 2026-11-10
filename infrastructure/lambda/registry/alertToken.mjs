/**
 * The flight-alert entitlement token, SIGNER half (#143 Phase 2, requirement 17).
 *
 *   exp   = epoch seconds, the start of the NEXT whole UTC hour after minting, plus 7 days
 *   sig   = base64url(HMAC-SHA256(FLIGHT_ALERT_TOKEN_SECRET, "alert:v1:" + exp))   (43 chars)
 *   token = `v1.${exp}.${sig}`
 *
 * Minted by the registry GET (`entitlementFor` in index.mjs) inside the `entitlement` object, for
 * an eligible family only. It carries no family id, no hash and no nonce, and every token minted
 * in the same hour is identical, so a flight-alert registration can never be linked to a family
 * or a mint time. The client refreshes it on every entitlement poll (hourly), so a lapsed family
 * holds one for at most 7 days.
 *
 * The VERIFIER is `flight-status/alertToken.mjs`. Two zero-dependency restatements (every Lambda
 * is its own zip), pinned by ONE golden vector in `alertToken.test.mjs` here and in
 * `flight-status/__tests__/alertToken.test.mjs`. If that test fails, the change is wrong.
 */

import { createHmac } from 'node:crypto';

const SIG_PREFIX = 'alert:v1:';
const HOUR_S = 3600;
const VALID_S = 7 * 24 * HOUR_S;

/**
 * Who gets a token: the client's `isEntitled` restated (flightStatusStore.ts). Not enforced
 * (the dry-run soak) → everyone; else trial, beta, or an active magic beans (`full`) plan.
 */
export function alertEligible(entitlement) {
  if (!entitlement || typeof entitlement !== 'object') return false;
  if (entitlement.enforced === false) return true;
  const { state, plan } = entitlement;
  return state === 'trial' || state === 'beta' || (state === 'active' && plan === 'full');
}

/** `exp` for a mint at `nowMs`: the next whole UTC hour (strictly after now) plus 7 days. */
export function alertTokenExp(nowMs) {
  return (Math.floor(Math.floor(nowMs / 1000) / HOUR_S) + 1) * HOUR_S + VALID_S;
}

/** The token for an exp. Exported so the golden vector pins the format without a clock. */
export function signAlertToken(secret, exp) {
  if (typeof secret !== 'string' || secret.length === 0) {
    throw new Error('flight alert token secret is missing');
  }
  const sig = createHmac('sha256', secret)
    .update(SIG_PREFIX + exp, 'utf8')
    .digest('base64url');
  return `v1.${exp}.${sig}`;
}

/** The token a GET at `nowMs` hands out. */
export function mintAlertToken(secret, nowMs) {
  return signAlertToken(secret, alertTokenExp(nowMs));
}
