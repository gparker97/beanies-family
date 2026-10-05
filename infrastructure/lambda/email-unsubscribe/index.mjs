/* global process, Buffer */
/**
 * Email unsubscribe Lambda (#115): records an owner's opt-out from campaign email.
 *
 * Two routes on the shared HTTP API (`api.beanies.family`), one URL, branched on method:
 *
 *   GET  /unsubscribe?t=<token>   302 -> https://beanies.family/unsubscribe?t=<token>
 *                                 Stores nothing itself. Note the page it lands on posts the
 *                                 unsubscribe on load (one tap, no confirm step, by design), so
 *                                 a scanner that RUNS the page's JavaScript can still opt an
 *                                 owner out. Accepted in the #115 plan: the harm is one fewer
 *                                 email, and the page says how to undo it.
 *   POST /unsubscribe?t=<token>   Records the opt-out. Both the RFC 8058 one-click POST from a
 *                                 mail client (body `List-Unsubscribe=One-Click`) and the
 *                                 confirmation page post here; the body only tells them apart.
 *
 * The token is read ONLY from the query string, never the body. It is verified with
 * `token.mjs`; only the `emailHash` is stored (no address ever reaches this Lambda). The table
 * (`OPTOUT_TABLE`, PK `emailHash`) is written with `attribute_not_exists(emailHash)`, so the
 * first unsubscribe timestamp is kept and a repeat is a harmless `already`.
 *
 * No CORS code: the shared gateway's `allow_origins = ["*"]` answers preflight, and the page
 * sends a simple request.
 *
 * Logging: one JSON line per request `{msg, outcome, source, hashTail}` (last 6 hex of the hash;
 * never the token or an address). A failed store is a compliance failure, so it also logs the
 * exported alarmed prefix, which has a CloudWatch metric filter + alarm in the ops repo's
 * `modules/email-optout` (pinned by `infrastructure/__tests__/alarm-prefixes.test.mjs`).
 */

import { DynamoDBClient, PutItemCommand } from '@aws-sdk/client-dynamodb';

import { TOKEN_SHAPE, verifyUnsubToken } from './token.mjs';

export const ALARMING_PREFIXES = Object.freeze({
  storeFailed: '[email-unsubscribe] store_failed',
});

export const REMEDIATION =
  'An unsubscribe request could NOT be recorded; that owner may still be mailed. Check that the ' +
  'opt-out table (OPTOUT_TABLE, beanies-family-email-optout-prod) exists, that the Lambda role ' +
  'still grants dynamodb:PutItem on it, and that UNSUB_TOKEN_SECRET is set. Then record the ' +
  'opt-out by hand: follow the manual-unsubscribe runbook in the beanies-email skill ' +
  '(~/projects/beanies-ops/.claude/skills/beanies-email/SKILL.md) before the next send.';

export const PAGE_URL = 'https://beanies.family/unsubscribe';
const ONE_CLICK_BODY = 'List-Unsubscribe=One-Click';

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
const defaultClient = () => ({ send: (cmd) => ddb.send(cmd), commands: { PutItemCommand } });

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
 * `reason` says why a request failed. On store_failed the FULL emailHash is logged (a keyed
 * HMAC, already the opt-out table key, never the address) so greg can record that owner's
 * opt-out by hand from the log alone (beanies-email SKILL.md, manual unsubscribe).
 */
function logOutcome(outcome, source = null, hash = null, reason = null) {
  // eslint-disable-next-line no-console -- structured decision line, read by CloudWatch
  console.log(
    JSON.stringify({
      msg: 'email-unsubscribe',
      outcome,
      source,
      reason,
      hashTail: hash ? hash.slice(-6) : null,
      ...(outcome === 'store_failed' && hash ? { emailHash: hash } : {}),
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

async function unsubscribe(event, token) {
  const source = bodyText(event).includes(ONE_CLICK_BODY) ? 'one-click' : 'page';

  const secret = process.env.UNSUB_TOKEN_SECRET;
  if (!secret) {
    // Never verify (let alone accept) a token without the secret. Every unsubscribe fails
    // until this is fixed, so it rides the same alarm as a failed store.
    logOutcome('store_failed', source, null, 'secret_unset');
    console.error(
      `${ALARMING_PREFIXES.storeFailed} (UNSUB_TOKEN_SECRET is not set)\n${REMEDIATION}`
    );
    return json(500, { error: 'store_failed' });
  }

  const hash = verifyUnsubToken(secret, token);
  if (!hash) {
    logOutcome('invalid_token', source, null, tokenProblem(token));
    return json(400, { error: 'invalid_token' });
  }

  try {
    const { send, commands } = testClient ?? (await defaultClient());
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
      return json(200, { ok: true });
    }
    logOutcome('store_failed', source, hash, err?.name || 'unknown');
    console.error(`${ALARMING_PREFIXES.storeFailed} emailHash=${hash}\n${REMEDIATION}`, err);
    return json(500, { error: 'store_failed' });
  }

  logOutcome('stored', source, hash);
  return json(200, { ok: true });
}

export async function handler(event) {
  const method = event?.requestContext?.http?.method;
  const token = event?.queryStringParameters?.t;
  if (method === 'GET') return redirect(token);
  if (method === 'POST') return unsubscribe(event, token);
  return json(405, { error: 'method_not_allowed' }, { allow: 'GET, POST' });
}
