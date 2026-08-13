/**
 * Load-path performance timing — instrumentation for the "app freezes while the
 * orange sync bar slides" investigation.
 *
 * The freeze is the JS main thread being blocked by synchronous, whole-document
 * work during load/sync (Automerge WASM load/clone/merge, whole-doc save,
 * char-by-char base64, and the ~21-store re-projection). None of it runs in a
 * worker, so a large accumulated `.beanpod` (e.g. after days away) pins the
 * event loop and can trip Chrome's "page unresponsive" dialog.
 *
 * These helpers time each suspect op and:
 *   - always log to the console (`[perf] <label>: <ms>ms`) for local repro, and
 *   - escalate genuinely slow ops (≥ TELEMETRY_FLOOR_MS) to the firehose
 *     (`logEvent`, surface `load-perf`) so real-world freezes surface in
 *     CloudWatch, correlated by `family_id`, not just on the developer's device.
 *
 * Fire-and-forget and cheap: `performance.now()` is effectively free, and the
 * console floor keeps trivial sub-ms calls (base64-encoding a 32-byte key)
 * silent. This is measurement-only — no behaviour changes.
 */

import { logEvent } from '@/services/telemetry';

/** Console-log ops at/above this — filters sub-ms noise from hot shared utils. */
const CONSOLE_FLOOR_MS = 1;
/** At/above this a single op is a felt stall → escalate to telemetry. */
const TELEMETRY_FLOOR_MS = 250;
/** At/above this it's a freeze a user would notice → warn level. */
const WARN_FLOOR_MS = 1000;

export interface PerfContext {
  /** Size of the binary/payload the op processed, in bytes (doc-size proxy). */
  perf_doc_bytes?: number;
  /** Entity count the op touched (data-volume proxy). */
  perf_entity_count?: number;
}

/**
 * Record a timing sample through the console-floor + telemetry-escalation logic.
 * Exported so the doc-worker's own `performance.now()` samples (which cannot use
 * `logEvent`/telemetry inside a Worker — that's a main-thread-only buffer) can be
 * relayed to the main thread and replayed through the SAME thresholds + single
 * telemetry buffer. See ADR-032. Prefer `measureSync`/`measureAsync` in-process.
 */
export function record(label: string, durationMs: number, ctx?: PerfContext): void {
  const ms = Math.round(durationMs);
  if (ms < CONSOLE_FLOOR_MS) return;

  const bytes = ctx?.perf_doc_bytes;
  const count = ctx?.perf_entity_count;
  const suffix = [
    bytes != null ? `${Math.round(bytes / 1024)}KB` : null,
    count != null ? `${count} items` : null,
  ]
    .filter(Boolean)
    .join(', ');

  // Always visible for local reproduction — grep `[perf]` in the console.
  // eslint-disable-next-line no-console -- deliberate load-path perf instrumentation
  console.info(`[perf] ${label}: ${ms}ms${suffix ? ` (${suffix})` : ''}`);

  // Telemetry is main-thread-only: `logEvent`'s queue flushes on `window`/
  // `pagehide`/`sendBeacon`, which don't exist in a Web Worker. So the worker
  // (which reuses this via encoding/crypto/persistence) console-times only; its
  // heavy load/merge/save ops relay explicit perf samples to the main thread,
  // where `docClient` replays them through this same `record` (see ADR-032).
  if (ms >= TELEMETRY_FLOOR_MS && typeof window !== 'undefined') {
    logEvent({
      level: ms >= WARN_FLOOR_MS ? 'warn' : 'info',
      surface: 'load-perf',
      // The numbers live in `message` too — it bypasses the context allowlist,
      // so the duration always survives to CloudWatch even if a key changes.
      message: `${label} took ${ms}ms${suffix ? ` (${suffix})` : ''}`,
      context: {
        perf_op: label,
        perf_duration_ms: ms,
        ...(bytes != null ? { perf_doc_bytes: bytes } : {}),
        ...(count != null ? { perf_entity_count: count } : {}),
      },
    });
  }
}

/**
 * Time a synchronous operation (Automerge WASM, base64, JSON). The timing wraps
 * the blocking call, so the reported ms is exactly how long the main thread was
 * pinned. Always returns `fn()`'s result; never swallows a throw.
 */
export function measureSync<T>(label: string, fn: () => T, ctx?: PerfContext): T {
  const start = performance.now();
  try {
    return fn();
  } finally {
    record(label, performance.now() - start, ctx);
  }
}

/**
 * Time an async operation (e.g. the reload-all-stores fan-out). Note this is
 * wall-clock, which for an awaiting op can include off-thread waits — use it
 * for aggregate steps, `measureSync` for the individual blocking calls.
 */
export async function measureAsync<T>(
  label: string,
  fn: () => Promise<T>,
  ctx?: PerfContext
): Promise<T> {
  const start = performance.now();
  try {
    return await fn();
  } finally {
    record(label, performance.now() - start, ctx);
  }
}
