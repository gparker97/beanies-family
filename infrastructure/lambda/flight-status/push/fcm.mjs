/* global Buffer */
/**
 * FCM sender (#143 Phase 2): Firebase Cloud Messaging HTTP v1 with a service-account OAuth token.
 * Zero dependencies: `node:crypto` for the RS256 assertion, global `fetch` for both calls.
 *
 * The Lambda receives two fields of the service-account JSON, `FCM_CLIENT_EMAIL` and
 * `FCM_PRIVATE_KEY` (the PEM), not the whole JSON: Lambda environment variables total 4 KB and
 * the JSON alone is ~2.3 KB. The OAuth access token is cached at module level until a minute
 * before it expires (it is bytes, it survives a freeze); a 401 from the send drops it.
 *
 * Android notices ride the app's existing `reminders_v2` channel (`useLocalNotifications.ts`), and
 * `collapse_key` / `tag` make a later revision replace an undelivered earlier one.
 *
 * NEVER THROWS: `{ ok: true }` or `{ ok: false, invalidToken, status?, code?, error? }`. Never
 * logs: the handler owns log lines, and a device token never reaches one.
 */

import { createPrivateKey, sign } from 'node:crypto';
import { normalisePem } from './apns.mjs';

export const FCM_TIMEOUT_MS = 3000;
export const FCM_SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';
export const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
export const ANDROID_CHANNEL_ID = 'reminders_v2';
const TOKEN_REFRESH_MARGIN_MS = 60_000;

let accessCache = null; // { key: clientEmail, token, expiresAtMs }

/** Test-only: forget the cached OAuth token. */
export function __resetFcmTokenForTests() {
  accessCache = null;
}

const b64url = (value) => Buffer.from(value).toString('base64url');

/** The signed service-account assertion for the OAuth token exchange. */
export function serviceAccountJwt({ clientEmail, privateKey, nowMs }) {
  const iat = Math.floor(nowMs / 1000);
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = b64url(
    JSON.stringify({
      iss: clientEmail,
      scope: FCM_SCOPE,
      aud: GOOGLE_TOKEN_URL,
      iat,
      exp: iat + 3600,
    })
  );
  const signingInput = `${header}.${claims}`;
  const signature = sign(
    'RSA-SHA256',
    Buffer.from(signingInput),
    createPrivateKey(normalisePem(privateKey))
  );
  return `${signingInput}.${signature.toString('base64url')}`;
}

/** Read a JSON body without throwing; null when it is not JSON. */
async function jsonOrNull(res) {
  try {
    return await res.json();
  } catch {
    // FCM and Google OAuth answer JSON; anything else is reported by its status alone.
    return null;
  }
}

/** FCM's specific error code (`details[].errorCode`, e.g. UNREGISTERED), else the status name. */
function fcmCode(body) {
  const details = Array.isArray(body?.error?.details) ? body.error.details : [];
  const specific = details.find((d) => typeof d?.errorCode === 'string')?.errorCode;
  return specific ?? (typeof body?.error?.status === 'string' ? body.error.status : undefined);
}

/** An INVALID_ARGUMENT that names the token (not the payload) means the token is bad. */
function tokenViolation(body) {
  const details = Array.isArray(body?.error?.details) ? body.error.details : [];
  const namesToken = details.some((d) =>
    (Array.isArray(d?.fieldViolations) ? d.fieldViolations : []).some((v) =>
      String(v?.field ?? '').includes('token')
    )
  );
  return namesToken || /registration token/i.test(String(body?.error?.message ?? ''));
}

/**
 * @param {object} cfg
 * @param {string} cfg.projectId    FCM_PROJECT_ID.
 * @param {string} cfg.clientEmail  FCM_CLIENT_EMAIL.
 * @param {string} cfg.privateKey   FCM_PRIVATE_KEY (PEM; literal `\n` escapes tolerated).
 * @param {Function=} cfg.fetchImpl Defaults to global fetch.
 * @param {Function=} cfg.now       Clock (epoch ms).
 * @returns {{ send: Function, close: Function }}
 */
export function createFcmSender({
  projectId,
  clientEmail,
  privateKey,
  fetchImpl = globalThis.fetch,
  now = () => Date.now(),
} = {}) {
  const configured = !!(projectId && clientEmail && privateKey);

  async function accessToken() {
    const nowMs = now();
    if (accessCache && accessCache.key === clientEmail && nowMs < accessCache.expiresAtMs) {
      return { ok: true, token: accessCache.token };
    }
    let assertion;
    try {
      assertion = serviceAccountJwt({ clientEmail, privateKey, nowMs });
    } catch (err) {
      return { ok: false, code: 'fcm_key_invalid', error: err?.message };
    }
    let res;
    try {
      res = await fetchImpl(GOOGLE_TOKEN_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
          assertion,
        }).toString(),
        signal: AbortSignal.timeout(FCM_TIMEOUT_MS),
      });
    } catch (err) {
      return {
        ok: false,
        code: err?.name === 'TimeoutError' ? 'timeout' : 'network',
        error: err?.message,
      };
    }
    const body = await jsonOrNull(res);
    if (!res.ok || typeof body?.access_token !== 'string') {
      return { ok: false, status: res.status, code: `oauth_${res.status}` };
    }
    const ttlMs = (Number(body.expires_in) || 3600) * 1000;
    accessCache = {
      key: clientEmail,
      token: body.access_token,
      expiresAtMs: nowMs + ttlMs - TOKEN_REFRESH_MARGIN_MS,
    };
    return { ok: true, token: body.access_token };
  }

  /**
   * @param {{ token: string, title: string, body: string, data?: object, collapseId?: string,
   *   expiresAt?: number }} msg
   */
  async function send({ token, title, body, data = {}, collapseId, expiresAt }) {
    if (!configured) return { ok: false, invalidToken: false, code: 'fcm_unconfigured' };
    const auth = await accessToken();
    if (!auth.ok) {
      return {
        ok: false,
        invalidToken: false,
        status: auth.status,
        code: auth.code,
        error: auth.error,
      };
    }

    const ttlS = Number.isFinite(expiresAt)
      ? Math.max(0, Math.floor(expiresAt - now() / 1000))
      : undefined;
    const message = {
      token,
      notification: { title, body },
      // FCM data values must be strings.
      data: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, String(v)])),
      android: {
        priority: 'HIGH',
        ...(collapseId ? { collapse_key: collapseId } : {}),
        ...(ttlS !== undefined ? { ttl: `${ttlS}s` } : {}),
        notification: {
          channel_id: ANDROID_CHANNEL_ID,
          ...(collapseId ? { tag: collapseId } : {}),
        },
      },
    };

    let res;
    try {
      res = await fetchImpl(
        `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/messages:send`,
        {
          method: 'POST',
          headers: {
            authorization: `Bearer ${auth.token}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({ message }),
          signal: AbortSignal.timeout(FCM_TIMEOUT_MS),
        }
      );
    } catch (err) {
      return {
        ok: false,
        invalidToken: false,
        code: err?.name === 'TimeoutError' ? 'timeout' : 'network',
        error: err?.message,
      };
    }
    if (res.ok) {
      await jsonOrNull(res);
      return { ok: true };
    }
    const errBody = await jsonOrNull(res);
    if (res.status === 401) accessCache = null;
    const code = fcmCode(errBody) ?? `http_${res.status}`;
    const invalidToken =
      code === 'UNREGISTERED' || (code === 'INVALID_ARGUMENT' && tokenViolation(errBody));
    return { ok: false, invalidToken, status: res.status, code };
  }

  return { send, close: () => {} };
}
