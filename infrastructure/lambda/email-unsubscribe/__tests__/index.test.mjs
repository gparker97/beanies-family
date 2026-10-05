/* global process, Buffer */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { handler, __setDdbClientForTests, ALARMING_PREFIXES, PAGE_URL } from '../index.mjs';
import { signUnsubToken, emailHash } from '../token.mjs';

const SECRET = 'test-secret-do-not-use';
const TABLE = 'optout-table';
const EMAIL = 'owner@example.com';
const TOKEN = signUnsubToken(SECRET, EMAIL);
const HASH = emailHash(SECRET, EMAIL);

const originalLog = console.log;
const originalError = console.error;

// ── A tiny DynamoDB double: one table keyed by emailHash, conditional PutItem honoured ───────
class PutItemCommand {
  constructor(input) {
    this.input = input;
  }
}
function fakeDdb({ rows = {}, putThrows = null } = {}) {
  const calls = [];
  return {
    calls,
    rows,
    ddb: {
      commands: { PutItemCommand },
      async send(cmd) {
        calls.push(cmd);
        if (putThrows) throw putThrows;
        const key = cmd.input.Item.emailHash.S;
        if (cmd.input.ConditionExpression === 'attribute_not_exists(emailHash)' && rows[key]) {
          const e = new Error('The conditional request failed');
          e.name = 'ConditionalCheckFailedException';
          throw e;
        }
        rows[key] = Object.fromEntries(Object.entries(cmd.input.Item).map(([k, v]) => [k, v.S]));
        return {};
      },
    },
  };
}

const event = (method, { t, body, isBase64Encoded = false } = {}) => ({
  requestContext: { http: { method } },
  queryStringParameters: t === undefined ? undefined : { t },
  body,
  isBase64Encoded,
});
const post = (opts) => event('POST', opts);

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
    assert.deepEqual(bodyOf(res), { ok: true });

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
    assert.deepEqual(bodyOf(res), { ok: true });
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
