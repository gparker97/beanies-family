/**
 * DynamoDB primitives for the billing Lambda (#95 Phase 5).
 *
 * This is a deliberate SIBLING of `ai-extract/ddb.mjs`, not an import of it: every Lambda in
 * this repo is its own zero-dependency zip (see the plan's "No cross-Lambda shared directory"
 * note), so the three things that must agree across Lambdas are restated here and pinned by
 * tests rather than shared by module:
 *
 *   * `hash()` is sha256 hex of the raw value. `family_id_hash` in every log line, and the
 *     plan-token hash in the billing row, both come from it. `scripts/billing-cohort.mjs`
 *     (`hashPlanToken`) and `ai-extract/allowance.mjs` hash the same way; if any of the three
 *     drifts, a reissued token silently never matches.
 *   * Raw AttributeValues, no DocumentClient: `@aws-sdk/client-dynamodb` resolves from the
 *     nodejs20.x runtime and nothing is bundled.
 *   * Env is read at CALL time so tests can toggle it per case.
 */

import { createHash } from 'node:crypto';

let ddbPromise = null;
export function defaultClient() {
  ddbPromise ??= import('@aws-sdk/client-dynamodb').then((sdk) => {
    // Looser than ai-extract's 800 ms: nothing here runs after a paid model call, and a webhook
    // that times out is retried by Stripe. Two attempts keeps a slow region from eating the
    // 10 s function timeout.
    const client = new sdk.DynamoDBClient({
      maxAttempts: 2,
      requestHandler: { requestTimeout: 2500 },
    });
    return { send: (cmd) => client.send(cmd), commands: sdk };
  });
  return ddbPromise;
}

/** Test-only seam for the default client. Pass `null` to restore the real one. */
let testClient = null;
export function __setDdbClientForTests(client) {
  testClient = client;
}

/** The client a caller should use: injected > test stub > the real lazy one. */
export async function resolveClient(injected) {
  return injected ?? testClient ?? (await defaultClient());
}

/** The one hash. Family ids and plan tokens are NEVER stored or logged raw. */
export function hash(value) {
  return createHash('sha256').update(String(value), 'utf8').digest('hex');
}

/** `{ familyId: 'x' }` → `{ familyId: { S: 'x' } }` for string keys. */
export const marshalKey = (key) =>
  Object.fromEntries(Object.entries(key).map(([k, v]) => [k, { S: String(v) }]));

/** A minimal unmarshal for the flat string/number/bool rows this Lambda reads. */
export function unmarshall(item) {
  if (!item) return null;
  const out = {};
  for (const [k, v] of Object.entries(item)) {
    if (!v || typeof v !== 'object') continue;
    if ('S' in v) out[k] = v.S;
    else if ('N' in v) out[k] = Number(v.N);
    else if ('BOOL' in v) out[k] = v.BOOL;
    else if ('NULL' in v) out[k] = null;
  }
  return out;
}

/**
 * Build an `UpdateItem` input that SETs exactly the given attributes and nothing else.
 *
 * THE WRITE DISCIPLINE OF THE BILLING ROW: three writers (webhook, claim, the cohort script)
 * share one item with disjoint attributes, and each may only `SET` its own. A `PutItem` from any
 * of them would erase the other two. Every write in this Lambda goes through here so the shape
 * cannot be got wrong at a call site; `null`/`undefined` values are skipped, never written.
 */
export function updateSetInput(table, familyId, attrs, condition, removeKeys = []) {
  const names = {};
  const values = {};
  const sets = [];
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined) continue;
    names[`#${k}`] = k;
    values[`:${k}`] = typeof v === 'number' ? { N: String(v) } : { S: String(v) };
    sets.push(`#${k} = :${k}`);
  }
  // Attributes that must be ABSENT after this write (a cancellation that was undone): a
  // `null` in `attrs` is skipped on purpose (never erase on a parse miss), so removal is explicit.
  const removes = removeKeys.filter((k) => !(k in attrs) || attrs[k] == null);
  for (const k of removes) names[`#${k}`] = k;
  if (sets.length === 0 && removes.length === 0) return null;
  const expr = [
    sets.length ? `SET ${sets.join(', ')}` : '',
    removes.length ? `REMOVE ${removes.map((k) => `#${k}`).join(', ')}` : '',
  ]
    .filter(Boolean)
    .join(' ');
  const input = {
    TableName: table,
    Key: marshalKey({ familyId }),
    UpdateExpression: expr,
    ExpressionAttributeNames: names,
    ...(Object.keys(values).length ? { ExpressionAttributeValues: values } : {}),
  };
  // e.g. `attribute_not_exists(tokenClaimedAt)`: the token mint must be one atomic
  // compare-and-set, or two concurrent claims both mint and the second hash wins.
  if (condition) input.ConditionExpression = condition;
  return input;
}

/** One consistent `GetItem` by familyId, unmarshalled, or null. Throws on a store error. */
export async function getRow(table, familyId, ddb) {
  const { send, commands } = await resolveClient(ddb);
  const { Item } = await send(
    new commands.GetItemCommand({
      TableName: table,
      Key: marshalKey({ familyId }),
      ConsistentRead: true,
    })
  );
  return unmarshall(Item);
}
