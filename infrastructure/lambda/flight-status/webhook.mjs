/* global process */
/**
 * `POST /flight-status/webhook/{secret}`: the provider's flight-alert callback (#143 Phase 2,
 * requirements 18 and 19).
 *
 * THE PATH SECRET IS THE AUTHENTICATION. The provider signs nothing (Spike 1 (b)), so every
 * subscription is created with the callback url `<base>/flight-status/webhook/<secret>` and the
 * path parameter is compared here in constant time. `rawPath` is never logged (the `route` field
 * is the `{secret}` TEMPLATE, `event.routeKey`), and neither is a header, a push token or a url.
 *
 * A straight sequence: path secret → parse → ONE Query of the number's partition → replay guard →
 * no provider item (a stray or forged event: a log line at most) → no live device → one pure
 * `planPushes` → for each planned push CLAIM the revision (`markSent`, conditional on the old
 * value) and send only what was claimed → record the event id LAST → top up the credits.
 *
 * WHY CLAIM BEFORE SEND: a duplicate or concurrent delivery (the provider retries once; two first
 * deliveries can race) must never notify twice, and `markSent` arbitrates. The claim is kept even
 * when the send then fails: there is no retry path for a failed send, by design (the failure is in
 * the log; the change is in the app on the next open). WHY THE EVENT ID LAST: a store fault
 * answered 500 must not leave a replay guard that swallows the provider's retry.
 *
 * Inside the provider's 10 s window: one Query, a concurrent fan-out with 3 s sender timeouts and
 * a 3 s refill call that runs only below the credit floor. No provider call otherwise (the payload
 * carries the legs) and no counter or cancel work: an invalid push token only deletes its device;
 * the sweep cancels a number nobody watches.
 */

import {
  corsHeaders,
  errorResponse,
  errorText,
  jsonResponse,
  logLine,
  parseOrigins,
  readJsonBody,
  safeEqual,
} from './http.mjs';
import { createAlertsStore } from './alertsStore.mjs';
import { planPushes } from './schedule.mjs';
import { PUSH_TITLE, pushBody } from './copy.mjs';
import { createCredits } from './credits.mjs';

// ⚠️ Matched verbatim by metric filters in the ops repo's modules/flight-status/main.tf.
export const WEBHOOK_REJECTED_PREFIX = '[flight-alerts] webhook rejected';
export const PUSH_SEND_FAILED_PREFIX = '[flight-alerts] push send FAILED';

export const MAX_WEBHOOK_BYTES = 65_536;

/**
 * @param {object} deps  `{ provider, env, ddb, now, senders }` (the common factory shape).
 */
export function createWebhook({
  provider,
  env = process.env,
  ddb,
  now = () => Date.now(),
  senders,
}) {
  const SECRET = env.AERODATABOX_WEBHOOK_SECRET || '';
  const ALLOWED_ORIGINS = parseOrigins(env.CORS_ORIGINS);
  const store = createAlertsStore({ table: env.ALERTS_TABLE, ddb });
  const ensureCredits = createCredits({ provider, env, ddb, now });

  return async function webhook(event) {
    const headers = corsHeaders(event, ALLOWED_ORIGINS);
    const log = {
      route: event?.routeKey ?? null,
      event_id: null,
      flight: null,
      attempt: null,
      outcome: 'rejected',
      reason: null,
      status: 0,
      devices: 0,
      expired: 0,
      sent: 0,
      claim_lost: 0,
      skipped_same_rev: 0,
      skipped_no_leg: 0,
      invalid_tokens: 0,
      apns_reason: null,
      send_failed: 0,
      credits_remaining: null,
      refilled: false,
    };
    const answer = (status, outcome, reason = null) => {
      logLine('flight-alerts-webhook', { ...log, outcome, reason, status });
      return jsonResponse(status, { ok: true, outcome, ...(reason ? { reason } : {}) }, headers);
    };
    const storeError = () => {
      logLine('flight-alerts-webhook', { ...log, outcome: 'store_error', status: 500 });
      return { ...errorResponse('alerts_unavailable', headers), statusCode: 500 };
    };
    /**
     * A provider delivery carries the balance; top up below the floor whatever the outcome. A
     * delivery WITHOUT a balance (`null`: a hand-made or stray payload, never the provider's) is
     * not evidence of an empty balance, so it refills nothing: only the sweep's own
     * `GET /subscriptions/balance` may read `null` as zero (the first-refill seed). Found live on
     * 2026-11-09: two probe payloads spent the day's two refills.
     */
    const topUp = async (credits) => {
      if (credits === null) {
        log.credits_remaining = null;
        log.refilled = false;
        return;
      }
      const c = await ensureCredits(credits, 'webhook');
      log.credits_remaining = c.creditsRemaining;
      log.refilled = c.refilled;
    };

    try {
      // 1. The path secret. An unset secret refuses everything rather than accepting any path.
      if (!SECRET || !safeEqual(event?.pathParameters?.secret, SECRET)) {
        console.error(
          `${WEBHOOK_REJECTED_PREFIX} secret_set=${SECRET !== ''}: a call to the flight-alert webhook ` +
            'carried the wrong path secret. A burst right after rotating var.aerodatabox_webhook_secret is ' +
            'expected until the next sweep re-subscribes under the new url (invoke cleanup by hand to heal ' +
            'now); otherwise someone is probing the route.'
        );
        logLine('flight-alerts-webhook', { ...log, outcome: 'rejected', status: 401 });
        return errorResponse('webhook_rejected', headers);
      }

      // 2. Parse. Anything we cannot act on is a 200 (a non-2xx only buys a paid retry).
      const read = readJsonBody(event, MAX_WEBHOOK_BYTES);
      const n = read.ok ? provider?.parseWebhook?.(read.body) : null;
      if (!n) return answer(200, 'ignored', 'unparseable');
      log.event_id = n.eventId;
      log.flight = n.flight;
      log.attempt = n.attempt;

      // 3. ONE Query: provider item, live devices, replay guards.
      const nowMs = now();
      const nowS = Math.floor(nowMs / 1000);
      const pk = n.flight;
      const loaded = await store.loadFlight(pk, nowS);
      if (!loaded.ok) return storeError();
      log.devices = loaded.devices.length;
      log.expired = loaded.expired;

      if (loaded.eventIds.has(n.eventId)) {
        await topUp(n.creditsRemaining);
        return answer(200, 'replay');
      }
      if (!loaded.provider) {
        await topUp(n.creditsRemaining);
        return answer(200, 'ignored', 'unknown_flight');
      }
      if (loaded.devices.length === 0) {
        await topUp(n.creditsRemaining);
        return answer(200, 'ignored', 'no_devices');
      }

      // 4. Plan: one push per device per revision it does not know.
      const plan = planPushes(n.legs, loaded.devices, pk);
      log.skipped_same_rev = plan.skipped_same_rev;
      log.skipped_no_leg = plan.skipped_no_leg;

      // 5. Claim, then send what was claimed.
      let storeFault = false;
      const claimed = [];
      for (const entry of plan.pushes) {
        const mark = await store.markSent(pk, entry.device.sk, entry.device.sent_rev, entry.rev);
        if (!mark.ok) storeFault = true;
        else if (!mark.claimed) log.claim_lost += 1;
        else claimed.push(entry);
      }

      try {
        const outcomes = await Promise.allSettled(
          claimed.map(async ({ device, change }) => {
            const sender = senders?.senderFor?.(device.platform);
            if (!sender) {
              return { ok: false, invalidToken: false, code: 'no_sender' };
            }
            return sender.send({
              token: device.push_token,
              title: PUSH_TITLE,
              body: pushBody(device.lang, change),
              data: { kind: 'travel-change', flight: pk, date: device.date },
              collapseId: `${pk}#${device.date}`,
              expiresAt: device.expires_at,
            });
          })
        );
        for (let i = 0; i < outcomes.length; i += 1) {
          const { device } = claimed[i];
          const settled = outcomes[i];
          const result =
            settled.status === 'fulfilled'
              ? settled.value
              : { ok: false, invalidToken: false, code: 'threw', error: errorText(settled.reason) };
          if (result?.ok) {
            log.sent += 1;
            continue;
          }
          if (device.platform === 'ios' && result?.code) log.apns_reason = result.code;
          if (result?.invalidToken) {
            log.invalid_tokens += 1;
            // Info: the platform says this address is dead. The sweep cancels the number when no
            // device is left. A failed delete was logged with the alarmed store prefix.
            await store.deleteDevice(pk, device.sk);
            continue;
          }
          log.send_failed += 1;
          console.error(
            `${PUSH_SEND_FAILED_PREFIX} platform=${device.platform} flight=${pk} date=${device.date} ` +
              `status=${result?.status ?? '-'} code=${result?.code ?? '-'}\n` +
              'A planned push was not delivered and is not retried (the change still shows when the app opens). ' +
              'Repeated failures on one platform mean its credentials (APNS_* / FCM_*) or the platform itself.'
          );
        }
      } finally {
        senders?.close?.();
      }

      if (storeFault) return storeError();

      // 6. The replay guard, only now.
      const recorded = await store.recordEvent(pk, n.eventId, nowS);
      if (!recorded.ok) return storeError();

      await topUp(n.creditsRemaining);
      if (plan.pushes.length > 0) return answer(200, 'sent');
      // `no_leg`: no device's flight is in this payload at all (typically another day's instance
      // of the number); `no_change`: at least one device's flight is here and moved nothing. With
      // no push planned every device was skipped one way or the other, so "none same-rev" IS
      // "all no-leg".
      const noLeg = plan.skipped_same_rev === 0;
      return answer(200, 'ignored', noLeg ? 'no_leg' : 'no_change');
    } catch (err) {
      // Nothing above is meant to throw (the store and the senders return outcomes); if something
      // does, answer a clean 500 so the provider's one retry gets another chance.
      console.error(`[flight-alerts] unhandled webhook error: ${errorText(err)}`);
      logLine('flight-alerts-webhook', { ...log, outcome: 'internal_error', status: 500 });
      return errorResponse('internal_error', headers);
    }
  };
}
