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

import { tail } from '@/utils/diagnostics';
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
 * Email is the only PII allowed. Family name allowed as identification.
 * Add new fields only after confirming they cannot carry user-typed content
 * (transaction descriptions, activity titles, member names, etc.).
 *
 * MIRROR: `infrastructure/lambda/telemetry/index.mjs` has a copy of this set,
 * pinned by a Lambda test. Update both together.
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
  'drive_file_not_found',
  'context_build_error',
  'vue_info',
  'component',
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

// ─── Environment / build ─────────────────────────────────────────────────────

export function getBuildSha(): string {
  if (typeof import.meta === 'undefined') return 'dev';
  return (import.meta.env?.VITE_BUILD_SHA as string | undefined) ?? 'dev';
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

  // Family identity (read once; tolerant of pre-auth state)
  try {
    const ctx = useFamilyContextStore();
    if (ctx.activeFamilyId) raw.family_id = ctx.activeFamilyId;
    if (ctx.activeFamilyName) raw.family_name = ctx.activeFamilyName;
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

  return redactContext(raw);
}
