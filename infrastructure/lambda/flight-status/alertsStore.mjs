/**
 * The flight-alerts table (#143 Phase 2): who is watching which flight, the provider subscription
 * per flight number, the webhook replay guards and the daily credit-refill counter.
 *
 * KEY GRAMMAR (the only place it is spelled). One partition per flight NUMBER, because the
 * provider subscribes per number (no date) and bills every daily instance of it:
 *   device   pk `<FLIGHT>`  sk `d#<YYYY-MM-DD>#<sha256(pushToken)>`
 *            { push_token, platform, lang, dep, arr?, sent_rev, created_at, expires_at }
 *   provider pk `<FLIGHT>`  sk `p`   { claimed_at?, provider_id?, created_at }   NO expires_at:
 *            the sweep (cleanup.mjs) is its only deleter.
 *   replay   pk `<FLIGHT>`  sk `e#<notificationId>`   { expires_at = now + 24 h }
 *   refill   pk `r#<UTC day>` sk `n`   counter `n` + expires_at   (GLOBAL, the countOne shape)
 * `r#` cannot collide with a flight partition: the handlers validate every flight against
 * FLIGHT_RE (`^[A-Z0-9]{2}\d{1,4}$`) before it becomes a key.
 *
 * Nothing else is stored: no family id, member, trip, IP or device model, and no device counter.
 *
 * FAILURE POSTURE: FAIL CLOSED, the opposite of `store.mjs` (the Phase 1 cache and limiter, which
 * fail OPEN because a lost item there costs units, never a notice). A lost registration IS a lost
 * notice, so every function here returns `{ ok: true, ... } | { ok: false, error }`, NEVER
 * throws, and logs a fault ONCE with the alarmed `STORE_UNAVAILABLE_PREFIX` naming the table and
 * the IAM action to check; the handler answers `alerts_unavailable` (503; 500 on the webhook) and
 * the device retries on its next run. The refill counter fails closed for the other reason: a lost
 * count must never become an unbounded refill.
 *
 * Unset table ⇒ `{ ok: false, error: 'table_unset' }` with the same alarmed line: unlike the cache,
 * the alerts routes cannot work without it, and saying so is the honest answer.
 */

import { countOne, hash, marshalKey, resolveClient } from './ddb.mjs';

// ⚠️ Matched verbatim by a metric filter in the ops repo's modules/flight-status/main.tf (pinned
// by __tests__/alarm-prefixes.test.mjs through createHandler.mjs's ALARMING_PREFIXES).
export const STORE_UNAVAILABLE_PREFIX = '[flight-alerts] store unavailable';

const HOUR_S = 3600;
const DAY_S = 86_400;
/** A device item lives until its departure date's UTC midnight plus 72 h (requirement 16). */
export const DEVICE_TTL_AFTER_DATE_S = 72 * HOUR_S;
/** Replay guards outlive the provider's retry window by a wide margin. */
export const EVENT_TTL_S = DAY_S;
/** An unfilled claim older than this is presumed dead (a Lambda that died mid-subscribe). */
export const CLAIM_STALE_S = 60;
export const PROVIDER_SK = 'p';

export const flightPk = (flight) => flight;
export const deviceSk = (date, pushToken) => `d#${date}#${hash(pushToken)}`;
export const devicePrefix = (date) => `d#${date}#`;
export const eventSk = (eventId) => `e#${eventId}`;
export const refillKey = (day) => ({ pk: `r#${day}`, sk: 'n' });

/** THE one TTL rule for a device item: the date's 00:00 UTC + 72 h, in epoch seconds. */
export function expiresAtFor(date) {
  return Math.floor(Date.parse(`${date}T00:00:00Z`) / 1000) + DEVICE_TTL_AFTER_DATE_S;
}

/** `d#<date>#<hash>` → date, else null. */
export function dateOfSk(sk) {
  return /^d#(\d{4}-\d{2}-\d{2})#/.exec(sk)?.[1] ?? null;
}

const S = (v) => ({ S: String(v) });
const N = (v) => ({ N: String(v) });
const str = (av) => (typeof av?.S === 'string' ? av.S : undefined);
const num = (av) =>
  av?.N !== undefined && Number.isFinite(Number(av.N)) ? Number(av.N) : undefined;

/** Raw item → the device shape the handlers read (never logged: it carries the push token). */
function toDevice(item) {
  const sk = str(item.sk);
  return {
    sk,
    date: dateOfSk(sk),
    push_token: str(item.push_token),
    platform: str(item.platform),
    lang: str(item.lang) ?? 'en',
    dep: str(item.dep),
    arr: str(item.arr),
    sent_rev: str(item.sent_rev) ?? '',
    expires_at: num(item.expires_at) ?? 0,
  };
}

function toProvider(item) {
  return {
    providerId: str(item.provider_id) ?? null,
    claimedAt: num(item.claimed_at) ?? null,
    createdAt: num(item.created_at) ?? null,
  };
}

const isConditionFailure = (err) => err?.name === 'ConditionalCheckFailedException';

/**
 * @param {object} deps
 * @param {string} deps.table  ALERTS_TABLE.
 * @param {object=} deps.ddb   `{ send, commands }`; otherwise ddb.mjs's seam/default client.
 */
export function createAlertsStore({ table, ddb } = {}) {
  /**
   * Run one store operation. `fn` returns the ok-payload; a ConditionalCheckFailedException is
   * handed to `onCondition` when given (it is an answer, not a fault). Any other failure is logged
   * once with the alarmed prefix and becomes `{ ok: false, error }`.
   */
  async function op(name, action, fn, onCondition) {
    if (!table) {
      console.error(
        `${STORE_UNAVAILABLE_PREFIX} op=${name} reason=table_unset\n` +
          'ALERTS_TABLE is unset on the Lambda, so no flight alert can be registered or delivered. Apply module.flight_status.'
      );
      return { ok: false, error: 'table_unset' };
    }
    try {
      const { send, commands } = await resolveClient(ddb);
      return { ok: true, ...(await fn(send, commands)) };
    } catch (err) {
      if (onCondition && isConditionFailure(err)) return { ok: true, ...onCondition() };
      console.error(
        `${STORE_UNAVAILABLE_PREFIX} op=${name}\n` +
          `Flight alerts are failing closed. Check the ${table} table and the Lambda's dynamodb:${action} permission.`,
        err
      );
      return { ok: false, error: err?.name || 'store_error' };
    }
  }

  /** Every item of one partition, following `LastEvaluatedKey`. */
  async function queryAll(send, commands, input) {
    const items = [];
    let ExclusiveStartKey;
    do {
      const out = await send(
        new commands.QueryCommand({ TableName: table, ...input, ExclusiveStartKey })
      );
      items.push(...(out?.Items ?? []));
      ExclusiveStartKey = out?.LastEvaluatedKey;
    } while (ExclusiveStartKey);
    return items;
  }

  return {
    /** Write (or overwrite) one device registration. `sent_rev` is the device's own `rev`. */
    putDevice(pk, sk, item) {
      return op('put_device', 'PutItem', async (send, commands) => {
        const Item = {
          pk: S(pk),
          sk: S(sk),
          push_token: S(item.push_token),
          platform: S(item.platform),
          lang: S(item.lang),
          dep: S(item.dep),
          sent_rev: S(item.sent_rev),
          created_at: N(item.created_at),
          expires_at: N(item.expires_at),
        };
        if (item.arr) Item.arr = S(item.arr);
        await send(new commands.PutItemCommand({ TableName: table, Item }));
        return {};
      });
    },

    /** Plain delete; a repeat is a no-op. Unsubscribe and an invalid push token both land here. */
    deleteDevice(pk, sk) {
      return op('delete_device', 'DeleteItem', async (send, commands) => {
        await send(
          new commands.DeleteItemCommand({ TableName: table, Key: marshalKey({ pk, sk }) })
        );
        return {};
      });
    },

    /** Whether one device item exists (the device cap lets a known device re-subscribe). */
    hasDevice(pk, sk) {
      return op('get_device', 'GetItem', async (send, commands) => {
        const out = await send(
          new commands.GetItemCommand({
            TableName: table,
            Key: marshalKey({ pk, sk }),
            ProjectionExpression: 'sk',
          })
        );
        return { exists: !!out?.Item };
      });
    },

    /**
     * ONE Query over the flight's partition: the provider item, the LIVE devices (expired ones are
     * counted and dropped: the TTL reaper is lazy) and the replay-guard ids.
     * @returns {Promise<{ ok: true, provider, devices, expired: number, eventIds: Set<string> }
     *   | { ok: false, error }>}
     */
    loadFlight(pk, nowS) {
      return op('load_flight', 'Query', async (send, commands) => {
        const items = await queryAll(send, commands, {
          KeyConditionExpression: 'pk = :pk',
          ExpressionAttributeValues: { ':pk': S(pk) },
          ConsistentRead: true,
        });
        let provider = null;
        let expired = 0;
        const devices = [];
        const eventIds = new Set();
        for (const item of items) {
          const sk = str(item.sk) ?? '';
          if (sk === PROVIDER_SK) provider = toProvider(item);
          else if (sk.startsWith('e#')) eventIds.add(sk.slice(2));
          else if (sk.startsWith('d#')) {
            const device = toDevice(item);
            if (device.expires_at > nowS) devices.push(device);
            else expired += 1;
          }
        }
        return { provider, devices, expired, eventIds };
      });
    },

    /** Live device items for one flight+date (`Select: COUNT`). A SOFT cap: not atomic, by design. */
    countDevices(pk, date, nowS) {
      return op('count_devices', 'Query', async (send, commands) => {
        let count = 0;
        let ExclusiveStartKey;
        do {
          const out = await send(
            new commands.QueryCommand({
              TableName: table,
              KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefix)',
              FilterExpression: 'expires_at > :now',
              ExpressionAttributeValues: {
                ':pk': S(pk),
                ':prefix': S(devicePrefix(date)),
                ':now': N(nowS),
              },
              Select: 'COUNT',
              ExclusiveStartKey,
            })
          );
          count += Number(out?.Count ?? 0);
          ExclusiveStartKey = out?.LastEvaluatedKey;
        } while (ExclusiveStartKey);
        return { count };
      });
    },

    /** The provider item, strongly consistent (the claim race reads it). */
    getProvider(pk) {
      return op('get_provider', 'GetItem', async (send, commands) => {
        const out = await send(
          new commands.GetItemCommand({
            TableName: table,
            Key: marshalKey({ pk, sk: PROVIDER_SK }),
            ConsistentRead: true,
          })
        );
        return { provider: out?.Item ? toProvider(out.Item) : null };
      });
    },

    /**
     * CLAIM the right to create the number's provider subscription: one conditional
     * `SET claimed_at` that also creates `p` when absent. Won only when no subscription id is held
     * and no live claim exists (an unfilled claim older than `CLAIM_STALE_S` is re-claimable, so a
     * Lambda that died between claim and fill cannot leave a number nobody can subscribe).
     * @returns {Promise<{ ok: true, won: boolean, stale: boolean } | { ok: false, error }>}
     *   `stale` = this claim replaced a dead one.
     */
    claimProvider(pk, nowS) {
      return op(
        'claim_provider',
        'UpdateItem',
        async (send, commands) => {
          const out = await send(
            new commands.UpdateItemCommand({
              TableName: table,
              Key: marshalKey({ pk, sk: PROVIDER_SK }),
              UpdateExpression:
                'SET claimed_at = :now, created_at = if_not_exists(created_at, :now)',
              ConditionExpression:
                'attribute_not_exists(provider_id) AND (attribute_not_exists(claimed_at) OR claimed_at < :stale)',
              ExpressionAttributeValues: { ':now': N(nowS), ':stale': N(nowS - CLAIM_STALE_S) },
              ReturnValues: 'ALL_OLD',
            })
          );
          return { won: true, stale: out?.Attributes?.claimed_at !== undefined };
        },
        () => ({ won: false, stale: false })
      );
    },

    /** Record the provider subscription id (creating `p` when the sweep adopts for a bare number). */
    fillProvider(pk, providerId, nowS) {
      return op('fill_provider', 'UpdateItem', async (send, commands) => {
        await send(
          new commands.UpdateItemCommand({
            TableName: table,
            Key: marshalKey({ pk, sk: PROVIDER_SK }),
            UpdateExpression:
              'SET provider_id = :id, created_at = if_not_exists(created_at, :now) REMOVE claimed_at',
            ExpressionAttributeValues: { ':id': S(providerId), ':now': N(nowS) },
          })
        );
        return {};
      });
    },

    /** Give a claim back after a provider failure. Never deletes `p`; a missing `p` is a no-op. */
    releaseClaim(pk) {
      return op(
        'release_claim',
        'UpdateItem',
        async (send, commands) => {
          await send(
            new commands.UpdateItemCommand({
              TableName: table,
              Key: marshalKey({ pk, sk: PROVIDER_SK }),
              UpdateExpression: 'REMOVE claimed_at',
              ConditionExpression: 'attribute_exists(sk)',
            })
          );
          return {};
        },
        () => ({})
      );
    },

    /** SWEEP ONLY: forget the number's provider item. */
    deleteProvider(pk) {
      return op('delete_provider', 'DeleteItem', async (send, commands) => {
        await send(
          new commands.DeleteItemCommand({
            TableName: table,
            Key: marshalKey({ pk, sk: PROVIDER_SK }),
          })
        );
        return {};
      });
    },

    /**
     * SWEEP ONLY: the whole (tiny) table, following `LastEvaluatedKey`, as
     * `{ pk, sk, expiresAt, providerId, claimedAt }` rows. Push tokens are not projected.
     */
    scanAll() {
      return op('scan', 'Scan', async (send, commands) => {
        const items = [];
        let ExclusiveStartKey;
        do {
          const out = await send(
            new commands.ScanCommand({
              TableName: table,
              ProjectionExpression: 'pk, sk, expires_at, provider_id, claimed_at',
              ExclusiveStartKey,
            })
          );
          for (const item of out?.Items ?? []) {
            items.push({
              pk: str(item.pk),
              sk: str(item.sk),
              expiresAt: num(item.expires_at) ?? null,
              providerId: str(item.provider_id) ?? null,
              claimedAt: num(item.claimed_at) ?? null,
            });
          }
          ExclusiveStartKey = out?.LastEvaluatedKey;
        } while (ExclusiveStartKey);
        return { items };
      });
    },

    /** The replay guard: a plain put, written only AFTER a webhook's fan-out completes. */
    recordEvent(pk, eventId, nowS) {
      return op('record_event', 'PutItem', async (send, commands) => {
        await send(
          new commands.PutItemCommand({
            TableName: table,
            Item: { pk: S(pk), sk: S(eventSk(eventId)), expires_at: N(nowS + EVENT_TTL_S) },
          })
        );
        return {};
      });
    },

    /**
     * Claim-before-send: move `sent_rev` from `oldRev` to `newRev` only if it still holds
     * `oldRev` (and the device still exists). `claimed: false` = a duplicate or concurrent
     * delivery already claimed it, or the device left; either way, do not send.
     * @returns {Promise<{ ok: true, claimed: boolean } | { ok: false, error }>}
     */
    markSent(pk, sk, oldRev, newRev) {
      return op(
        'mark_sent',
        'UpdateItem',
        async (send, commands) => {
          await send(
            new commands.UpdateItemCommand({
              TableName: table,
              Key: marshalKey({ pk, sk }),
              UpdateExpression: 'SET sent_rev = :new',
              ConditionExpression: 'attribute_exists(sk) AND sent_rev = :old',
              ExpressionAttributeValues: { ':old': S(oldRev), ':new': S(newRev) },
            })
          );
          return { claimed: true };
        },
        () => ({ claimed: false })
      );
    },

    /**
     * One token of the GLOBAL daily credit-refill cap (`countOne` on `r#<day>`). At the cap →
     * `allowed: false`; any other fault → `ok: false` (FAIL CLOSED: no refill).
     */
    takeRefillToken(day, cap) {
      const ttl = Math.floor(Date.parse(`${day}T00:00:00Z`) / 1000) + 2 * DAY_S;
      return op(
        'take_refill_token',
        'UpdateItem',
        async (send, commands) => {
          await countOne(send, commands, table, refillKey(day), { max: cap, ttl });
          return { allowed: true };
        },
        () => ({ allowed: false })
      );
    },
  };
}
