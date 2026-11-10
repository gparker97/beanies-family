/* global Buffer, setImmediate */
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { generateKeyPairSync, verify } from 'node:crypto';

import { APNS_HOSTS, __resetApnsJwtForTests, apnsJwt, createApnsSender } from '../push/apns.mjs';
import { createSenders } from '../push/index.mjs';

const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
const P8 = privateKey.export({ type: 'pkcs8', format: 'pem' });
const NOW = Date.parse('2026-12-12T12:00:00Z');
const TOKEN = 'ab'.repeat(32);

/** A fake `http2.connect`: `respond(headers, payload)` → `{ status, body }` | `{ error }` | 'hang'. */
function fakeHttp2(respond = () => ({ status: 200, body: '' })) {
  const sessions = [];
  const requests = [];
  const connect = (host) => {
    const session = new EventEmitter();
    session.host = host;
    session.closed = false;
    session.destroyed = false;
    session.close = () => {
      session.closed = true;
    };
    session.request = (headers) => {
      const stream = new EventEmitter();
      stream.close = () => {};
      stream.end = (payload) => {
        requests.push({ host, headers, payload: JSON.parse(payload) });
        const r = respond(headers, payload);
        if (r === 'hang') return;
        setImmediate(() => {
          if (r.error) {
            stream.emit('error', new Error(r.error));
            return;
          }
          stream.emit('response', { ':status': r.status });
          if (r.body) stream.emit('data', Buffer.from(r.body));
          stream.emit('end');
        });
      };
      return stream;
    };
    sessions.push(session);
    return session;
  };
  return { connect, sessions, requests };
}

const cfg = (over = {}) => ({
  keyP8: P8,
  keyId: 'KEY123',
  teamId: 'TEAM456',
  bundleId: 'family.beanies.app',
  now: () => NOW,
  ...over,
});
const msg = {
  token: TOKEN,
  title: 'beanies.family',
  body: 'SQ318 now leaves at 8:30am.',
  data: { kind: 'travel-change', flight: 'SQ318', date: '2026-12-13' },
  collapseId: 'SQ318#2026-12-13',
  expiresAt: 1797465600,
};

beforeEach(() => __resetApnsJwtForTests());

describe('APNs sender', () => {
  test('2xx: the request carries the topic, push type, collapse id, expiration and the alert', async () => {
    const h2 = fakeHttp2();
    const sender = createApnsSender({ ...cfg(), connect: h2.connect });
    assert.deepEqual(await sender.send(msg), { ok: true });
    const [{ host, headers, payload }] = h2.requests;
    assert.equal(host, APNS_HOSTS.production);
    assert.equal(headers[':path'], `/3/device/${TOKEN}`);
    assert.equal(headers['apns-topic'], 'family.beanies.app');
    assert.equal(headers['apns-push-type'], 'alert');
    assert.equal(headers['apns-collapse-id'], 'SQ318#2026-12-13');
    assert.equal(headers['apns-expiration'], '1797465600');
    assert.match(headers.authorization, /^bearer [\w-]+\.[\w-]+\.[\w-]+$/);
    assert.deepEqual(payload, {
      aps: {
        alert: { title: msg.title, body: msg.body },
        sound: 'default',
        'thread-id': 'SQ318#2026-12-13',
      },
      kind: 'travel-change',
      flight: 'SQ318',
      date: '2026-12-13',
    });
    assert.ok(!('content-available' in payload.aps), 'never a silent push');
  });

  test('ONE session per invocation: reused across sends, closed by close(), reopened after', async () => {
    const h2 = fakeHttp2();
    const sender = createApnsSender({ ...cfg(), connect: h2.connect });
    await sender.send(msg);
    await sender.send(msg);
    assert.equal(h2.sessions.length, 1);
    sender.close();
    assert.equal(h2.sessions[0].closed, true);
    await sender.send(msg);
    assert.equal(h2.sessions.length, 2);
  });

  test('sandbox env picks the sandbox host', async () => {
    const h2 = fakeHttp2();
    await createApnsSender({ ...cfg(), env: 'sandbox', connect: h2.connect }).send(msg);
    assert.equal(h2.requests[0].host, APNS_HOSTS.sandbox);
  });

  test('410 and 400 BadDeviceToken are invalid tokens with the reason as code', async () => {
    const gone = fakeHttp2(() => ({ status: 410, body: '{"reason":"Unregistered"}' }));
    assert.deepEqual(await createApnsSender({ ...cfg(), connect: gone.connect }).send(msg), {
      ok: false,
      invalidToken: true,
      status: 410,
      code: 'Unregistered',
    });
    const bad = fakeHttp2(() => ({ status: 400, body: '{"reason":"BadDeviceToken"}' }));
    assert.deepEqual(await createApnsSender({ ...cfg(), connect: bad.connect }).send(msg), {
      ok: false,
      invalidToken: true,
      status: 400,
      code: 'BadDeviceToken',
    });
  });

  test('other failures are not invalid tokens; a network error and a timeout never throw', async () => {
    const topic = fakeHttp2(() => ({ status: 400, body: '{"reason":"DeviceTokenNotForTopic"}' }));
    const r1 = await createApnsSender({ ...cfg(), connect: topic.connect }).send(msg);
    assert.deepEqual([r1.ok, r1.invalidToken, r1.code], [false, false, 'DeviceTokenNotForTopic']);
    const net = fakeHttp2(() => ({ error: 'ECONNRESET' }));
    const r2 = await createApnsSender({ ...cfg(), connect: net.connect }).send(msg);
    assert.deepEqual([r2.ok, r2.invalidToken, r2.code], [false, false, 'network']);
    const throwing = () => {
      throw new Error('connect refused');
    };
    const r3 = await createApnsSender({ ...cfg(), connect: throwing }).send(msg);
    assert.equal(r3.code, 'network');
  });

  test('unconfigured or an unusable key: a return value, never a throw', async () => {
    assert.equal(
      (await createApnsSender({ ...cfg(), keyId: '' }).send(msg)).code,
      'apns_unconfigured'
    );
    assert.equal(
      (
        await createApnsSender({ ...cfg(), keyP8: 'not a pem', connect: fakeHttp2().connect }).send(
          msg
        )
      ).code,
      'apns_key_invalid'
    );
  });

  test('the JWT is ES256 in IEEE-P1363 form (64-byte signature), cached for 50 minutes', () => {
    const jwt = apnsJwt({ keyP8: P8, keyId: 'KEY123', teamId: 'TEAM456', nowMs: NOW });
    const [h, c, s] = jwt.split('.');
    assert.deepEqual(JSON.parse(Buffer.from(h, 'base64url')), { alg: 'ES256', kid: 'KEY123' });
    assert.deepEqual(JSON.parse(Buffer.from(c, 'base64url')), { iss: 'TEAM456', iat: NOW / 1000 });
    const sig = Buffer.from(s, 'base64url');
    assert.equal(sig.length, 64);
    assert.ok(
      verify('sha256', Buffer.from(`${h}.${c}`), { key: publicKey, dsaEncoding: 'ieee-p1363' }, sig)
    );
    assert.equal(
      apnsJwt({ keyP8: P8, keyId: 'KEY123', teamId: 'TEAM456', nowMs: NOW + 49 * 60_000 }),
      jwt
    );
    assert.notEqual(
      apnsJwt({ keyP8: P8, keyId: 'KEY123', teamId: 'TEAM456', nowMs: NOW + 51 * 60_000 }),
      jwt
    );
  });

  test('a PEM with literal \\n escapes (a single-line env value) works', async () => {
    const h2 = fakeHttp2();
    const oneLine = P8.replace(/\n/g, '\\n');
    assert.deepEqual(
      await createApnsSender({ ...cfg(), keyP8: oneLine, connect: h2.connect }).send(msg),
      { ok: true }
    );
  });
});

describe('createSenders', () => {
  test('senderFor maps ios/android and nothing else; close() ends the APNs session', async () => {
    const h2 = fakeHttp2();
    const senders = createSenders(
      {
        APNS_KEY_P8: P8,
        APNS_KEY_ID: 'K',
        APNS_TEAM_ID: 'T',
        APNS_BUNDLE_ID: 'b',
        APNS_ENV: 'production',
      },
      { connect: h2.connect, now: () => NOW }
    );
    assert.ok(senders.senderFor('ios'));
    assert.ok(senders.senderFor('android'));
    assert.equal(senders.senderFor('web'), null);
    await senders.senderFor('ios').send(msg);
    senders.close();
    assert.equal(h2.sessions[0].closed, true);
    assert.equal((await senders.senderFor('android').send(msg)).code, 'fcm_unconfigured');
  });
});
