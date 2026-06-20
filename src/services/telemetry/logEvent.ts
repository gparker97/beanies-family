/**
 * Diagnostic logging tier — the firehose companion to `reportError`.
 *
 * Where `reportError` (errorReporter.ts) escalates CRITICAL errors to Slack,
 * `logEvent` captures the full diagnostic stream (`debug | info | warn | error`)
 * that today dies in the browser console. Every event is enriched + redacted
 * through the shared `diagnosticContext` core, then handed to a batched,
 * offline-aware queue (`logQueue.ts`) that ships to the AWS ingest endpoint.
 *
 * Contracts (mirrors errorReporter):
 *   - Fire-and-forget. Returns synchronously. NEVER throws, never blocks.
 *   - Re-entry guarded so a logEvent emitted from within enrichment/queue code
 *     can't recurse.
 *   - Privacy: enriches with `includeEmail: false` — the firehose correlates by
 *     `family_id` (random UUID), never email. Email stays on the Slack path.
 *   - No silent failures: every internal failure → `[telemetry] <reason>`
 *     console.warn (never a bare catch).
 *
 * `level`, `surface`, `message`, `timestamp`, and `stack` are system-generated
 * fields written on top of the redacted context — they are NOT subject to the
 * context allowlist (they carry no user-typed content; `message` is
 * developer-authored, exactly as on the Slack path).
 */

import { enrichAndRedact, extractStack, normalizeMessage } from '@/utils/diagnosticContext';
import { enqueueLogEvent } from './logQueue';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEventInput {
  level: LogLevel;
  /** Surface where the event occurred — kebab-case, e.g. 'silent-refresh'. */
  surface: string;
  message: string;
  /** Structured context — merged then filtered through the allowlist. */
  context?: Record<string, unknown>;
  /** Error object — stack extracted; the object itself is not sent. */
  error?: unknown;
  /**
   * Force an immediate flush (bypass the batch threshold) so the event survives
   * a hang-then-force-quit. Set for critical reports. Fire-and-forget; the queue
   * coalesces concurrent flushes.
   */
  flush?: boolean;
}

/** A finished, redacted, ship-ready record. System fields + allowlisted context. */
export interface LogRecord {
  level: LogLevel;
  surface: string;
  message: string;
  timestamp: string;
  stack?: string;
  [key: string]: unknown;
}

let reentryGuard = false;

// ─── Client-side rate limit (runaway-loop guard) ─────────────────────────────
//
// Collapse identical (surface, normalized-message) events within a window so a
// hot loop can't flood the buffer. Count-only — no Slack summary (that's the
// errorReporter's job). Reuses `normalizeMessage` so "nearly identical" events
// (differing only by UUID/timestamp/id) share a bucket.

const RATE_WINDOW_MS = 60_000;
const RATE_MAX_PER_WINDOW = 50;
const RATE_MAX_BUCKETS = 500;

interface RateBucket {
  count: number;
  windowStart: number;
}

const rateBuckets = new Map<string, RateBucket>();

function rateLimited(surface: string, message: string): boolean {
  const key = `${surface}::${normalizeMessage(message)}`;
  const now = Date.now();
  let bucket = rateBuckets.get(key);
  if (!bucket || now - bucket.windowStart >= RATE_WINDOW_MS) {
    if (!bucket && rateBuckets.size >= RATE_MAX_BUCKETS) {
      // LRU-ish eviction — Map iteration is insertion order, oldest first.
      const oldest = rateBuckets.keys().next().value;
      if (oldest) rateBuckets.delete(oldest);
    }
    bucket = { count: 0, windowStart: now };
    rateBuckets.set(key, bucket);
  }
  bucket.count++;
  if (bucket.count === RATE_MAX_PER_WINDOW + 1) {
    console.warn(`[telemetry] rate cap hit for ${key} — suppressing further events this window`);
  }
  return bucket.count > RATE_MAX_PER_WINDOW;
}

/**
 * Capture a diagnostic event. Fire-and-forget; never throws.
 */
export function logEvent(input: LogEventInput): void {
  if (reentryGuard) {
    console.warn('[telemetry] re-entry blocked', input.surface);
    return;
  }
  reentryGuard = true;
  try {
    if (rateLimited(input.surface, input.message)) return;

    const context = enrichAndRedact(
      { surface: input.surface, context: input.context },
      { includeEmail: false }
    );
    const stack = extractStack(input.error);

    const record: LogRecord = {
      ...context,
      level: input.level,
      surface: input.surface,
      message: input.message,
      timestamp: new Date().toISOString(),
      ...(stack ? { stack } : {}),
    };

    enqueueLogEvent(record, input.flush);
  } catch (e) {
    console.warn('[telemetry] logEvent failed', e);
  } finally {
    reentryGuard = false;
  }
}

/** Test-only — clears the rate-limit buckets between cases. */
export function __resetLogEventRateLimitForTesting(): void {
  rateBuckets.clear();
}
