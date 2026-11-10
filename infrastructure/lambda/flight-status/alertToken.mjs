/**
 * The flight-alert entitlement token, VERIFIER half (#143 Phase 2, requirement 17).
 *
 *   exp   = epoch seconds, the start of the NEXT whole UTC hour after minting, plus 7 days
 *   sig   = the base64url of an HMAC-SHA256 over `alert:v1:<exp>` keyed with the token secret   (43 chars)
 *   token = `v1.${exp}.${sig}`
 *
 * It carries no family id, no hash and no nonce: every family minted in the same hour holds the
 * same token, which is what makes a registration unlinkable to a family (and makes the token a
 * shared bearer, on purpose; ADR-046). The flight-status Lambda checks the signature in constant
 * time and `exp > now`, on `subscribe` only.
 *
 * The SIGNER is `registry/alertToken.mjs`. The two are zero-dependency restatements, not one
 * shared module (every Lambda is its own zip, `billing/ddb.mjs` header), pinned by ONE golden
 * vector that appears in both `__tests__/alertToken.test.mjs` here and
 * `registry/alertToken.test.mjs`: change the format in one file without the other and a test
 * fails. The `email-unsubscribe/token.mjs` precedent.
 */

import { createHmac } from 'node:crypto';
import { safeEqual } from './http.mjs';

const SIG_PREFIX = 'alert:v1:';
/** `v1.<1-12 digit exp>.<43-char base64url>`. */
const TOKEN_SHAPE = /^v1\.(\d{1,12})\.([A-Za-z0-9_-]{43})$/;

/**
 * @param {string} secret   FLIGHT_ALERT_TOKEN_SECRET. Missing → throws (a deploy fault, never
 *                          "accept"; the `requireSecret` precedent).
 * @param {unknown} token
 * @param {number} nowSec   Epoch seconds.
 * @returns {{ ok: true, exp: number } | { ok: false, reason: 'malformed' | 'bad_sig' | 'expired' }}
 */
export function verifyAlertToken(secret, token, nowSec) {
  if (typeof secret !== 'string' || secret.length === 0) {
    throw new Error('flight alert token secret is missing');
  }
  const m = typeof token === 'string' ? TOKEN_SHAPE.exec(token) : null;
  if (!m) return { ok: false, reason: 'malformed' };
  const expected = createHmac('sha256', secret)
    .update(SIG_PREFIX + m[1], 'utf8')
    .digest('base64url');
  if (!safeEqual(m[2], expected)) return { ok: false, reason: 'bad_sig' };
  const exp = Number(m[1]);
  if (!(exp > nowSec)) return { ok: false, reason: 'expired' };
  return { ok: true, exp };
}
