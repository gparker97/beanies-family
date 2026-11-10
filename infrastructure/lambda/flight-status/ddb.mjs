/**
 * DynamoDB primitives for the flight-status Lambda (#143).
 *
 * This is a deliberate SIBLING of `ai-extract/ddb.mjs`, not an import of it: every Lambda in
 * this repo is its own zero-dependency zip (see the plan's "No cross-Lambda shared directory"
 * note), so the things that must agree across Lambdas are restated here and pinned by tests
 * rather than shared by module:
 *
 *   * `hash()` is sha256 hex of the raw value. Here it only ever hashes a source-IP prefix, so no
 *     cross-Lambda join depends on it, but it stays byte-identical to ai-extract's so it never
 *     becomes the one that quietly differs.
 *   * Raw AttributeValues, no DocumentClient: `@aws-sdk/client-dynamodb` resolves from the
 *     nodejs20.x runtime and nothing is bundled.
 *   * Env is read by the CALLER (the handler factory) and passed in, so tests can vary it per case.
 *
 * Lifted from `ai-extract/ddb.mjs`: `defaultClient`, `__setDdbClientForTests`, `resolveClient`,
 * `hash`, `marshalKey`, `countOne`, `safeWrite`. The ai-extract usage-table grammar is not copied;
 * this Lambda has one table and its key grammar lives in `store.mjs`.
 */

import { createHash } from 'node:crypto';

/**
 * Lazily-created DynamoDB client, cached at module scope.
 *
 * Lazy so a cold start that 401s, 413s or 400s never pays for SDK initialisation.
 *
 * `maxAttempts` and `requestTimeout` are a DEADLINE, not tuning. The function's timeout is 20 s,
 * raised for the 6-hourly sweep only; every HTTP path keeps the old 10 s budget. The proxy's
 * provider call is allowed 8 s; up to three store calls run before it (IP token, cache read, day
 * token) and one after (cache write). At 2 x 500 ms each a fully degraded store costs ~2 s before
 * the provider, and every one of these calls fails OPEN, so a slow store is latency, never a
 * refusal. The handler also hands the provider a signal bounded by the time actually remaining.
 * The webhook has the provider's own 10 s window: one Query, a capped fan-out at 3 s per send and
 * at most one 3 s refill, so a degraded store (1 s per call) still answers inside it. The alerts
 * store (alertsStore.mjs) fails CLOSED instead, answering `alerts_unavailable`.
 */
let ddbPromise = null;
export function defaultClient() {
  ddbPromise ??= import('@aws-sdk/client-dynamodb').then((sdk) => {
    const client = new sdk.DynamoDBClient({
      maxAttempts: 2,
      requestHandler: { requestTimeout: 500 },
    });
    return { send: (cmd) => client.send(cmd), commands: sdk };
  });
  return ddbPromise;
}

/**
 * Test-only seam for the DEFAULT client, shared by every module in this Lambda. ONE seam: two
 * overrides of one cached client is how a test stubs one module while the other quietly reaches
 * AWS. Pass `null` to restore the real lazily-loaded client.
 */
let testClient = null;
export function __setDdbClientForTests(client) {
  testClient = client;
}

/** The client a caller should use: injected > test stub > the real lazy one. */
export async function resolveClient(injected) {
  return injected ?? testClient ?? (await defaultClient());
}

/** The one hash. A raw source address is never stored or logged; its key goes through here. */
export function hash(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

/** Plain-string key → raw AttributeValue key. Marshalling happens here, once. */
export const marshalKey = (key) =>
  Object.fromEntries(Object.entries(key).map(([k, v]) => [k, { S: v }]));

/**
 * Atomically increment one counter, optionally refusing above `max`.
 *
 * With `max`, a ConditionalCheckFailedException is the AT-LIMIT signal, not an error: the caller
 * catches it and turns it into a refusal.
 *
 * TTL is written on every update rather than only on create: an `ADD` on a missing item creates
 * it, and there is no cheap "only if new" for the sibling attribute. Rewriting the same value is
 * harmless and keeps the reap guaranteed.
 */
export async function countOne(send, commands, table, key, { max, ttl, attr = 'n' } = {}) {
  const { UpdateItemCommand } = commands;
  // `#n` via ExpressionAttributeNames rather than a bare name: a reserved-word mistake would fail
  // EVERY request with a ValidationException that an outer catch reads as a transient store error.
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
 * carrying the fixed prefix AND remediation, returns false.
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
