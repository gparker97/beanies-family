/* global process */
/**
 * Shared DynamoDB primitives for the ai-extract Lambda.
 *
 * WHY THIS MODULE EXISTS
 * `rateLimit.mjs` owned `hash()`, `defaultClient()` and `countOne()` privately. The usage meter
 * needs all three. Copying them would give us two `createHash('sha256')` helpers that can
 * silently diverge — at which point `/beanies-metrics` joins zero rows against the registry and
 * nobody finds out — and two module-scope SDK import promises, i.e. two cold-start
 * initialisations on a path that now runs on EVERY request.
 *
 * It also owns the usage-table GRAMMAR as data rather than prose. Five facts have to stay in
 * step across the Lambda and the metrics skill — the hash function, the pk prefix, the sk
 * prefix, the attribute names and the table name — and a mismatch in any one of them returns an
 * empty scan, which looks exactly like "no reads yet". Declaring them once here is what makes
 * that impossible; `scripts/pull_ai_usage.mjs` imports them directly rather than re-deriving.
 */

import { createHash } from 'node:crypto';

/**
 * Lazily-created DynamoDB client, cached at module scope.
 *
 * There is no bundling step — `archive_file` zips this directory and `@aws-sdk/client-dynamodb`
 * resolves from the nodejs20.x runtime, the same pattern `lambda/registry/index.mjs` uses.
 *
 * The import stays lazy, but the reason has CHANGED and the old one is now false. It used to be
 * "the image path this feature does not touch"; the meter touches every path. The surviving
 * reason: a cold start that 401s, 413s or 400s should still not pay for SDK initialisation.
 *
 * `maxAttempts` and `requestTimeout` are a DEADLINE, not tuning. The post-model window is ~4
 * seconds (UPSTREAM_TIMEOUT_MS 25s inside a 29s function), and the SDK's default of 3 attempts
 * with exponential backoff can spend all of it. A failed count is a logged, alertable gap; a
 * Lambda that TIMES OUT after the model was paid for loses the user their extraction, which is
 * the outcome the awaited count exists to avoid. `checkLimits` inherits the same bound, also
 * correctly: a slow limiter write is latency the user pays before the model even starts.
 *
 * (Note for whoever bumps the runtime: AWS has signalled it will stop providing the SDK. A
 * runtime bump means vendoring it, same as registry.)
 */
let ddbPromise = null;
export function defaultClient() {
  ddbPromise ??= import('@aws-sdk/client-dynamodb').then((sdk) => {
    const client = new sdk.DynamoDBClient({
      maxAttempts: 2,
      requestHandler: { requestTimeout: 800 },
    });
    return { send: (cmd) => client.send(cmd), commands: sdk };
  });
  return ddbPromise;
}

/**
 * Test-only seam for the DEFAULT client, shared by every module in this Lambda.
 *
 * ONE seam, not one per module: two overrides of one cached client is a trap where a test stubs
 * one and the other quietly reaches AWS, and the symptom is a hang or a credential error nobody
 * attributes to the seam. `rateLimit.mjs` re-exports this under its existing name so
 * `handler.test.mjs` needs no change at all.
 *
 * Pass `null` to restore the real lazily-loaded client.
 */
let testClient = null;
export function __setDdbClientForTests(client) {
  testClient = client;
}

/** The client a caller should use: injected > test stub > the real lazy one. */
export async function resolveClient(injected) {
  return injected ?? testClient ?? (await defaultClient());
}

/**
 * The one hash. Family ids are NEVER stored or logged in raw form (see rateLimit.mjs's
 * doctrine); every key derived from one goes through here, including in the metrics skill.
 */
export function hash(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

// ── The usage-table grammar. Declared once, imported by the metrics skill. ───────────────────

/** Counter item: one per family per UTC day. Plain strings — `countOne` marshals. */
export const usageKey = (familyId, dayIso) => ({
  pk: `f#${hash(familyId)}`,
  sk: `d#${dayIso}`,
});

/** Correction grant: lives in the RATE table, whose hourly TTL horizon is already a grant's. */
export const grantKey = (familyId, id) => ({ pk: `c#${hash(familyId)}#${id}` });

/**
 * The two counters on a usage item.
 *
 * `charged` is what an allowance is spent against. `corrected` is OUR cost, not the family's —
 * a free re-read after we inferred the wrong kind. An entitlement layer that sums the row rather
 * than reading `n` would bill families for our miscategorisations, which is the opposite of the
 * promise. A fourth counter is a new attribute here, never a second item shape: the sort key is
 * the day, and a second shape under the same `pk` breaks the metrics scan-and-sum.
 */
export const USAGE_ATTRS = Object.freeze({ charged: 'n', corrected: 'c' });

/**
 * Convenience default for `pull_ai_usage.mjs` ONLY — terraform owns the real name and hands it
 * to the Lambda as `USAGE_TABLE`. Overridable so it is never the fact that breaks a join.
 */
export const usageTableName = (env, appName = 'beanies-family') =>
  process.env.AI_USAGE_TABLE || `${appName}-ai-usage-${env}`;

// ── Writes ───────────────────────────────────────────────────────────────────────────────────

/**
 * Keys are declared as plain strings (above) because this module has two consumers with
 * opposite needs: the Lambda speaks raw AttributeValue — there is no DocumentClient in this
 * runtime — and `pull_ai_usage.mjs` compares plain strings from a Scan. Plain wins at the
 * boundary; marshalling happens here, once.
 *
 * ⚠️ Getting this wrong throws ValidationException on EVERY write, which an outer catch reports
 * as a transient store error — the same mis-classification the `#n` alias below exists to
 * prevent, one level up.
 */
const marshalKey = (key) => Object.fromEntries(Object.entries(key).map(([k, v]) => [k, { S: v }]));

/**
 * Atomically increment one counter, optionally refusing above `max`.
 *
 * Lifted from `rateLimit.mjs`'s private `countOne` and generalised on exactly three axes: a full
 * `Key` object (so a table with a sort key works), an optional `max` (omitted ⇒ no
 * ConditionExpression ⇒ the unconditional increment the meter needs), and the attribute name (so
 * a correction increments `c`).
 *
 * With `max`, a ConditionalCheckFailedException is the AT-LIMIT signal, not an error — the
 * caller catches it and turns it into a refusal.
 *
 * TTL is written on every update rather than only on create: an `ADD` on a missing item creates
 * it, and there is no cheap "only if new" for the sibling attribute. Rewriting the same value is
 * harmless and keeps the reap guaranteed.
 */
export async function countOne(send, commands, table, key, { max, ttl, attr = 'n' } = {}) {
  const { UpdateItemCommand } = commands;
  // `#n` via ExpressionAttributeNames rather than a bare name. DynamoDB's reserved-word list is
  // long and easy to be wrong about, and being wrong here fails EVERY request with a
  // ValidationException — which an outer catch cannot distinguish from a transient store error,
  // so it would fail silently-but-loudly forever. The alias costs one line and removes the
  // question. This matters more now than it did: `c` and `n` are both short and both counters.
  const values = { ':one': { N: '1' }, ':ttl': { N: String(ttl) } };
  if (max !== undefined) values[':max'] = { N: String(max) };

  await send(
    new UpdateItemCommand({
      TableName: table,
      Key: marshalKey(key),
      UpdateExpression: 'ADD #n :one SET expires_at = :ttl',
      ...(max !== undefined
        ? { ConditionExpression: 'attribute_not_exists(#n) OR #n < :max' }
        : {}),
      ExpressionAttributeNames: { '#n': attr },
      ExpressionAttributeValues: values,
    })
  );
}

/**
 * Run a write that must NEVER throw and must NEVER fail silently.
 *
 * Unset table ⇒ silent no-op, returns false. Success ⇒ true. Failure ⇒ one `console.error`
 * carrying the fixed prefix AND remediation, returns false. That boolean is exactly what the
 * meter's "issue a grant only if the count succeeded" rule needs.
 *
 * ⚠️ `checkLimits` is deliberately NOT built on this. Its contract is three-valued
 * (allowed / allowed+degraded / refused+limit+retryAfter), it must treat
 * ConditionalCheckFailedException as a REFUSAL rather than a failure, and its fail-open
 * direction is the opposite of the meter's fail-loud one. Sharing a wrapper would mean either
 * widening this until it stops being a contract, or changing the limiter — and `rateLimit.test.mjs`
 * must pass unchanged. It shares `hash`, `countOne` and `defaultClient`, and keeps its own catch.
 *
 * @param {string}   table        Resolved table name; falsy ⇒ silent no-op.
 * @param {string}   prefix       The fixed log prefix a CloudWatch metric filter matches.
 * @param {string}   remediation  What to check. Shown to whoever reads the alarm.
 * @param {Function} fn           The write.
 */
export async function safeWrite(table, prefix, remediation, fn) {
  if (!table) return false;
  try {
    await fn();
    return true;
  } catch (err) {
    console.error(`${prefix}\n${remediation}`, err);
    return false;
  }
}
