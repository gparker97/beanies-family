/* global process */
/**
 * Telemetry ingest Lambda — receives batched diagnostic events from the
 * beanies client (`src/services/telemetry`) and writes each as a structured
 * JSON line to THIS Lambda's own CloudWatch log group, which Terraform pins to
 * 90-day retention. Logs Insights queries filter on the `t = "beanlog"`
 * discriminator. No AWS SDK, no PutLogEvents, no log-stream management — a plain
 * `console.log` lands in the group via the basic Lambda execution role.
 *
 * Contract / invariants (see docs/adr/027-diagnostic-logging-telemetry.md):
 *   - Every telemetry line is valid JSON with `t` as the FIRST key.
 *   - The Lambda's own errors and alarm tally lines use the `[telemetry-lambda]`
 *     text prefix (no leading `{`) so the `t = "beanlog"` filter excludes them.
 *   - `t` and `v` (schema version) are stamped server-side, never trusted from
 *     the client (client-sent `t`/`v` are dropped by the allowlist).
 *
 * Defense-in-depth: re-enforces the same field allowlist as the client
 * (`src/utils/diagnosticContext.ts`). A non-allowlisted key never reaches
 * durable storage even if a future client bug sends it. NOTE: `family_email`
 * is deliberately ABSENT here: the firehose is PII-free by contract, and no
 * path (client or Lambda, firehose or Slack) carries an email any more. The
 * handler test pins the exact key set so client/server drift fails CI.
 */

const API_KEY = process.env.LOG_INGEST_API_KEY;
const ALLOWED_ORIGINS = (process.env.CORS_ORIGINS || 'https://beanies.family')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

// ── Slack paging policy (the ONLY client-error path to Slack) ────────────────
//
// The client no longer posts to Slack itself: every report reaches this Lambda
// through the firehose, and the page is decided HERE, where a broken client
// build cannot omit the webhook (the June 2026 and 2026-08-10 dev-build
// incidents, `boot-integrity`, are why the webhook lives in this environment).
//
// An event pages when and only when `severity === 'critical'` AND its surface
// is on this allowlist. The bar is "a user's data is at risk, or a user journey
// failed and will not recover by itself"; everything else stays queryable in
// CloudWatch and counts toward the rate alarms (see ALARMING_PREFIXES).
//
// MIRROR of `PAGING_SURFACES` in src/utils/pagingPolicy.ts. The set equality is
// pinned by src/utils/__tests__/telemetryAllowlistDrift.test.ts, so adding a
// paging surface is a reviewed diff to both files. Keep it alphabetised.
export const SLACK_ESCALATE_SURFACES = new Set([
  'ai-enclave', // enclave attestation failed: an AI action cannot run safely
  'app.chunkRecoveryFailed', // stale-chunk reload could not recover: app will not start
  'app.loadFamilyData.replaceLoopDetected', // load/replace loop: the pod never opens
  'app.onboardingStallTimeout', // init still stalled 60s after the watchdog (critical arm only)
  'app.postInitNoData', // init finished with no family data: the person sees an empty app
  'app.redirectAuthCompletion', // redirect code exchange failed: create blocked (create registry)
  'beanie-wall', // beanie wall job failed to save
  'billing-ui', // checkout / portal action failed: the person cannot pay or manage a plan
  'boot-integrity', // a dev/local build is live on the cloud host
  'cache-replay', // cache replay dropped increments: unsynced local edits may be lost
  'calendar-import', // calendar import failed to save
  'calendar-sync', // calendar sync failed for a non-auth reason (auth class stays at error)
  'change-password', // credential rotation half-applied: possible lockout
  'createPod.adoptExisting', // adopting an existing pod during create failed
  'createPod.connectDrive', // Drive connect blocked a create (drive-api-disabled, unknown)
  'createPod.handOff', // create hand-off reached a finish surface without an owner
  'delete-family', // family deletion did not complete: data the family asked to erase remains
  'feedback-submit', // feedback has no webhook configured (network failures stay at error)
  'file-delivery', // a critical export (the readable copy) could not be delivered
  'join-flow:FILE_CORRUPT', // joiner's family file is corrupt
  'join-flow:FILE_DECRYPT_FAILED', // joiner cannot decrypt the family file
  'join-flow:FILE_READ_FAILED', // joiner cannot read the family file
  'join-flow:FILE_TOO_LARGE', // family file too large for the joining device
  'kdf-upgrade', // credential rotation (kdf upgrade) rollback failed: possible lockout
  'list-copy', // list copy failed to save
  'login-flow', // pod-creation owner rehydrate or sign-out failed: the person is stuck
  'offline-queue-flush', // queued offline edits failed past the flush threshold
  'photo-upload', // a photo failed to save
  'pod-access', // canonical mismatch, pointer-write refusal, deletion residue
  'pod-compaction', // compaction failed, or a safety copy survived a deletion
  'pod-lineage', // pod lineage break: merge would lose history
  'pod-load-failure', // the pod payload is corrupt (device cannot open it)
  'pod-merge', // remote merge failed: edits may not converge
  'quick-add-composer', // quick-add composer failed to save
  'recipe-extract', // recipe capture failed to save
  'recurring-processor', // recurring items failed to materialise
  'registry', // the registry row survived a family deletion
  'reset-member-password', // credential rotation half-applied: possible lockout
  'responsibilities', // responsibilities failed to save or restore
  'resumeSetup.adoptExisting', // adopting an existing pod during resume failed
  'resumeSetup.concurrent-write', // create refused: another create/load in flight
  'resumeSetup.connectDrive', // Drive connect blocked a resumed create
  'resumeSetup.finalize', // resumed create could not finalise
  'resumeSetup.persist', // created pod not cached locally
  'resumeSetup.precondition', // create precondition failed
  'resumeSetup.probeDriveAuth', // Drive auth probe blocked a resumed create
  'resumeSetup.register', // created pod not registered: a fresh device cannot find it
  'resumeSetup.verify', // written pod failed read-back verification (silent corruption)
  'resumeSetup.write', // the pod write failed (Drive full stays a warning)
  'review-demo', // App Review demo seed failed: the reviewer sees an empty app
  'setupProgress.firstSync', // the first save of a new pod failed
  'setupProgress.unexpected', // setup progress hit an unexpected failure
  'signin-heal', // credential rotation (sign-in heal) rollback failed: possible lockout
  'statement-import', // statement import failed to save
  'storage-migration-failed', // storage migration failed: the pod may be split across homes
  'sync-envelope', // envelope write failed: other devices may lose access
  'syncStore.deferredHashLeak', // a deferred credential hash leaked into the doc
  'vue-render', // a component setup/render/lifecycle error (watchers and handlers stay at error)
  'wrapAsync:engine-panic', // the CRDT engine panicked mid-mutation
]);
const SLACK_WEBHOOK_URL = process.env.SLACK_ERROR_WEBHOOK_URL;

// Plain-text log prefixes that carry a CloudWatch metric filter + alarm in the
// ops repo's `modules/telemetry` (pinned by `infrastructure/__tests__/
// alarm-prefixes.test.mjs`). One tally line per qualifying event, written right
// after its beanlog line: `client_error` for every `level: 'error'` event and
// `client_critical` for every `severity: 'critical'` one, so the error and
// critical RATES are alarmable even for surfaces that never page.
export const ALARMING_PREFIXES = Object.freeze({
  clientError: '[telemetry-lambda] client_error',
  clientCritical: '[telemetry-lambda] client_critical',
});

// Best-effort, per-warm-container page dedup: page signature -> last page
// time. Across containers the same event may page more than once, which is
// acceptable at the expected volume.
const PAGE_DEDUP_WINDOW_MS = 5 * 60_000;
const PAGE_DEDUP_MAX_ENTRIES = 200;
// Cap the fan-out: a client loop could otherwise turn one batch into 100 posts.
const PAGE_FANOUT_CAP = 3;
const lastPagedAt = new Map();

/**
 * Lowercases a critical message and folds its variable parts (UUIDs, 0x/hex
 * runs of 6+, digit runs of 2+) to `#`, so a render or reload loop whose
 * message embeds an id or a length pages once, not once per variant.
 */
function normalizePageMessage(message) {
  return String(message ?? '')
    .toLowerCase()
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, '#')
    .replace(/\b(?:0x)?[0-9a-f]{6,}\b/g, '#')
    .replace(/\d{2,}/g, '#');
}

/** Last 8 chars of `family_id`, or null when absent. Shared by the key and the page text. */
function familyTail(e) {
  return typeof e.family_id === 'string' && e.family_id ? e.family_id.slice(-8) : null;
}

/**
 * Dedup signature `surface::<family tail>::<error_code | normalized message>`.
 * Registry-driven surfaces carry a stable `error_code`, so key on that;
 * otherwise on the normalized message. The family tail (`-` when absent) keeps
 * a second family's distinct critical from being suppressed by the first;
 * loop protection still holds because a reload or render loop is one family.
 */
function pageKey(e) {
  const detail =
    e.error_code !== undefined && e.error_code !== null && e.error_code !== ''
      ? e.error_code
      : normalizePageMessage(e.message);
  return `${e.surface}::${familyTail(e) ?? '-'}::${detail}`;
}

/** True when this signature already paged within the window. Read-only. */
function isDuplicatePage(key, now) {
  const prev = lastPagedAt.get(key);
  return prev !== undefined && now - prev < PAGE_DEDUP_WINDOW_MS;
}

/**
 * Records a delivered page (re-inserted so Map order stays oldest-first) and
 * evicts the oldest entries past the cap. Called only after Slack accepted the
 * post, so an overflow or a failed POST never suppresses a later real page.
 */
function recordPage(key, now) {
  lastPagedAt.delete(key);
  lastPagedAt.set(key, now);
  while (lastPagedAt.size > PAGE_DEDUP_MAX_ENTRIES) {
    lastPagedAt.delete(lastPagedAt.keys().next().value);
  }
}

const SCHEMA_VERSION = 1;
const MAX_EVENTS = 100;
const MAX_BODY_BYTES = 256 * 1024;
const MAX_EVENT_BYTES = 2 * 1024;
const MAX_STRING_LEN = 200;
const LEVELS = new Set(['debug', 'info', 'warn', 'error']);

// System fields the client writes on top of the redacted context
// (`logEvent.ts`). They carry no user-typed content (`message` is
// developer-authored, exactly as on the Slack path) and pass through unchanged.
const SYSTEM_FIELDS = new Set(['level', 'surface', 'message', 'timestamp', 'stack']);

// MIRROR of `ALLOWED_CONTEXT_KEYS` in src/utils/diagnosticContext.ts, minus
// `family_email` (the firehose is PII-free by contract). Pinned by the handler
// test — adding a context key on the client requires mirroring it here or the
// test fails. Anything not listed here (or in SYSTEM_FIELDS) is dropped.
export const ALLOWED_CONTEXT_KEYS = new Set([
  // Real report severity ('warning' | 'error' | 'critical') — `level` cannot
  // carry 'critical'. Lets the firehose answer "which events paged Slack?".
  'severity',
  'family_id',
  'family_name',
  'route_path',
  'route_name',
  'from_path',
  'action',
  // Bean identity (2026-09-02): generic `count` for the 'member-colour',
  // 'activity-celebration' and 'activity-owner-resolve' surfaces. Small integers only.
  'count',
  'error_code',
  // An activity record's random id (2026-09-27): per-record UUID, diagnostics only.
  'activity_id',
  // Beanie wall sizing (#96, surface 'beanie-wall'). Coarse integers only.
  // MIRROR of src/utils/diagnosticContext.ts — see the note at the top.
  'viewport_w',
  'viewport_h',
  'screen_w',
  'screen_h',
  // Meal planner (#27, surface 'meal-planner'). PII-free fixed enums/bools:
  // `kind` (recipe|eat_out|leftovers|skip|other), `slot` (breakfast|lunch|
  // dinner|snack), `quick_add`, `share_scope` (day|week), `overwrote`.
  'kind',
  'slot',
  'quick_add',
  'share_scope',
  'overwrote',
  'extraction_path',
  'inferred_count',
  'ingredient_count',
  // Plan export (#67, surface 'plan-export'). PII-free fixed enums: `format`
  // (image|pdf), `stage` (render|rasterize|pdf|deliver).
  'format',
  'stage',
  'http_status',
  'provider_type',
  'file_id_tail',
  'invite_token_tail',
  'build_sha',
  'browser',
  'os',
  'online',
  'connection_type',
  'save_failure_level',
  'save_status',
  'consecutive_failures',
  'drive_file_not_found',
  'context_build_error',
  'vue_info',
  'component',
  'silent_refresh_attempts',
  'silent_refresh_had_refresh_token',
  'silent_refresh_consecutive_failures',
  'page_hidden_for_ms',
  'visibility_state',
  'refresh_token_age_ms',
  'member_id_tail',
  // Web Storage availability + email-redacted init breadcrumbs (added
  // 2026-06-20 for the iPhone onboarding blocker). Mirror of the client
  // allowlist; both are PII-free (breadcrumbs redacted client-side).
  'web_storage',
  'breadcrumbs',
  // Cache-persist durability failure (added 2026-07-13, #50). PII-free: write kind +
  // IDB error-class name.
  'cache_persist_kind',
  'cache_persist_error',
  // Doc-worker death-recovery diagnostics (added 2026-07-13, A9 review-fix; mirror
  // of the client allowlist). PII-free: timed-out method name, recovery attempt
  // count, drained-siblings bool.
  'recovery_method',
  'recovery_attempt',
  'lost_siblings',
  // Native biometric passkey PRF diagnostics (added 2026-07-14, #52; mirror of the
  // client allowlist). PII-free: booleans + a small enum + a bounded `Name: message`
  // error descriptor. `detail` replaces the raw error string; platform ships in `os`.
  'prf_enabled',
  'has_prf_output',
  'credential_source',
  'unwrap_ok',
  'detail',
  // Share-target ingest counters (added 2026-08-26, #64). PII-free: a document count and a
  // cold-start boolean. Mirror of src/utils/diagnosticContext.ts.
  'file_count',
  'cold_start',
  // Perf timings (surface `load-perf`, src/utils/perfTiming.ts). These were on the CLIENT
  // allowlist but never here, so every sample's structured fields were stripped on ingest
  // and only the free-text `message` survived — the durations reached CloudWatch as prose
  // that cannot be filtered, averaged or alerted on. Found 2026-08-26 by the client-vs-
  // Lambda drift guard (src/utils/__tests__/telemetryAllowlistDrift.test.ts), which is the
  // comparison this file's header always claimed existed. PII-free: an op label plus
  // numbers.
  'perf_op',
  'perf_duration_ms',
  'perf_doc_bytes',
  'perf_entity_count',
  // Native hardware-Keystore biometric backing enum (added 2026-07-14, #52 pivot).
  'key_backing',
  // Silent data-connection config-heal booleans (added 2026-07-15, native data-
  // connection resilience). PII-free. Mirror of src/utils/diagnosticContext.ts.
  'had_config',
  'has_session',
  'registry_had_file_id',
  'token_valid',
  // OS local-notification diagnostics (#55). PII-free counters/enums/bools.
  // Mirror of src/utils/diagnosticContext.ts.
  'notif_count',
  'notif_truncated',
  'notif_lead_default',
  'notif_permission',
  'notif_error_stage',
  'notif_kind',
  'notif_exact_alarm',
  'notif_tz_changed',
  'notif_skipped',
  'notif_lateness_bucket',
  'notif_activity_lead',
  'notif_gated',
  'notif_backfilled',
  'notif_tap_outcome',
  // Helpful Hints (#40) reconcile + skip-reason diagnostics. MIRRORED from the
  // client allowlist — without these the hint telemetry is dropped at ingest.
  'hint_generated',
  'hint_expired',
  'hint_pruned_stale',
  'hint_total',
  'hint_skipped_records',
  'hint_master_on',
  'hint_flag_on',
  'hint_type',
  'hint_op',
  'hint_reason',
  'hint_count',
  // Account-details adoption/diagnostic counters (surface `account-details`).
  // PII-free: account-type enum + booleans + counts; never field values.
  'account_type',
  'has_account_number',
  'has_online_banking',
  'has_card_details',
  'wallet_count',
  'detail_field_count',
  // Google token lifecycle (surface `google-token-lifecycle`, token-churn fix #62,
  // 2026-08-13). PII-free closed enums — never a token value. Mirror of
  // src/utils/diagnosticContext.ts.
  'token_grant',
  'token_op',
  'token_outcome',
  'token_reason',
  'token_trigger',
  // Recurring-series occurrence handling (occurrence-edit data-loss fix,
  // 2026-08-15). PII-free: occurrence dates, closed enums, counts, and a joined
  // list of stripped model field names. Mirror of src/utils/diagnosticContext.ts.
  'recur_occurrence_ymd',
  'recur_resolved_ymd',
  'recur_rescheduled',
  'recur_scope',
  'recur_stripped_fields',
  'recur_outcome',
  'recur_children_removed',
  'recur_children_expected',
  // Unified recurrence engine (#70, surface 'recurrence') — PII-free enums/ints.
  'recur_surface',
  'recur_unit',
  'recur_interval',
  'recur_end',
  'recur_reason',
  // Plans and read-only (#95): closed enums and a boolean. Mirror of src/utils/diagnosticContext.ts.
  'entitlement_state',
  'plan',
  'dry_run',
  // Pod-creation funnel (#128): the open create attempt's random UUID. Mirror of
  // src/utils/diagnosticContext.ts.
  'create_attempt_id',
]);

function getHeaders(event) {
  const origin = event?.headers?.origin || ALLOWED_ORIGINS[0];
  const allowedOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Headers': 'Content-Type, x-api-key',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };
}

function response(statusCode, body, event) {
  return {
    statusCode,
    headers: getHeaders(event),
    body: body === null ? '' : JSON.stringify(body),
  };
}

function truncate(value) {
  if (typeof value === 'string' && value.length > MAX_STRING_LEN) {
    return value.slice(0, MAX_STRING_LEN) + '…';
  }
  return value;
}

/**
 * Strip an incoming event to allowlisted keys + system fields, truncate long
 * strings, and coerce the system fields to safe shapes. Returns null if the
 * event isn't an object.
 */
function sanitizeEvent(evt) {
  if (!evt || typeof evt !== 'object' || Array.isArray(evt)) return null;
  const out = {};
  for (const [key, value] of Object.entries(evt)) {
    if (SYSTEM_FIELDS.has(key) || ALLOWED_CONTEXT_KEYS.has(key)) {
      out[key] = truncate(value);
    }
    // else: dropped (defense-in-depth — non-allowlisted / PII keys never persist)
  }
  if (!LEVELS.has(out.level)) out.level = 'info';
  if (typeof out.surface !== 'string') out.surface = 'unknown';
  if (typeof out.message !== 'string') out.message = '';
  if (typeof out.timestamp !== 'string') out.timestamp = new Date().toISOString();
  return out;
}

export async function handler(event) {
  const method = event?.requestContext?.http?.method;
  if (method === 'OPTIONS') return response(204, null, event);
  if (method !== 'POST') return response(405, { error: 'Method not allowed' }, event);

  // API key — via `x-api-key` header (fetch path) OR `?k=` query param (the
  // unload beacon path, since beacons cannot set headers). Hard 401 on
  // mismatch, matching the registry Lambda.
  const key = event?.headers?.['x-api-key'] || event?.queryStringParameters?.k;
  if (!API_KEY || key !== API_KEY) {
    return response(401, { error: 'Unauthorized' }, event);
  }

  const rawBody = event?.body || '';
  if (rawBody.length > MAX_BODY_BYTES) {
    return response(413, { error: 'Payload too large' }, event);
  }

  let parsed;
  try {
    parsed = JSON.parse(rawBody || '{}');
  } catch {
    return response(400, { error: 'Malformed JSON body' }, event);
  }

  const events = parsed?.events;
  if (!Array.isArray(events)) {
    return response(400, { error: 'Body must be { events: [...] }' }, event);
  }
  if (events.length === 0) {
    return response(200, { ok: true, count: 0, dropped: 0 }, event);
  }
  if (events.length > MAX_EVENTS) {
    return response(400, { error: `Too many events (max ${MAX_EVENTS})` }, event);
  }

  let written = 0;
  let dropped = 0;
  // Non-duplicate criticals to page, each with its dedup signature.
  const escalations = [];
  const batchKeys = new Set();
  const now = Date.now();
  try {
    for (const evt of events) {
      const sanitized = sanitizeEvent(evt);
      if (!sanitized) {
        dropped++;
        continue;
      }
      // `t` first, `v` stamped server-side. Client-sent t/v were dropped above.
      const line = JSON.stringify({ t: 'beanlog', v: SCHEMA_VERSION, ...sanitized });
      if (line.length > MAX_EVENT_BYTES) {
        dropped++;
        continue;
      }
      console.log(line);
      // Alarm tally lines (plain text, never JSON, so `t = "beanlog"` skips them).
      if (sanitized.level === 'error') {
        console.log(`${ALARMING_PREFIXES.clientError} ${sanitized.surface}`);
      }
      if (sanitized.severity === 'critical') {
        console.log(`${ALARMING_PREFIXES.clientCritical} ${sanitized.surface}`);
      }
      written++;
      if (sanitized.severity === 'critical' && SLACK_ESCALATE_SURFACES.has(sanitized.surface)) {
        const key = pageKey(sanitized);
        if (batchKeys.has(key) || isDuplicatePage(key, now)) {
          console.log(
            `[telemetry-lambda] Slack page suppressed (duplicate within 5 min): ${sanitized.surface}`
          );
        } else {
          batchKeys.add(key);
          escalations.push({ event: sanitized, key });
        }
      }
    }
  } catch (err) {
    // Plain-text prefix (no leading `{`) so `t = "beanlog"` queries exclude it.
    console.error('[telemetry-lambda] error writing events:', err);
    return response(500, { error: 'Internal server error' }, event);
  }

  // Fire-and-forget AFTER the log lines are written, so a Slack outage can never
  // cost us the durable CloudWatch record — that record is the primary artifact;
  // Slack is the notification.
  if (escalations.length > 0) {
    const posted = escalations.slice(0, PAGE_FANOUT_CAP);
    const delivered = await notifySlack(
      posted.map((p) => p.event),
      escalations.length - posted.length
    );
    // Stamp only what Slack actually accepted: overflow and failed posts stay
    // eligible to page on the next batch.
    if (delivered) {
      for (const p of posted) recordPage(p.key, now);
    }
  }

  return response(200, { ok: true, count: written, dropped }, event);
}

const DEFAULT_REGION = 'ap-southeast-1';
const DEFAULT_LOG_GROUP = '/aws/lambda/beanies-family-telemetry-prod';
const INSIGHTS_WINDOW_MS = 30 * 60_000;

/**
 * JSURL string escape, as the CloudWatch console's `queryDetail` uses: every
 * character outside `[A-Za-z0-9_.-]` becomes `*` + two hex digits (`$` is `!`).
 */
function jsurlString(value) {
  return (
    "'" +
    String(value).replace(/[^\w.-]/g, (ch) => {
      if (ch === '$') return '!';
      const code = ch.charCodeAt(0);
      return code < 0x100
        ? '*' + code.toString(16).padStart(2, '0')
        : '**' + code.toString(16).padStart(4, '0');
    })
  );
}

/**
 * The console's fragment encoding: percent-encode EVERYTHING outside
 * `[A-Za-z0-9_.-]` (including the JSURL structure `~ ' ( ) * !`, which
 * `encodeURIComponent` leaves alone), then `%` -> `$`. Fully encoding keeps
 * Slack's link parser away from the parens and quotes.
 */
function consoleFragmentEncode(value) {
  return encodeURIComponent(value)
    .replace(/[~'()*!]/g, (ch) => '%' + ch.charCodeAt(0).toString(16).toUpperCase())
    .replace(/%/g, '$');
}

/**
 * CloudWatch Logs Insights deep link over this Lambda's log group, pre-filled
 * with a `family_id` filter and a +/-30 min absolute window around the event.
 * A missing family id drops the filter; an unparseable timestamp centres on now.
 */
export function insightsLink(familyId, timestampIso) {
  const region = process.env.AWS_REGION || DEFAULT_REGION;
  const logGroup =
    process.env.AWS_LAMBDA_LOG_GROUP_NAME ||
    (process.env.AWS_LAMBDA_FUNCTION_NAME
      ? `/aws/lambda/${process.env.AWS_LAMBDA_FUNCTION_NAME}`
      : DEFAULT_LOG_GROUP);
  const parsed = Date.parse(timestampIso);
  const centre = Number.isNaN(parsed) ? Date.now() : parsed;
  const start = new Date(centre - INSIGHTS_WINDOW_MS).toISOString();
  const end = new Date(centre + INSIGHTS_WINDOW_MS).toISOString();
  // Client-sent: keep only id characters so it cannot break out of the quotes.
  const safeId = typeof familyId === 'string' ? familyId.replace(/[^A-Za-z0-9_-]/g, '') : '';
  const query = [
    'fields @timestamp, level, severity, surface, message, route_path, build_sha',
    safeId ? `| filter t = "beanlog" and family_id = "${safeId}"` : '| filter t = "beanlog"',
    '| sort @timestamp asc',
    '| limit 500',
  ].join('\n');
  const queryDetail =
    `~(end~${jsurlString(end)}~start~${jsurlString(start)}` +
    `~timeType~'ABSOLUTE~tz~'UTC~editorString~${jsurlString(query)}` +
    `~source~(~${jsurlString(logGroup)}))`;
  return (
    `https://${region}.console.aws.amazon.com/cloudwatch/home?region=${region}` +
    `#logsV2:logs-insights${consoleFragmentEncode(`?queryDetail=${queryDetail}`)}`
  );
}

/** Slack mrkdwn control characters in client-sent text. */
function slackEscape(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const BROWSERS = [
  [/Edg\/(\d+)/, 'Edge'],
  [/OPR\/(\d+)/, 'Opera'],
  [/FxiOS\/(\d+)/, 'Firefox'],
  [/CriOS\/(\d+)/, 'Chrome'],
  [/Firefox\/(\d+)/, 'Firefox'],
  [/Chrome\/(\d+)/, 'Chrome'],
  [/Version\/(\d+).*Safari/, 'Safari'],
];
const PLATFORMS = [
  [/iPhone|iPad|iPod/, 'iOS'],
  [/Android/, 'Android'],
  [/Windows/, 'Windows'],
  [/Mac OS X|Macintosh/, 'macOS'],
  [/CrOS/, 'ChromeOS'],
  [/Linux/, 'Linux'],
];

/** `Chrome 141 on Android` from the client's raw user agent (`browser`). */
function shortBrowser(ua) {
  if (typeof ua !== 'string' || !ua) return 'unknown browser';
  const browser = BROWSERS.find(([re]) => re.test(ua));
  const platform = PLATFORMS.find(([re]) => re.test(ua));
  const name = browser ? `${browser[1]} ${ua.match(browser[0])[1]}` : 'WebView';
  return platform ? `${name} on ${platform[1]}` : name;
}

/** One page block: headline, message, identity line, deep link. */
function formatPage(e) {
  const identity = [
    e.family_name ? `family ${slackEscape(e.family_name)}` : null,
    familyTail(e) ? `id …${slackEscape(familyTail(e))}` : null,
    `build \`${slackEscape(String(e.build_sha || 'unknown').slice(0, 7))}\``,
    slackEscape(shortBrowser(e.browser)),
  ].filter(Boolean);
  return (
    `🚨 *beanies critical* · \`${slackEscape(e.surface)}\`\n` +
    `${slackEscape(e.message || '(no message)')}\n` +
    `_${identity.join(' · ')}_\n` +
    `<${insightsLink(e.family_id, e.timestamp)}|Logs Insights, +/-30 min>`
  );
}

/**
 * Page allowlisted critical events to the Slack error channel. Never throws: a
 * failure here must not turn a successful ingest into a 500, because the client
 * would then retry the whole batch and duplicate the log lines. Returns true
 * only when Slack accepted the post (`res.ok`), so the caller can stamp dedup.
 *
 * Deliberately awaited (not fire-and-forget): a Lambda's execution can be frozen
 * the moment the handler returns, which would drop an in-flight socket.
 *
 * `events` is already capped by the caller; `overflow` counts the non-duplicate
 * criticals beyond the cap, for the "and N more" suffix.
 */
async function notifySlack(events, overflow) {
  if (!SLACK_WEBHOOK_URL) {
    console.error('[telemetry-lambda] SLACK_ERROR_WEBHOOK_URL unset — cannot escalate', {
      surfaces: events.map((e) => e.surface),
    });
    return false;
  }
  const text = events.map(formatPage).join('\n\n');
  const suffix = overflow > 0 ? `\n\n_…and ${overflow} more in this batch_` : '';
  try {
    const res = await fetch(SLACK_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: text + suffix }),
    });
    if (!res.ok) {
      console.error('[telemetry-lambda] Slack escalation rejected:', res.status);
      return false;
    }
    return true;
  } catch (err) {
    console.error('[telemetry-lambda] Slack escalation failed:', err);
    return false;
  }
}
