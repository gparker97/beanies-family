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
 *   - The Lambda's OWN errors use the `[telemetry-lambda]` text prefix (no
 *     leading `{`) so the `t = "beanlog"` filter excludes them.
 *   - `t` and `v` (schema version) are stamped server-side, never trusted from
 *     the client (client-sent `t`/`v` are dropped by the allowlist).
 *
 * Defense-in-depth: re-enforces the same field allowlist as the client
 * (`src/utils/diagnosticContext.ts`). A non-allowlisted key never reaches
 * durable storage even if a future client bug sends it. NOTE: `family_email`
 * is deliberately ABSENT here — the firehose is PII-free by contract; email
 * lives only on the low-volume Slack error path. The handler test pins the
 * exact key set so client/server drift fails CI.
 */

const API_KEY = process.env.LOG_INGEST_API_KEY;
const ALLOWED_ORIGINS = (process.env.CORS_ORIGINS || 'https://beanies.family')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

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
  'error_code',
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
  // Incremental delta-sync diagnostics (added 2026-07-13, mirror of the client
  // allowlist). PII-free: phase enum, fallback-reason enum, chunk counts, seq, bool.
  'incr_phase',
  'incr_reason',
  'incr_chunk_count',
  'incr_seq',
  'incr_dirty',
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
  // Native hardware-Keystore biometric backing enum (added 2026-07-14, #52 pivot).
  'key_backing',
  // Silent data-connection config-heal booleans (added 2026-07-15, native data-
  // connection resilience). PII-free. Mirror of src/utils/diagnosticContext.ts.
  'had_config',
  'has_session',
  'registry_had_file_id',
  'token_valid',
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
      written++;
    }
  } catch (err) {
    // Plain-text prefix (no leading `{`) so `t = "beanlog"` queries exclude it.
    console.error('[telemetry-lambda] error writing events:', err);
    return response(500, { error: 'Internal server error' }, event);
  }

  return response(200, { ok: true, count: written, dropped }, event);
}
