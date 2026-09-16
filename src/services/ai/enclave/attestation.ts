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
}

/** Test seam, matching `__resetVersionPolicyForTesting`. */
export function __resetEnclaveVerificationForTesting(): void {
  invalidateEnclaveVerification();
}

async function runVerification(signal?: AbortSignal): Promise<VerifiedEnclave> {
  const startedAt = Date.now();
  // Lazy, so ~575KB of verifier and crypto stays out of the main bundle and is fetched only by a
  // family that actually uses the managed AI tier.
  const { Verifier } = await import('@tinfoilsh/verifier');

  const verifier = new Verifier({ serverURL: ENCLAVE_URL, configRepo: CONFIG_REPO });

  // The SDK does not take a signal, so race it rather than let a hung verification consume the
  // caller's whole extraction budget.
  const timeout = signal
    ? AbortSignal.any([signal, AbortSignal.timeout(VERIFY_TIMEOUT_MS)])
    : AbortSignal.timeout(VERIFY_TIMEOUT_MS);
  const aborted = new Promise<never>((_, reject) => {
    timeout.addEventListener(
      'abort',
      () =>
        reject(
          new ExtractionProviderError('upstream_busy', 'Enclave verification timed out', undefined)
        ),
      { once: true }
    );
  });

  let result: { hpkePublicKey?: string; measurement?: unknown };
  try {
    result = (await Promise.race([verifier.verify(), aborted])) as typeof result;
  } catch (err) {
    if (err instanceof ExtractionProviderError) throw err;
    // The well-known fetch or the bundle lookup failed. Transient from the user's point of view,
    // so it reuses the EXISTING `upstream_busy`, which `useExtractionErrorToast` already renders
    // as a friendly retry with no error surface. No new code, no new string.
    reportError({
      surface: 'ai-enclave',
      severity: 'error',
      message: `enclave key fetch failed: ${err instanceof Error ? err.name : 'unknown'}`,
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
  if (pending && Date.now() - verifiedAt < VERIFY_TTL_MS) return pending;

  verifiedAt = Date.now();
  pending = runVerification(signal).catch((err) => {
    // A failed verification must not be cached, or one blip locks the tier out for ten minutes.
    invalidateEnclaveVerification();
    throw err;
  });
  return pending;
}
