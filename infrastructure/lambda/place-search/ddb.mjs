/**
 * DynamoDB primitives for the place-search Lambda (#150).
 *
 * SIBLING, NOT SHARED. Every Lambda in this repo is its own zero-dependency zip (see the header
 * of `flight-status/ddb.mjs` and `billing/ddb.mjs`), so these are RESTATED from
 * `flight-status/ddb.mjs` rather than imported:
 *
 *   defaultClient, __setDdbClientForTests, resolveClient, hash, marshalKey, countOne
 *
 * `__tests__/twinDrift.test.mjs` asserts `fn.toString()` equality for each against the
 * flight-status copy. ⚠️ EDIT BOTH COPIES IN ONE COMMIT: the comparison covers comments inside a
 * function body too. This is the third copy of the counter helpers (ai-extract, flight-status,
 * place-search); a fourth Lambda that needs them is the trigger for the shared-kit decision
 * (ADR-049), not a fourth copy.
 *
 * Raw AttributeValues, no DocumentClient: `@aws-sdk/client-dynamodb` resolves from the nodejs20.x
 * runtime and nothing is bundled. Env is read by the CALLER (the handler factory) and passed in.
 */

import { createHash } from 'node:crypto';

/**
 * Lazily-created DynamoDB client, cached at module scope. Lazy so a cold start that 401s, 413s or
 * 400s never pays for SDK initialisation.
 *
 * `maxAttempts` and `requestTimeout` are a DEADLINE: the function timeout is 10 s, the provider
 * call gets at most 6 s, and two store calls (IP token, day token) run before it. At 2 x 500 ms
 * each a fully degraded store costs ~2 s, so the provider budget still fits.
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
 * Test-only seam for the DEFAULT client. Pass `null` to restore the real lazily-loaded client.
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
 * catches it and turns it into a refusal. TTL is written on every update (an `ADD` on a missing
 * item creates it, and there is no cheap "only if new" for the sibling attribute).
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
