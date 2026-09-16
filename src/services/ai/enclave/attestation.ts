/**
 * Verify the AI enclave before a single document byte leaves the device (#49, ADR-030 Gate 3).
 *
 * WHAT "VERIFY" MEANS HERE, because the word does a lot of work. Tinfoil runs the model on AMD
 * hardware that emits a signed report naming exactly what code is running inside a sealed VM.
 * `@tinfoilsh/verifier` checks that report against the measurement published in Tinfoil's config
 * repo, and hands back the enclave's HPKE public key BOUND TO that measurement. So encrypting to
 * this key is what makes "only the attested enclave can read it" a fact rather than a promise.
 *
 * Until this shipped we took the enclave's word for it: the Lambda read a `tinfoil-enclave` header
 * carrying a NAME and passed the string along, and `AttestationInfo.verified` was defined and
 * never set by anything.
 *
 * ⚠️ FAILURE NEVER DEGRADES TO A PLAINTEXT SEND. There is no fallback path, by construction: the
 * caller cannot obtain a key without verifying, so an unverified enclave simply has nothing to
 * encrypt to.
 */

import { ExtractionProviderError } from '../types';
import { raceCallerSignal } from '../callerSignal';
import { reportError } from '@/utils/errorReporter';
import { logEvent } from '@/services/telemetry';

/** Tinfoil's inference endpoint. The scheme is REQUIRED; a bare host throws a bare "Invalid URL". */
const ENCLAVE_URL = 'https://inference.tinfoil.sh';

/**
 * TINFOIL'S repo, not ours. Its signed releases publish the expected enclave measurement, which is
 * what the attestation is checked against — so this constant is the root of trust for the whole
 * feature, and changing it changes what we are willing to believe.
 *
 * Verified end to end on 2026-09-16 by `scripts/spikes/enclave-attestation.mjs`, which is kept for
 * re-running whenever the enclave, this repo or the verifier version changes.
 */
const CONFIG_REPO = 'tinfoilsh/confidential-model-router';

/**
 * Verification is one round trip, so a SHORT ttl is close to free and bounds how long a key
 * rotation can bite. `versionPolicy.ts`'s memo comment is both the precedent and the warning:
 * this caches for the life of the PROCESS, and on iOS a phone that is only ever backgrounded and
 * resumed can hold a process for days.
 */
const VERIFY_TTL_MS = 10 * 60_000;

/** Verification must not silently eat the caller's extraction budget. */
const VERIFY_TIMEOUT_MS = 10_000;

export interface VerifiedEnclave {
  /** Hex HPKE public key, bound to the attested measurement. Feeds `Identity.fromPublicKeyHex`. */
  hpkePublicKey: string;
  /** Human-readable enclave identity, for the result's `AttestationInfo`. */
  enclave: string;
  /** Always true. Present so a caller cannot forget to check, and reads honestly at the call site. */
  verified: true;
}

/**
 * The in-flight promise, not just the settled value.
 *
 * Caching the PROMISE is what makes two concurrent reads verify once rather than twice. Cleared on
 * failure so a transient outage cannot poison the rest of the session.
 */
let pending: Promise<VerifiedEnclave> | null = null;
let verifiedAt = 0;
/**
 * Is the memoised promise still running?
 *
 * ⚠️ Needed because `verifiedAt` is stamped on COMPLETION (stamping at the start let a slow
 * verification spend its own TTL). While in flight `verifiedAt` is therefore still 0, so a TTL
 * check alone reads as "expired" and every concurrent caller starts its OWN verification — which
 * is precisely the thing the memo exists to prevent, and it fails silently because each caller
 * still gets a correct answer. Caught by the concurrency test.
 */
let inFlight = false;

/**
 * Drop the memo so the next call re-verifies.
 *
 * Called by the provider after ANY failed sealed request, deliberately not only after a
 * stale-key-shaped one. We have never observed what a rotation looks like on the wire, and
 * classifying a failure nobody has seen is how you write a branch nobody can test. Clearing
 * unconditionally covers every shape, costs one extra verification after a failure that already
 * cost the user a retry, and has no re-entrancy at all.
 */
export function invalidateEnclaveVerification(): void {
  pending = null;
  verifiedAt = 0;
  inFlight = false;
}

/** Test seam, matching `__resetVersionPolicyForTesting`. */
export function __resetEnclaveVerificationForTesting(): void {
  invalidateEnclaveVerification();
}

/**
 * The shared verification. Deliberately takes NO caller signal.
 *
 * ⚠️ Threading a per-caller signal into a memoised promise produced two bugs. An already-aborted
 * signal made `AbortSignal.any([aborted, timeout])` return an already-aborted signal, so the
 * listener below never fired and the 10-second budget silently became unbounded — and
 * `verifier.verify()` is not cheap (six requests over four serial rounds, each retried with
 * backoff, then signature verification on the main thread). And the memo bound every later caller
 * to the FIRST caller's cancellation: caller A cancels, caller B — still on screen, never
 * cancelled — gets a timeout error it cannot explain. The work is shared, so its lifetime must be
 * shared too; each caller races the memo against its own signal at the call site instead.
 */
async function runVerification(): Promise<VerifiedEnclave> {
  const startedAt = Date.now();
  // Lazy, so the verifier and its crypto stay out of the main bundle and are not FETCHED until a
  // family actually runs a managed extraction. Verified in a browser, not inferred from the build:
  // a cold load makes 87 requests and none of them is a crypto chunk. Now also pinned by
  // `scripts/checkCryptoChunk.mjs`, so a regression fails the build rather than waiting for
  // someone to re-check by hand.
  //
  // ⚠️ "Not fetched on load" is not the same as "not downloaded". Workbox's `globPatterns` sweeps
  // every built .js into the service-worker precache, so an installed PWA does pull these bytes
  // once at SW install. That is the honest description and it is fine — this app is offline-first,
  // so caching a chunk the family might need is the behaviour we want.
  //
  // An earlier attempt to exclude it from the precache via a named `manualChunks` entry made
  // things WORSE and is recorded here so nobody retries it: the manual chunk became the host of
  // Vite's own shared runtime helpers (`__vite__mapDeps` and friends), so every page chunk then
  // depended on it and it was modulepreloaded on every cold load. Do not reach for the bundler to
  // make a comment true; fix the comment.
  const { Verifier } = await import('@tinfoilsh/verifier');

  const verifier = new Verifier({ serverURL: ENCLAVE_URL, configRepo: CONFIG_REPO });

  // The SDK takes no signal, so race it against our own deadline rather than let a hung
  // verification consume the caller's whole extraction budget.
  const timeout = AbortSignal.timeout(VERIFY_TIMEOUT_MS);
  const aborted = new Promise<never>((_, reject) => {
    const fail = () =>
      reject(
        new ExtractionProviderError('upstream_busy', 'Enclave verification timed out', undefined)
      );
    // The fast path matters: a signal that is ALREADY aborted never fires `abort` again, so a
    // listener alone would wait forever on it.
    if (timeout.aborted) fail();
    else timeout.addEventListener('abort', fail, { once: true });
  });

  let result: { hpkePublicKey?: string; measurement?: unknown };
  try {
    result = (await Promise.race([verifier.verify(), aborted])) as typeof result;
  } catch (err) {
    if (err instanceof ExtractionProviderError) throw err;

    // ⚠️ THE DISCRIMINATION MATTERS MORE THAN ANYTHING ELSE IN THIS FILE, and an earlier version
    // got it backwards. `@tinfoilsh/verifier` signals a FAILED VERIFICATION with `AttestationError`
    // ("Code measurement mismatch", "Report signature or certificate chain is invalid", "HPKE key
    // mismatch", "Certificate domain mismatch"). Those are the events this module exists to
    // detect: a rotated measurement, a broken root of trust, or an active MITM. Folding them in
    // with a network blip would tell the family "beanies AI is busy, try again in a moment" and
    // page nobody — the single worst outcome available here.
    //
    // A FetchError or ConfigurationError, by contrast, genuinely is transient or ours to fix.
    const name = err instanceof Error ? err.name : 'unknown';
    const isVerificationFailure = name === 'AttestationError';

    if (isVerificationFailure) {
      console.error(
        '[ai-enclave] the enclave attestation FAILED to verify, so nothing was sent. This is not ' +
          'a network problem: either Tinfoil rotated the enclave measurement, the configRepo in ' +
          'this file is stale, or the connection is being tampered with. Re-run ' +
          'scripts/spikes/enclave-attestation.mjs before assuming the first.'
      );
      reportError({
        surface: 'ai-enclave',
        severity: 'critical',
        message: `attestation verification failed, send refused: ${name}`,
        context: { error_code: 'attestation_failed' },
        error: err,
      });
      throw new ExtractionProviderError(
        'attestation_failed',
        'The AI enclave could not be verified',
        err
      );
    }

    // The well-known fetch or the bundle lookup failed. Transient from the user's point of view,
    // so it reuses the EXISTING `upstream_busy`, which `useExtractionErrorToast` already renders
    // as a friendly retry with no error surface. No new code, no new string.
    reportError({
      surface: 'ai-enclave',
      severity: 'error',
      message: `enclave key fetch failed: ${name}`,
      context: { error_code: 'upstream_busy' },
      error: err,
    });
    throw new ExtractionProviderError(
      'upstream_busy',
      'Could not reach the AI enclave to verify it',
      err
    );
  }

  const hpkePublicKey = typeof result?.hpkePublicKey === 'string' ? result.hpkePublicKey : '';
  if (!hpkePublicKey) {
    // Verification "succeeded" but produced nothing to encrypt to. Treated as a hard failure
    // rather than a soft one: proceeding would mean sending to an unverified key, which is the
    // exact thing this module exists to prevent.
    console.error(
      '[ai-enclave] the attestation verified but carried no HPKE public key. Check that ' +
        `${CONFIG_REPO} still publishes the measurement for ${ENCLAVE_URL}, and re-run ` +
        'scripts/spikes/enclave-attestation.mjs to see the live result shape.'
    );
    reportError({
      surface: 'ai-enclave',
      severity: 'critical',
      message: 'attestation verification failed, send refused: no hpke key on the result',
      context: { error_code: 'attestation_failed' },
    });
    throw new ExtractionProviderError(
      'attestation_failed',
      'The AI enclave did not present a verifiable encryption key'
    );
  }

  const enclave = new URL(ENCLAVE_URL).host;
  // Success-path signal, so the verification RATE and cost are both measurable rather than only
  // its failures. Emitted on a real verification only, never a memo hit, so this is one event per
  // ten minutes of use rather than one per extraction. Duration and enclave ride in `message`:
  // the firehose context is an allowlist, and adding keys would drag in the store declarations.
  logEvent({
    level: 'info',
    surface: 'ai-enclave',
    message: `attestation verified in ${Date.now() - startedAt}ms (enclave=${enclave})`,
    context: { action: 'verify' },
  });

  return { hpkePublicKey, enclave, verified: true };
}

/**
 * Verify the enclave, or throw. Memoised for {@link VERIFY_TTL_MS}.
 *
 * Throws {@link ExtractionProviderError} with `attestation_failed` when verification did not pass
 * (a critical report, because a user action failed and nothing was sent) or `upstream_busy` when
 * the enclave could not be reached (transient, telemetry only, never a page).
 */
export function verifyEnclave(signal?: AbortSignal): Promise<VerifiedEnclave> {
  if (!pending || (!inFlight && Date.now() - verifiedAt >= VERIFY_TTL_MS)) {
    inFlight = true;
    pending = runVerification()
      .then((result) => {
        // Stamped on COMPLETION, not on start. Stamping at the start meant a slow verification
        // spent its own TTL before anyone could use it.
        verifiedAt = Date.now();
        inFlight = false;
        return result;
      })
      .catch((err) => {
        // A failed verification must not be cached, or one blip locks the tier out for ten minutes.
        invalidateEnclaveVerification();
        throw err;
      });
  }

  // Each caller races the SHARED work against its OWN signal, so cancelling one extraction never
  // cancels or poisons another's. The shared promise keeps running for whoever is still waiting.
  //
  // This used to be an inline `Promise.race` here. It was extracted because `enclaveModel` was
  // written WITHOUT it and reintroduced the exact bug this function's comments warn about — the
  // reasoning was documented in one place and the mechanism lived in another, so the next
  // memoised thing got it wrong. One implementation, nowhere left to diverge.
  return raceCallerSignal(pending, signal);
}
