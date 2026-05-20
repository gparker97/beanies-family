/**
 * Batched, offline-aware transport for the diagnostic firehose.
 *
 * Events from `logEvent()` buffer in memory and flush to the AWS ingest
 * endpoint on any of: a periodic interval, a batch-size threshold, the network
 * coming back (`online`), or the page being hidden / unloaded.
 *
 * Design mirrors `services/sync/offlineQueue.ts`: an `isListening` idempotency
 * flag, a `flushInFlight` coalescing guard, and lifecycle-event triggers.
 *
 * Failure contract — this module is telemetry-about-telemetry, so it NEVER
 * calls `reportError`/`logEvent` (that would risk an infinite loop). Every
 * failure path is a `[telemetry] <reason>` console.warn:
 *   - network / timeout / 5xx  → keep the batch, retry on the next trigger
 *   - 4xx (401 bad key, 400 malformed) → terminal, drop the batch (the server
 *     will always reject it — never retry-loop)
 *   - buffer overflow → drop oldest + counted warn
 *   - `sendBeacon` returns false on unload → accepted terminal loss (the page
 *     is gone; no retry is possible)
 *
 * Transport split (CORS reality):
 *   - interval/online/visibility flush → `fetch` with `keepalive` + the
 *     `x-api-key` header (preflight handled by the shared API's CORS config).
 *   - true unload (`pagehide`, non-bfcache) → `navigator.sendBeacon` with a
 *     `text/plain` Blob (a CORS-safelisted type, so no preflight — beacons
 *     can't preflight) and the key in a `?k=` query param (beacons can't set
 *     headers).
 */

import type { LogRecord } from './logEvent';

const FLUSH_INTERVAL_MS = 10_000;
const BATCH_THRESHOLD = 25;
const MAX_BUFFER = 500;
const MAX_EVENTS_PER_REQUEST = 100; // mirror the Lambda's MAX_EVENTS cap
const BEACON_MAX_BYTES = 60_000; // ~64KB browser cap, with margin

let buffer: LogRecord[] = [];
let isListening = false;
let intervalTimer: ReturnType<typeof setInterval> | null = null;
let flushInFlight: Promise<void> | null = null;
let droppedTotal = 0;
let warnedNoUrl = false;

// ─── Config (read at call time, never at import) ─────────────────────────────

function ingestUrl(): string | null {
  if (typeof import.meta === 'undefined') return null;
  const url = import.meta.env?.VITE_BEANIES_LOG_INGEST_URL;
  return url && typeof url === 'string' ? url : null;
}

function ingestApiKey(): string {
  if (typeof import.meta === 'undefined') return '';
  return (import.meta.env?.VITE_BEANIES_LOG_INGEST_API_KEY as string | undefined) ?? '';
}

// ─── Enqueue ─────────────────────────────────────────────────────────────────

/**
 * Buffer a finished log record. No-ops (with a single warn) when no ingest URL
 * is configured, so `logEvent` is a cheap no-op in dev/preview without the env.
 */
export function enqueueLogEvent(record: LogRecord): void {
  if (!ingestUrl()) {
    if (!warnedNoUrl) {
      console.warn('[telemetry] VITE_BEANIES_LOG_INGEST_URL not set — diagnostic logging disabled');
      warnedNoUrl = true;
    }
    return;
  }

  buffer.push(record);

  if (buffer.length > MAX_BUFFER) {
    const overflow = buffer.length - MAX_BUFFER;
    buffer.splice(0, overflow); // drop oldest
    droppedTotal += overflow;
    console.warn(`[telemetry] buffer overflow — dropped ${droppedTotal} oldest event(s) total`);
  }

  startListening();

  if (buffer.length >= BATCH_THRESHOLD) {
    void tryFlush();
  }
}

// ─── Flush ───────────────────────────────────────────────────────────────────

/**
 * Single coalesced flush entry point — only one fetch runs at a time. Triggers
 * arriving mid-flight share the in-flight attempt rather than stacking
 * duplicate requests.
 */
function tryFlush(): Promise<void> {
  if (flushInFlight) return flushInFlight;
  const p = flush().catch((e) => {
    // flush() handles its own expected failures; this guards the unexpected.
    console.warn('[telemetry] flush threw unexpectedly', e);
  });
  flushInFlight = p;
  void p.finally(() => {
    if (flushInFlight === p) flushInFlight = null;
  });
  return p;
}

async function flush(): Promise<void> {
  const url = ingestUrl();
  if (!url || buffer.length === 0) return;

  const batch = buffer.slice(0, MAX_EVENTS_PER_REQUEST);
  const body = JSON.stringify({ events: batch });

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      keepalive: true,
      headers: { 'Content-Type': 'application/json', 'x-api-key': ingestApiKey() },
      body,
    });
  } catch (e) {
    // Network / timeout — retryable. Keep the batch for the next trigger.
    console.warn('[telemetry] flush network error (will retry on next trigger)', e);
    return;
  }

  if (res.ok) {
    removeFromFront(batch.length);
    // More queued than one request holds — drain on the next tick.
    if (buffer.length > 0) void Promise.resolve().then(() => void tryFlush());
    return;
  }

  if (res.status >= 400 && res.status < 500) {
    // Terminal: bad key / malformed body. The server will always reject this —
    // drop it rather than retry-loop forever.
    console.warn(
      `[telemetry] flush rejected ${res.status} (terminal — dropping ${batch.length} event(s))`
    );
    removeFromFront(batch.length);
    return;
  }

  // 5xx — server-side transient. Keep the batch, retry next trigger.
  console.warn(`[telemetry] flush failed ${res.status} (will retry on next trigger)`);
}

function removeFromFront(n: number): void {
  buffer.splice(0, n);
}

// ─── Unload flush (terminal, beacon) ─────────────────────────────────────────

/**
 * Best-effort terminal flush on real page unload. Uses `sendBeacon` because
 * `fetch` (even with keepalive) is unreliable during unload. The page is going
 * away, so there is no retry: a `false` return is an accepted, logged loss.
 */
function flushViaBeacon(): void {
  const url = ingestUrl();
  if (!url || buffer.length === 0) return;
  if (typeof navigator === 'undefined' || typeof navigator.sendBeacon !== 'function') return;

  try {
    const batch = beaconBatchUnderCap();
    if (batch.length === 0) return;
    const body = JSON.stringify({ events: batch });
    // Beacons can't set headers → key travels as a query param. text/plain is a
    // CORS-safelisted content type → no preflight (beacons can't preflight).
    const key = ingestApiKey();
    const beaconUrl = key ? `${url}?k=${encodeURIComponent(key)}` : url;
    const blob = new Blob([body], { type: 'text/plain' });
    const ok = navigator.sendBeacon(beaconUrl, blob);
    if (ok) {
      removeFromFront(batch.length);
    } else {
      console.warn('[telemetry] sendBeacon returned false on unload (events lost — no retry)');
    }
  } catch (e) {
    console.warn('[telemetry] sendBeacon threw on unload', e);
  }
}

/** Take as many events from the front as fit under the beacon byte cap. */
function beaconBatchUnderCap(): LogRecord[] {
  let count = Math.min(buffer.length, MAX_EVENTS_PER_REQUEST);
  while (count > 0) {
    const candidate = buffer.slice(0, count);
    if (JSON.stringify({ events: candidate }).length <= BEACON_MAX_BYTES) return candidate;
    count = Math.floor(count / 2);
  }
  return [];
}

// ─── Lifecycle listeners (idempotent) ────────────────────────────────────────

function handleOnline(): void {
  void tryFlush();
}

function handleVisibilityChange(): void {
  // Tab hidden (mobile background / tab switch): flush via keepalive fetch so a
  // successful flush clears the buffer (avoids re-sending if the tab returns).
  if (typeof document !== 'undefined' && document.hidden) void tryFlush();
}

function handlePageHide(event: PageTransitionEvent): void {
  // Real unload → terminal beacon. bfcache freeze (`persisted: true`) will
  // resume and flush normally, so don't beacon (would double-send).
  if (!event.persisted) flushViaBeacon();
}

function startListening(): void {
  if (isListening) return;
  if (typeof window !== 'undefined') {
    window.addEventListener('online', handleOnline);
    window.addEventListener('pagehide', handlePageHide);
  }
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', handleVisibilityChange);
  }
  intervalTimer = setInterval(() => {
    if (buffer.length > 0) void tryFlush();
  }, FLUSH_INTERVAL_MS);
  isListening = true;
}

function stopListening(): void {
  if (!isListening) return;
  if (typeof window !== 'undefined') {
    window.removeEventListener('online', handleOnline);
    window.removeEventListener('pagehide', handlePageHide);
  }
  if (typeof document !== 'undefined') {
    document.removeEventListener('visibilitychange', handleVisibilityChange);
  }
  if (intervalTimer) {
    clearInterval(intervalTimer);
    intervalTimer = null;
  }
  isListening = false;
}

/** Test-only — reset all module state between cases. */
export function __resetLogQueueForTesting(): void {
  stopListening();
  buffer = [];
  flushInFlight = null;
  droppedTotal = 0;
  warnedNoUrl = false;
}

/** Test-only — inspect the current buffer length. */
export function __getLogQueueLengthForTesting(): number {
  return buffer.length;
}
