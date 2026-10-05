/* global process, Buffer */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  handler,
  __setDdbClientForTests,
  ALARMING_PREFIXES,
  PAGE_URL,
  RESUBSCRIBE_REMEDIATION,
} from '../index.mjs';
import { signUnsubToken, emailHash } from '../token.mjs';

const SECRET = 'test-secret-do-not-use';
const TABLE = 'optout-table';
const EMAIL = 'owner@example.com';
const TOKEN = signUnsubToken(SECRET, EMAIL);
const HASH = emailHash(SECRET, EMAIL);

const originalLog = console.log;
const originalError = console.error;

// ── A tiny DynamoDB double: one table keyed by emailHash, conditional Put/Delete honoured ────
class PutItemCommand {
  constructor(input) {
    this.input = input;
  }
}
class DeleteItemCommand {
  constructor(input) {
    this.input = input;
  }
}
const conditionFailed = () =>
  Object.assign(new Error('The conditional request failed'), {
    name: 'ConditionalCheckFailedException',
  });
function fakeDdb({ rows = {}, putThrows = null, deleteThrows = null } = {}) {
  const calls = [];
  return {
    calls,
    rows,
    ddb: {
      commands: { PutItemCommand, DeleteItemCommand },
      async send(cmd) {
        calls.push(cmd);
        if (cmd instanceof DeleteItemCommand) {
          if (deleteThrows) throw deleteThrows;
          const key = cmd.input.Key.emailHash.S;
          if (cmd.input.ConditionExpression === 'attribute_exists(emailHash)' && !rows[key]) {
            throw conditionFailed();
          }
          delete rows[key];
          return {};
        }
        if (putThrows) throw putThrows;
        const key = cmd.input.Item.emailHash.S;
        if (cmd.input.ConditionExpression === 'attribute_not_exists(emailHash)' && rows[key]) {
          throw conditionFailed();
        }
        rows[key] = Object.fromEntries(Object.entries(cmd.input.Item).map(([k, v]) => [k, v.S]));
        return {};
      },
    },
  };
}

const event = (method, { t, action, body, isBase64Encoded = false } = {}) => {
  const qs = {
    ...(t === undefined ? {} : { t }),
    ...(action === undefined ? {} : { action }),
  };
  return {
    requestContext: { http: { method } },
    queryStringParameters: Object.keys(qs).length ? qs : undefined,
    body,
    isBase64Encoded,
  };
};
const post = (opts) => event('POST', opts);
const resub = (opts) => post({ action: 'resubscribe', ...opts });

let logs;
let errors;
let fake;
beforeEach(() => {
  logs = [];
  errors = [];
  console.log = (line) => logs.push(JSON.parse(line));
  console.error = (...args) => errors.push(args);
  process.env.UNSUB_TOKEN_SECRET = SECRET;
  process.env.OPTOUT_TABLE = TABLE;
  fake = fakeDdb();
  __setDdbClientForTests(fake.ddb);
});
afterEach(() => {
  console.log = originalLog;
  console.error = originalError;
  delete process.env.UNSUB_TOKEN_SECRET;
  delete process.env.OPTOUT_TABLE;
  __setDdbClientForTests(null);
});

const bodyOf = (res) => JSON.parse(res.body);

describe('POST /unsubscribe', () => {
  it('stores a valid token once, with a conditional put', async () => {
    const res = await handler(post({ t: TOKEN }));
    assert.equal(res.statusCode, 200);
    assert.equal(res.headers['content-type'], 'application/json');
    assert.deepEqual(bodyOf(res), { ok: true, status: 'unsubscribed' });

    assert.equal(fake.calls.length, 1);
    const { input } = fake.calls[0];
    assert.equal(input.TableName, TABLE);
    assert.equal(input.ConditionExpression, 'attribute_not_exists(emailHash)');
    assert.deepEqual(Object.keys(input.Item).sort(), ['emailHash', 'source', 'unsubscribedAt']);
    assert.equal(input.Item.emailHash.S, HASH);
    assert.equal(input.Item.source.S, 'page');
    assert.ok(!Number.isNaN(Date.parse(input.Item.unsubscribedAt.S)));

    assert.deepEqual(logs, [
      {
        msg: 'email-unsubscribe',
        outcome: 'stored',
        source: 'page',
        reason: null,
        hashTail: HASH.slice(-6),
      },
    ]);
    assert.equal(errors.length, 0);
  });

  it('a repeat is `already` 200 and keeps the first timestamp', async () => {
    await handler(post({ t: TOKEN }));
    const first = fake.rows[HASH].unsubscribedAt;
    const res = await handler(post({ t: TOKEN, body: 'List-Unsubscribe=One-Click' }));
    assert.equal(res.statusCode, 200);
    assert.deepEqual(bodyOf(res), { ok: true, status: 'already' });
    assert.equal(fake.rows[HASH].unsubscribedAt, first);
    assert.equal(fake.rows[HASH].source, 'page');
    assert.equal(logs[1].outcome, 'already');
    assert.equal(errors.length, 0);
  });

  it('detects the RFC 8058 one-click body, plain and base64-encoded', async () => {
    const plain = 'List-Unsubscribe=One-Click';
    const b64 = Buffer.from(plain, 'utf8').toString('base64');
    for (const opts of [{ body: plain }, { body: b64, isBase64Encoded: true }]) {
      fake = fakeDdb();
      __setDdbClientForTests(fake.ddb);
      const res = await handler(post({ t: TOKEN, ...opts }));
      assert.equal(res.statusCode, 200);
      assert.equal(fake.calls[0].input.Item.source.S, 'one-click');
    }
    assert.deepEqual(
      logs.map((l) => l.source),
      ['one-click', 'one-click']
    );
  });

  it('an empty or absent body is the page', async () => {
    for (const body of [undefined, '', Buffer.from('').toString('base64')]) {
      fake = fakeDdb();
      __setDdbClientForTests(fake.ddb);
      await handler(post({ t: TOKEN, body, isBase64Encoded: body !== undefined }));
      assert.equal(fake.calls[0].input.Item.source.S, 'page');
    }
  });

  it('rejects invalid or missing tokens with 400 and no write', async () => {
    const [hash, sig] = TOKEN.split('.');
    const bad = [
      undefined,
      '',
      'garbage',
      `${hash}.${sig[0] === 'A' ? 'B' : 'A'}${sig.slice(1)}`,
      `${emailHash(SECRET, 'someone@else.test')}.${sig}`,
      signUnsubToken('another-secret', EMAIL),
    ];
    for (const t of bad) {
      const res = await handler(post({ t }));
      assert.equal(res.statusCode, 400, `token ${t}`);
      assert.deepEqual(bodyOf(res), { error: 'invalid_token' });
    }
    assert.equal(fake.calls.length, 0);
    assert.ok(logs.every((l) => l.outcome === 'invalid_token' && l.hashTail === null));
    // Why each was refused, so a burst of invalid tokens can be told apart in CloudWatch.
    assert.deepEqual(
      logs.map((l) => l.reason),
      ['missing', 'missing', 'malformed', 'bad_signature', 'bad_signature', 'bad_signature']
    );
  });

  it('reads the token only from the query string, never the body', async () => {
    const res = await handler(post({ body: `t=${TOKEN}` }));
    assert.equal(res.statusCode, 400);
    const encoded = Buffer.from(JSON.stringify({ t: TOKEN })).toString('base64');
    const res2 = await handler(post({ body: encoded, isBase64Encoded: true }));
    assert.equal(res2.statusCode, 400);
    assert.equal(fake.calls.length, 0);
  });

  it('a DynamoDB error is 500 store_failed with the alarmed prefix logged', async () => {
    const boom = Object.assign(new Error('AccessDenied'), { name: 'AccessDeniedException' });
    fake = fakeDdb({ putThrows: boom });
    __setDdbClientForTests(fake.ddb);
    const res = await handler(post({ t: TOKEN }));
    assert.equal(res.statusCode, 500);
    assert.deepEqual(bodyOf(res), { error: 'store_failed' });
    assert.equal(logs[0].outcome, 'store_failed');
    assert.equal(logs[0].reason, 'AccessDeniedException');
    // The full hash is on the line, so the opt-out can be recorded by hand from the log alone.
    assert.equal(logs[0].emailHash, TOKEN.split('.')[0]);
    assert.equal(errors.length, 1);
    assert.ok(errors[0][0].startsWith(ALARMING_PREFIXES.storeFailed));
    assert.ok(errors[0][0].includes(TOKEN.split('.')[0]));
    assert.match(errors[0][0], /dynamodb:PutItem/);
    assert.equal(errors[0][1], boom);
  });

  it('refuses to verify anything without the secret: 500, alarmed, no write', async () => {
    delete process.env.UNSUB_TOKEN_SECRET;
    const res = await handler(post({ t: TOKEN }));
    assert.equal(res.statusCode, 500);
    assert.equal(fake.calls.length, 0);
    assert.equal(errors.length, 1);
    assert.ok(errors[0][0].startsWith(ALARMING_PREFIXES.storeFailed));
  });

  it('never logs the token or an address', async () => {
    await handler(post({ t: TOKEN }));
    const text = JSON.stringify(logs);
    assert.ok(!text.includes(TOKEN) && !text.includes(HASH) && !text.includes(EMAIL));
  });
});

describe('POST /unsubscribe?action=resubscribe', () => {
  it('deletes the opt-out row with a conditional delete', async () => {
    await handler(post({ t: TOKEN }));
    assert.ok(fake.rows[HASH]);
    const res = await handler(resub({ t: TOKEN }));
    assert.equal(res.statusCode, 200);
    assert.deepEqual(bodyOf(res), { ok: true, status: 'resubscribed' });
    assert.equal(fake.rows[HASH], undefined);

    const { input } = fake.calls[1];
    assert.ok(fake.calls[1] instanceof DeleteItemCommand);
    assert.deepEqual(input, {
      TableName: TABLE,
      Key: { emailHash: { S: HASH } },
      ConditionExpression: 'attribute_exists(emailHash)',
    });
    assert.deepEqual(logs[1], {
      msg: 'email-unsubscribe',
      outcome: 'resubscribed',
      source: 'page',
      reason: null,
      hashTail: HASH.slice(-6),
    });
    assert.equal(errors.length, 0);
  });

  it('is `not_unsubscribed` 200 when there is no opt-out row', async () => {
    const res = await handler(resub({ t: TOKEN }));
    assert.equal(res.statusCode, 200);
    assert.deepEqual(bodyOf(res), { ok: true, status: 'not_unsubscribed' });
    assert.equal(logs[0].outcome, 'not_unsubscribed');
    assert.equal(errors.length, 0);
  });

  it('unsubscribe -> re-subscribe -> unsubscribe again stores a fresh row', async () => {
    await handler(post({ t: TOKEN }));
    await handler(resub({ t: TOKEN }));
    const res = await handler(post({ t: TOKEN }));
    assert.deepEqual(bodyOf(res), { ok: true, status: 'unsubscribed' });
    assert.ok(fake.rows[HASH]);
    assert.deepEqual(
      logs.map((l) => l.outcome),
      ['stored', 'resubscribed', 'stored']
    );
  });

  it('a DynamoDB error is 500 resubscribe_failed with its own alarmed prefix', async () => {
    const boom = Object.assign(new Error('AccessDenied'), { name: 'AccessDeniedException' });
    fake = fakeDdb({ rows: { [HASH]: { emailHash: HASH } }, deleteThrows: boom });
    __setDdbClientForTests(fake.ddb);
    const res = await handler(resub({ t: TOKEN }));
    assert.equal(res.statusCode, 500);
    assert.deepEqual(bodyOf(res), { error: 'resubscribe_failed' });
    assert.equal(logs[0].outcome, 'resubscribe_failed');
    assert.equal(logs[0].reason, 'AccessDeniedException');
    // The full hash is on the line, so greg can re-subscribe the owner by hand from the log.
    assert.equal(logs[0].emailHash, HASH);
    assert.equal(errors.length, 1);
    assert.ok(errors[0][0].startsWith(ALARMING_PREFIXES.resubscribeFailed));
    assert.ok(!errors[0][0].startsWith(ALARMING_PREFIXES.storeFailed));
    assert.ok(errors[0][0].includes(HASH));
    assert.ok(errors[0][0].includes(RESUBSCRIBE_REMEDIATION));
    assert.match(errors[0][0], /dynamodb:DeleteItem/);
    assert.equal(errors[0][1], boom);
  });

  it('without the secret: 500 resubscribe_failed, alarmed, no delete', async () => {
    delete process.env.UNSUB_TOKEN_SECRET;
    const res = await handler(resub({ t: TOKEN }));
    assert.equal(res.statusCode, 500);
    assert.deepEqual(bodyOf(res), { error: 'resubscribe_failed' });
    assert.equal(fake.calls.length, 0);
    assert.equal(logs[0].reason, 'secret_unset');
    assert.equal(errors.length, 1);
    assert.ok(errors[0][0].startsWith(ALARMING_PREFIXES.resubscribeFailed));
  });

  it('rejects invalid tokens with 400 and the same reasons, no delete', async () => {
    const res = await handler(resub({}));
    const res2 = await handler(resub({ t: 'garbage' }));
    const res3 = await handler(resub({ t: signUnsubToken('another-secret', EMAIL) }));
    for (const r of [res, res2, res3]) {
      assert.equal(r.statusCode, 400);
      assert.deepEqual(bodyOf(r), { error: 'invalid_token' });
    }
    assert.equal(fake.calls.length, 0);
    assert.deepEqual(
      logs.map((l) => [l.outcome, l.reason]),
      [
        ['invalid_token', 'missing'],
        ['invalid_token', 'malformed'],
        ['invalid_token', 'bad_signature'],
      ]
    );
  });

  it('an unknown action is 400 bad_action with no write, whatever the token', async () => {
    for (const action of ['', 'unsubscribe', 'RESUBSCRIBE', 'delete']) {
      const res = await handler(post({ t: TOKEN, action }));
      assert.equal(res.statusCode, 400, `action ${JSON.stringify(action)}`);
      assert.deepEqual(bodyOf(res), { error: 'bad_action' });
    }
    assert.equal(fake.calls.length, 0);
    assert.ok(logs.every((l) => l.outcome === 'bad_action' && l.hashTail === null));
  });

  it('the action parameter alone decides: a one-click body cannot turn into a re-subscribe', async () => {
    // A mail client's RFC 8058 POST goes to the List-Unsubscribe URL, which never has `action`,
    // so it can only unsubscribe. The body never changes the operation either way.
    const oneClick = 'List-Unsubscribe=One-Click';
    await handler(post({ t: TOKEN, body: oneClick }));
    assert.equal(fake.calls[0].constructor, PutItemCommand);
    await handler(resub({ t: TOKEN, body: oneClick }));
    assert.equal(fake.calls[1].constructor, DeleteItemCommand);
    assert.deepEqual(
      logs.map((l) => [l.outcome, l.source]),
      [
        ['stored', 'one-click'],
        ['resubscribed', 'one-click'],
      ]
    );
  });

  it('never logs the token, the full hash or an address on success', async () => {
    await handler(post({ t: TOKEN }));
    await handler(resub({ t: TOKEN }));
    await handler(resub({ t: TOKEN }));
    const text = JSON.stringify(logs);
    assert.ok(!text.includes(TOKEN) && !text.includes(HASH) && !text.includes(EMAIL));
  });
});

describe('GET /unsubscribe', () => {
  it('302s to the page with the token and stores nothing', async () => {
    const res = await handler(event('GET', { t: TOKEN }));
    assert.equal(res.statusCode, 302);
    assert.equal(res.headers.location, `${PAGE_URL}?t=${encodeURIComponent(TOKEN)}`);
    assert.equal(res.headers.location, `https://beanies.family/unsubscribe?t=${TOKEN}`);
    assert.equal(fake.calls.length, 0);
    assert.deepEqual(logs, [
      { msg: 'email-unsubscribe', outcome: 'redirect', source: null, reason: null, hashTail: null },
    ]);
  });

  it('url-encodes whatever token arrives, and omits a missing one', async () => {
    const res = await handler(event('GET', { t: 'a b&c' }));
    assert.equal(res.headers.location, `${PAGE_URL}?t=a%20b%26c`);
    const res2 = await handler(event('GET'));
    assert.equal(res2.headers.location, PAGE_URL);
    assert.equal(fake.calls.length, 0);
  });
});

describe('other methods', () => {
  it('are 405 with no write', async () => {
    for (const m of ['PUT', 'DELETE', 'HEAD', undefined]) {
      const res = await handler(event(m, { t: TOKEN }));
      assert.equal(res.statusCode, 405);
      assert.equal(res.headers.allow, 'GET, POST');
    }
    assert.equal(fake.calls.length, 0);
  });
});
