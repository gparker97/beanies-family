/**
 * Universal error reporter — fire-and-forget Slack POST for every caught
 * error in the beanies app.
 *
 * Three layers of capture flow into this single utility:
 *   A. `showToast('error', ...)` (auto, unless `{ silent: true }`)
 *   B. Vue render errors via `app.config.errorHandler`
 *   C. Unhandled JS errors / promise rejections (window listeners)
 *
 * Privacy contract:
 *   - Strict allowlist for context fields (NOT a blocklist). Email is the
 *     only PII allowed; family name is allowed as identification context.
 *     No member names, no transaction descriptions, no activity titles, no
 *     user-typed content of any kind.
 *   - Stack traces ship as-is (Error.stack contains function@file:line, no
 *     local variable values).
 *
 * Spam prevention contract — count-summary dedup:
 *   - First occurrence sends immediately.
 *   - Subsequent occurrences within 60s increment a counter (no fetch).
 *   - At 60s, a single follow-up message reports "fired N more times" if N>0.
 *   - Bucket key normalizes UUIDs / timestamps / numeric IDs / hex strings
 *     so "nearly identical" errors collapse together.
 *
 * Failure contract — no silent failures:
 *   - Every failure path logs `[errorReporter] <reason>` to console.warn.
 *   - The reporter never throws, never blocks render, never breaks the toast.
 */

import { tail } from '@/utils/diagnostics';
import { slackPost } from '@/utils/slackNotify';
import { useFamilyStore } from '@/stores/familyStore';
import { useFamilyContextStore } from '@/stores/familyContextStore';
import { useSyncStore } from '@/stores/syncStore';

// ─── Public API ──────────────────────────────────────────────────────────────

export type ErrorSeverity = 'error' | 'warning';

export interface ErrorReportInput {
  /** Surface where the error occurred — kebab-case, e.g. 'create-activity'. */
  surface: string;
  /** User-facing or system error message. */
  message: string;
  /** Error object — stack and name extracted; the object itself is not sent. */
  error?: unknown;
  /** Structured context — filtered through `redactContext` before send. */
  context?: Record<string, unknown>;
  /** Defaults to 'error'. */
  severity?: ErrorSeverity;
}

/**
 * Fire-and-forget. Returns synchronously — never blocks, never throws.
 * If you're tempted to `await` this, don't — it's async-internal but the
 * surface is intentionally synchronous.
 */
export function reportError(input: ErrorReportInput): void {
  if (reentryGuard) {
    console.warn('[errorReporter] re-entry blocked', input.surface);
    return;
  }
  reentryGuard = true;
  try {
    handleReport(input);
  } catch (e) {
    console.warn('[errorReporter] reportError itself threw', e);
  } finally {
    reentryGuard = false;
  }
}

// ─── Privacy: context allowlist ──────────────────────────────────────────────

/**
 * The ONLY field names allowed in a Slack-bound context payload. Anything
 * else is dropped + console.warn before send. This is enforced as a unit
 * test contract, so adding a new context field requires explicit opt-in
 * here AND the test continues to pass.
 *
 * Email is the only PII allowed. Family name allowed as identification.
 * Add new fields only after confirming they cannot carry user-typed
 * content (transaction descriptions, activity titles, member names, etc.).
 */
const ALLOWED_CONTEXT_KEYS = new Set<string>([
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
]);

const MAX_STRING_LEN = 200;

/**
 * Filter a raw context object to the allowlist. Drops disallowed keys (with
 * a console.warn so devs see the lint signal in dev tools). Truncates
 * string values to 200 chars. Enforces last-4-chars on `*_tail` fields.
 *
 * Exported for testing and for layered contexts that pre-filter before
 * passing through.
 */
export function redactContext(raw: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  let truncatedAny = false;
  for (const [key, value] of Object.entries(raw)) {
    if (!ALLOWED_CONTEXT_KEYS.has(key)) {
      console.warn('[errorReporter] dropped non-allowlisted context key:', key);
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
    console.warn('[errorReporter] truncated long string value(s) in context');
  }
  return out;
}

// ─── Spam prevention: count-summary dedup ────────────────────────────────────

const DEDUP_WINDOW_MS = 60 * 1000;
const MAX_BUCKETS = 200;

interface BucketState {
  surface: string;
  message: string;
  firstSeenAt: number;
  count: number;
  summaryTimer: ReturnType<typeof setTimeout>;
}

const buckets: Map<string, BucketState> = new Map();
let reentryGuard = false;

/**
 * Normalize a message before bucketing so "nearly identical" errors
 * collapse into a single dedup bucket. The original message still ships
 * to Slack — normalization is for hashing only.
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

function bucketKey(surface: string, message: string): string {
  return `${surface}::${normalizeMessage(message)}`;
}

/**
 * Returns true if this report should be suppressed (count-only); false if
 * the caller should proceed with the immediate Slack POST. Also handles
 * bucket creation, summary timer scheduling, and LRU eviction.
 */
function shouldSuppress(surface: string, message: string): boolean {
  const key = bucketKey(surface, message);
  const existing = buckets.get(key);
  if (existing) {
    existing.count++;
    console.warn('[errorReporter] dedup-counted', surface, message, 'count=' + existing.count);
    return true;
  }
  // New bucket — first occurrence sends immediately.
  if (buckets.size >= MAX_BUCKETS) {
    // LRU eviction — Map iteration is insertion order, so first key is oldest.
    const oldestKey = buckets.keys().next().value;
    if (oldestKey) {
      const oldest = buckets.get(oldestKey);
      if (oldest) clearTimeout(oldest.summaryTimer);
      buckets.delete(oldestKey);
      console.warn('[errorReporter] dedup map at cap, evicted', oldestKey);
    }
  }
  const timer = setTimeout(() => onBucketWindowClose(key), DEDUP_WINDOW_MS);
  buckets.set(key, {
    surface,
    message,
    firstSeenAt: Date.now(),
    count: 1,
    summaryTimer: timer,
  });
  return false;
}

function onBucketWindowClose(key: string): void {
  const b = buckets.get(key);
  if (!b) return;
  buckets.delete(key);
  if (b.count > 1) {
    sendToSlack(buildSummaryPayload(b));
  }
}

// ─── Slack send ──────────────────────────────────────────────────────────────

function getWebhookUrl(): string | null {
  if (typeof import.meta === 'undefined') return null;
  const url = import.meta.env?.VITE_BEANIES_ERROR_WEBHOOK_URL;
  if (!url || typeof url !== 'string') return null;
  return url;
}

function getBuildSha(): string {
  if (typeof import.meta === 'undefined') return 'dev';
  return (import.meta.env?.VITE_BUILD_SHA as string | undefined) ?? 'dev';
}

/**
 * Send a Slack message via the shared `slackPost` helper. Wraps it so the
 * webhook-URL check + scope tag are consistent across summary + first-fire
 * paths. Fire-and-forget; failures land in console.warn with the
 * `errorReporter` scope tag.
 */
function sendToSlack(payload: { text: string }): void {
  slackPost(getWebhookUrl(), payload, 'errorReporter');
}

// ─── Report orchestration ────────────────────────────────────────────────────

function handleReport(input: ErrorReportInput): void {
  if (shouldSuppress(input.surface, input.message)) return;

  let context: Record<string, unknown>;
  try {
    context = buildContext(input);
  } catch (e) {
    console.warn('[errorReporter] context build failed', e);
    context = {
      build_sha: getBuildSha(),
      context_build_error: e instanceof Error ? e.message : String(e),
    };
  }

  const text = buildSlackMessage(input, context);
  sendToSlack({ text });
}

/**
 * Read identity + environment context. Wrapped by handleReport's try/catch
 * so a Pinia pre-init race or missing store cannot break the report — the
 * caller falls through to a degraded report with `context_build_error`.
 *
 * Each store/router read is independently try/catched so a single failing
 * subsystem (e.g. Pinia not yet initialized at boot-time error) doesn't
 * lose ALL context — the report still ships with the bits that worked.
 */
function buildContext(input: ErrorReportInput): Record<string, unknown> {
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
  try {
    const fam = useFamilyStore();
    const owner = fam.members?.find?.((m) => m.role === 'owner');
    if (owner?.email) raw.family_email = owner.email;
  } catch {
    /* same as above — independent so partial context still ships */
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

// ─── Slack message formatting ────────────────────────────────────────────────

function buildSlackMessage(input: ErrorReportInput, context: Record<string, unknown>): string {
  const severity = input.severity ?? 'error';
  const familyId = context.family_id ? String(context.family_id) : null;
  const familyName = context.family_name ?? null;
  const familyEmail = context.family_email ?? null;
  const buildSha = context.build_sha ?? 'dev';
  const stack = extractStack(input.error);
  const time = new Date().toISOString().replace('T', ' ').replace('Z', ' UTC');

  const familyLine = familyId
    ? `*Family:* ${familyName ?? '(unknown)'}${familyEmail ? ` (${familyEmail})` : ''} · \`${tail(familyId, 8) ?? familyId}\``
    : `*Family:* (not yet authenticated)`;

  const stackBlock = stack ? `\n*Stack:*\n\`\`\`${stack}\`\`\`` : '';

  const contextLines = Object.entries(context)
    .filter(([k]) => !['family_id', 'family_name', 'family_email', 'build_sha'].includes(k))
    .map(([k, v]) => `• ${k}: ${formatContextValue(v)}`)
    .join('\n');

  const contextBlock = contextLines ? `\n*Context:*\n${contextLines}` : '';

  return [
    `🚨 *beanies error* — ${severity}`,
    familyLine,
    `*Surface:* \`${input.surface}\``,
    `*Time:* ${time}`,
    `*Build:* \`${buildSha}\``,
    '',
    '*Message:*',
    `\`\`\`${input.message}\`\`\``,
    stackBlock,
    contextBlock,
  ]
    .filter(Boolean)
    .join('\n');
}

function buildSummaryPayload(b: BucketState): { text: string } {
  return {
    text: `🔁 *${b.surface}* repeated: \`${b.message}\` fired ${b.count - 1} more times in the last ${DEDUP_WINDOW_MS / 1000}s.`,
  };
}

function extractStack(err: unknown): string | null {
  if (!err) return null;
  if (err instanceof Error && err.stack) {
    // Trim to first ~12 frames for readability
    return err.stack.split('\n').slice(0, 12).join('\n');
  }
  return null;
}

function formatContextValue(v: unknown): string {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  try {
    return JSON.stringify(v);
  } catch {
    return '[unserializable]';
  }
}

// ─── Test-only reset ─────────────────────────────────────────────────────────

/**
 * Test-only — clears all dedup buckets and timers + resets the re-entry
 * guard. Production code never calls this; tests use it between cases.
 */
export function __resetErrorReporterForTesting(): void {
  for (const b of buckets.values()) clearTimeout(b.summaryTimer);
  buckets.clear();
  reentryGuard = false;
}
