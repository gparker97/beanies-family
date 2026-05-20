/**
 * Offline queue for Google Drive saves.
 *
 * When a Drive write() fails due to network error, the content is queued here.
 * Only the latest save is kept (each is a full file replacement).
 *
 * Four recovery paths trigger a flush attempt — the queue can be stuck
 * for any of these reasons, each with its own recovery signal:
 *
 *   - `startup`        — a provider attached at app boot with pending
 *                        content already restored from sessionStorage.
 *                        Usually the FIRST trigger on PWA cold-start.
 *   - `online`         — network came back from offline. Catches the
 *                        original "WiFi just reconnected" case.
 *   - `token-acquired` — silent refresh succeeded after auth was the
 *                        actual blocker (network was fine all along).
 *   - `visible`        — user returned to the tab. Catches edge cases
 *                        where neither network nor auth events fired
 *                        but conditions improved while the tab was
 *                        backgrounded.
 *
 * Concurrent triggers coalesce: only one flush runs at a time, the first
 * trigger's reason wins for the failure report. Without this, PWA
 * cold-start would fire 2-3 alerts per occurrence (one per trigger that
 * arrives during the startup window) — see #beanies-errors history.
 *
 * Persists to sessionStorage so queued saves survive page refreshes
 * (but not full browser restarts — session-scoped is appropriate).
 */
import type { StorageProvider } from './storageProvider';
import { onTokenAcquired, TokenExpiredError } from '@/services/google/googleAuth';
import { buildSilentRefreshAlertContext } from '@/services/google/silentRefreshAlertContext';
import { reportError } from '@/utils/errorReporter';

const SESSION_STORAGE_KEY = 'beanies_offline_queue';

// In-memory queue (only keeps latest)
let pendingContent: string | null = null;
let flushProvider: StorageProvider | null = null;
let isListening = false;

// Restore from sessionStorage on module load
try {
  const cached = sessionStorage.getItem(SESSION_STORAGE_KEY);
  if (cached) {
    pendingContent = cached;
    startListening();
  }
} catch {
  // Ignore — sessionStorage may not be available
}

/**
 * Enqueue content for offline save.
 * Replaces any previously queued content.
 */
export function enqueueOfflineSave(content: string): void {
  pendingContent = content;
  persistToSession();
  startListening();
  console.warn('[offlineQueue] Save queued for when connection resumes');
}

/**
 * Set the provider to use when flushing the queue.
 * Auto-flushes if there's pending content and we're online.
 */
export function setFlushProvider(provider: StorageProvider): void {
  flushProvider = provider;
  if (pendingContent && navigator.onLine) {
    tryFlush('startup');
  }
}

/**
 * Check if there's a pending offline save.
 */
export function hasPendingSave(): boolean {
  return pendingContent !== null;
}

/**
 * Flush the queued save.
 *
 * Returns `true` if the flush completed and the queue is now clear.
 * Returns `false` only when there is nothing to flush (no pending content
 * or no provider attached) — a no-op, not a failure.
 *
 * Throws the underlying error if the provider's `write()` rejects. Callers
 * are responsible for catching, classifying, and reporting. The queue is
 * left intact on failure for the next recovery trigger to retry.
 */
export async function flushQueue(): Promise<boolean> {
  if (!pendingContent || !flushProvider) return false;

  const content = pendingContent;
  await flushProvider.write(content);
  // Only clear if this specific content was flushed
  // (a newer save may have been queued during the flush)
  if (pendingContent === content) {
    pendingContent = null;
    clearFromSession();
  }
  console.log('[offlineQueue] Queued save flushed successfully');
  return true;
}

/**
 * Clear the queue (e.g. on disconnect).
 */
export function clearQueue(): void {
  pendingContent = null;
  clearFromSession();
  stopListening();
}

// --- sessionStorage helpers ---

function persistToSession(): void {
  if (!pendingContent) return;
  try {
    sessionStorage.setItem(SESSION_STORAGE_KEY, pendingContent);
  } catch {
    // Ignore — sessionStorage may not be available or quota exceeded
  }
}

function clearFromSession(): void {
  try {
    sessionStorage.removeItem(SESSION_STORAGE_KEY);
  } catch {
    // Ignore
  }
}

// --- Event listeners ---

let retryTimer: ReturnType<typeof setTimeout> | null = null;
let tokenAcquiredUnsub: (() => void) | null = null;
let visibilityHandler: (() => void) | null = null;

// Coalescing guard: only one flush attempt runs at a time. Triggers that
// arrive while a flush is already in flight (e.g. `token-acquired` and
// `visible` firing 10ms apart on PWA cold-start) share the existing
// attempt instead of stacking duplicate Drive writes and duplicate Slack
// alerts. The first trigger's reason wins for the failure report.
let flushInFlight: Promise<void> | null = null;

type FlushReason = 'online' | 'token-acquired' | 'visible' | 'startup';

/**
 * Surface a flush failure via console + reportError. Centralizes the
 * telemetry shape so all recovery hooks emit the same structure with the
 * only difference being the `reason` field — post-deploy Slack telemetry
 * can then show which recovery path produces the most stuck queues.
 *
 * The underlying error from `flushQueue` is always forwarded so the
 * Slack alert carries the real failure cause (token-rejected, drive 404,
 * network TypeError, etc.) instead of an opaque "flush returned false".
 *
 * The inner message is also concatenated into `input.message` because the
 * Slack alert format only renders `input.message` + `error.stack` — not
 * `error.message`. Without this, the Slack body reads "flush rejected
 * after visible" with no indication of WHY, and triages can't make a call
 * from the alert alone (see 2026-05-18 HK pilot cascade).
 */
function reportFlushFailure(reason: FlushReason, err: unknown): void {
  console.warn(`[offlineQueue] flush rejected (reason: ${reason})`, err);
  const inner = err instanceof Error ? err : new Error(String(err));
  // Attach silent-refresh diagnostic context when the flush rejection is
  // auth-driven — i.e. `getValidToken()` threw `TokenExpiredError` because
  // the underlying silent refresh failed. Matches the cold-start-reconnect
  // path (DRY: same `buildSilentRefreshAlertContext` source of truth). For
  // non-auth flush failures (Drive 404, generic NetworkError, etc.) the
  // diagnostic is irrelevant and would mislead — omit context entirely.
  const context =
    err instanceof TokenExpiredError
      ? (buildSilentRefreshAlertContext() as unknown as Record<string, unknown>)
      : undefined;
  reportError({
    surface: 'offline-queue-flush',
    message: `flush rejected after ${reason}: ${inner.message}`,
    error: inner,
    context,
  });
}

/**
 * Single entry point for all flush triggers. No-ops when there's nothing
 * to flush, no provider yet, or another flush is already in flight.
 *
 * Coalescing matters on PWA cold-start where multiple recovery triggers
 * fire within milliseconds: the first wins, the rest piggy-back on its
 * outcome silently — no duplicate writes, no duplicate alerts.
 */
function tryFlush(reason: FlushReason): void {
  if (!pendingContent || !flushProvider) return;
  if (flushInFlight) return;

  const p = flushQueue().then(
    () => {},
    (e) => reportFlushFailure(reason, e)
  );
  flushInFlight = p;
  void p.finally(() => {
    if (flushInFlight === p) flushInFlight = null;
  });
}

function handleOnline(): void {
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
  tryFlush('online');
  // Schedule a single 5s retry if the queue is still pending after this
  // attempt resolves. The retry goes back through `tryFlush`, which means
  // it'll coalesce with anything else triggered in that window.
  const settled = flushInFlight;
  if (!settled) return;
  void settled.then(() => {
    if (pendingContent) {
      retryTimer = setTimeout(() => {
        retryTimer = null;
        tryFlush('online');
      }, 5000);
    }
  });
}

function startListening(): void {
  if (isListening) return;
  window.addEventListener('online', handleOnline);

  // Auth recovery — flush even if the network never went offline.
  if (!tokenAcquiredUnsub) {
    tokenAcquiredUnsub = onTokenAcquired(() => tryFlush('token-acquired'));
  }

  // Tab return — retry stuck queue when user comes back. Some recovery
  // conditions (token expiring while tab was backgrounded; SW reload)
  // don't fire either online or tokenAcquired but DO change the
  // visibility state.
  if (!visibilityHandler && typeof document !== 'undefined') {
    visibilityHandler = () => {
      if (!document.hidden) tryFlush('visible');
    };
    document.addEventListener('visibilitychange', visibilityHandler);
  }

  isListening = true;
}

function stopListening(): void {
  if (!isListening) return;
  window.removeEventListener('online', handleOnline);
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
  if (tokenAcquiredUnsub) {
    tokenAcquiredUnsub();
    tokenAcquiredUnsub = null;
  }
  if (visibilityHandler && typeof document !== 'undefined') {
    document.removeEventListener('visibilitychange', visibilityHandler);
    visibilityHandler = null;
  }
  isListening = false;
}
