/* global process */
/**
 * #beanies-leavers lines from the registry Lambda (2026-10-23): a family that deleted itself
 * (`family_deleted`, the DELETE arm tombstoned a row that had a pod) and a family that left a
 * device but kept its file (`family_left_device`, `DELETE ?keepFile=1`). Negative events that are
 * not errors; the channel routing rule lives in `~/projects/beanies-ops/docs/runbooks/slack-channels.md`.
 *
 * ⚠️ TWIN of `../billing/slack.mjs` for `SLACK_TIMEOUT_MS`, `PLAN_LABELS`, `slackEscape`,
 * `familyIdentity` and `postToSlack`, copied VERBATIM. They cannot be imported: every Lambda here
 * is its own zip (see owner.mjs `realEmail`). `slackTwinDrift.test.mjs` pins the two copies to
 * identical behaviour; change them together.
 *
 * Privacy matches billing's lines: the family name or, without one, the owner's email DOMAIN only,
 * plus the last 8 characters of the family id. Never a full email, never the full family id. Log
 * lines carry the family id's sha256 only.
 *
 * `formatLeaverMessage` is pure. `notifyLeaverSlack` never throws, holds the ONE dev-table gate
 * (every e2e teardown DELETEs against the dev table, and a localhost deletion is not a leaver),
 * and reads `SLACK_LEAVERS_WEBHOOK_URL` at CALL time (billing's `env()` pattern) so one test
 * process can toggle it.
 */
import { createHash } from 'node:crypto';

// ── Twin of ../billing/slack.mjs (verbatim; slackTwinDrift.test.mjs) ─────────

/** A Slack post is a side channel; Stripe's webhook must not wait long for it. */
export const SLACK_TIMEOUT_MS = 3_000;

export const PLAN_LABELS = { basic: 'beanies basic', full: 'magic beans' };

/** Slack mrkdwn control characters (the telemetry Lambda's escape). */
export function slackEscape(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** `The Parkers · id …55555555`, or `owner @gmail.com · id …55555555` with no family name. */
export function familyIdentity({ familyId, familyName, ownerEmail } = {}) {
  const domain =
    typeof ownerEmail === 'string' && ownerEmail.includes('@') ? ownerEmail.split('@')[1] : null;
  const who = familyName
    ? slackEscape(familyName)
    : domain
      ? `owner @${slackEscape(domain)}`
      : 'unnamed family';
  return typeof familyId === 'string' && familyId
    ? `${who} · id …${slackEscape(familyId.slice(-8))}`
    : who;
}

/**
 * POST `{ text }` to a Slack incoming webhook. Never throws. Awaited by the caller (a Lambda can
 * be frozen the moment the handler returns, dropping an in-flight socket), bounded by
 * `SLACK_TIMEOUT_MS`.
 *
 * @returns {Promise<{ ok: true } | { ok: false, reason: 'no_url'|'http_error'|'timeout'|'network', httpStatus?: number }>}
 */
export async function postToSlack(url, text, { fetchImpl } = {}) {
  if (!url) return { ok: false, reason: 'no_url' };
  const doFetch = fetchImpl ?? globalThis.fetch;
  try {
    const res = await doFetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
      signal: AbortSignal.timeout(SLACK_TIMEOUT_MS),
    });
    return res.ok ? { ok: true } : { ok: false, reason: 'http_error', httpStatus: res.status };
  } catch (err) {
    return {
      ok: false,
      reason: err?.name === 'TimeoutError' || err?.name === 'AbortError' ? 'timeout' : 'network',
    };
  }
}

// ── Registry-only: the leavers lines ─────────────────────────────────────────

/** The two leaver events and their headlines. Anything else posts nothing. */
export const LEAVER_HEADLINES = Object.freeze({
  family_deleted: ':wave: *Family deleted*',
  family_left_device: ':door: *Family left a device (file kept)*',
});

const isoDay = (iso) => (typeof iso === 'string' && iso.length >= 10 ? iso.slice(0, 10) : null);

/**
 * One Slack mrkdwn line for a leaver event, e.g.
 * `:wave: *Family deleted* · The Parkers · id …55555555 · ios · 3 members · since 2026-10-02 ·
 * google_drive · plan: magic beans (active)`. A segment whose data is missing is left out.
 *
 * @param {'family_deleted'|'family_left_device'} kind
 * @param {object} row the registry row as read BEFORE any tombstone (it still has the pointer)
 * @param {object|null} billing the billing row (`plan`, `status`), or null
 */
export function formatLeaverMessage(kind, row, billing) {
  const r = row ?? {};
  const members =
    typeof r.memberCount === 'number' && r.memberCount >= 1
      ? `${r.memberCount} member${r.memberCount === 1 ? '' : 's'}`
      : null;
  const since = isoDay(r.createdAt);
  const planLabel = billing?.plan ? (PLAN_LABELS[billing.plan] ?? billing.plan) : null;
  const plan =
    planLabel || billing?.status
      ? `plan: ${slackEscape(planLabel ?? 'unknown')}${billing?.status ? ` (${slackEscape(billing.status)})` : ''}`
      : null;
  return [
    LEAVER_HEADLINES[kind] ?? `*${slackEscape(kind)}*`,
    familyIdentity(r),
    r.signupPlatform ? slackEscape(r.signupPlatform) : null,
    members,
    since ? `since ${since}` : null,
    r.provider ? slackEscape(r.provider) : null,
    plan,
  ]
    .filter(Boolean)
    .join(' · ');
}

/** sha256 hex, the same derivation as `index.mjs` `familyIdHash` (and billing's `hash`). */
const idHash = (familyId) =>
  familyId ? createHash('sha256').update(String(familyId)).digest('hex') : null;

/** Billing's `logLine` shape, plus the channel. */
function logLine(msg, familyId, fields) {
  // eslint-disable-next-line no-console -- structured decision line, read by CloudWatch
  console.log(
    JSON.stringify({ msg, family_id_hash: idHash(familyId), channel: 'leavers', ...fields })
  );
}

/**
 * Post a leaver line to #beanies-leavers. NEVER throws and never fails the DELETE: every outcome
 * is one `slack_posted` / `slack_post_failed` / `slack_post_skipped` line.
 *
 * @param {'family_deleted'|'family_left_device'} kind
 * @param {object} row the registry row (read before any write)
 * @param {{ table: 'dev'|'prod', billing?: object|null, fetchImpl?: Function }} opts
 *   `table` is `index.mjs` `tableLabel(origin)`: `'dev'` skips (localhost and e2e teardowns).
 * @returns {Promise<{ ok: boolean, reason?: string }>}
 */
export async function notifyLeaverSlack(kind, row, { table, billing = null, fetchImpl } = {}) {
  const familyId = row?.familyId ?? null;
  try {
    if (!(kind in LEAVER_HEADLINES)) {
      logLine('slack_post_skipped', familyId, { kind, reason: 'unknown_kind', table });
      return { ok: false, reason: 'unknown_kind' };
    }
    if (table === 'dev') {
      logLine('slack_post_skipped', familyId, { kind, reason: 'dev_table', table });
      return { ok: false, reason: 'dev_table' };
    }
    const url = process.env.SLACK_LEAVERS_WEBHOOK_URL || '';
    if (!url) {
      logLine('slack_post_skipped', familyId, { kind, reason: 'no_url', table });
      return { ok: false, reason: 'no_url' };
    }
    // The billing row is fetched only past the gates above: a dev-table or no-URL call must
    // not pay a DynamoDB read for a line it will never post. A thunk or a row are both accepted.
    const billingRow = typeof billing === 'function' ? await billing().catch(() => null) : billing;
    const r = await postToSlack(url, formatLeaverMessage(kind, row, billingRow), { fetchImpl });
    if (r.ok) {
      logLine('slack_posted', familyId, { kind, table });
      return r;
    }
    console.warn(
      `[registry] slack_post_failed kind=${kind} reason=${r.reason} http_status=${r.httpStatus ?? '-'}\n` +
        'Check SLACK_LEAVERS_WEBHOOK_URL (TF_VAR_slack_leavers_webhook_url) on the registry Lambda.'
    );
    logLine('slack_post_failed', familyId, {
      kind,
      reason: r.reason,
      http_status: r.httpStatus ?? null,
      table,
    });
    return r;
  } catch (err) {
    console.warn('[registry] slack_post_failed reason=exception', err);
    logLine('slack_post_failed', familyId, { kind, reason: 'exception', table });
    return { ok: false, reason: 'exception' };
  }
}
