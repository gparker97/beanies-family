/* global Buffer */
/**
 * Unsubscribe tokens for owner email campaigns (#115). Pure `node:crypto`, no dependencies.
 *
 *   emailHash = hex(HMAC-SHA256(secret, "id:v1:" + normalizeEmail(email)))      (64 lowercase hex)
 *   sig       = base64url(HMAC-SHA256(secret, "unsub:v1:" + emailHash))          (43 chars, no pad)
 *   token     = `${emailHash}.${sig}`
 *
 * THE FORMAT IS FROZEN FOREVER. Unsubscribe links never expire (CAN-SPAM wants at least 30 days;
 * we promise always) and `UNSUB_TOKEN_SECRET` is never rotated, so every link ever sent must keep
 * verifying. Changing the normalisation, either prefix, the hash or the encoding silently breaks
 * every unsubscribe link already in someone's inbox. `__tests__/token.test.mjs` pins the format
 * with a golden vector (fixed secret + address -> literal hash and token); if that test fails,
 * the change is wrong, not the test.
 *
 * The hash is KEYED (HMAC, not plain sha256) so nobody who knows an address can confirm it
 * against the opt-out table. The token carries no plaintext address; a leaked token can only
 * unsubscribe the one address it was minted for.
 *
 * Two consumers, one file: the `email-unsubscribe` Lambda verifies (`verifyUnsubToken`), and the
 * ops-repo `/beanies-email` skill signs (`signUnsubToken`, `emailHash`) by importing THIS file
 * through its `public-repo` symlink, so signer and verifier cannot drift.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

const ID_PREFIX = 'id:v1:';
const SIG_PREFIX = 'unsub:v1:';

/** 64 lowercase hex, a dot, a 43-char base64url HMAC-SHA256 (32 bytes, unpadded). */
export const TOKEN_SHAPE = /^([0-9a-f]{64})\.([A-Za-z0-9_-]{43})$/;

/**
 * Constant-time string compare. Restated from `billing/webhookSignature.mjs` rather than
 * imported: every Lambda is its own zero-dependency zip (header rule in `billing/ddb.mjs`).
 * `timingSafeEqual` throws on unequal lengths, hence the length check first.
 */
function safeEqual(a, b) {
  const left = Buffer.from(String(a), 'utf8');
  const right = Buffer.from(String(b), 'utf8');
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

function requireSecret(secret) {
  if (typeof secret !== 'string' || secret.length === 0) {
    throw new Error('unsubscribe token secret is missing');
  }
  return secret;
}

const hmac = (secret, data) => createHmac('sha256', secret).update(data, 'utf8');

/** Trim + lowercase. The whole normalisation; part of the frozen format. */
export function normalizeEmail(s) {
  return String(s ?? '')
    .trim()
    .toLowerCase();
}

/** The keyed, stable id of an address: the opt-out table's partition key. */
export function emailHash(secret, email) {
  const normalized = normalizeEmail(email);
  if (!normalized) throw new Error('cannot hash an empty email address');
  return hmac(requireSecret(secret), ID_PREFIX + normalized).digest('hex');
}

function sigFor(secret, hash) {
  return hmac(secret, SIG_PREFIX + hash).digest('base64url');
}

/** The `t` value for an address's unsubscribe link. */
export function signUnsubToken(secret, email) {
  const hash = emailHash(secret, email);
  return `${hash}.${sigFor(secret, hash)}`;
}

/**
 * @returns {string | null} the token's emailHash when the signature is genuine, else null.
 * Throws only when the secret itself is missing (a deploy fault, never "accept").
 */
export function verifyUnsubToken(secret, token) {
  requireSecret(secret);
  if (typeof token !== 'string') return null;
  const m = TOKEN_SHAPE.exec(token);
  if (!m) return null;
  const [, hash, sig] = m;
  return safeEqual(sig, sigFor(secret, hash)) ? hash : null;
}
