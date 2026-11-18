/**
 * The place-search counter table (#150): the per-IP hourly limit and the two GLOBAL daily
 * provider-call caps, over ONE DynamoDB table keyed on `pk` alone. No cache: Places content may
 * not be cached, so every valid request that passes the limits is one provider call.
 *
 * Key grammar (the only place it is spelled):
 *   ip       `i#<sha256(ip or /64)>#<hour>`   counter `n` + expires_at  (one bucket for both routes)
 *   suggest  `gs#<YYYY-MM-DD UTC>`             counter `n` + expires_at  (Autocomplete spend bound)
 *   resolve  `gr#<YYYY-MM-DD UTC>`             counter `n` + expires_at  (Geocoding spend bound)
 *
 * FAILURE POSTURE (different from flight-status, on purpose):
 *   * `ip` fails OPEN and logs the alarmed store prefix. The route throttle, the reserved
 *     concurrency and the day caps still bound what one address can do.
 *   * `suggest` / `resolve` fail CLOSED. A store fault, OR AN UNSET TABLE, refuses the request
 *     (`budget_unavailable`) and logs the alarmed store prefix with the remediation. The day cap
 *     is the ONLY control that bounds the bill, so "no table" must never read as "no cap".
 *
 * Restated from `flight-status/store.mjs` (pinned by `__tests__/twinDrift.test.mjs`; ⚠️ EDIT BOTH
 * COPIES IN ONE COMMIT): `ipKey`, `utcDay`, `secondsToUtcMidnight`. `takeToken` is this Lambda's
 * OWN: its kinds, keys and failure posture differ.
 */

import { countOne, hash, resolveClient } from './ddb.mjs';
import { errorText } from './http.mjs';

// ⚠️ These exact prefixes are what the CloudWatch metric filters in the ops repo's
// modules/place-search/main.tf match, pinned by its __tests__/alarm-prefixes.test.mjs through
// createHandler.mjs's ALARMING_PREFIXES. Changing one means changing that module in the same change.
export const RATE_STORE_UNAVAILABLE_PREFIX = '[place-search] rate-limit store unavailable';
export const BUDGET_EXHAUSTED_PREFIX = '[place-search] daily budget exhausted';

/** The token kinds and their day-key prefixes. `ip` has no day key. */
export const DAY_KEY_PREFIX = Object.freeze({ suggest: 'gs', resolve: 'gr' });

const HOUR_SECONDS = 3600;
const DAY_SECONDS = 86_400;

/**
 * What a client should wait after `budget_unavailable`. Short on purpose: a store blip clears in
 * minutes, and the client's quiet period would otherwise run to UTC midnight.
 */
export const UNAVAILABLE_RETRY_SECONDS = 300;

/**
 * Reduce a source address to the unit an ATTACKER cannot trivially multiply (copied from
 * ai-extract/rateLimit.mjs, where the reasoning lives in full): IPv4 whole, IPv6 collapsed to its
 * /64, because any cloud VM or residential line can mint fresh /128s per request.
 */
export function ipKey(ip) {
  const value = String(ip);
  if (!value.includes(':') || value.includes('.')) return value;
  const hextets = value.split(':');
  return hextets.length <= 4 ? value : `${hextets.slice(0, 4).join(':')}::/64`;
}

/** `YYYY-MM-DD` of the UTC day containing `nowMs`. */
export const utcDay = (nowMs) => new Date(nowMs).toISOString().slice(0, 10);

/** Seconds until the next UTC midnight, at least 1: an honest `retryAfterSeconds` for the cap. */
export function secondsToUtcMidnight(nowMs) {
  const d = new Date(nowMs);
  const next = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
  return Math.max(1, Math.ceil((next - nowMs) / 1000));
}

/** The remediation sentence every alarmed store line carries. */
const remediation = (table) =>
  table
    ? `Check the ${table} table and the Lambda's dynamodb:UpdateItem permission on it.`
    : 'COUNTER_TABLE is unset on the Lambda: set it to the place-search counter table (module.place_search) and grant dynamodb:UpdateItem on it.';

/**
 * Spend one token from a fixed-window counter. NEVER throws on a store fault.
 *
 *   kind 'ip'       one per source IP (or /64) per UTC hour, `limit` = IP_LIMIT. Fails OPEN.
 *   kind 'suggest'  one per Autocomplete call per UTC day, GLOBAL, `limit` = DAILY_SUGGEST_CAP.
 *   kind 'resolve'  one per Geocoding call per UTC day, GLOBAL, `limit` = DAILY_RESOLVE_CAP.
 *                   Both day kinds fail CLOSED.
 *
 * @returns {Promise<
 *   | { allowed: true, degraded?: true }
 *   | { allowed: false, reason: 'limit', retryAfterSeconds: number }
 *   | { allowed: false, reason: 'unavailable', retryAfterSeconds: number }>}
 *
 * ⚠️ The ip is `requestContext.http.sourceIp`, NEVER `x-forwarded-for`, which the caller controls.
 */
export async function takeToken({ kind, ip, now = Date.now(), ddb, limit, table } = {}) {
  let key;
  let ttl;
  let retryAfterSeconds;
  const nowS = Math.floor(now / 1000);
  const dayPrefix = DAY_KEY_PREFIX[kind];

  if (kind === 'ip') {
    // No table: the day token right after this refuses LOUDLY, so this one stays quiet.
    // Nothing to key on (a direct invoke, a test): the route throttle bounds the rest.
    if (!table || !ip) return { allowed: true };
    const bucket = Math.floor(nowS / HOUR_SECONDS);
    key = `i#${hash(ipKey(ip))}#${bucket}`;
    ttl = (bucket + 2) * HOUR_SECONDS; // one spare window before the reaper
    retryAfterSeconds = Math.max(1, (bucket + 1) * HOUR_SECONDS - nowS);
  } else if (dayPrefix) {
    if (!table) {
      console.error(
        `${RATE_STORE_UNAVAILABLE_PREFIX} kind=${kind} reason=table_unset: refusing the request ` +
          '(fails closed, so the daily provider-call cap cannot be skipped). ' +
          remediation(table)
      );
      return {
        allowed: false,
        reason: 'unavailable',
        retryAfterSeconds: UNAVAILABLE_RETRY_SECONDS,
      };
    }
    const day = utcDay(now);
    key = `${dayPrefix}#${day}`;
    ttl = Math.floor(Date.parse(`${day}T00:00:00Z`) / 1000) + 2 * DAY_SECONDS;
    retryAfterSeconds = secondsToUtcMidnight(now);
  } else {
    // A programming error, not a store fault: refuse to guess which bound was meant.
    throw new TypeError(`takeToken: unknown kind ${kind}`);
  }

  try {
    const { send, commands } = await resolveClient(ddb);
    try {
      await countOne(send, commands, table, { pk: key }, { max: limit, ttl });
    } catch (err) {
      if (err?.name !== 'ConditionalCheckFailedException') throw err;
      return { allowed: false, reason: 'limit', retryAfterSeconds };
    }
    return { allowed: true };
  } catch (err) {
    if (kind === 'ip') {
      console.error(
        `${RATE_STORE_UNAVAILABLE_PREFIX} kind=ip: allowing the request (the per-IP limit fails ` +
          `open; the day caps still bound spend). ${remediation(table)} ${errorText(err)}`
      );
      return { allowed: true, degraded: true };
    }
    console.error(
      `${RATE_STORE_UNAVAILABLE_PREFIX} kind=${kind}: refusing the request (fails closed, so ` +
        `the daily provider-call cap cannot be skipped). ${remediation(table)} ${errorText(err)}`
    );
    return { allowed: false, reason: 'unavailable', retryAfterSeconds: UNAVAILABLE_RETRY_SECONDS };
  }
}
