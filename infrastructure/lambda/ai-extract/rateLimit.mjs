/* global process */
/**
 * Per-family and per-IP abuse limits for the AI-extract proxy (#83).
 *
 * ── Why this exists ────────────────────────────────────────────────────────────────────
 *
 * The `share` task's text arm used to be safe by PROVENANCE: the text provably came from
 * `content-fetch`, behind its SSRF guard and its own fetch budget — never raw user input.
 * #83 removes that guarantee, because the same field now carries text a person supplied
 * directly — selected in another app and pushed through an exported share sheet, or pasted
 * into the magic-beans sheet inside the app (#84) — authenticated only by a soft `x-api-key`
 * that ships in the public bundle.
 *
 * These limits are not hardening bolted onto a feature. They are what REPLACES the fence
 * being removed. See `docs/adr/035-plain-text-share-provenance.md`.
 *
 * ── Two limits, neither authoritative ──────────────────────────────────────────────────
 *
 *   family — the right unit for cost attribution, and stable. But it is client-supplied and
 *            therefore forgeable. Primary limit, generous.
 *   ip     — catches exactly what family cannot: one attacker rotating family ids. Secondary
 *            backstop, set HIGHER, because shared NAT legitimately puts many real families
 *            behind one address.
 *
 * Either tripping refuses the request. Neither is trusted on its own.
 *
 * ── Identifiers ────────────────────────────────────────────────────────────────────────
 *
 * ONE mechanism: a plain `sha256`, applied here. No HMAC and no secret — an HMAC was
 * considered and dropped, because `hashicorp/random` is not a declared Terraform provider,
 * so `random_password` would add a provider to two `required_providers` blocks and put a
 * secret into Terraform state, in exchange for hiding an IPv4 from the only party who can
 * read this table: the party holding the AWS account, who can already read far more.
 *
 * The IP's preimage space is enumerable at 2^32, so its hash is trivially reversible by
 * whoever holds the table. Accepted, deliberately and once — the hash is there to keep raw
 * addresses out of a stored key, not to defeat that reader.
 *
 * ⚠️ The IP is `requestContext.http.sourceIp` and NEVER `x-forwarded-for`. That header is
 * caller-controlled: an attacker rotating it would defeat the IP limit entirely. This is the
 * single most bypassable detail in this module. Do not "improve" it with a header fallback.
 *
 * ── Window ─────────────────────────────────────────────────────────────────────────────
 *
 * A FIXED hourly bucket, not a rolling one. A conditional `UpdateItem` returning a counter is
 * inherently fixed-window; making it truly rolling needs per-key timestamp lists, a
 * read-modify-write and a race. The bucket is embedded in the key, so one atomic `UpdateItem`
 * does the whole job — no `Query`, no GSI, no item lists.
 *
 * Honest trade: worst case is 2× the limit across a bucket boundary. Accepted.
 *
 * ── Failure posture ────────────────────────────────────────────────────────────────────
 *
 * FAIL OPEN, LOG LOUD. Silently allowing is a silent failure; silently refusing would take
 * down every extraction including the image path this feature does not otherwise touch.
 * Fail-open is acceptable precisely because the API-Gateway route throttle (burst 5 / rate 2)
 * remains in front as the backstop.
 *
 * This module NEVER throws. It owns its own try/catch so the handler gains exactly one `if`.
 */

import { createHash } from 'node:crypto';

/** Requests per family per hour. */
export const FAMILY_LIMIT = 80;
/** Requests per source IP per hour. Higher: a shared NAT carries several real families. */
export const IP_LIMIT = 120;

const WINDOW_SECONDS = 3600;
/** How long a spent bucket lingers before DynamoDB reaps it. One extra window is plenty. */
const TTL_SLACK_SECONDS = WINDOW_SECONDS;

/**
 * Lazily-created DynamoDB client, cached at module scope.
 *
 * There is no bundling step — `archive_file` zips this directory and `@aws-sdk/client-dynamodb`
 * resolves from the nodejs20.x runtime, the same pattern `lambda/registry/index.mjs` uses. A
 * STATIC top-level import would put SDK initialisation into every cold start, including the
 * image path this feature explicitly does not touch. So: `await import(...)`, after the
 * RATE_TABLE early return.
 *
 * (Note for whoever bumps the runtime: AWS has signalled it will stop providing the SDK. A
 * runtime bump means vendoring it, same as registry.)
 */
let ddbPromise = null;
function defaultClient() {
  ddbPromise ??= import('@aws-sdk/client-dynamodb').then((sdk) => {
    const client = new sdk.DynamoDBClient({});
    return { send: (cmd) => client.send(cmd), commands: sdk };
  });
  return ddbPromise;
}

/**
 * Test-only seam for the DEFAULT client.
 *
 * `checkLimits` already takes an injected `ddb`, which covers this module's own suite — but
 * the HANDLER calls it with no client, so `handler.test.mjs` had no way to exercise a refused
 * verdict at all. That gap let the entire rate-limit call site be deleted from `index.mjs`
 * with every handler test still green. Matches the `__resetAttemptBudgetForTests` /
 * `__resetPinAttemptsForTests` convention used on the client.
 *
 * Pass `null` to restore the real lazily-loaded client.
 */
let testClient = null;
export function __setRateLimitClientForTests(client) {
  testClient = client;
}

function hash(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

/**
 * Reduce a source address to the unit an ATTACKER cannot trivially multiply.
 *
 * ⚠️ Over IPv4 the full address is that unit. Over IPv6 it is NOT: a residential subscriber is
 * routinely delegated a /56 or /64, and any cloud VM has a /64 — so keying on the full /128
 * hands an attacker an unbounded supply of fresh buckets simply by binding a new source
 * address per request. Combined with omitting `familyId` (which skips the family limit), that
 * makes BOTH limits no-ops and leaves only the route throttle: exactly the pre-#83 posture
 * ADR-035 says was insufficient.
 *
 * So: IPv6 collapses to its /64 prefix (the first four hextets), IPv4 stays whole. The cost is
 * that one subscriber's whole prefix shares a bucket, which is the correct trade — it is the
 * same "several real families behind one address" case IP_LIMIT is already sized for.
 */
function ipKey(ip) {
  const value = String(ip);
  // IPv4, or an IPv4-mapped IPv6 address (::ffff:1.2.3.4) — keep the whole thing.
  if (!value.includes(':') || value.includes('.')) return value;
  const hextets = value.split(':');
  // `::` compression means a short form can address a whole prefix; expanding it properly is
  // more machinery than this needs, so an already-short address is used as-is (it cannot be
  // multiplied without lengthening it, at which point the /64 slice applies).
  return hextets.length <= 4 ? value : `${hextets.slice(0, 4).join(':')}::/64`;
}

/**
 * Count one request against one key, returning whether it is within `max`.
 *
 * `ADD n :one` with `ConditionExpression attribute_not_exists(n) OR n < :max` is the whole
 * limit: DynamoDB applies the condition and the increment atomically, so concurrent Lambda
 * invocations cannot both see "79" and both proceed. A `ConditionalCheckFailedException` is
 * the AT-LIMIT signal, not an error — it is caught by the caller and turned into a refusal.
 *
 * TTL is written on every update rather than only on create: an `ADD` on a missing item
 * creates it, and there is no cheap "only if new" for the sibling attribute. Rewriting the
 * same value is harmless and keeps the reap guaranteed.
 */
async function countOne(send, commands, table, pk, max, ttl) {
  const { UpdateItemCommand } = commands;
  await send(
    new UpdateItemCommand({
      TableName: table,
      Key: { pk: { S: pk } },
      // `#n` via ExpressionAttributeNames rather than a bare `n`. DynamoDB's reserved-word
      // list is long and easy to be wrong about, and being wrong here fails EVERY request with
      // a ValidationException — which this module's outer catch cannot distinguish from a
      // transient store error, so it would fail open silently-but-loudly forever. The alias
      // costs one line and removes the question.
      UpdateExpression: 'ADD #n :one SET expires_at = :ttl',
      ConditionExpression: 'attribute_not_exists(#n) OR #n < :max',
      ExpressionAttributeNames: { '#n': 'n' },
      ExpressionAttributeValues: {
        ':one': { N: '1' },
        ':max': { N: String(max) },
        ':ttl': { N: String(ttl) },
      },
    })
  );
}

/**
 * Apply both limits to one request.
 *
 * NEVER throws. Returns:
 *   `{ allowed: true }`                                             — within both limits
 *   `{ allowed: true, degraded: true }`                             — the store failed; allowed
 *   `{ allowed: false, limit: 'family'|'ip', retryAfterSeconds }`   — refused
 *
 * @param {object}  args
 * @param {string=} args.familyId   Raw family id from the request body. Absent is SUPPORTED —
 *                                  an old cached bundle sends none, and it must fall back to
 *                                  the IP limit rather than 400. Never logged, never stored.
 * @param {string=} args.ip         `event.requestContext.http.sourceIp`.
 * @param {number=} args.now        Epoch ms. Injectable so tests need no clock control.
 * @param {object=} args.ddb        `{ send, commands }`. Injectable so `node --test` can pass
 *                                  a stub — there is no `aws-sdk-client-mock` in this repo.
 */
export async function checkLimits({ familyId, ip, now = Date.now(), ddb } = {}) {
  // Read at CALL time, not module load. Lambda's environment is static in production either
  // way, and reading here is what lets `node --test` exercise both the configured and the
  // unset paths in one process without module-cache games.
  const table = process.env.RATE_TABLE;

  // Unset table ⇒ immediate, SILENT no-op. Without this the existing handler suite (every
  // case a POST) would attempt a real DynamoDB call per test, and any non-prod deploy would
  // silently depend on credentials it does not need. Deliberately logs nothing: an unset
  // table is a valid configuration, not a fault.
  if (!table) return { allowed: true };

  // Nothing to key on. An unauthenticated flood is already stopped by the x-api-key check
  // upstream of this, and the route throttle bounds the rest.
  if (!familyId && !ip) return { allowed: true };

  const bucket = Math.floor(now / 1000 / WINDOW_SECONDS);
  const ttl = (bucket + 1) * WINDOW_SECONDS + TTL_SLACK_SECONDS;
  // Seconds until this bucket ends — an honest `Retry-After` for a fixed window.
  const retryAfterSeconds = Math.max(1, (bucket + 1) * WINDOW_SECONDS - Math.floor(now / 1000));

  try {
    const { send, commands } = ddb ?? testClient ?? (await defaultClient());

    // Family FIRST: it is the limit a legitimate heavy user meets, and the one whose refusal
    // is most informative. Checking it first also means a forged-id flood still consumes its
    // own family bucket before reaching the IP one.
    if (familyId) {
      try {
        await countOne(send, commands, table, `f#${hash(familyId)}#${bucket}`, FAMILY_LIMIT, ttl);
      } catch (err) {
        if (err?.name !== 'ConditionalCheckFailedException') throw err;
        // Never the identifier — only WHICH limit tripped. A NAT false-positive must show as
        // an IP-limit spike without deanonymising anybody.
        console.warn('[ai-extract] rate_limited limit=family');
        return { allowed: false, limit: 'family', retryAfterSeconds };
      }
    }

    if (ip) {
      try {
        await countOne(send, commands, table, `i#${hash(ipKey(ip))}#${bucket}`, IP_LIMIT, ttl);
      } catch (err) {
        if (err?.name !== 'ConditionalCheckFailedException') throw err;
        console.warn('[ai-extract] rate_limited limit=ip');
        return { allowed: false, limit: 'ip', retryAfterSeconds };
      }
    }

    return { allowed: true };
  } catch (err) {
    // ⚠️ This exact prefix is what the CloudWatch metric-filter alarm matches. Changing the
    // string means changing `modules/ai-extract/main.tf` in the same commit.
    console.error(
      '[ai-extract] rate-limit store unavailable — allowing the request. Check the ' +
        `${table} table and the Lambda dynamodb:UpdateItem permission.`,
      err
    );
    return { allowed: true, degraded: true };
  }
}
