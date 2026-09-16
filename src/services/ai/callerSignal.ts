import { ExtractionProviderError } from './types';

/**
 * Marks an error as "this caller cancelled", as opposed to anything going wrong.
 *
 * ⚠️ Needed because the two are indistinguishable by code alone and must be handled oppositely.
 * `managedProvider.run()`'s catch clears the attestation and model memos after any failed sealed
 * request — deliberately, because we have never observed what a Tinfoil key rotation looks like
 * on the wire. But a cancellation is not a failed request: treating it as one means a family who
 * opens the reader, backs out, and opens it again destroys both shared memos and pays a full
 * fresh SEV-SNP verification plus a second config round trip, which is the exact cost this
 * module was extracted to prevent.
 */
const CANCELLED = Symbol('beanies.extraction.cancelled');

/** Did this error come from a caller cancelling, rather than from anything being wrong? */
export function isCancellation(err: unknown): boolean {
  return Boolean(err && typeof err === 'object' && CANCELLED in err);
}

/**
 * Tag an error as a caller cancellation.
 *
 * Exported because `raceCallerSignal` is not the only place one arises: an abort during the
 * sealed POST surfaces as a `DOMException` from `fetch`, and that is the long leg — the only
 * cancellation window a person realistically hits, since the memo lookups this module wraps are
 * instant after the first read of a session.
 */
export function markCancelled<T extends object>(err: T): T {
  Object.defineProperty(err, CANCELLED, { value: true, enumerable: false });
  return err;
}

function cancellationError(): ExtractionProviderError {
  return markCancelled(new ExtractionProviderError('timeout', 'Extraction cancelled', undefined));
}

/**
 * Race one caller's cancellation against a promise SHARED by several callers.
 *
 * ⚠️ WHY THIS EXISTS RATHER THAN A SIGNAL PARAMETER. Two things in the managed tier are
 * memoised across concurrent extractions: the enclave attestation and the model-id lookup. The
 * obvious shape — thread the caller's `AbortSignal` into the memoised work — is wrong twice
 * over, and this codebase has now written that bug twice:
 *
 *  1. The memo captures the FIRST caller's signal, so every later caller awaiting the same
 *     promise is silently bound to a request that may already be gone. A family who opens the
 *     reader, backs out, and opens it again cancels the first extraction and the second one
 *     fails on a signal belonging to the first.
 *  2. An already-aborted signal makes `AbortSignal.any([aborted, timeout])` return an
 *     already-aborted signal, so the shared work never even starts.
 *
 * The fix is to keep the shared work signal-free — it has its own deadline — and let each
 * caller race it here instead. Cancelling one extraction then cancels exactly one extraction,
 * and whoever is still waiting keeps waiting on work that is still running.
 *
 * `attestation.ts` carried the original inline copy of this; `enclaveModel` was written without
 * it and reintroduced the bug. One implementation, so there is nowhere left to reintroduce it.
 */
export function raceCallerSignal<T>(shared: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return shared;
  if (signal.aborted) {
    // ⚠️ Adopt the shared promise's rejection before walking away. Both call sites have ALREADY
    // started the work by the time we get here — `verifyEnclave` assigned `pending`, and
    // `raceCallerSignal(enclaveModel(), …)` started the config round trip — and both inner
    // handlers re-throw. Returning without subscribing leaves that rejection unhandled, so a
    // network blip or a real AttestationError during a cancelled extraction fires
    // `window.onunhandledrejection` and files a MISATTRIBUTED enclave failure in the firehose
    // for a cancellation we handled correctly. The inline `Promise.race` this replaced always
    // had `shared` in the array, so it never had this hole; the early return introduced it.
    void shared.catch(() => {});
    return Promise.reject(cancellationError());
  }

  // ⚠️ The listener is REMOVED once the race settles. `Promise.race` leaves the losing side
  // pending forever, so a listener added and never taken off accumulates one entry per
  // extraction on a signal the caller may keep for its whole lifetime — and this function is
  // called twice per extraction (attestation, then the model lookup) on the same signal.
  let onAbort: (() => void) | undefined;
  const cancelled = new Promise<never>((_, reject) => {
    onAbort = () => reject(cancellationError());
    signal.addEventListener('abort', onAbort, { once: true });
  });

  return Promise.race([shared, cancelled]).finally(() => {
    if (onAbort) signal.removeEventListener('abort', onAbort);
  });
}
