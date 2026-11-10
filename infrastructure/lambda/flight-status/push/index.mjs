/**
 * The push senders (#143 Phase 2), behind one interface so no handler branches on the platform.
 *
 * `createSenders(env)` reads the APNs and FCM credentials ONCE (cold start) and returns
 * `{ senderFor(platform), close() }`. Each sender's `send({ token, title, body, data, collapseId,
 * expiresAt })` resolves `{ ok: true } | { ok: false, invalidToken, status?, code?, error? }` and
 * never throws. `close()` ends the per-invocation APNs HTTP/2 session (the webhook calls it in
 * its `finally`; see `apns.mjs` for why the session is never module-level).
 */

import { createApnsSender } from './apns.mjs';
import { createFcmSender } from './fcm.mjs';

export const PLATFORMS = Object.freeze(['ios', 'android']);

/**
 * @param {object} env  The Lambda env (APNS_*, FCM_*).
 * @param {object=} opts  `{ connect, fetchImpl, now }` test seams.
 */
export function createSenders(env, { connect, fetchImpl, now } = {}) {
  const apns = createApnsSender({
    keyP8: env.APNS_KEY_P8,
    keyId: env.APNS_KEY_ID,
    teamId: env.APNS_TEAM_ID,
    bundleId: env.APNS_BUNDLE_ID,
    env: env.APNS_ENV === 'sandbox' ? 'sandbox' : 'production',
    ...(connect ? { connect } : {}),
    ...(now ? { now } : {}),
  });
  const fcm = createFcmSender({
    projectId: env.FCM_PROJECT_ID,
    clientEmail: env.FCM_CLIENT_EMAIL,
    privateKey: env.FCM_PRIVATE_KEY,
    ...(fetchImpl ? { fetchImpl } : {}),
    ...(now ? { now } : {}),
  });
  const byPlatform = { ios: apns, android: fcm };
  return {
    /** The sender for a stored platform; null for anything else (never stored: subscribe validates). */
    senderFor(platform) {
      return byPlatform[platform] ?? null;
    },
    close() {
      apns.close();
      fcm.close();
    },
  };
}
