/**
 * The shared App Store Connect client for the release preflights.
 *
 * Extracted when the second preflight arrived (`assert-no-pending-submission.mjs`). Both
 * checks need the same three things — an ES256 JWT, the app's bundle id, and the numeric
 * app id behind it — and a second hand-rolled copy of the JWT builder is the kind of
 * duplication that rots silently: one copy gets the 20-minute expiry cap right and the
 * other does not, and the symptom is an unexplained 401 in a release log.
 *
 * Auth is built with `node:crypto` alone, so there is no dependency to keep in sync with
 * the runner's toolchain.
 */

import fs from 'node:fs';
import { createSign } from 'node:crypto';

export const ASC_HOST = 'https://api.appstoreconnect.apple.com';

/** base64url without padding, as JWT requires. */
function b64url(input) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * Build the ES256 JWT App Store Connect expects.
 *
 * Exported for the unit test: the signature cannot be asserted without the private key, but
 * the header/payload SHAPE can be, and getting `aud`, `alg` or the expiry wrong is the usual
 * way this silently 401s.
 *
 * @param {{ keyId: string, issuerId: string, privateKey: string, now?: number }} args
 */
export function buildToken({ keyId, issuerId, privateKey, now = Math.floor(Date.now() / 1000) }) {
  const header = { alg: 'ES256', kid: keyId, typ: 'JWT' };
  // 20 minutes is Apple's maximum; anything longer is rejected outright.
  const payload = { iss: issuerId, iat: now, exp: now + 20 * 60, aud: 'appstoreconnect-v1' };
  const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const signer = createSign('SHA256');
  signer.update(signingInput);
  const der = signer.sign({ key: privateKey, dsaEncoding: 'ieee-p1363' });
  return `${signingInput}.${der.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}`;
}

/**
 * The app's bundle id, read from the ONE place it is already declared.
 *
 * Hardcoding it here would be a second copy that silently rots: if `capacitor.config.ts`
 * ever changes, a stale literal makes the apps lookup return no app, which fails OPEN and
 * quietly protects nothing. `IOS_BUNDLE_ID` overrides for a test or a second app.
 */
export function readBundleId(configSource) {
  const match = /appId:\s*['"]([^'"]+)['"]/.exec(configSource);
  if (!match) throw new Error('could not find appId in capacitor.config.ts');
  return match[1];
}

/**
 * The App Store Connect credentials from the environment, or `null` when they are not set.
 *
 * Returning `null` rather than throwing keeps the "no credentials" case distinct from the
 * "Apple is broken" case: a caller skips politely on `null`, and fails open on a throw.
 */
export function ascCredentials(env = process.env) {
  const keyId = env.APP_STORE_CONNECT_API_KEY_ID?.trim();
  const issuerId = env.APP_STORE_CONNECT_API_ISSUER_ID?.trim();
  const keyPath = env.ASC_API_KEY_P8_PATH?.trim();
  if (!keyId || !issuerId || !keyPath) return null;
  return { keyId, issuerId, keyPath };
}

/** A signed token from the credentials + the key file on disk. Throws if the key is unreadable. */
export function tokenFromCredentials({ keyId, issuerId, keyPath }) {
  return buildToken({ keyId, issuerId, privateKey: fs.readFileSync(keyPath, 'utf8') });
}

/** GET an App Store Connect path, throwing on any non-2xx so callers take their fault path. */
export async function ascGet(path, token, fetchImpl = fetch) {
  const res = await fetchImpl(`${ASC_HOST}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`${path} returned HTTP ${res.status}`);
  return res.json();
}

/**
 * The numeric app id for a bundle id. Both preflights start here, because every other
 * App Store Connect resource hangs off it.
 */
export async function resolveAppId({ bundleId, token, fetchImpl = fetch }) {
  const apps = await ascGet(
    `/v1/apps?filter[bundleId]=${encodeURIComponent(bundleId)}`,
    token,
    fetchImpl
  );
  const appId = apps?.data?.[0]?.id;
  if (!appId) throw new Error(`no app on App Store Connect for bundle id ${bundleId}`);
  return appId;
}

/** The bundle id for this repo's app, honouring the `IOS_BUNDLE_ID` override. */
export function resolveBundleId(env = process.env) {
  return (
    env.IOS_BUNDLE_ID?.trim() ||
    readBundleId(fs.readFileSync(new URL('../../capacitor.config.ts', import.meta.url), 'utf8'))
  );
}
