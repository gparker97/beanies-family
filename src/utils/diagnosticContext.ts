/**
 * Shared diagnostic-context core — the single source of truth for the privacy
 * allowlist, context redaction, message normalization, identity/environment
 * enrichment, and stack extraction.
 *
 * Used by BOTH telemetry surfaces:
 *   - `src/utils/errorReporter.ts` (critical errors → Slack)
 *   - `src/services/telemetry/*` (the full diagnostic firehose → AWS)
 *
 * Dependency direction is one-way: errorReporter and telemetry import FROM
 * here; this module imports nothing from either, so there is no import cycle.
 * (The `APP_VERSION` constant it reads imports nothing, so no cycle there either.)
 *
 * Privacy contract:
 *   - Strict allowlist for context fields (NOT a blocklist). Email is the only
 *     PII allowed, and only on the low-volume Slack error path
 *     (`enrichAndRedact(..., { includeEmail: true })`). The high-volume
 *     telemetry firehose passes `includeEmail: false` and correlates by
 *     `family_id` (a random UUID, non-PII) instead.
 *   - Stack traces ship as-is (Error.stack contains function@file:line, no
 *     local variable values).
 *
 * IMPORTANT — server mirror: the telemetry Lambda
 * (`infrastructure/lambda/telemetry/index.mjs`) keeps a COPY of
 * `ALLOWED_CONTEXT_KEYS` and re-enforces it as defense-in-depth. A pinned
 * unit test in the Lambda fails if the two lists drift. When you add a key
 * here, mirror it there.
 */

import { APP_VERSION } from '@/constants/appVersion';
import { getDeviceInfo, tail } from '@/utils/diagnostics';
import { useFamilyStore } from '@/stores/familyStore';
import { useFamilyContextStore } from '@/stores/familyContextStore';
import { useSyncStore } from '@/stores/syncStore';

// ─── Privacy: context allowlist ──────────────────────────────────────────────

/**
 * The ONLY field names allowed in a redacted context payload. Anything else is
 * dropped + console.warn before send. Enforced as a unit-test contract, so
 * adding a new context field requires explicit opt-in here AND the test
 * continues to pass.
 *
 * Email and family name are the only PII allowed, and BOTH ship only on the
 * low-volume Slack error path (gated by `includeEmail` in `enrichAndRedact` —
 * `family_email` and `family_name` are added to the payload only when
 * `includeEmail: true`). The high-volume telemetry firehose omits them and
 * correlates by `family_id` (a random UUID) instead, so it stays PII-free.
 * Add new fields only after confirming they cannot carry user-typed content
 * (transaction descriptions, activity titles, member names, etc.).
 *
 * MIRROR: `infrastructure/lambda/telemetry/index.mjs` has a copy of this set,
 * pinned by a Lambda test. Update both together.
 *
 * APP-STORE DECLARATION: the fields transmitted here are declared to Apple &
 * Google. If you add/remove a field (or change which path it ships on), update
 * the data-collection table in `docs/runbooks/native-store-submission.md` and
 * its consumers (ios/App/App/PrivacyInfo.xcprivacy, the store Data-Safety/App-
 * Privacy answers, and web/src/pages/privacy.astro) so they can't drift.
 */
export const ALLOWED_CONTEXT_KEYS = new Set<string>([
  'family_id',
  'family_name',
  'family_email',
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
  // Sidebar save-status indicator transitions (surface: 'save-status', added
  // 2026-08-06). `save_status` is a fixed enum (saving|critical|degraded|saved|
  // hidden); `consecutive_failures` is a small integer count. No user content.
  'save_status',
  'consecutive_failures',
  'drive_file_not_found',
  'context_build_error',
  'vue_info',
  'component',
  // The report's real severity ('warning' | 'error' | 'critical'), injected by
  // `errorReporter.handleReport` so the firehose stays filterable ("which events
  // actually paged Slack?" = severity === 'critical'). `LogLevel` has no
  // 'critical', so it cannot ride on `level`.
  //
  // This was NOT allowlisted until 2026-07-10 — the key was stripped (with a
  // console warn) from every report ever sent, silently defeating the stated
  // intent. Fixed-enum, developer-authored, no user-typed content.
  'severity',
  // Silent-refresh diagnostic capture (added 2026-05-14 for the
  // cold-start-reconnect-escalation surface — see `googleAuth.performSilentRefresh`).
  // These ship as JSON-serialized arrays/primitives, no user-typed content:
  // attempt timings, error names/messages from the OAuth proxy, network classifications.
  'silent_refresh_attempts',
  'silent_refresh_had_refresh_token',
  'silent_refresh_consecutive_failures',
  'page_hidden_for_ms',
  'visibility_state',
  // Refresh-token age at the moment of permanent (invalid_grant) failure.
  // Added 2026-05-20 to detect revocation patterns (Google revoking after N
  // days of disuse, password change, etc.). Number-of-ms or null when the
  // token's `issuedAt` is unknown (legacy bare-string IDB / localStorage).
  'refresh_token_age_ms',
  // Password-rotation surfaces (changePassword / resetMemberPassword /
  // signin-heal) — tail of the affected member's UUID lets us correlate
  // a failure in telemetry to a specific entry in the corrupted envelope
  // without leaking the full id. Family scoping comes from `family_id`.
  'member_id_tail',
  // Web Storage availability (added 2026-06-20 for the iPhone onboarding
  // blocker). A flat `ls=<bool>,ss=<bool>` scalar from the diagnostics probe —
  // distinguishes "storage throws/blocked" from "storage wiped". No user content.
  'web_storage',
  // Init breadcrumb trail on init-failure surfaces (app.initFailed /
  // app.chunkRecoveryFailed / app.postInitNoData). Email-redacted and
  // tail-trimmed by `breadcrumbsForReport` before it reaches here, so it
  // honours the firehose's PII-free contract. Developer-authored step labels.
  'breadcrumbs',
  // Load-path performance timing (surface `load-perf`, see utils/perfTiming.ts).
  // All PII-free by construction: an op label, a duration, and size/count
  // proxies — no user-typed content. Added 2026-07-05 for the sync-freeze
  // investigation to capture real-world main-thread stall durations.
  'perf_op',
  'perf_duration_ms',
  'perf_doc_bytes',
  'perf_entity_count',
  // Local-durability cache-persist failure (surface `cache-persist`, see
  // services/sync/syncService.ts). PII-free: which write failed (base/increment) +
  // the IDB error class name. Added 2026-07-13 (#50). MIRROR in the Lambda allowlist
  // + its pinned test.
  'cache_persist_kind',
  'cache_persist_error',
  // Doc-worker death-recovery diagnostics (surface `doc-worker-recovery`, see
  // services/automerge/worker/docClient.ts). PII-free: the timed-out method name,
  // the recovery attempt count, and whether sibling calls were drained. Added
  // 2026-07-13 (A9 data-integrity review-fix) — these were previously sent as
  // `method`/`attempt`/`lostSiblings`, which are NOT allowlisted and so were
  // silently stripped from every recovery event. MIRROR in the Lambda allowlist
  // + its pinned test.
  'recovery_method',
  'recovery_attempt',
  'lost_siblings',
  // Native biometric passkey PRF diagnostics (surface `passkey-prf` + the
  // `passkey-register`/`passkey-assertion` warnings, see services/auth/passkeyService.ts).
  // PII-free by construction: booleans + a small enum + a bounded `Name: message`
  // error descriptor (no user-typed content; redactContext caps it at MAX_STRING_LEN).
  // Added 2026-07-14 (#52). `detail` supersedes the previously-passed-but-stripped
  // raw error string; platform ships in the existing `os` key. MIRROR every key here
  // in the Lambda allowlist + its pinned test.
  'prf_enabled',
  'has_prf_output',
  'credential_source',
  'unwrap_ok',
  'detail',
  // Native hardware-Keystore biometric (surface `native-biometric`, see
  // services/auth/nativeBiometric.ts). `key_backing` is a bounded enum
  // (strongbox|tee|keychain|secureEnclave) reporting which OS key backing was used —
  // PII-free. Outcome rides the existing `action` key; the rest reuse os/error_code/
  // detail. Added 2026-07-14 (#52 Keystore pivot). MIRROR in the Lambda allowlist + test.
  'key_backing',
  // Silent data-connection config-heal (surfaces `sync-init-restore`,
  // `sync-init-config-heal`, `sync-config-reconnect`, `sync-config-total-failure`,
  // see stores/syncStore.ts + services/sync/syncService.ts). PII-free booleans:
  // whether a provider config was found at boot, whether a session existed, whether
  // the registry entry carried a fileId, and whether the token was valid at total
  // failure. Heal source/outcome ride the existing `action` key; transient cause
  // rides `error_code`; provider type rides `provider_type`. Added 2026-07-15
  // (native data-connection resilience). MIRROR every key here in the Lambda
  // allowlist + its pinned test.
  'had_config',
  'has_session',
  'registry_had_file_id',
  'token_valid',
  // OS local-notification diagnostics (#55, surface `local-notifications`). All
  // PII-free counters/enums/bools: how many reminders were scheduled, whether the
  // MAX_SCHEDULED cap clipped the list, the to-do default lead, the permission
  // outcome, which reschedule stage failed, and the delivered reminder's kind.
  // MIRROR every key here in the Lambda allowlist + its pinned test, AND in the
  // store data-collection declarations (docs/runbooks/native-store-submission.md,
  // PrivacyInfo.xcprivacy, Play Data Safety, web/src/pages/privacy.astro).
  'notif_count',
  'notif_truncated',
  'notif_lead_default',
  'notif_permission',
  'notif_error_stage',
  'notif_kind',
  // Added by the #55 remediation. `notif_exact_alarm` is the one that makes the
  // silent inexact-alarm downgrade visible — without it a late reminder is
  // undiagnosable, because the schedule itself looks perfectly healthy.
  'notif_exact_alarm',
  'notif_tz_changed',
  'notif_skipped',
  'notif_lateness_bucket',
  'notif_activity_lead',
  'notif_gated',
  'notif_backfilled',
  'notif_tap_outcome', // notification tap → navigated | deferred | ignored-no-target
  // Helpful Hints (#40) — reconcile outcome counters + type/op enums. All are
  // non-PII (counts + a closed hint-type enum); no names, member ids, or event
  // content. Family scoping comes from `family_id`.
  'hint_generated',
  'hint_expired',
  'hint_pruned_stale',
  'hint_total',
  'hint_skipped_records',
  'hint_master_on',
  'hint_flag_on',
  'hint_type',
  'hint_op',
  'hint_reason', // why a candidate was not generated (no-dob | out-of-window | ...)
  'hint_count', // count carried by the per-reason "trigger skipped" debug event
  // Account-details adoption/diagnostic counters (surface `account-details`).
  // All PII-FREE by construction: an account-type enum plus booleans + counts
  // summarizing WHICH detail categories were populated — NEVER the field values
  // (account numbers, card digits, wallet addresses, URLs, phones, notes are
  // sensitive financial data and must never enter the firehose). MIRROR every
  // key here in the Lambda allowlist + its pinned test, AND in the store
  // data-collection declarations (docs/runbooks/native-store-submission.md,
  // PrivacyInfo.xcprivacy, Play Data Safety, web/src/pages/privacy.astro).
  'account_type',
  'has_account_number',
  'has_online_banking',
  'has_card_details',
  'wallet_count',
  'detail_field_count',
  // Google token lifecycle (surface `google-token-lifecycle`, token-churn fix
  // #62, 2026-08-13). All PII-FREE closed enums — NEVER a token value: which
  // grant (drive|calendar), the op (mint|revoke), the outcome (ok|queued|failed),
  // a short reason enum, and what drove it (reconnect|recovery|signout|disconnect|
  // enqueue|queue-drain). Lets us measure token-pressure + revoke success-rate
  // fleet-wide. MIRROR every key here in the Lambda allowlist + its pinned test,
  // AND in the store data-collection declarations (docs/runbooks/
  // native-store-submission.md, PrivacyInfo.xcprivacy, Play Data Safety,
  // web/src/pages/privacy.astro).
  'token_grant',
  'token_op',
  'token_outcome',
  'token_reason',
  'token_trigger',
]);

export const MAX_STRING_LEN = 200;

/**
 * Filter a raw context object to the allowlist. Drops disallowed keys (with
 * a console.warn so devs see the lint signal in dev tools). Truncates string
 * values to 200 chars. Enforces last-4-chars on `*_tail` fields.
 *
 * Exported for testing and for layered contexts that pre-filter before
 * passing through.
 */
export function redactContext(raw: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  let truncatedAny = false;
  for (const [key, value] of Object.entries(raw)) {
    if (!ALLOWED_CONTEXT_KEYS.has(key)) {
      console.warn('[diagnosticContext] dropped non-allowlisted context key:', key);
      continue;
    }
    /* eslint-disable security/detect-object-injection -- key is allowlisted above */
    if (key.endsWith('_tail') && typeof value === 'string') {
      out[key] = tail(value);
      continue;
    }
    if (typeof value === 'string' && value.length > MAX_STRING_LEN) {
      out[key] = value.slice(0, MAX_STRING_LEN) + '…';
      truncatedAny = true;
      continue;
    }
    out[key] = value;
    /* eslint-enable security/detect-object-injection */
  }
  if (truncatedAny) {
    console.warn('[diagnosticContext] truncated long string value(s) in context');
  }
  return out;
}

// ─── Message normalization (dedup hashing) ───────────────────────────────────

/**
 * Normalize a message before bucketing so "nearly identical" errors collapse
 * into a single dedup bucket. The original message still ships — normalization
 * is for hashing only.
 */
/* eslint-disable security/detect-unsafe-regex --
   The patterns below use fixed-length character classes and bounded
   quantifiers; no catastrophic backtracking is possible. Disabled at
   the function scope rather than rewriting to less-readable equivalents.
*/
export function normalizeMessage(message: string): string {
  return message
    .replace(/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/gi, '<uuid>')
    .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z?/g, '<ts>')
    .replace(/\b\d{6,}\b/g, '<id>')
    .replace(/\b[a-f0-9]{8,}\b/gi, '<hex>');
}
/* eslint-enable security/detect-unsafe-regex */

/**
 * Build a firehose-safe `breadcrumbs` context value from an init breadcrumb
 * trail. Two guarantees, both load-bearing:
 *
 *   1. PII-free. The `auth:` breadcrumb embeds `user=<email>`, but the telemetry
 *      firehose is PII-free by contract (the Lambda allowlist omits
 *      `family_email`). Every email-shaped token is replaced with `<email>`. The
 *      pattern mirrors the repo's own email shape (`src/utils/email.ts`:
 *      `[^\s@]+@[^\s@]+\.[^\s@]+`); the extra `|` exclusion stops a match from
 *      spanning the ` | ` crumb separator, and the `@` exclusion stops it
 *      spanning two addresses. Linear-time, no nested quantifiers.
 *   2. Tail-preserving. `redactContext` truncates strings >MAX_STRING_LEN keeping
 *      the FIRST 200 chars — which would drop the failure point (always the last
 *      crumb). So we keep the TAIL here, sized to exactly MAX_STRING_LEN so the
 *      downstream `> MAX_STRING_LEN` guard stays false and won't re-truncate.
 *
 * Pure, synchronous, never throws. The on-device error modal still renders the
 * FULL (un-redacted) trail — this redaction applies only to the telemetry-bound
 * context value.
 */
export function breadcrumbsForReport(crumbs: string[]): string {
  if (!crumbs || crumbs.length === 0) return '';
  const redacted = crumbs.join(' | ').replace(/[^\s|@]+@[^\s|@]+\.[^\s|@]+/g, '<email>');
  if (redacted.length > MAX_STRING_LEN) {
    return '…' + redacted.slice(-(MAX_STRING_LEN - 1));
  }
  return redacted;
}

// ─── Environment / build ─────────────────────────────────────────────────────

export function getBuildSha(): string {
  if (typeof import.meta === 'undefined') return 'dev';
  return (import.meta.env?.VITE_BUILD_SHA as string | undefined) ?? 'dev';
}

/** ISO build timestamp injected at build time, or null if unavailable. */
export function getBuildTime(): string | null {
  if (typeof import.meta === 'undefined') return null;
  return (import.meta.env?.VITE_BUILD_TIME as string | undefined) ?? null;
}

/**
 * A subtle, human-readable "which version am I on?" marker for the welcome gate
 * (2026-06-19). Format: `<short-sha> · <DD Mon YYYY>` (e.g. `41f5353 · 19 Jun 2026`).
 * The short SHA is the first 7 chars of `VITE_BUILD_SHA` — the SAME value the
 * error reporter ships in the `Build:` field of #beanies-errors, so a Slack
 * alert can be matched directly against the running build. A local/dev build
 * (no injected SHA) returns `dev`. Increments on every deploy (new commit +
 * new build time).
 */
export function getBuildVersionLabel(): string {
  const sha = getBuildSha();
  const shortSha = sha === 'dev' ? 'dev' : sha.slice(0, 7);
  const iso = getBuildTime();
  if (iso) {
    const d = new Date(iso);
    if (!Number.isNaN(d.getTime())) {
      const date = d.toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      });
      return `${shortSha} · ${date}`;
    }
  }
  return shortSha;
}

/** The human-facing product version, e.g. `v0.9`. Sidebar / menu label. */
export function getProductVersionLabel(): string {
  return `v${APP_VERSION}`;
}

/**
 * Product version + build marker, e.g. `v0.9 · 41f5353 · 19 Jun 2026`. Shown in the
 * Settings "about" footer so a running, signed-in build is fully identifiable (the
 * WelcomeGate is only visible pre-login).
 */
export function getFullVersionLabel(): string {
  return `${getProductVersionLabel()} · ${getBuildVersionLabel()}`;
}

// ─── Stack extraction ────────────────────────────────────────────────────────

export function extractStack(err: unknown): string | null {
  if (!err) return null;
  if (err instanceof Error && err.stack) {
    // Trim to first ~12 frames for readability
    return err.stack.split('\n').slice(0, 12).join('\n');
  }
  return null;
}

// ─── Identity + environment enrichment ───────────────────────────────────────

export interface EnrichInput {
  /** Surface where the event occurred — kebab-case, e.g. 'create-activity'. */
  surface?: string;
  /** Structured context — merged then filtered through `redactContext`. */
  context?: Record<string, unknown>;
}

/**
 * Read identity + environment context, merge the caller's context, and redact
 * through the allowlist. Each store/router read is independently try/caught so
 * a Pinia pre-init race (boot-time event) doesn't lose ALL context — the
 * result still ships with the bits that worked.
 *
 * `includeEmail` gates the owner email: the critical Slack error path passes
 * `true` (precedent — operators may need to contact the family); the
 * high-volume telemetry firehose passes `false` and correlates by `family_id`.
 *
 * Never touches Pinia at module-import time — only when actually called.
 */
export function enrichAndRedact(
  input: EnrichInput,
  opts: { includeEmail?: boolean } = {}
): Record<string, unknown> {
  const raw: Record<string, unknown> = {
    build_sha: getBuildSha(),
    ...input.context,
  };

  // Family identity (read once; tolerant of pre-auth state). `family_id` is a
  // random UUID (generateUUID → crypto.randomUUID; familyContext.ts) — non-PII,
  // so it ships on BOTH paths as the correlation key. `family_name` is user-typed
  // (commonly a surname) → PII, so it ships ONLY with `includeEmail` (the
  // low-volume Slack error path, which already carries the owner email), NEVER on
  // the high-volume telemetry firehose. This is what keeps the firehose PII-free.
  try {
    const ctx = useFamilyContextStore();
    if (ctx.activeFamilyId) raw.family_id = ctx.activeFamilyId;
    if (opts.includeEmail && ctx.activeFamilyName) raw.family_name = ctx.activeFamilyName;
  } catch {
    /* pre-auth, no Pinia, or store error — context is just less rich */
  }

  if (opts.includeEmail) {
    try {
      const fam = useFamilyStore();
      const owner = fam.members?.find?.((m) => m.role === 'owner');
      if (owner?.email) raw.family_email = owner.email;
    } catch {
      /* same as above — independent so partial context still ships */
    }
  }

  // Sync state
  try {
    const sync = useSyncStore();
    raw.provider_type = sync.storageProviderType ?? null;
    raw.save_failure_level = sync.saveFailureLevel ?? null;
    raw.drive_file_not_found = sync.driveFileNotFound ?? null;
  } catch {
    /* pre-init */
  }

  // Browser / network — best-effort
  if (typeof navigator !== 'undefined') {
    raw.online = navigator.onLine;
    const conn = (navigator as { connection?: { effectiveType?: string } }).connection;
    if (conn?.effectiveType) raw.connection_type = conn.effectiveType;
    raw.browser = navigator.userAgent.slice(0, MAX_STRING_LEN);
  }

  // Web Storage availability — the iPhone onboarding blocker (2026-06-20) is a
  // storage *access* failure the old diagnostics couldn't see. Flat scalar from
  // the single diagnostics probe; independently guarded so a probe fault never
  // drops the rest of the context.
  try {
    const dev = getDeviceInfo();
    raw.web_storage = `ls=${dev.localStorage},ss=${dev.sessionStorage}`;
  } catch (e) {
    console.warn('[diagnosticContext] web_storage enrich failed', e);
  }

  return redactContext(raw);
}
