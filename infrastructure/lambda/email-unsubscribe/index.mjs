/* global process, Buffer */
/**
 * Email unsubscribe Lambda (#115): records an owner's opt-out from campaign email, and undoes
 * it when the same token holder explicitly asks to re-subscribe.
 *
 * Two routes on the shared HTTP API (`api.beanies.family`), one URL, branched on method:
 *
 *   GET  /unsubscribe?t=<token>   302 -> https://beanies.family/unsubscribe?t=<token>
 *                                 Stores nothing itself. Note the page it lands on posts the
 *                                 unsubscribe on load (one tap, no confirm step, by design), so
 *                                 a scanner that RUNS the page's JavaScript can still opt an
 *                                 owner out. Accepted in the #115 plan: the harm is one fewer
 *                                 email, and the page offers a re-subscribe button to undo it.
 *   POST /unsubscribe?t=<token>   Records the opt-out: 200 {ok, status: 'unsubscribed'} on a new
 *                                 row, 200 {ok, status: 'already'} when one exists. Both the
 *                                 RFC 8058 one-click POST from a mail client (body
 *                                 `List-Unsubscribe=One-Click`) and the confirmation page post
 *                                 here; the body only tells them apart (`source` in the log).
 *   POST /unsubscribe?t=<token>&action=resubscribe
 *                                 Deletes the opt-out row: 200 {ok, status: 'resubscribed'}, or
 *                                 {ok, status: 'not_unsubscribed'} when there was none. Only the
 *                                 page's re-subscribe button sends this, on an explicit click,
 *                                 never on load. Any other `action` value is 400 bad_action.
 *
 * The `action` query parameter alone decides what a POST does; the body never does. A one-click
 * POST goes to the List-Unsubscribe URL the campaign sender wrote, which never carries `action`,
 * so a mail client can only ever unsubscribe. (A one-click body sent to a URL that does carry
 * `action=resubscribe` is still a re-subscribe: only the token holder can build that URL.)
 *
 * The token is read ONLY from the query string, never the body. It is verified with
 * `token.mjs`; only the `emailHash` is stored (no address ever reaches this Lambda). The table
 * (`OPTOUT_TABLE`, PK `emailHash`) is written with `attribute_not_exists(emailHash)`, so the
 * first unsubscribe timestamp is kept and a repeat is a harmless `already`; a re-subscribe
 * deletes with `attribute_exists(emailHash)`, so a repeat is a harmless `not_unsubscribed`.
 *
 * No CORS code: the shared gateway's `allow_origins = ["*"]` answers preflight, and the page
 * sends a simple request.
 *
 * Logging: one JSON line per request `{msg, outcome, source, reason, hashTail}` (last 6 hex of
 * the hash; never the token or an address). Outcomes: stored | already | resubscribed |
 * not_unsubscribed | invalid_token | bad_action | store_failed | resubscribe_failed | redirect.
 * A failed store is a compliance failure and a failed re-subscribe is a failed user action, so
 * each also logs its exported alarmed prefix, which has a CloudWatch metric filter + alarm in the
 * ops repo's `modules/email-optout` (pinned by `infrastructure/__tests__/alarm-prefixes.test.mjs`).
 */

import { DeleteItemCommand, DynamoDBClient, PutItemCommand } from '@aws-sdk/client-dynamodb';

import { TOKEN_SHAPE, verifyUnsubToken } from './token.mjs';

export const ALARMING_PREFIXES = Object.freeze({
  storeFailed: '[email-unsubscribe] store_failed',
  resubscribeFailed: '[email-unsubscribe] resubscribe_failed',
});

export const REMEDIATION =
  'An unsubscribe request could NOT be recorded; that owner may still be mailed. Check that the ' +
  'opt-out table (OPTOUT_TABLE, beanies-family-email-optout-prod) exists, that the Lambda role ' +
  'still grants dynamodb:PutItem on it, and that UNSUB_TOKEN_SECRET is set. Then record the ' +
  'opt-out by hand: follow the manual-unsubscribe runbook in the beanies-email skill ' +
  '(~/projects/beanies-ops/.claude/skills/beanies-email/SKILL.md) before the next send.';

export const RESUBSCRIBE_REMEDIATION =
  'A re-subscribe request could NOT be recorded; that owner stays unsubscribed (no compliance ' +
  'risk, but they asked to hear from us again and were told it did not work). Check that the ' +
  'opt-out table (OPTOUT_TABLE, beanies-family-email-optout-prod) exists, that the Lambda role ' +
  'grants dynamodb:DeleteItem on it, and that UNSUB_TOKEN_SECRET is set. If the owner replies ' +
  'asking to be re-subscribed, follow the re-subscribe runbook in the beanies-email skill ' +
  '(~/projects/beanies-ops/.claude/skills/beanies-email/SKILL.md) with the emailHash logged here.';

export const PAGE_URL = 'https://beanies.family/unsubscribe';
const ONE_CLICK_BODY = 'List-Unsubscribe=One-Click';
const RESUBSCRIBE = 'resubscribe';

// ── DynamoDB: the nodejs20.x runtime's SDK, nothing bundled ──────────────────────────────────
// Imported and constructed at module load (the registry Lambda does the same), NOT lazily in
// the handler: init runs with a CPU burst, while a first-request dynamic import at 128 MB took
// 5.5-6 s on 2026-10-05 and outlived the unsubscribe page's 6 s timeout on every cold start.
// `throwOnRequestTimeout`: from @smithy/node-http-handler 4.4.0 a bare `requestTimeout` only
// logs a warning, so a stalled PutItem would run to the Lambda timeout outside the catch and
// lose the unsubscribe with no store_failed line. With it, a stall fails fast and is alarmed.
const ddb = new DynamoDBClient({
  maxAttempts: 2,
  requestHandler: { requestTimeout: 2500, connectionTimeout: 1500, throwOnRequestTimeout: true },
});
const defaultClient = () => ({
  send: (cmd) => ddb.send(cmd),
  commands: { PutItemCommand, DeleteItemCommand },
});

/** Test-only seam for the default client. Pass `null` to restore the real one. */
let testClient = null;
export function __setDdbClientForTests(client) {
  testClient = client;
}

// ── Helpers ──────────────────────────────────────────────────────────────────────────────────
function json(statusCode, body, extraHeaders = {}) {
  return {
    statusCode,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...extraHeaders },
    body: JSON.stringify(body),
  };
}

/** The request body as text. API Gateway v2 may base64-encode it (billing `rawBodyOf`). */
function bodyText(event) {
  if (typeof event?.body !== 'string') return '';
  return (
    event.isBase64Encoded ? Buffer.from(event.body, 'base64') : Buffer.from(event.body, 'utf8')
  ).toString('utf8');
}

/**
 * One structured line per request. Closed-enum fields only; never the token or an address.
 * `reason` says why a request failed. On store_failed and resubscribe_failed the FULL emailHash
 * is logged (a keyed HMAC, already the opt-out table key, never the address) so greg can record
 * or delete that owner's opt-out by hand from the log alone (beanies-email SKILL.md runbooks).
 */
const FULL_HASH_OUTCOMES = new Set(['store_failed', 'resubscribe_failed']);

function logOutcome(outcome, source = null, hash = null, reason = null) {
  // eslint-disable-next-line no-console -- structured decision line, read by CloudWatch
  console.log(
    JSON.stringify({
      msg: 'email-unsubscribe',
      outcome,
      source,
      reason,
      hashTail: hash ? hash.slice(-6) : null,
      ...(FULL_HASH_OUTCOMES.has(outcome) && hash ? { emailHash: hash } : {}),
    })
  );
}

/** Why a token was refused: no token, wrong shape (cut off or altered), or a bad signature. */
function tokenProblem(token) {
  if (typeof token !== 'string' || !token) return 'missing';
  return TOKEN_SHAPE.test(token) ? 'bad_signature' : 'malformed';
}

function redirect(token) {
  logOutcome('redirect');
  const location =
    typeof token === 'string' && token ? `${PAGE_URL}?t=${encodeURIComponent(token)}` : PAGE_URL;
  return {
    statusCode: 302,
    headers: { location, 'cache-control': 'no-store' },
    body: '',
  };
}

/** `one-click` when the body is the RFC 8058 marker, else `page`. Logged and stored, never trusted. */
function sourceOf(event) {
  return bodyText(event).includes(ONE_CLICK_BODY) ? 'one-click' : 'page';
}

/**
 * The verified emailHash, or a ready error response. `failedOutcome` / `prefix` / `remediation`
 * name the action's alarmed failure, so a missing secret pages on the right alarm.
 */
function verify(token, source, { failedOutcome, prefix, remediation }) {
  const secret = process.env.UNSUB_TOKEN_SECRET;
  if (!secret) {
    // Never verify (let alone accept) a token without the secret. Every request fails until
    // this is fixed, so it rides the same alarm as a failed write.
    logOutcome(failedOutcome, source, null, 'secret_unset');
    console.error(`${prefix} (UNSUB_TOKEN_SECRET is not set)\n${remediation}`);
    return { response: json(500, { error: failedOutcome }) };
  }
  const hash = verifyUnsubToken(secret, token);
  if (!hash) {
    logOutcome('invalid_token', source, null, tokenProblem(token));
    return { response: json(400, { error: 'invalid_token' }) };
  }
  return { hash };
}

async function unsubscribe(event, token) {
  const source = sourceOf(event);
  const { hash, response } = verify(token, source, {
    failedOutcome: 'store_failed',
    prefix: ALARMING_PREFIXES.storeFailed,
    remediation: REMEDIATION,
  });
  if (response) return response;

  try {
    const { send, commands } = testClient ?? defaultClient();
    await send(
      new commands.PutItemCommand({
        TableName: process.env.OPTOUT_TABLE,
        Item: {
          emailHash: { S: hash },
          unsubscribedAt: { S: new Date().toISOString() },
          source: { S: source },
        },
        ConditionExpression: 'attribute_not_exists(emailHash)',
      })
    );
  } catch (err) {
    if (err?.name === 'ConditionalCheckFailedException') {
      logOutcome('already', source, hash);
      return json(200, { ok: true, status: 'already' });
    }
    logOutcome('store_failed', source, hash, err?.name || 'unknown');
    console.error(`${ALARMING_PREFIXES.storeFailed} emailHash=${hash}\n${REMEDIATION}`, err);
    return json(500, { error: 'store_failed' });
  }

  logOutcome('stored', source, hash);
  return json(200, { ok: true, status: 'unsubscribed' });
}

async function resubscribe(event, token) {
  const source = sourceOf(event);
  const { hash, response } = verify(token, source, {
    failedOutcome: 'resubscribe_failed',
    prefix: ALARMING_PREFIXES.resubscribeFailed,
    remediation: RESUBSCRIBE_REMEDIATION,
  });
  if (response) return response;

  try {
    const { send, commands } = testClient ?? defaultClient();
    await send(
      new commands.DeleteItemCommand({
        TableName: process.env.OPTOUT_TABLE,
        Key: { emailHash: { S: hash } },
        ConditionExpression: 'attribute_exists(emailHash)',
      })
    );
  } catch (err) {
    if (err?.name === 'ConditionalCheckFailedException') {
      logOutcome('not_unsubscribed', source, hash);
      return json(200, { ok: true, status: 'not_unsubscribed' });
    }
    logOutcome('resubscribe_failed', source, hash, err?.name || 'unknown');
    console.error(
      `${ALARMING_PREFIXES.resubscribeFailed} emailHash=${hash}\n${RESUBSCRIBE_REMEDIATION}`,
      err
    );
    return json(500, { error: 'resubscribe_failed' });
  }

  logOutcome('resubscribed', source, hash);
  return json(200, { ok: true, status: 'resubscribed' });
}

/** POST: the `action` query parameter alone picks the operation (see the header). */
function post(event, token) {
  const action = event?.queryStringParameters?.action;
  if (action === undefined) return unsubscribe(event, token);
  if (action === RESUBSCRIBE) return resubscribe(event, token);
  logOutcome('bad_action', sourceOf(event), null, 'unknown_action');
  return json(400, { error: 'bad_action' });
}

export async function handler(event) {
  const method = event?.requestContext?.http?.method;
  const token = event?.queryStringParameters?.t;
  if (method === 'GET') return redirect(token);
  if (method === 'POST') return post(event, token);
  return json(405, { error: 'method_not_allowed' }, { allow: 'GET, POST' });
}
