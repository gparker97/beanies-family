/* global process */
/**
 * `POST /flight-status/subscribe` and `POST /flight-status/unsubscribe` (#143 Phase 2,
 * requirements 15-17 and 23).
 *
 * A device that watches a flight registers an ANONYMOUS subscription: flight number, date, the
 * provider's own leg codes it matched (`dep`, `arr`), the revision its plan holds (`rev`, which
 * seeds `sent_rev` so a revision it knows is never pushed to it), platform, language and an opaque
 * push token. No family id, member, trip or name ever arrives here. Subscribe additionally needs
 * the identity-free alert token minted by the registry (`alertToken.mjs`); unsubscribe does not
 * (a lapsed family must still be able to leave; knowing the push token is the proof).
 *
 * The provider side is per flight NUMBER (`alertsStore.mjs` header). Subscribe puts the device
 * item, then makes sure the number has a provider subscription: an existing id → `ready`; else
 * one conditional CLAIM decides who creates it (the loser answers `pending`), the winner spends
 * one token of the GLOBAL daily provider-call cap, subscribes, and fills the id. THE REQUEST PATH
 * NEVER CANCELS A PROVIDER SUBSCRIPTION AND NEVER COUNTS DEVICES: the sweep (`cleanup.mjs`) owns
 * every cancel, every orphan and every dead claim.
 *
 * Each handler is a straight sequence; a refusal returns through `fail(code)` where it is known.
 * Store faults before the device item is written FAIL CLOSED as `alerts_unavailable` (503): the
 * device retries on its next run. After the item is written the answer depends on whether a
 * provider subscription for the number EXISTS:
 *   - `ready` (200): `p` holds an id, or this request created and filled it;
 *   - `pending` (200): ONLY when one exists or is being made, so the device may record the
 *     registration: the claim was lost (another request is filling `p` right now), or the provider
 *     call SUCCEEDED and only `fillProvider` failed (the sweep adopts that subscription). The
 *     device row stays;
 *   - any failure that means NO subscription exists or can be confirmed (budget exhausted, an
 *     upstream error, an unset webhook / internal error, a store fault on get/claim/fill) DELETES
 *     the device row again (best effort) and answers the ORIGINAL error (503 `budget_exhausted`,
 *     502-504 upstream, 503 `alerts_unavailable`, 500 `internal_error`). The device then records
 *     nothing and keeps the Phase 1 local notice: a recorded registration with no subscription
 *     would mute that notice (`pushCovered`) and leave a real change with no notice at all.
 * The log line's `provider` is `ready` | `pending` | `failed` (row deleted, error answered), with
 * `provider_code` naming why (`created` / `claim_stale` on a ready that made the subscription,
 * `claim_lost` / `fill_failed` on pending, the error code on failed).
 */

import {
  DEFAULT_DAILY_PROVIDER_CAP,
  DEFAULT_IP_LIMIT,
  STATUS_FOR_CODE,
  UPSTREAM_CODES,
  checkDate,
  corsHeaders,
  errorResponse,
  errorText,
  isRealDate,
  jsonResponse,
  logLine,
  normaliseFlight,
  parseOrigins,
  positiveInt,
  readJsonBody,
  softKeyOk,
} from './http.mjs';
import { BUDGET_EXHAUSTED_PREFIX, takeToken } from './store.mjs';
import {
  STORE_UNAVAILABLE_PREFIX,
  createAlertsStore,
  deviceSk,
  expiresAtFor,
  flightPk,
} from './alertsStore.mjs';
import { verifyAlertToken } from './alertToken.mjs';
import { PLATFORMS } from './push/index.mjs';

// ⚠️ Matched verbatim by a metric filter in the ops repo's modules/flight-status/main.tf.
export const PROVIDER_SUBSCRIBE_FAILED_PREFIX = '[flight-alerts] provider subscribe FAILED';
/** Info (a burst is visible as a rate), not alarmed. */
export const ALERT_TOKEN_REJECTED_PREFIX = '[flight-alerts] alert token rejected';

/** An FCM token runs ~160 chars beside the ~60-char alert token. */
export const MAX_SUBSCRIBE_BYTES = 2048;
export const DEFAULT_MAX_DEVICES_PER_FLIGHT = 12;

const IATA_RE = /^[A-Z]{3}$/;
/** APNs device tokens are hex (64 today; Apple reserves the right to lengthen them). */
const APNS_TOKEN_RE = /^[0-9a-fA-F]{64,200}$/;
/** FCM registration tokens: base64url-ish with `:` (about 160 chars). */
const FCM_TOKEN_RE = /^[A-Za-z0-9_:.-]{32,512}$/;
const MAX_REV = 128;
const LANGS = new Set(['en', 'zh']);

/** The callback URL the provider calls: `<base>/flight-status/webhook/<secret>`. NEVER logged. */
export function webhookUrl(baseUrl, secret) {
  return `${String(baseUrl).replace(/\/+$/, '')}/flight-status/webhook/${secret}`;
}

/** A push token as the platform issues it, else null. */
function pushTokenFor(platform, raw) {
  if (typeof raw !== 'string') return null;
  if (platform === 'ios') return APNS_TOKEN_RE.test(raw) ? raw : null;
  return FCM_TOKEN_RE.test(raw) ? raw : null;
}

/** Any token shape we could have stored (unsubscribe carries no platform). */
function anyPushToken(raw) {
  return typeof raw === 'string' && (APNS_TOKEN_RE.test(raw) || FCM_TOKEN_RE.test(raw))
    ? raw
    : null;
}

/**
 * Make sure the number has a provider subscription. Shared by subscribe and the sweep (which
 * imports it) so the claim → day token → subscribe → fill sequence is written once.
 *
 * @returns {Promise<{ provider: 'created' | 'claim_stale' | 'claim_lost' | 'fill_failed' | 'failed',
 *   code?: string }>}
 *   `created` / `claim_stale`: this call subscribed and filled `p` (`claim_stale` replaced a dead
 *   claim). `claim_lost`: another request holds a live claim and is filling. `fill_failed`: the
 *   provider subscription EXISTS but `p` was not filled (the sweep adopts it). `failed` (with the
 *   error `code`): no subscription exists or none could be confirmed.
 */
export async function ensureProviderSubscription({
  store,
  provider,
  pk,
  nowMs,
  callbackUrl,
  dayCap,
  cacheTable,
  ddb,
  source,
}) {
  const nowS = Math.floor(nowMs / 1000);
  const claim = await store.claimProvider(pk, nowS);
  if (!claim.ok) return { provider: 'failed', code: 'alerts_unavailable' };
  if (!claim.won) return { provider: 'claim_lost' };

  // A failed release was logged with the alarmed store prefix; the claim then goes stale in 60 s.
  const giveBack = async (code) => {
    await store.releaseClaim(pk);
    return { provider: 'failed', code };
  };

  if (!callbackUrl) {
    console.error(
      `${PROVIDER_SUBSCRIBE_FAILED_PREFIX} source=${source} flight=${pk} reason=webhook_unset\n` +
        'AERODATABOX_WEBHOOK_SECRET or WEBHOOK_BASE_URL is unset on the Lambda, so no flight can be subscribed. Set TF_VAR_aerodatabox_webhook_secret and apply module.flight_status.'
    );
    return giveBack('alerts_unavailable');
  }
  if (!provider || typeof provider.subscribeAlert !== 'function') {
    console.error(
      `${PROVIDER_SUBSCRIBE_FAILED_PREFIX} source=${source} flight=${pk} reason=no_alerts_client`
    );
    return giveBack('internal_error');
  }

  const dayToken = await takeToken({
    kind: 'day',
    now: nowMs,
    ddb,
    limit: dayCap,
    table: cacheTable,
  });
  if (!dayToken.allowed) {
    console.error(
      `${BUDGET_EXHAUSTED_PREFIX} cap=${dayCap} source=${source}: refusing a flight-alert provider ` +
        'subscription until UTC midnight; the device keeps on-open checks. Read the per-request lines before raising var.daily_provider_call_cap.'
    );
    return giveBack('budget_exhausted');
  }

  let id;
  try {
    ({ id } = await provider.subscribeAlert(pk, callbackUrl));
  } catch (err) {
    const code = UPSTREAM_CODES.has(err?.code) ? err.code : 'internal_error';
    console.error(
      `${PROVIDER_SUBSCRIBE_FAILED_PREFIX} source=${source} flight=${pk} code=${code} ` +
        `http_status=${Number.isFinite(err?.httpStatus) ? err.httpStatus : '-'}` +
        (code === 'internal_error' ? ` error=${errorText(err)}` : '') +
        '\nThe number has no provider subscription, so no closed-app alert can reach it. The claim is released; the next subscribe or the next sweep retries. Check the provider key and plan.'
    );
    return giveBack(code);
  }

  const fill = await store.fillProvider(pk, id, nowS);
  // A failed fill after a successful subscribe was logged with the alarmed store prefix; the
  // subscription exists and the sweep adopts it (it matches the provider's list on our own url).
  if (!fill.ok) return { provider: 'fill_failed' };
  return { provider: claim.stale ? 'claim_stale' : 'created' };
}

/**
 * @param {object} deps  `{ provider, env, ddb, now, senders }` (the common factory shape;
 *                       `provider` is the bound alerts client, `senders` unused here).
 */
export function createAlerts({ provider, env = process.env, ddb, now = () => Date.now() }) {
  const API_KEY = env.FLIGHT_STATUS_API_KEY;
  const TOKEN_SECRET = env.FLIGHT_ALERT_TOKEN_SECRET || '';
  const CACHE_TABLE = env.CACHE_TABLE || '';
  const IP_LIMIT = positiveInt(env.IP_LIMIT, DEFAULT_IP_LIMIT, 'IP_LIMIT');
  const DAY_CAP = positiveInt(
    env.DAILY_PROVIDER_CAP,
    DEFAULT_DAILY_PROVIDER_CAP,
    'DAILY_PROVIDER_CAP'
  );
  const MAX_DEVICES = positiveInt(
    env.MAX_DEVICES_PER_FLIGHT,
    DEFAULT_MAX_DEVICES_PER_FLIGHT,
    'MAX_DEVICES_PER_FLIGHT'
  );
  const CALLBACK_URL =
    env.WEBHOOK_BASE_URL && env.AERODATABOX_WEBHOOK_SECRET
      ? webhookUrl(env.WEBHOOK_BASE_URL, env.AERODATABOX_WEBHOOK_SECRET)
      : '';
  const ALLOWED_ORIGINS = parseOrigins(env.CORS_ORIGINS);
  const store = createAlertsStore({ table: env.ALERTS_TABLE, ddb });

  /** The common line + `fail`, per request. */
  function begin(event, route) {
    const headers = corsHeaders(event, ALLOWED_ORIGINS);
    const log = {
      route,
      flight: null,
      date: null,
      platform: null,
      lang: null,
      outcome: 'bad_request',
      status: 0,
      provider: null,
      provider_code: null,
    };
    const fail = (code, outcome = 'bad_request', extra = {}) => {
      logLine('flight-alerts', { ...log, outcome, status: STATUS_FOR_CODE[code].status, code });
      return errorResponse(code, headers, extra);
    };
    const ok = (body) => {
      logLine('flight-alerts', { ...log, outcome: 'ok', status: 200 });
      return jsonResponse(200, { ok: true, ...body }, headers);
    };
    return { headers, log, fail, ok };
  }

  async function ipAllowed(event, nowMs) {
    return takeToken({
      kind: 'ip',
      ip: event?.requestContext?.http?.sourceIp,
      now: nowMs,
      ddb,
      limit: IP_LIMIT,
      table: CACHE_TABLE,
    });
  }

  async function subscribe(event) {
    const { log, fail, ok } = begin(event, event?.routeKey ?? 'POST /flight-status/subscribe');
    try {
      if (!softKeyOk(event, API_KEY)) return fail('unauthorized');
      const read = readJsonBody(event, MAX_SUBSCRIBE_BYTES);
      if (!read.ok) return fail(read.code);
      const b = read.body;
      const nowMs = now();
      const nowS = Math.floor(nowMs / 1000);

      // The entitlement proof first: nothing is learnt about a request that fails it.
      if (!TOKEN_SECRET) {
        console.error(
          `${ALERT_TOKEN_REJECTED_PREFIX} reason=secret_unset: FLIGHT_ALERT_TOKEN_SECRET is unset on the Lambda, so every subscribe is refused. Set TF_VAR_flight_alert_token_secret and apply.`
        );
        return fail('alert_token_rejected', 'rejected');
      }
      const verdict = verifyAlertToken(TOKEN_SECRET, b.alert, nowS);
      if (!verdict.ok) {
        logLine(ALERT_TOKEN_REJECTED_PREFIX, { route: log.route, reason: verdict.reason });
        return fail('alert_token_rejected', 'rejected');
      }

      const flight = normaliseFlight(b.flight);
      if (!flight) return fail('bad_flight');
      log.flight = flight;
      const dateCode = checkDate(b.date, nowMs);
      if (dateCode) return fail(dateCode);
      const date = b.date;
      log.date = date;
      if (!PLATFORMS.includes(b.platform)) return fail('bad_platform');
      const platform = b.platform;
      log.platform = platform;
      const lang = LANGS.has(b.lang) ? b.lang : 'en';
      log.lang = lang;
      const pushToken = pushTokenFor(platform, b.token);
      if (!pushToken) return fail('bad_token');
      const dep = typeof b.dep === 'string' ? b.dep.toUpperCase() : '';
      const arr = b.arr === undefined || b.arr === null ? '' : String(b.arr).toUpperCase();
      if (!IATA_RE.test(dep) || (arr !== '' && !IATA_RE.test(arr))) return fail('bad_codes');
      if (typeof b.rev !== 'string' || b.rev.length === 0 || b.rev.length > MAX_REV) {
        return fail('bad_request');
      }

      const ipToken = await ipAllowed(event, nowMs);
      if (!ipToken.allowed) {
        return fail('rate_limited', 'rate_limited', {
          retryAfterSeconds: ipToken.retryAfterSeconds,
        });
      }

      const pk = flightPk(flight);
      const sk = deviceSk(date, pushToken);

      // The per flight+date device cap: a SOFT cap (a COUNT, not a counter). A device already
      // registered may always re-register (a new rev or language).
      const counted = await store.countDevices(pk, date, nowS);
      if (!counted.ok) return fail('alerts_unavailable', 'store_error');
      if (counted.count >= MAX_DEVICES) {
        const known = await store.hasDevice(pk, sk);
        if (!known.ok) return fail('alerts_unavailable', 'store_error');
        if (!known.exists) return fail('subscription_full', 'subscription_full');
      }

      const put = await store.putDevice(pk, sk, {
        push_token: pushToken,
        platform,
        lang,
        dep,
        arr: arr || undefined,
        sent_rev: b.rev,
        created_at: nowS,
        expires_at: expiresAtFor(date),
      });
      if (!put.ok) return fail('alerts_unavailable', 'store_error');

      // FROM HERE THE DEVICE ITEM IS WRITTEN. A 200 tells the device "the server will push you",
      // and the device then mutes its Phase 1 local notice for this flight (`pushCovered`). So a
      // 200 is only honest while a provider subscription exists or is being made; on any failure
      // that means none does, the item is taken back and the original error answered (header).
      const ready = (code = null) => {
        log.provider = 'ready';
        log.provider_code = code;
        return ok({ provider: 'ready' });
      };
      const pending = (code) => {
        log.provider = 'pending';
        log.provider_code = code;
        return ok({ provider: 'pending' });
      };
      const withdraw = async (code) => {
        log.provider = 'failed';
        log.provider_code = code;
        // Best effort. The store already logged the fault; this line adds why it matters: the
        // row stays and is pushed unrecorded (a double notice at worst) until its TTL.
        const removed = await store.deleteDevice(pk, sk);
        if (!removed.ok) {
          console.error(
            `${STORE_UNAVAILABLE_PREFIX} op=withdraw_device flight=${flight} code=${code}\n` +
              'A subscribe failed after its device item was written and the item could not be taken back, so the device may get a push AND its own notice for this flight.'
          );
        }
        return fail(code, 'provider_failed');
      };

      const current = await store.getProvider(pk);
      if (!current.ok) return withdraw('alerts_unavailable');
      if (current.provider?.providerId) return ready();

      const ensured = await ensureProviderSubscription({
        store,
        provider,
        pk,
        nowMs,
        callbackUrl: CALLBACK_URL,
        dayCap: DAY_CAP,
        cacheTable: CACHE_TABLE,
        ddb,
        source: 'subscribe',
      });
      if (ensured.provider === 'failed') return withdraw(ensured.code);
      // Another request is filling `p` right now, or the subscription exists and the sweep adopts it.
      if (ensured.provider === 'claim_lost' || ensured.provider === 'fill_failed') {
        return pending(ensured.provider);
      }
      return ready(ensured.provider);
    } catch (err) {
      console.error(`[flight-alerts] unhandled subscribe error: ${errorText(err)}`);
      return fail('internal_error', 'internal_error');
    }
  }

  async function unsubscribe(event) {
    const { log, fail, ok } = begin(event, event?.routeKey ?? 'POST /flight-status/unsubscribe');
    try {
      if (!softKeyOk(event, API_KEY)) return fail('unauthorized');
      const read = readJsonBody(event, MAX_SUBSCRIBE_BYTES);
      if (!read.ok) return fail(read.code);
      const b = read.body;
      const nowMs = now();

      const flight = normaliseFlight(b.flight);
      if (!flight) return fail('bad_flight');
      log.flight = flight;
      // No range check: leaving must work for any date the device may hold, past ones included.
      if (!isRealDate(b.date)) return fail('bad_date');
      log.date = b.date;
      const pushToken = anyPushToken(b.token);
      if (!pushToken) return fail('bad_token');

      const ipToken = await ipAllowed(event, nowMs);
      if (!ipToken.allowed) {
        return fail('rate_limited', 'rate_limited', {
          retryAfterSeconds: ipToken.retryAfterSeconds,
        });
      }

      const removed = await store.deleteDevice(flightPk(flight), deviceSk(b.date, pushToken));
      if (!removed.ok) return fail('alerts_unavailable', 'store_error');
      log.provider = 'deleted';
      return ok({});
    } catch (err) {
      console.error(`[flight-alerts] unhandled unsubscribe error: ${errorText(err)}`);
      return fail('internal_error', 'internal_error');
    }
  }

  return { subscribe, unsubscribe };
}
