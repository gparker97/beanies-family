/* global Buffer */
/**
 * APNs sender (#143 Phase 2): HTTP/2 to Apple with a token-based (ES256 JWT) provider auth.
 * Zero dependencies: `node:http2` and `node:crypto`.
 *
 * ONE HTTP/2 SESSION PER INVOCATION. The session opens on the first send and the webhook handler
 * closes it in its `finally` (`close()`). A module-level session survives a Lambda freeze as a
 * dead socket and surfaces as GOAWAY / ECONNRESET on the first push of the day; a JWT is just
 * bytes, so IT is cached at module level (50 min; Apple accepts up to 60 and refuses refreshes
 * more often than every 20).
 *
 * `dsaEncoding: 'ieee-p1363'` is load-bearing: Node signs ECDSA as DER by default, and APNs
 * rejects a DER signature (Spike 1 (e) confirmed the P1363 form against both hosts).
 *
 * APNs has two environments and this Lambda speaks to one (`APNS_ENV`, `production` in prod).
 * An Xcode debug build holds a SANDBOX token that the production host refuses as
 * `BadDeviceToken`; the outcome carries Apple's `reason` as `code` so the handler logs it as
 * `apns_reason` and a mismatch is readable rather than looking like a vanished registration.
 *
 * NEVER THROWS: every outcome is a return value, `{ ok: true }` or
 * `{ ok: false, invalidToken, status?, code?, error? }`. Never logs: the handler owns log lines,
 * and a device token never reaches one.
 */

import http2 from 'node:http2';
import { createPrivateKey, sign } from 'node:crypto';

export const APNS_HOSTS = Object.freeze({
  production: 'https://api.push.apple.com',
  sandbox: 'https://api.sandbox.push.apple.com',
});
export const APNS_TIMEOUT_MS = 3000;
const JWT_TTL_MS = 50 * 60_000;

/** Apple's reasons that mean "this token will never work again". */
const INVALID_TOKEN_REASONS = new Set(['BadDeviceToken', 'Unregistered', 'ExpiredToken']);

let jwtCache = null; // { key: `${teamId}:${keyId}`, token, at }

/** Test-only: forget the cached JWT. */
export function __resetApnsJwtForTests() {
  jwtCache = null;
}

/** A PEM that arrived with literal `\n` escapes (a single-line env value) → real newlines. */
export function normalisePem(pem) {
  return typeof pem === 'string' ? pem.replace(/\\n/g, '\n').trim() : '';
}

const b64url = (value) => Buffer.from(value).toString('base64url');

/** The provider JWT, cached for 50 minutes per team+key. Throws only on an unusable key. */
export function apnsJwt({ keyP8, keyId, teamId, nowMs }) {
  const cacheKey = `${teamId}:${keyId}`;
  if (jwtCache && jwtCache.key === cacheKey && nowMs - jwtCache.at < JWT_TTL_MS) {
    return jwtCache.token;
  }
  const header = b64url(JSON.stringify({ alg: 'ES256', kid: keyId }));
  const claims = b64url(JSON.stringify({ iss: teamId, iat: Math.floor(nowMs / 1000) }));
  const signingInput = `${header}.${claims}`;
  const signature = sign('sha256', Buffer.from(signingInput), {
    key: createPrivateKey(normalisePem(keyP8)),
    dsaEncoding: 'ieee-p1363',
  }).toString('base64url');
  const token = `${signingInput}.${signature}`;
  jwtCache = { key: cacheKey, token, at: nowMs };
  return token;
}

/**
 * @param {object} cfg
 * @param {string} cfg.keyP8      APNS_KEY_P8 (the .p8 PEM).
 * @param {string} cfg.keyId      APNS_KEY_ID.
 * @param {string} cfg.teamId     APNS_TEAM_ID.
 * @param {string} cfg.bundleId   APNS_BUNDLE_ID (the `apns-topic`).
 * @param {string=} cfg.env       APNS_ENV: 'production' (default) | 'sandbox'.
 * @param {Function=} cfg.connect `http2.connect`, injectable for tests.
 * @param {Function=} cfg.now     Clock (epoch ms).
 * @returns {{ send: Function, close: Function }}
 */
export function createApnsSender({
  keyP8,
  keyId,
  teamId,
  bundleId,
  env = 'production',
  connect = http2.connect,
  now = () => Date.now(),
} = {}) {
  const host = APNS_HOSTS[env] ?? APNS_HOSTS.production;
  const configured = !!(keyP8 && keyId && teamId && bundleId);
  let session = null;

  function getSession() {
    if (session && !session.closed && !session.destroyed) return session;
    session = connect(host);
    // An 'error' with no listener would crash the process; the request below reports it.
    session.on('error', () => {});
    return session;
  }

  function close() {
    const s = session;
    session = null;
    if (s && !s.closed && !s.destroyed) {
      try {
        s.close();
      } catch {
        // Closing an already-broken session cannot fail in a way that matters: it is gone.
        s.destroy?.();
      }
    }
  }

  /**
   * @param {{ token: string, title: string, body: string, data?: object, collapseId?: string,
   *   expiresAt?: number }} msg
   */
  async function send({ token, title, body, data = {}, collapseId, expiresAt }) {
    if (!configured) {
      return { ok: false, invalidToken: false, code: 'apns_unconfigured' };
    }
    let jwt;
    try {
      jwt = apnsJwt({ keyP8, keyId, teamId, nowMs: now() });
    } catch (err) {
      return { ok: false, invalidToken: false, code: 'apns_key_invalid', error: err?.message };
    }

    const payload = JSON.stringify({
      aps: {
        alert: { title, body },
        sound: 'default',
        ...(collapseId ? { 'thread-id': collapseId } : {}),
      },
      ...data,
    });
    const headers = {
      ':method': 'POST',
      ':path': `/3/device/${encodeURIComponent(token)}`,
      authorization: `bearer ${jwt}`,
      'apns-topic': bundleId,
      'apns-push-type': 'alert',
      'apns-priority': '10',
      'content-type': 'application/json',
    };
    if (collapseId) headers['apns-collapse-id'] = collapseId.slice(0, 64);
    if (Number.isFinite(expiresAt)) headers['apns-expiration'] = String(Math.floor(expiresAt));

    return new Promise((resolve) => {
      let req;
      let settled = false;
      const done = (outcome) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(outcome);
      };
      const timer = setTimeout(() => {
        done({ ok: false, invalidToken: false, code: 'timeout' });
        req?.close?.();
      }, APNS_TIMEOUT_MS);

      try {
        req = getSession().request(headers);
      } catch (err) {
        done({ ok: false, invalidToken: false, code: 'network', error: err?.message });
        return;
      }
      let status = 0;
      const chunks = [];
      req.on('response', (h) => {
        status = Number(h[':status']) || 0;
      });
      req.on('data', (c) => chunks.push(Buffer.from(c)));
      req.on('error', (err) => {
        done({ ok: false, invalidToken: false, code: 'network', error: err?.message });
      });
      req.on('end', () => {
        if (status === 200) {
          done({ ok: true });
          return;
        }
        let reason;
        try {
          reason = JSON.parse(Buffer.concat(chunks).toString('utf8'))?.reason;
        } catch {
          // Apple answers every failure with a JSON reason; a body that is not JSON is reported
          // by its status alone.
          reason = undefined;
        }
        done({
          ok: false,
          invalidToken: status === 410 || INVALID_TOKEN_REASONS.has(reason),
          status,
          code: typeof reason === 'string' ? reason : `http_${status}`,
        });
      });
      req.end(payload);
    });
  }

  return { send, close };
}
