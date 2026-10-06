/**
 * Offline queue for Google Drive saves.
 *
 * When a Drive write() fails transiently (timeout / server / network) or on auth, the
 * save is queued here.
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
 * Persists a small MARKER to sessionStorage so a queued save survives a page refresh
 * (but not a full browser restart — session-scoped is appropriate). It used to persist
 * the whole multi-megabyte envelope, which the queue has not replayed since the resave
 * redesign below: pure quota pressure, and a quota failure silently lost the marker too.
 */
import type { StorageProvider } from './storageProvider';
import {
  onTokenAcquired,
  TokenExpiredError,
  whenRedirectAuthSettled,
} from '@/services/google/googleAuth';
import { buildSilentRefreshAlertContext } from '@/services/google/silentRefreshAlertContext';
import { reportError } from '@/utils/errorReporter';
import { logEvent } from '@/services/telemetry/logEvent';
import { assertNever } from '@/utils/assertNever';
import { TRANSIENT_FAILURES } from '@/utils/transientFailure';

const SESSION_STORAGE_KEY = 'beanies_offline_queue';

/**
 * Why the save could not reach the remote: every transient class the shared classifier
 * knows (`timeout` / `server` / `network`, `src/utils/transientFailure.ts`) plus `auth`.
 * Built FROM `TRANSIENT_FAILURES`, so a class added to the classifier is automatically a
 * valid, persisted queue reason (and `REQUEUE_OUTCOME` below forces its escalation
 * choice at compile time).
 *
 * `auth` is not "offline": the token was rejected and silent refresh failed, so the
 * queue will not drain until someone reconnects, and a flush that re-queues for that
 * reason is a FAILURE for the streak (it used to read as the benign "still offline" and
 * could never page). `timeout` is not "offline" either: see `'timeout-requeued'`.
 */
export const QUEUE_REASONS = [...TRANSIENT_FAILURES, 'auth'] as const;
export type QueueReason = (typeof QUEUE_REASONS)[number];

function isQueueReason(x: unknown): x is QueueReason {
  return (QUEUE_REASONS as readonly unknown[]).includes(x);
}

/**
 * The queued FACT: this device has unsaved work. Never the bytes (see `flushQueue`).
 * `null` = nothing queued.
 */
/**
 * `queuedAt` is when work was FIRST queued since the queue was last drained by a flush
 * (or `clearQueue`). Re-enqueues keep it, so a page can say how long the work has been
 * held ("queued since"). An ordinary landed save does not reset it (the marker is only
 * cleared by a flush), so it reads "queued since", never "unsaved since".
 */
let pendingMarker: { reason: QueueReason; queuedAt: string } | null = null;
let flushProvider: StorageProvider | null = null;
let isListening = false;

// Restore from sessionStorage on module load. Any non-empty value counts as "work is
// queued", including a LEGACY value that held the whole envelope; it is rewritten as a
// marker so the megabytes are released.
try {
  const cached = sessionStorage.getItem(SESSION_STORAGE_KEY);
  if (cached) {
    pendingMarker = parseMarker(cached);
    persistToSession();
    startListening();
  }
} catch {
  // Ignore — sessionStorage may not be available
}

function parseMarker(raw: string): { reason: QueueReason; queuedAt: string } {
  try {
    const m = JSON.parse(raw) as { v?: unknown; reason?: unknown; queuedAt?: unknown };
    if (
      m.v === 1 &&
      // The guard, not a hard-coded list: a persisted `'timeout'` marker must not be
      // silently degraded to `'network'` (which would also make it unpageable).
      isQueueReason(m.reason) &&
      typeof m.queuedAt === 'string'
    ) {
      return { reason: m.reason, queuedAt: m.queuedAt };
    }
  } catch {
    // A legacy envelope, or anything else: still a queued save.
  }
  return { reason: 'network', queuedAt: new Date().toISOString() };
}

/**
 * Record that a save could not reach the remote and must be re-run when it can.
 * The newest reason wins; the FIRST `queuedAt` is kept while a marker exists, so a
 * sustained-flush page reports how long the work has really been held (overwriting it
 * would print the time of the failed resave itself).
 */
export function enqueueOfflineSave(reason: QueueReason = 'network'): void {
  enqueueSeq += 1;
  pendingMarker = { reason, queuedAt: pendingMarker?.queuedAt ?? new Date().toISOString() };
  persistToSession();
  startListening();
  console.warn(`[offlineQueue] Save queued for when connection resumes (${reason})`);
}

/**
 * How many times anything has been queued, ever, in this session.
 *
 * ⚠️ A COUNTER, NOT A CONTENT COMPARISON, and the difference is the whole
 * reliability of two decisions below. Both ask "did something get queued while
 * we were saving?", and both used to answer it by comparing the pending string
 * to the one they started with — which is silently WRONG in the common case,
 * because a re-queue after a failed save writes the SAME serialized document
 * back. Identical bytes read as "nothing happened". A monotonic tick cannot be
 * fooled by equal content.
 */
let enqueueSeq = 0;

/**
 * How to re-save this device's CURRENT document.
 *
 * Registered by `syncService` alongside the provider. It must run the ordinary
 * save — read the remote, merge it, consult the lineage guard, serialize what
 * the document holds now — and return whether the save actually landed.
 * Returning `false` (rather than throwing) means "declined, already reported",
 * and leaves the queue intact for the next trigger.
 */
let resaveHandler: (() => Promise<boolean>) | null = null;

export function setResaveHandler(fn: (() => Promise<boolean>) | null): void {
  resaveHandler = fn;
}

/**
 * Set the provider to use when flushing the queue.
 * Auto-flushes if there's pending content and we're online.
 */
export function setFlushProvider(provider: StorageProvider): void {
  flushProvider = provider;
  if (pendingMarker && navigator.onLine) {
    tryFlush('startup');
  }
}

/**
 * Check if there's a pending offline save.
 */
export function hasPendingSave(): boolean {
  return pendingMarker !== null;
}

/**
 * What a flush attempt actually did. Six outcomes:
 *
 *   - `'flushed'`          — the resave landed; the streak resets.
 *   - `'nothing-to-flush'` — no marker or no provider (e.g. a sign-out inside the gate).
 *   - `'requeued'`         — the resave re-queued as `network` / `server`: offline or a
 *                            Google 5xx, which self-heals. Neutral.
 *   - `'timeout-requeued'` — the resave re-queued as `timeout`. Counted (see below).
 *   - `'auth-rejected'`    — the resave re-queued as `auth`. Counted.
 *   - `'declined'`         — the save path refused without re-queuing. Counted.
 *
 * ⚠️ AN OUTCOME, NOT A BOOLEAN, AND THAT IS THE FIX. `flushQueue` returned
 * `false` for two unrelated things — "there was nothing to flush" and "the save
 * path declined and the work is still stuck here" — and `tryFlush` reset the
 * failure streak on ANY resolution. So a permanently declining resave never
 * advanced `consecutiveFlushFailures`, `reportFlushFailure` never ran, and
 * `#beanies-errors` never paged for a queue holding unsaved family data. The two
 * falses have to be separable, and the consumer has to be exhaustive so a fifth
 * outcome fails the BUILD rather than landing silently in the reset arm.
 *
 * ⚠️ `'requeued'` IS THE THIRD FALSE, and leaving it folded into `'declined'`
 * turned this alert into a false alarm for every offline user. The save path
 * returns `false` for an offline write too — the provider catches the network
 * error, calls `enqueueOfflineSave` again and returns `{queued:true}` — so an
 * offline person who backgrounds and returns twice paged `#beanies-errors` with
 * a `critical`. That is the queue working exactly as designed. It is detected
 * WITHOUT guessing at `navigator.onLine` (which lies both ways): the save path
 * re-queued during our own flush, so the pending content is no longer the
 * content we started with.
 *
 * ⚠️ `'timeout-requeued'` IS SPLIT FROM `'requeued'` (#127). A timeout means this
 * device could not push this pod over this link inside the sized deadline. Unlike
 * offline it does NOT self-heal: a pod that has outgrown a device's uplink would show
 * "Waiting to Save" forever and never page. "A declining queue must page"
 * (`c5236555`), so it counts toward the flush streak like `'declined'` and pages at the
 * second consecutive one.
 */
export type FlushOutcome =
  'flushed' | 'nothing-to-flush' | 'requeued' | 'timeout-requeued' | 'auth-rejected' | 'declined';

/**
 * How a flush whose resave RE-QUEUED is classified, by the reason of the marker that
 * survived it. The question per class: does waiting fix it? `network` (offline) and
 * `server` (Google 5xx) self-heal, so they are neutral; `timeout` (this pod cannot cross
 * this link) and `auth` (the token was rejected) do not, so they count toward the page.
 *
 * ⚠️ A `Record`, NOT an "otherwise → requeued" default. A default would quietly make
 * any future class (e.g. `'throttle'`) neutral and unpageable, the exact silent drift
 * `c5236555` fixed; the `Record` forces the choice at compile time, like the provider's
 * `TRANSIENT_RETRIES`.
 *
 * The marker looked up is the newest one written during the flush window: by the
 * flush's own resave, or by an in-flight save that single-flight made it wait behind.
 * Both are this device failing to push, so both count; it is never a stale pre-flush
 * reason.
 */
const REQUEUE_OUTCOME: Record<QueueReason, 'requeued' | 'auth-rejected' | 'timeout-requeued'> = {
  network: 'requeued',
  server: 'requeued',
  timeout: 'timeout-requeued',
  auth: 'auth-rejected',
};

/**
 * Flush the queued save.
 *
 * Throws the underlying error if the resave rejects. Callers are responsible
 * for catching, classifying, and reporting. The queue is left intact on both
 * `'declined'` and a throw, for the next recovery trigger to retry.
 */
export async function flushQueue(): Promise<FlushOutcome> {
  if (!pendingMarker || !flushProvider) return 'nothing-to-flush';

  // ⚠️ RE-SAVE, NEVER REPLAY THE BYTES. This used to be
  // `await flushProvider.write(pendingContent)` — a blind write of a payload
  // serialized BEFORE the device went offline, straight over whatever the
  // family's file holds now.
  //
  // That is how an offline peer silently reverted a compaction for everyone,
  // and it bypassed every guard this subsystem has, because all of them live in
  // the SAVE path and this wrote around it. Observed in the field, 2026-09-07:
  //
  //   1. B goes offline, adds a to-do, save is queued.
  //   2. A compacts the pod (new lineage, smaller file).
  //   3. B comes online. The queue flushes B's PRE-COMPACTION document over
  //      A's compacted one. No read, no merge, no lineage check.
  //   4. A polls, correctly reads `ours-newer`, and republishes its compacted
  //      document over B's upload.
  //   5. B polls, and because B's own publish "succeeded" its baseline now
  //      matches its own document — context `clean` — so `adopt-remote × clean`
  //      ADOPTS. B's to-do is gone, with no rebase and no banner.
  //
  // Every step there is correct in isolation. The defect is step 3 writing
  // bytes that no longer describe anything true.
  //
  // So the queue no longer owns a payload to write; it owns the FACT that this
  // device has unsaved work. Resuming means re-running the ordinary save, which
  // reads the remote, merges it, consults the lineage guard, and serializes the
  // document as it stands NOW — the offline edit included.
  if (!resaveHandler) {
    // ⚠️ NO FALLBACK TO THE OLD WRITE. Replaying stale bytes is the bug; doing
    // it "just this once" because a handler is missing would reintroduce it on
    // exactly the paths nobody is watching. Keep the queue and say so — the
    // work is still on the device and the next trigger can retry.
    console.error(
      '[offlineQueue] No resave handler registered — refusing to replay stale bytes. ' +
        'The queued work is still on this device; it will be saved when the sync ' +
        'service registers its handler (syncService.setProvider).'
    );
    throw new Error('offlineQueue: no resave handler registered');
  }

  const seqBefore = enqueueSeq;
  const saved = await resaveHandler();
  if (!saved) {
    if (enqueueSeq !== seqBefore) {
      // The save ran, could not reach the remote, and re-queued. Whether that is the
      // offline path doing its job (neutral) or a stuck queue (counted) depends on WHY,
      // which the surviving marker records; see `REQUEUE_OUTCOME`. `?? 'network'` keeps
      // today's neutral `'requeued'` when a sign-out cleared the marker mid-resave.
      const outcome = REQUEUE_OUTCOME[pendingMarker?.reason ?? 'network'];
      console.warn(
        `[offlineQueue] Resave re-queued (${pendingMarker?.reason ?? 'cleared'}) → ${outcome}`
      );
      return outcome;
    }
    // The save path declined (a lineage block, a refused merge, an auth
    // failure). It has already classified and reported; the queue stays so the
    // next trigger retries rather than the work being dropped here.
    console.warn('[offlineQueue] Resave declined — keeping the queued work for a later retry');
    return 'declined';
  }
  // Only clear if nothing NEWER was queued while we were saving — asked through
  // the tick for the same reason as above: a newer edit that happens to
  // serialize to the same bytes must not read as "nothing was queued", or the
  // clear drops work that was only just added.
  clearMarkerIfUnchanged(seqBefore);
  console.log('[offlineQueue] Queued work re-saved through the normal save path');
  return 'flushed';
}

/**
 * Drop the marker, but only if nothing NEWER was queued since `seqAtStart` (asked
 * through the tick, never through the bytes: a newer edit that happens to serialize to
 * the same content must not read as "nothing was queued"). Shared by the flush path and
 * by an ordinary landed save (`noteSaveLanded`).
 */
function clearMarkerIfUnchanged(seqAtStart: number): boolean {
  if (enqueueSeq !== seqAtStart || !pendingMarker) return false;
  pendingMarker = null;
  clearFromSession();
  return true;
}

/** The enqueue tick now; pass it back to `noteSaveLanded` after the save lands. */
export function enqueueSeqNow(): number {
  return enqueueSeq;
}

/**
 * A landed save (ordinary OR the resave a flush runs: the resave handler is `save`, so a
 * successful flush reaches here first and `flushQueue`'s own clear is then a no-op) wrote a
 * full base that includes every edit made before it started, so any marker queued before
 * `seqAtStart` is satisfied. Without this an ordinary landed save left the marker in place: the
 * marker outlived the work it stood for: the next `visible` / `online` trigger re-uploaded
 * the whole pod with nothing unsaved, and under the counted `'timeout-requeued'` outcome a
 * slow link then produced a false "Waiting to Save" and a false sustained page for a
 * device with zero unsaved edits. The failure streak resets with the marker, for the same
 * reason `clearQueue` resets it: the queue is drained, so the next failure is a new streak.
 */
export function noteSaveLanded(seqAtStart: number): void {
  const reason = pendingMarker?.reason;
  if (!clearMarkerIfUnchanged(seqAtStart)) return;
  consecutiveFlushFailures = 0;
  console.log('[offlineQueue] Queued marker cleared by a landed save');
  logEvent({
    level: 'info',
    surface: 'offline-queue',
    message: 'queued marker cleared by a landed save',
    context: { action: 'marker-cleared-by-save', detail: reason ?? 'unknown' },
  });
}

/**
 * Clear the queue (e.g. on disconnect).
 */
export function clearQueue(): void {
  pendingMarker = null;
  consecutiveFlushFailures = 0; // nothing queued → no streak
  clearFromSession();
  stopListening();
}

// --- sessionStorage helpers ---

function persistToSession(): void {
  if (!pendingMarker) return;
  try {
    sessionStorage.setItem(
      SESSION_STORAGE_KEY,
      JSON.stringify({ v: 1, reason: pendingMarker.reason, queuedAt: pendingMarker.queuedAt })
    );
  } catch (e) {
    // Never silent (audit C12): without the marker a refresh forgets that unsaved work
    // exists. The in-memory queue still holds it for this page's life.
    logEvent({
      level: 'warn',
      surface: 'offline-queue',
      message: 'offline-queue marker could not be persisted',
      error: e instanceof Error ? e : undefined,
      context: {
        action: 'session-persist-failed',
        error_code: e instanceof Error ? e.name : 'unknown',
      },
    });
  }
}

function clearFromSession(): void {
  try {
    sessionStorage.removeItem(SESSION_STORAGE_KEY);
  } catch (e) {
    // A stale marker only causes one redundant resave after a refresh; logged, not fatal.
    logEvent({
      level: 'info',
      surface: 'offline-queue',
      message: 'offline-queue marker could not be cleared',
      context: {
        action: 'session-clear-failed',
        error_code: e instanceof Error ? e.name : 'unknown',
      },
    });
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
let flushInFlight: Promise<FlushOutcome | 'rejected'> | null = null;

// Sustained-only paging: a single flush failure is usually a reconnect-race
// transient that the next trigger / 5s retry clears. Only a queue that stays
// stuck across consecutive attempts is genuine unsaved-data risk worth a page.
let consecutiveFlushFailures = 0;
const FLUSH_FAILURE_PAGE_THRESHOLD = 2;

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
  consecutiveFlushFailures += 1;
  reportError({
    surface: 'offline-queue-flush',
    // Page exactly once when the queue crosses the sustained threshold (===):
    // unsaved user changes are genuinely stuck. Earlier/later failures are
    // telemetry-only (a single transient on reconnect shouldn't page).
    severity: consecutiveFlushFailures === FLUSH_FAILURE_PAGE_THRESHOLD ? 'critical' : undefined,
    message: `flush rejected after ${reason}${
      consecutiveFlushFailures >= FLUSH_FAILURE_PAGE_THRESHOLD
        ? ` (sustained ×${consecutiveFlushFailures})`
        : ''
    }: ${inner.message}`,
    error: inner,
    // No `consecutiveFailures` key: it is not in `ALLOWED_CONTEXT_KEYS`, so it
    // was dropped-with-console-warn on every flush failure. The count already
    // rides in `message` above as `(sustained ×N)`.
    context,
  });
}

/**
 * Triggers that can fire before the auth layer has finished settling.
 *
 * `startup` runs during boot, and `visible` fires on any tab return — including
 * the one immediately following an OAuth redirect, while `completeRedirectAuth`
 * is still exchanging the code for a token. Flushing then means
 * `getValidTokenSilent()` observes a half-initialised auth layer, throws
 * `TokenExpiredError`, and surfaces a reconnect prompt for a session that was
 * about to become perfectly healthy.
 *
 * `online` and `token-acquired` are NOT gated: the former is orthogonal to auth,
 * and the latter fires *because* a token was just acquired — gating it would
 * deadlock recovery behind the very thing it is recovering.
 */
const AUTH_GATED_REASONS: ReadonlySet<FlushReason> = new Set<FlushReason>(['startup', 'visible']);

/**
 * Single entry point for all flush triggers. No-ops when there's nothing
 * to flush, no provider yet, or another flush is already in flight.
 *
 * Coalescing matters on PWA cold-start where multiple recovery triggers
 * fire within milliseconds: the first wins, the rest piggy-back on its
 * outcome silently — no duplicate writes, no duplicate alerts. The auth gate
 * is inside `flushInFlight`, so a slow gate can't admit a second flush.
 */
function tryFlush(reason: FlushReason): void {
  if (!pendingMarker || !flushProvider) return;
  if (flushInFlight) return;

  // `whenRedirectAuthSettled` is non-throwing and bounded (20s timeout), and
  // resolves immediately when no redirect is in flight — so on the common path
  // this costs nothing. `flushQueue` re-checks `pendingMarker`/`flushProvider`,
  // so a sign-out during the gate is handled.
  const gate = AUTH_GATED_REASONS.has(reason) ? whenRedirectAuthSettled() : Promise.resolve();

  const p = gate.then(flushQueue).then(
    (outcome) => {
      switch (outcome) {
        case 'flushed':
          consecutiveFlushFailures = 0; // queue drained — streak resets
          return outcome;
        case 'nothing-to-flush':
          // A sign-out landed inside the auth gate. Reporting this as a failure
          // would manufacture a page for a queue that is legitimately empty.
          return outcome;
        case 'requeued':
          // Still offline. The work is safe, the queue holds it, and the next
          // trigger will try again. Neither a success (do not reset the streak,
          // or a genuine failure either side of it is forgotten) nor a failure.
          return outcome;
        case 'timeout-requeued':
          // The resave timed out again: this device cannot push this pod on this link,
          // and waiting does not fix that (#127). Counted, so the second consecutive one
          // pages; the message carries how long the work has been held. Only FLUSHES
          // advance the streak: ordinary saves that queue show "Waiting to Save" but never
          // page. The second counted flush must be an INDEPENDENT trigger (`visible`, a
          // later `online`, `token-acquired`, `startup`): `handleOnline` skips its own 5 s
          // retry after this outcome, so one reconnect cannot page by itself.
          reportFlushFailure(
            reason,
            new Error(
              `resave timed out — queued work still pending (queued since ${pendingMarker?.queuedAt ?? 'unknown'})`
            )
          );
          return outcome;
        case 'auth-rejected':
          // The token was rejected and silent refresh failed: waiting will not drain
          // this. Counted, and reported with the silent-refresh diagnostics.
          reportFlushFailure(
            reason,
            new TokenExpiredError('resave re-queued: token rejected — queued work still pending')
          );
          return outcome;
        case 'declined':
          // ⚠️ THE ARM THAT WAS MISSING. The save path refused (a lineage block,
          // a refused merge, an auth failure) and the work is STILL on this
          // device. It resolved rather than threw, so the old code read it as
          // success and zeroed the streak — the queue could stay stuck forever
          // without ever paging.
          reportFlushFailure(reason, new Error('resave declined — queued work still pending'));
          return outcome;
        default:
          return assertNever(outcome, 'offlineQueue.tryFlush');
      }
    },
    (e) => {
      reportFlushFailure(reason, e);
      return 'rejected' as const;
    }
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
  void settled.then((outcome) => {
    // Keyed on THIS flush's outcome, not on the marker: a `'timeout-requeued'` flush means
    // this link could not finish the upload within the sized deadline, so a retry 5 s
    // later on the same link is a wasted full upload AND would be the second counted
    // flush that pages (#127); the next real trigger (`visible`, a later `online`, a
    // token refresh, the next edit) retries it. Any other outcome (a reconnect-race auth
    // rejection, a neutral offline requeue) keeps the retry even when an older `timeout`
    // marker is what is queued, because that retry is exactly what clears those races.
    if (outcome === 'timeout-requeued') {
      console.warn('[offlineQueue] Skipping the 5 s retry after a timed-out resave');
      logEvent({
        level: 'info',
        surface: 'offline-queue',
        message: 'online retry skipped after a timed-out resave',
        context: { action: 'online-retry-skipped', detail: outcome },
      });
      return;
    }
    if (pendingMarker) {
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
