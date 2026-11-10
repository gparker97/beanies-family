/* global process */
/**
 * The sweep (#143 Phase 2, requirement 16): the ONE two-way reconcile between the alerts table and
 * the provider's own subscription list, and the ONLY code that ever cancels a provider
 * subscription.
 *
 * Invoked by the EventBridge schedule (`rate(6 hours)`) with the constant input
 * `{ task: 'cleanup' }`, which `createHandler.mjs` dispatches before any `routeKey`; by hand with
 * `aws lambda invoke --payload '{"task":"cleanup"}'` after a secret rotation.
 *
 * WHY IT EXISTS: a provider subscription never expires and bills every daily instance of its
 * number (Spike 1 (a)), so an orphan is an open tap. The request path only ever adds; this sweep
 * makes the provider match the table, so a subscription outlives its last device, a leaked one
 * survives, and a dead claim blocks a number for at most one interval (6 h).
 *
 * THE MATCH IS ON THE CALLBACK URL. The provider's list is global to the API key, so each listed
 * subscription is OURS (its url is exactly this Lambda's callback url), STALE (our base url with
 * another secret: a rotated `AERODATABOX_WEBHOOK_SECRET`; cancelled, so a rotation heals in one
 * sweep) or FOREIGN (anything else: the spike's, or hand-made; counted, never touched). A url
 * carries the webhook secret and is NEVER logged; the heartbeat carries counts only.
 *
 * Per number: live devices + an own subscription → adopt its id into `p` when `p` lacks it or
 * holds another (extra own duplicates are cancelled); live devices + none → claim and subscribe as
 * the request path does (same day token); no live devices → delete `p`, then cancel every own
 * subscription of the number. A failed cancel is alarmed and retried by the next sweep.
 *
 * The heartbeat `[flight-alerts] cleanup ran { ... }` is the LAST act, so a sweep that threw or
 * aborted half-way is a MISSING heartbeat (the module's one silence alarm), never a false one.
 */

import { DEFAULT_DAILY_PROVIDER_CAP, errorText, positiveInt } from './http.mjs';
import { createAlertsStore, PROVIDER_SK } from './alertsStore.mjs';
import { ensureProviderSubscription, webhookUrl } from './alerts.mjs';
import { createCredits } from './credits.mjs';

/** ⚠️ The ops heartbeat metric filter's pattern; pinned by the ops alarm-prefixes test. */
export const CLEANUP_HEARTBEAT_PREFIX = '[flight-alerts] cleanup ran';
// ⚠️ Matched verbatim by a metric filter in the ops repo's modules/flight-status/main.tf.
export const PROVIDER_CANCEL_FAILED_PREFIX = '[flight-alerts] provider cancel FAILED';
/** Not alarmed by prefix: an aborted sweep writes no heartbeat, and THAT alarms. */
export const CLEANUP_ABORTED_PREFIX = '[flight-alerts] cleanup aborted';

/**
 * @param {object} deps  `{ provider, env, ddb, now, senders }` (the common factory shape).
 */
export function createCleanup({ provider, env = process.env, ddb, now = () => Date.now() }) {
  const BASE = env.WEBHOOK_BASE_URL ? webhookUrl(env.WEBHOOK_BASE_URL, '') : '';
  const OWN_URL =
    BASE && env.AERODATABOX_WEBHOOK_SECRET
      ? webhookUrl(env.WEBHOOK_BASE_URL, env.AERODATABOX_WEBHOOK_SECRET)
      : '';
  const CACHE_TABLE = env.CACHE_TABLE || '';
  const DAY_CAP = positiveInt(
    env.DAILY_PROVIDER_CAP,
    DEFAULT_DAILY_PROVIDER_CAP,
    'DAILY_PROVIDER_CAP'
  );
  const store = createAlertsStore({ table: env.ALERTS_TABLE, ddb });
  const ensureCredits = createCredits({ provider, env, ddb, now });

  const abort = (reason, detail = '') => {
    console.error(
      `${CLEANUP_ABORTED_PREFIX} reason=${reason}${detail ? ` ${detail}` : ''}: no reconcile ran and no ` +
        'heartbeat is written; the heartbeat alarm fires after a day of this.'
    );
    return { ok: false, reason };
  };

  return async function cleanup() {
    const nowMs = now();
    const nowS = Math.floor(nowMs / 1000);
    if (!OWN_URL)
      return abort('webhook_unset', 'WEBHOOK_BASE_URL or AERODATABOX_WEBHOOK_SECRET is unset');
    if (!provider || typeof provider.listAlerts !== 'function') return abort('no_alerts_client');

    const scan = await store.scanAll();
    if (!scan.ok) return abort('store');

    let listed;
    try {
      listed = await provider.listAlerts();
    } catch (err) {
      return abort(
        'provider_list',
        `code=${err?.code ?? err?.name ?? 'error'} http_status=${Number.isFinite(err?.httpStatus) ? err.httpStatus : '-'}`
      );
    }

    const counts = {
      numbers: 0,
      listed: listed.length,
      own: 0,
      stale: 0,
      foreign: 0,
      adopted: 0,
      subscribed: 0,
      cancelled: 0,
      cancel_failed: 0,
      credits_remaining: null,
      refilled: false,
    };

    // The provider's list, by url. `flight` is null for a non-number subject: never ours.
    const ownBy = new Map();
    const stale = [];
    for (const s of listed) {
      if (s.url === OWN_URL && s.flight) {
        counts.own += 1;
        if (!ownBy.has(s.flight)) ownBy.set(s.flight, []);
        ownBy.get(s.flight).push(s);
      } else if (typeof s.url === 'string' && s.url.startsWith(BASE)) {
        counts.stale += 1;
        stale.push(s);
      } else {
        counts.foreign += 1;
      }
    }

    // The table, by number (the global `r#` refill partition is not a number).
    const table = new Map();
    for (const row of scan.items) {
      if (!row.pk || row.pk.startsWith('r#')) continue;
      if (!table.has(row.pk)) table.set(row.pk, { provider: null, live: 0 });
      const entry = table.get(row.pk);
      if (row.sk === PROVIDER_SK) entry.provider = row;
      else if (row.sk?.startsWith('d#') && (row.expiresAt ?? 0) > nowS) entry.live += 1;
    }

    async function cancel(sub) {
      try {
        await provider.cancelAlert(sub.id);
        counts.cancelled += 1;
      } catch (err) {
        counts.cancel_failed += 1;
        console.error(
          `${PROVIDER_CANCEL_FAILED_PREFIX} flight=${sub.flight ?? '-'} code=${err?.code ?? err?.name ?? 'error'} ` +
            `http_status=${Number.isFinite(err?.httpStatus) ? err.httpStatus : '-'}\n` +
            'A provider subscription nobody needs is still billing every instance of its number. The next sweep retries; if this repeats, cancel it by hand (GET then DELETE /subscriptions/webhook).'
        );
      }
    }

    async function reconcile(number) {
      const entry = table.get(number) ?? { provider: null, live: 0 };
      const own = ownBy.get(number) ?? [];
      const heldId = entry.provider?.providerId ?? null;

      if (entry.live === 0) {
        if (!entry.provider && own.length === 0) return;
        // The Scan is seconds old by now (the list call, the stale cancels), and a subscribe that
        // landed since may have put a device, claimed, subscribed and filled `p` (answered `ready`
        // for it). Re-read the partition (strongly consistent) right before any delete or cancel
        // and leave a number with a live device alone: the next sweep sees it whole. The read
        // narrows the race to milliseconds; what remains is healed by the next sweep (live
        // devices, no subscription → subscribe).
        const fresh = await store.loadFlight(number, nowS);
        if (!fresh.ok || fresh.devices.length > 0) return;
        // An own orphan with no `p` in the Scan: a `p` now present is a subscribe that arrived
        // since (its device may already be gone again); leave it to the next sweep rather than
        // cancel an id that `p` may name.
        if (!entry.provider && fresh.provider) return;
        if (entry.provider) {
          const removed = await store.deleteProvider(number);
          // Never cancel while `p` still names the subscription: a subscribe would answer
          // `ready` for a cancelled id. The next sweep retries both steps.
          if (!removed.ok) return;
        }
        for (const s of own) await cancel(s);
        return;
      }

      if (own.length > 0) {
        const keep = own.find((s) => s.id === heldId) ?? own[0];
        if (heldId !== keep.id) {
          const filled = await store.fillProvider(number, keep.id, nowS);
          if (filled.ok) counts.adopted += 1;
        }
        for (const s of own) if (s !== keep) await cancel(s);
        return;
      }

      // Live devices and no subscription of ours on the provider's list.
      if (heldId) {
        // `p` names an id the provider no longer lists (cancelled by hand, or a stale-secret one
        // cancelled above): forget it so the claim below can win.
        const removed = await store.deleteProvider(number);
        if (!removed.ok) return;
      }
      const ensured = await ensureProviderSubscription({
        store,
        provider,
        pk: number,
        nowMs,
        callbackUrl: OWN_URL,
        dayCap: DAY_CAP,
        cacheTable: CACHE_TABLE,
        ddb,
        source: 'cleanup',
      });
      if (ensured.provider === 'created' || ensured.provider === 'claim_stale')
        counts.subscribed += 1;
    }

    try {
      for (const s of stale) await cancel(s);
      const numbers = new Set([...table.keys(), ...ownBy.keys()]);
      counts.numbers = numbers.size;
      const settled = await Promise.allSettled([...numbers].map((n) => reconcile(n)));
      const threw = settled.find((r) => r.status === 'rejected');
      if (threw) return abort('reconcile_threw', errorText(threw.reason));
    } catch (err) {
      return abort('reconcile_threw', errorText(err));
    }

    // The balance: free to read, and a quiet spell must not end with a paused balance.
    let balance = null;
    try {
      balance = await provider.getBalance();
    } catch (err) {
      // Treated as unknown (null → refilled under the daily cap, which bounds it). Logged so a
      // balance endpoint that keeps failing is visible beside the heartbeat.
      console.error(
        `[flight-alerts] cleanup balance read failed code=${err?.code ?? err?.name ?? 'error'} ` +
          `http_status=${Number.isFinite(err?.httpStatus) ? err.httpStatus : '-'}`
      );
    }
    const credits = await ensureCredits(balance, 'cleanup');
    counts.credits_remaining = credits.creditsRemaining;
    counts.refilled = credits.refilled;

    // LAST: the heartbeat.
    // eslint-disable-next-line no-console -- the heartbeat metric filter reads this line
    console.log(`${CLEANUP_HEARTBEAT_PREFIX} ${JSON.stringify({ route: 'cleanup', ...counts })}`);
    return { ok: true, ...counts };
  };
}
