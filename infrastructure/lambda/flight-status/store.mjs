/**
 * The flight-status table (#143): the result cache, the per-IP hourly limit and the global daily
 * provider-call cap, all over ONE DynamoDB table keyed on `pk` alone.
 *
 * Key grammar (the only place it is spelled):
 *   cache   `<FLIGHT>#<YYYY-MM-DD>`           item { pk, body, fetched_at, expires_at }
 *   ip      `i#<sha256(ip or /64)>#<hour>`    counter `n` + expires_at   (ai-extract's IP half)
 *   day     `g#<YYYY-MM-DD UTC>`              counter `n` + expires_at   (the spend bound)
 * The three never collide: a flight key starts with an upper-case designator and contains no `i#`
 * or `g#` prefix, because the handler validates it against FLIGHT_RE first.
 *
 * FAILURE POSTURE: everything here fails OPEN and logs LOUD, with a fixed prefix that a CloudWatch
 * metric filter alarms on. A cache outage costs provider units, a limiter outage costs the IP
 * bound; neither may take live flight checks down for every family. The route throttle and the
 * reserved concurrency stay in front either way. The one thing a store outage does lose is the
 * daily cap, which is why its failure shares the alarmed rate-limit prefix.
 *
 * Unset table ⇒ silent no-op (cache miss, no write, token allowed): a valid configuration for
 * tests and self-hosts, not a fault, so it logs nothing. Terraform always sets it in prod.
 *
 * Nothing in this module throws on a store fault (only `takeToken` with an unknown `kind`, which is
 * a programming error).
 */

import { countOne, hash, resolveClient, marshalKey, safeWrite } from './ddb.mjs';

// ⚠️ These exact prefixes are what the CloudWatch metric filters in the ops repo's
// modules/flight-status/main.tf match, pinned by its __tests__/alarm-prefixes.test.mjs through
// index.mjs's ALARMING_PREFIXES. Changing one means changing that module in the same change.
export const CACHE_UNAVAILABLE_PREFIX = '[flight-status] cache unavailable';
export const RATE_STORE_UNAVAILABLE_PREFIX = '[flight-status] rate-limit store unavailable';

const HOUR_SECONDS = 3600;
const DAY_SECONDS = 86_400;

/** Result-cache TTLs (plan Commit 1). Minutes, so the provider's 7-day cache ceiling is never near. */
export const TTL_NEAR_SECONDS = 10 * 60; // earliest leg departs within 24 h (or already has)
export const TTL_FAR_SECONDS = 6 * HOUR_SECONDS; // further out: schedules rarely move hour to hour
export const TTL_EMPTY_SECONDS = 30 * 60; // a 204 is an answer, but a flight may be loaded later
const NEAR_WINDOW_MS = 24 * HOUR_SECONDS * 1000;

export const cacheKey = (flight, date) => `${flight}#${date}`;

/** AeroDataBox writes `2026-12-13 09:00Z`; `T` makes it ISO for every engine. NaN when absent. */
function parseUtc(value) {
  if (typeof value !== 'string' || value.length === 0) return NaN;
  return Date.parse(value.replace(' ', 'T'));
}

/**
 * How long an answer may be served from the cache.
 *
 * 10 min when the earliest leg departs within 24 h (a past departure counts: an airborne or
 * just-landed flight is exactly when gate, belt and estimates move), 6 h otherwise, 30 min for an
 * empty answer. A leg with no parseable departure cannot prove it is far away, but nor is it near:
 * it is ignored, and an answer with no parseable leg at all takes the far TTL.
 */
export function ttlSecondsFor(legs, nowMs) {
  if (!Array.isArray(legs) || legs.length === 0) return TTL_EMPTY_SECONDS;
  const departures = legs.map((l) => parseUtc(l?.departure?.scheduledUtc)).filter(Number.isFinite);
  if (departures.length === 0) return TTL_FAR_SECONDS;
  return Math.min(...departures) - nowMs <= NEAR_WINDOW_MS ? TTL_NEAR_SECONDS : TTL_FAR_SECONDS;
}

const CACHE_REMEDIATION = (table) =>
  `Serving without the cache, so every request is a provider call against the daily cap. Check the ${table} table and the Lambda's dynamodb:GetItem/PutItem permissions.`;

/**
 * Read one cached answer. NEVER throws.
 * @returns {Promise<{ legs: object[], fetchedAt: string } | null>} null on miss, expiry or failure.
 */
export async function getCached(key, { table, now = Date.now(), ddb } = {}) {
  if (!table) return null;
  try {
    const { send, commands } = await resolveClient(ddb);
    const out = await send(
      new commands.GetItemCommand({ TableName: table, Key: marshalKey({ pk: key }) })
    );
    const item = out?.Item;
    if (!item) return null;
    // DynamoDB TTL reaping is lazy (it can lag by a day or more), so an expired item is still
    // returned by GetItem. Expiry is enforced HERE, not by the reaper.
    if (Number(item.expires_at?.N) <= Math.floor(now / 1000)) return null;
    const legs = JSON.parse(item.body?.S ?? 'null');
    if (!Array.isArray(legs)) throw new Error('cached body is not a legs array');
    return { legs, fetchedAt: item.fetched_at?.S ?? new Date(now).toISOString() };
  } catch (err) {
    console.error(`${CACHE_UNAVAILABLE_PREFIX} op=get\n${CACHE_REMEDIATION(table)}`, err);
    return null;
  }
}

/**
 * Write one answer. NEVER throws; a failure is logged with the alarmed prefix.
 * @returns {Promise<boolean>} whether the item was written.
 */
export async function putCached(key, legs, ttlSeconds, { table, now = Date.now(), ddb } = {}) {
  return safeWrite(
    table,
    `${CACHE_UNAVAILABLE_PREFIX} op=put`,
    CACHE_REMEDIATION(table),
    async () => {
      const { send, commands } = await resolveClient(ddb);
      await send(
        new commands.PutItemCommand({
          TableName: table,
          Item: {
            pk: { S: key },
            body: { S: JSON.stringify(legs) },
            fetched_at: { S: new Date(now).toISOString() },
            expires_at: { N: String(Math.floor(now / 1000) + ttlSeconds) },
          },
        })
      );
    }
  );
}

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

/**
 * Spend one token from a fixed-window counter. NEVER throws.
 *
 *   kind 'ip'   one per source IP (or /64) per UTC hour, `limit` = IP_LIMIT
 *   kind 'day'  one per provider call per UTC day, GLOBAL, `limit` = DAILY_PROVIDER_CAP
 *
 * Returns `{ allowed: true }`, `{ allowed: true, degraded: true }` (store failed, failed open), or
 * `{ allowed: false, retryAfterSeconds }` (window spent).
 *
 * ⚠️ The ip is `requestContext.http.sourceIp`, NEVER `x-forwarded-for`, which the caller controls.
 */
export async function takeToken({ kind, ip, now = Date.now(), ddb, limit, table } = {}) {
  if (!table) return { allowed: true };

  let key;
  let ttl;
  let retryAfterSeconds;
  const nowS = Math.floor(now / 1000);
  if (kind === 'ip') {
    // Nothing to key on (a direct invoke, a test): the route throttle bounds the rest.
    if (!ip) return { allowed: true };
    const bucket = Math.floor(nowS / HOUR_SECONDS);
    key = `i#${hash(ipKey(ip))}#${bucket}`;
    ttl = (bucket + 2) * HOUR_SECONDS; // one spare window before the reaper
    retryAfterSeconds = Math.max(1, (bucket + 1) * HOUR_SECONDS - nowS);
  } else if (kind === 'day') {
    const day = utcDay(now);
    key = `g#${day}`;
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
      return { allowed: false, retryAfterSeconds };
    }
    return { allowed: true };
  } catch (err) {
    console.error(
      `${RATE_STORE_UNAVAILABLE_PREFIX} kind=${kind}: allowing the request. ` +
        (kind === 'day'
          ? 'The daily provider-call cap is NOT being enforced, so provider spend is unbounded until this clears. '
          : '') +
        `Check the ${table} table and the Lambda dynamodb:UpdateItem permission.`,
      err
    );
    return { allowed: true, degraded: true };
  }
}
