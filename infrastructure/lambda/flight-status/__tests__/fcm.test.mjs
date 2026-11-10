/* global Buffer */
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, verify } from 'node:crypto';

import {
  ANDROID_CHANNEL_ID,
  FCM_SCOPE,
  GOOGLE_TOKEN_URL,
  __resetFcmTokenForTests,
  createFcmSender,
  serviceAccountJwt,
} from '../push/fcm.mjs';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const PEM = privateKey.export({ type: 'pkcs8', format: 'pem' });
const NOW = Date.parse('2026-12-12T12:00:00Z');
const TOKEN = 'fcm:' + 'y'.repeat(150);

/** A fake fetch: token exchange answers an access token; sends answer `send(body)`. */
function fakeFetch(
  send = () => ({ status: 200, body: { name: 'projects/p/messages/1' } }),
  token = () => ({ status: 200, body: { access_token: 'at-1', expires_in: 3600 } })
) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, init });
    const r = url === GOOGLE_TOKEN_URL ? token(init) : send(JSON.parse(init.body));
    if (r.throw) throw Object.assign(new Error(r.throw), { name: r.throw });
    return new Response(JSON.stringify(r.body ?? {}), { status: r.status });
  };
  return { impl, calls };
}

const cfg = (fetchImpl, over = {}) => ({
  projectId: 'beanies-test',
  clientEmail: 'svc@beanies-test.iam.gserviceaccount.com',
  privateKey: PEM,
  fetchImpl,
  now: () => NOW,
  ...over,
});
const msg = {
  token: TOKEN,
  title: 'beanies.family',
  body: 'SQ318 now leaves at 8:30am.',
  data: { kind: 'travel-change', flight: 'SQ318', date: '2026-12-13' },
  collapseId: 'SQ318#2026-12-13',
  expiresAt: NOW / 1000 + 3600,
};

beforeEach(() => __resetFcmTokenForTests());

describe('FCM sender', () => {
  test('2xx: one OAuth exchange, then messages:send on reminders_v2 with the collapse key', async () => {
    const f = fakeFetch();
    const sender = createFcmSender(cfg(f.impl));
    assert.deepEqual(await sender.send(msg), { ok: true });
    assert.equal(f.calls[0].url, GOOGLE_TOKEN_URL);
    assert.equal(
      f.calls[1].url,
      'https://fcm.googleapis.com/v1/projects/beanies-test/messages:send'
    );
    assert.equal(f.calls[1].init.headers.authorization, 'Bearer at-1');
    const { message } = JSON.parse(f.calls[1].init.body);
    assert.deepEqual(message, {
      token: TOKEN,
      notification: { title: msg.title, body: msg.body },
      data: msg.data,
      android: {
        priority: 'HIGH',
        collapse_key: 'SQ318#2026-12-13',
        ttl: '3600s',
        notification: { channel_id: ANDROID_CHANNEL_ID, tag: 'SQ318#2026-12-13' },
      },
    });
    assert.equal(ANDROID_CHANNEL_ID, 'reminders_v2');
  });

  test('the access token is cached until shortly before expiry; a 401 drops it', async () => {
    let sendStatus = 200;
    const f = fakeFetch(() => ({ status: sendStatus, body: {} }));
    const sender = createFcmSender(cfg(f.impl));
    await sender.send(msg);
    await sender.send(msg);
    assert.equal(f.calls.filter((c) => c.url === GOOGLE_TOKEN_URL).length, 1);
    sendStatus = 401;
    await sender.send(msg);
    sendStatus = 200;
    await sender.send(msg);
    assert.equal(f.calls.filter((c) => c.url === GOOGLE_TOKEN_URL).length, 2);
  });

  test('UNREGISTERED and an INVALID_ARGUMENT on the token are invalid tokens', async () => {
    const unreg = fakeFetch(() => ({
      status: 404,
      body: {
        error: {
          status: 'NOT_FOUND',
          details: [
            {
              '@type': 'type.googleapis.com/google.firebase.fcm.v1.FcmError',
              errorCode: 'UNREGISTERED',
            },
          ],
        },
      },
    }));
    assert.deepEqual(await createFcmSender(cfg(unreg.impl)).send(msg), {
      ok: false,
      invalidToken: true,
      status: 404,
      code: 'UNREGISTERED',
    });
    __resetFcmTokenForTests();
    const badToken = fakeFetch(() => ({
      status: 400,
      body: {
        error: {
          status: 'INVALID_ARGUMENT',
          message: 'The registration token is not a valid FCM registration token',
        },
      },
    }));
    const r = await createFcmSender(cfg(badToken.impl)).send(msg);
    assert.deepEqual([r.invalidToken, r.code], [true, 'INVALID_ARGUMENT']);
  });

  test('an INVALID_ARGUMENT about the payload, a 500, a network error: not invalid tokens, never thrown', async () => {
    const payload = fakeFetch(() => ({
      status: 400,
      body: {
        error: {
          status: 'INVALID_ARGUMENT',
          message: 'Invalid value at message.android.ttl',
          details: [{ fieldViolations: [{ field: 'message.android.ttl' }] }],
        },
      },
    }));
    const r1 = await createFcmSender(cfg(payload.impl)).send(msg);
    assert.deepEqual([r1.ok, r1.invalidToken], [false, false]);
    __resetFcmTokenForTests();
    const r2 = await createFcmSender(
      cfg(fakeFetch(() => ({ status: 500, body: { error: { status: 'INTERNAL' } } })).impl)
    ).send(msg);
    assert.deepEqual([r2.invalidToken, r2.code, r2.status], [false, 'INTERNAL', 500]);
    __resetFcmTokenForTests();
    const r3 = await createFcmSender(cfg(fakeFetch(() => ({ throw: 'TypeError' })).impl)).send(msg);
    assert.deepEqual([r3.invalidToken, r3.code], [false, 'network']);
  });

  test('an OAuth failure and an unconfigured sender are return values', async () => {
    const f = fakeFetch(undefined, () => ({ status: 400, body: { error: 'invalid_grant' } }));
    const r = await createFcmSender(cfg(f.impl)).send(msg);
    assert.deepEqual([r.ok, r.invalidToken, r.code], [false, false, 'oauth_400']);
    assert.equal(
      (await createFcmSender(cfg(f.impl, { projectId: '' })).send(msg)).code,
      'fcm_unconfigured'
    );
    assert.equal(
      (await createFcmSender(cfg(f.impl, { privateKey: 'nope' })).send(msg)).code,
      'fcm_key_invalid'
    );
  });

  test('the service-account assertion is RS256 over the firebase.messaging scope', () => {
    const jwt = serviceAccountJwt({
      clientEmail: 'svc@x',
      privateKey: PEM.replace(/\n/g, '\\n'),
      nowMs: NOW,
    });
    const [h, c, s] = jwt.split('.');
    assert.deepEqual(JSON.parse(Buffer.from(h, 'base64url')), { alg: 'RS256', typ: 'JWT' });
    const claims = JSON.parse(Buffer.from(c, 'base64url'));
    assert.deepEqual(claims, {
      iss: 'svc@x',
      scope: FCM_SCOPE,
      aud: GOOGLE_TOKEN_URL,
      iat: NOW / 1000,
      exp: NOW / 1000 + 3600,
    });
    assert.ok(
      verify('RSA-SHA256', Buffer.from(`${h}.${c}`), publicKey, Buffer.from(s, 'base64url'))
    );
  });
});
