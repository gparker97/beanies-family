/* global Buffer */
/**
 * Stripe webhook signature verification (#95 Phase 5), with no Stripe SDK.
 *
 * The scheme (https://docs.stripe.com/webhooks#verify-manually):
 *   header  `Stripe-Signature: t=<unix seconds>,v1=<hex>[,v1=<hex>...][,v0=<ignored>]`
 *   signed  `${t}.${rawBody}` with HMAC-SHA256 over the endpoint's signing secret (`whsec_...`)
 *   accept  if ANY `v1=` entry equals our digest (Stripe sends several during a secret roll)
 *           AND |now - t| <= tolerance (300 s, Stripe's own default) to bound replay.
 *
 * The body must be the EXACT bytes Stripe sent. API Gateway v2 may deliver it base64-encoded
 * (`event.isBase64Encoded`); the handler decodes before calling this, and never re-serialises.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

export const SIGNATURE_TOLERANCE_SEC = 300;

/**
 * The one constant-time comparison in this Lambda: the signature check, the claim's
 * `client_secret` match and the portal's token-hash match all use it. `timingSafeEqual` throws
 * on unequal lengths, hence the length check first (which leaks only the length, as Stripe's
 * own SDK does).
 */
export function safeEqual(a, b) {
  const left = Buffer.from(String(a), 'utf8');
  const right = Buffer.from(String(b), 'utf8');
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/** Parse `t=...,v1=...,v1=...` into `{ t: number | null, v1: string[] }`. Tolerates junk. */
export function parseSignatureHeader(header) {
  const out = { t: null, v1: [] };
  if (typeof header !== 'string') return out;
  for (const part of header.split(',')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const k = part.slice(0, eq).trim();
    const v = part.slice(eq + 1).trim();
    if (k === 't') {
      const n = Number(v);
      out.t = Number.isFinite(n) ? n : null;
    } else if (k === 'v1' && v) {
      out.v1.push(v);
    }
  }
  return out;
}

export function computeSignature(secret, timestamp, rawBody) {
  return createHmac('sha256', secret)
    .update(`${timestamp}.`, 'utf8')
    .update(typeof rawBody === 'string' ? Buffer.from(rawBody, 'utf8') : rawBody)
    .digest('hex');
}

/**
 * @returns {{ ok: true } | { ok: false, reason: 'no_header'|'no_timestamp'|'no_v1'|'expired'|'mismatch' }}
 */
export function verifyStripeSignature({
  header,
  rawBody,
  secret,
  nowSec = Math.floor(Date.now() / 1000),
  toleranceSec = SIGNATURE_TOLERANCE_SEC,
}) {
  if (!header) return { ok: false, reason: 'no_header' };
  const { t, v1 } = parseSignatureHeader(header);
  if (t === null) return { ok: false, reason: 'no_timestamp' };
  if (v1.length === 0) return { ok: false, reason: 'no_v1' };
  if (Math.abs(nowSec - t) > toleranceSec) return { ok: false, reason: 'expired' };
  const expected = computeSignature(secret, t, rawBody);
  // Every candidate is compared (no early exit on the first match) so timing does not reveal
  // which slot matched. The cost is a handful of HMAC-length compares.
  let matched = false;
  for (const candidate of v1) if (safeEqual(candidate, expected)) matched = true;
  return matched ? { ok: true } : { ok: false, reason: 'mismatch' };
}
