/**
 * Universal error reporter — fire-and-forget Slack POST for every caught
 * error in the beanies app.
 *
 * Three layers of capture flow into this single utility:
 *   A. `showToast('error', ...)` (auto, unless `{ silent: true }`)
 *   B. Vue render errors via `app.config.errorHandler`
 *   C. Unhandled JS errors / promise rejections (window listeners)
 *
 * Context enrichment, the privacy allowlist, and message normalization live in
 * `src/utils/diagnosticContext.ts` (shared with the telemetry firehose in
 * `src/services/telemetry`). This module owns the Slack-specific
 * orchestration: dedup, formatting, and the webhook POST.
 *
 * Privacy contract: see `diagnosticContext.ts`. The Slack path enriches with
 * `includeEmail: true` — operators may need to contact the family.
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
import {
  enrichAndRedact,
  extractStack,
  getBuildSha,
  normalizeMessage,
} from '@/utils/diagnosticContext';
import { logEvent } from '@/services/telemetry';

// ─── Public API ──────────────────────────────────────────────────────────────

export type ErrorSeverity = 'critical' | 'error' | 'warning';

export interface ErrorReportInput {
  /** Surface where the error occurred — kebab-case, e.g. 'create-activity'. */
  surface: string;
  /** User-facing or system error message. */
  message: string;
  /** Error object — stack and name extracted; the object itself is not sent. */
  error?: unknown;
  /** Structured context — filtered through `redactContext` before send. */
  context?: Record<string, unknown>;
  /**
   * Telemetry log-level AND the Slack page-gate. ONLY `'critical'` pages
   * #beanies-errors; `'error'` / `'warning'` / unspecified are telemetry +
   * console only (the firehose still records them). Set `'critical'` ONLY when
   * a user action failed or data is at risk (failed save, pod file couldn't be
   * created, onboarding/render/engine break). Defaults to `'error'`
   * (telemetry-only). To enumerate every Slack-paging site: `rg "severity: 'critical'"`.
   */
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

// ─── Spam prevention: count-summary dedup ────────────────────────────────────
//
// Two layers — both keyed by (surface, normalized message):
//
//   1. In-memory `buckets` map — covers the typical same-session flood.
//      First occurrence sends; subsequent within 60s increment a counter;
//      at the 60s mark a single summary fires if count > 1.
//
//   2. sessionStorage timestamp — covers reload loops that destroy the
//      in-memory bucket on every page reload. Caught 2026-05-18 from one
//      family hitting 40+ alerts in 30s during an init → fail-load →
//      redirect-cancelled → reload → init → fail-load loop. Each reload
//      wiped the in-memory bucket, so layer 1's dedup couldn't help.
//      sessionStorage survives reloads within the same tab.
//
// If layer 2 suppresses, no Slack send AND no in-memory bucket creation —
// the in-memory bucket would re-fire its "first occurrence sends" branch.
// Layer 2 IS the dedup for cross-reload patterns.

const DEDUP_WINDOW_MS = 60 * 1000;
const MAX_BUCKETS = 200;
const STORAGE_KEY_PREFIX = '__er_bucket_';

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
 * Read the timestamp the given bucket key was last sent to Slack, persisted
 * across page reloads in `sessionStorage`. Returns null if never sent in
 * this tab or if sessionStorage is unavailable (private mode, server
 * environment, etc.) — falls back to in-memory dedup only.
 */
function getStoredFiredAt(key: string): number | null {
  if (typeof sessionStorage === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY_PREFIX + key);
    if (!raw) return null;
    const ts = parseInt(raw, 10);
    return Number.isFinite(ts) ? ts : null;
  } catch {
    return null;
  }
}

function setStoredFiredAt(key: string, ts: number): void {
  if (typeof sessionStorage === 'undefined') return;
  try {
    sessionStorage.setItem(STORAGE_KEY_PREFIX + key, String(ts));
  } catch {
    // sessionStorage quota / private-mode — degrade to in-memory dedup only.
  }
}

function bucketKey(surface: string, message: string): string {
  return `${surface}::${normalizeMessage(message)}`;
}

/**
 * Returns true if this report should be suppressed (count-only); false if
 * the caller should proceed with the immediate Slack POST. Also handles
 * bucket creation, summary timer scheduling, and LRU eviction.
 *
 * Two-layer suppression — see the layered-dedup comment block above:
 *   1. In-memory bucket existing → suppress (count only).
 *   2. sessionStorage timestamp within DEDUP_WINDOW_MS → suppress (across
 *      reloads). The in-memory bucket is NOT created in this case, since
 *      the layer-2 suppression handles the dedup contract entirely.
 *   3. First fire in the window → send. Both layers updated.
 */
function shouldSuppress(surface: string, message: string): boolean {
  const key = bucketKey(surface, message);

  // Layer 1: in-memory bucket (same session).
  const existing = buckets.get(key);
  if (existing) {
    existing.count++;
    console.warn('[errorReporter] dedup-counted', surface, message, 'count=' + existing.count);
    return true;
  }

  // Layer 2: sessionStorage timestamp (across reloads in the same tab).
  // Catches reload-loop floods that destroy the in-memory bucket on every
  // page reload. If we sent this bucket within the dedup window during a
  // previous page load, suppress this one too.
  const now = Date.now();
  const lastFiredAt = getStoredFiredAt(key);
  if (lastFiredAt !== null && now - lastFiredAt < DEDUP_WINDOW_MS) {
    console.warn(
      '[errorReporter] dedup-counted-across-reload',
      surface,
      'lastFiredAt=' + new Date(lastFiredAt).toISOString()
    );
    return true;
  }

  // First fire in this window — proceed to send. Record the timestamp in
  // sessionStorage so any reload within the window can suppress.
  setStoredFiredAt(key, now);

  // New in-memory bucket — first occurrence sends immediately.
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
    firstSeenAt: now,
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
  // Mirror EVERY reported error into the queryable diagnostic firehose — the
  // firehose is the complete historical record; Slack is only the critical
  // subset. Emitted before dedup so suppressed Slack alerts are still logged
  // (the firehose has its own rate cap). `logEvent` is internally guarded and
  // never throws, but we belt-and-suspenders wrap it so a hypothetical
  // telemetry fault can never break the Slack send below.
  try {
    logEvent({
      // LogLevel has no 'critical', so map it to 'error' for the level, but
      // carry the real severity in context so the firehose stays filterable
      // ("which events actually paged Slack?" = severity === 'critical').
      level: input.severity === 'warning' ? 'warn' : 'error',
      surface: input.surface,
      message: input.message,
      error: input.error,
      context: { ...input.context, severity: input.severity ?? 'error' },
    });
  } catch (e) {
    console.warn('[errorReporter] telemetry mirror failed', e);
  }

  // ── Slack page-gate ──────────────────────────────────────────────────────
  // Telemetry above is the complete record (every severity). Slack is the
  // critical-only subset: page a human ONLY when a user action failed or data
  // is at risk. 'error'/'warning'/unspecified are captured in telemetry +
  // console but never page. See the `severity` contract on ErrorReportInput;
  // `rg "severity: 'critical'"` lists every paging site.
  if (input.severity !== 'critical') return;

  if (shouldSuppress(input.surface, input.message)) return;

  let context: Record<string, unknown>;
  try {
    context = enrichAndRedact(input, { includeEmail: true });
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

// ─── Slack message formatting ────────────────────────────────────────────────

function buildSlackMessage(input: ErrorReportInput, context: Record<string, unknown>): string {
  // Post-gate, only `severity: 'critical'` reaches here (see handleReport), so
  // this is always 'critical'. The fallback is dead but harmless — kept to avoid
  // touching the summary-path siblings + their tests for zero behavioural gain.
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
 *
 * Also clears the sessionStorage-backed layer-2 dedup so tests start fresh.
 * Pass `{ keepSessionStorage: true }` to simulate a "page reload" scenario
 * where in-memory buckets are gone but the persistent timestamps remain.
 */
export function __resetErrorReporterForTesting(opts?: { keepSessionStorage?: boolean }): void {
  for (const b of buckets.values()) clearTimeout(b.summaryTimer);
  buckets.clear();
  reentryGuard = false;
  if (!opts?.keepSessionStorage && typeof sessionStorage !== 'undefined') {
    try {
      // Iterate over a snapshot of keys — calling removeItem during iteration
      // shifts the storage's index and would skip entries.
      const keys: string[] = [];
      for (let i = 0; i < sessionStorage.length; i++) {
        const k = sessionStorage.key(i);
        if (k && k.startsWith(STORAGE_KEY_PREFIX)) keys.push(k);
      }
      for (const k of keys) sessionStorage.removeItem(k);
    } catch {
      // sessionStorage unavailable — nothing to clean up
    }
  }
}
