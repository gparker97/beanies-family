/**
 * Offline queue for Google Drive saves.
 *
 * When a Drive write() fails due to network error, the content is queued here.
 * Only the latest save is kept (each is a full file replacement).
 *
 * Three recovery paths trigger a flush attempt — the queue can be stuck
 * for any of three reasons, each with its own recovery signal:
 *
 *   - `online`         — network came back from offline. Catches the
 *                        original "WiFi just reconnected" case.
 *   - `token-acquired` — silent refresh succeeded after auth was the
 *                        actual blocker (network was fine all along).
 *   - `visible`        — user returned to the tab. Catches edge cases
 *                        where neither network nor auth events fired
 *                        but conditions improved while the tab was
 *                        backgrounded.
 *
 * Persists to sessionStorage so queued saves survive page refreshes
 * (but not full browser restarts — session-scoped is appropriate).
 */
import type { StorageProvider } from './storageProvider';
import { onTokenAcquired } from '@/services/google/googleAuth';
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
    flushQueue().catch(console.warn);
  }
}

/**
 * Check if there's a pending offline save.
 */
export function hasPendingSave(): boolean {
  return pendingContent !== null;
}

/**
 * Flush the queued save. Called automatically on 'online' event.
 */
export async function flushQueue(): Promise<boolean> {
  if (!pendingContent || !flushProvider) return false;

  const content = pendingContent;
  try {
    await flushProvider.write(content);
    // Only clear if this specific content was flushed
    // (a newer save may have been queued during the flush)
    if (pendingContent === content) {
      pendingContent = null;
      clearFromSession();
    }
    console.log('[offlineQueue] Queued save flushed successfully');
    return true;
  } catch (e) {
    console.warn('[offlineQueue] Flush failed, will retry on next online event:', e);
    return false;
  }
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

type FlushReason = 'online' | 'token-acquired' | 'visible';

/**
 * Surface a flush failure via console + reportError. Centralizes the
 * telemetry shape so all three recovery hooks emit the same structure
 * with the only difference being the `reason` field — post-deploy
 * Slack telemetry can then show which recovery path produces the
 * most stuck queues.
 */
function reportFlushFailure(reason: FlushReason, err?: unknown): void {
  console.warn(`[offlineQueue] flush rejected (reason: ${reason})`, err);
  reportError({
    surface: 'offline-queue-flush',
    message: `flush rejected after ${reason}`,
    error:
      err instanceof Error
        ? err
        : new Error(err ? String(err) : `flush returned false (${reason})`),
  });
}

/**
 * Single entry point for all flush triggers. No-ops when there's nothing
 * to flush or no provider yet (e.g. event fires before sync is initialized).
 *
 * `flushQueue` resolves to a boolean (it catches its own errors internally
 * and returns false on failure), so we check the resolved value rather
 * than relying on `.catch`. The defensive `.catch` is still there for
 * truly unexpected throws (provider lookup race, sessionStorage failure
 * inside flushQueue's own cleanup).
 */
function tryFlush(reason: FlushReason): void {
  if (!pendingContent || !flushProvider) return;
  flushQueue()
    .then((success) => {
      if (!success) reportFlushFailure(reason);
    })
    .catch((e) => reportFlushFailure(reason, e));
}

function handleOnline(): void {
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
  flushQueue()
    .then((success) => {
      if (success) return;
      reportFlushFailure('online');
      if (pendingContent) {
        retryTimer = setTimeout(() => {
          retryTimer = null;
          tryFlush('online');
        }, 5000);
      }
    })
    .catch((e) => reportFlushFailure('online', e));
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
