/**
 * KDF parameters — the ONE definition of every PBKDF2 iteration count, and the ONE place
 * that runs PBKDF2 (ADR-041, "KDF parameters travel with the data").
 *
 * Every wrap written from this build onward records the count it was made with
 * (`iterations` on `WrappedMemberKey` / `RecoveryKeyPackage` / `InviteKeyPackage`), and
 * every reader derives with the RECORDED count (`recordedIterations`). A record with no
 * count predates the field and was made with `LEGACY_ITERATIONS`. That is what makes the
 * next cost change a constant bump instead of a format migration.
 *
 * ⚠️ PURE BY DESIGN. The only import is `logEvent`. No gate read, no stores, no
 * Capacitor: the doc worker imports `familyKeyService`, which imports this module, so
 * anything added here lands in the worker's graph too. The write POLICY for the `secret`
 * profile (which count a new wrap gets) lives in `kdfWriteGate.ts`, never here.
 */

import { logEvent } from '@/services/telemetry/logEvent';

/**
 * The derivation profiles, one per kind of secret, each with the reason for its count.
 * Changing a count here changes only what NEW writes use; readers always honour the
 * count a record carries.
 */
export const KDF_PROFILES = {
  /**
   * 600,000. Human-chosen secrets that guard an IN-THE-CLEAR wrap: member passwords
   * (`wrappedKeys`) and the family recovery passphrase (`recoveryPassphrase`). These are
   * the wraps an attacker holding a leaked `.beanpod` grinds offline with no rate limit,
   * so the iteration count is real security here (OWASP PBKDF2-HMAC-SHA256 guidance).
   * Writers go through `kdfWriteGate.secretWriteIterations()`, never this constant
   * directly, because a stale client heals an unreadable wrap down to legacy.
   */
  secret: 600_000,
  /**
   * 100,000. `passwordHash` and `pinHash` inside the encrypted doc: iterations only
   * matter once the family key is already lost; keeping the count (and the `salt:hash`
   * format) means every shipped client keeps verifying them. Also keeps the wall PIN
   * pad's per-adult cost unchanged.
   */
  docHash: 100_000,
  /**
   * 100,000. Recovery kit codes, invite / device-link / magic-link tokens: at least 128
   * bits of real entropy, so the entropy carries the load and the count is a
   * parity/latency choice, not a security one.
   */
  highEntropy: 100_000,
  /**
   * 210,000. `deviceUnlock.ts`'s `hkdf+pbkdf2` mode: the PIN stretch used only when the
   * device secret had to be stored as extractable bytes. Moved here unchanged.
   */
  deviceFallback: 210_000,
} as const;

export type KdfProfile = keyof typeof KDF_PROFILES;

/**
 * `untracked`: skip the `kdf_derive` row. ONLY for measurement that must not land in the
 * fleet distribution (the dev benchmark page). Production call sites never pass it.
 */
export type DeriveOptions = { untracked?: true };

/** What any stored wrap with NO recorded `iterations` was made with. */
export const LEGACY_ITERATIONS = 100_000;

/**
 * Upper bound on a recorded count. A record is attacker-writable (it sits in the clear
 * in the envelope), so an absurd count must be refused rather than honoured: honouring
 * it would pin the device's crypto thread for minutes on every sign-in attempt.
 */
const MAX_RECORDED_ITERATIONS = 10_000_000;

/** The parameters one derivation runs with: which profile (for telemetry) and the count. */
export type KdfParams = { profile: KdfProfile; iterations: number };

/** A record's `iterations` is present but unusable (not a positive integer, or too large). */
export class KdfParamsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'KdfParamsError';
  }
}

/**
 * The count a stored record was made with.
 *
 * - Absent (`undefined`) → `LEGACY_ITERATIONS`: the record predates the field.
 * - A positive integer ≤ 10,000,000 → that count.
 * - Anything else THROWS `KdfParamsError`. A record that carries a count was never
 *   legacy, so guessing 100k could only ever produce a false "wrong password"; the
 *   upper bound is the DoS guard.
 */
export function recordedIterations(record: { iterations?: unknown }): number {
  const value = record.iterations;
  if (value === undefined) return LEGACY_ITERATIONS;
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value <= 0 ||
    value > MAX_RECORDED_ITERATIONS
  ) {
    throw new KdfParamsError(`recorded iterations are not usable: ${String(value)}`);
  }
  return value;
}

const WRAP_ALGO = 'AES-KW';
const WRAP_KEY_BITS = 256;

/**
 * The one PBKDF2-SHA256 core. Owns `importKey`, the timing and the single `kdf_derive`
 * telemetry row, so no derivation site can forget any of them.
 *
 * Timing uses `performance.now()` directly and NOT `perfTiming`: perfTiming can carry
 * neither `kind`/`count` nor a sub-250 ms sample, and its ≥ 250 ms escalation would add
 * a second, `warn`-level row on every low-end-phone derivation.
 */
async function runPbkdf2<T>(
  secret: BufferSource,
  salt: Uint8Array,
  params: KdfParams,
  derive: (material: CryptoKey, algorithm: Pbkdf2Params) => Promise<T>,
  opts: DeriveOptions = {}
): Promise<T> {
  const start = performance.now();
  const material = await crypto.subtle.importKey('raw', secret, 'PBKDF2', false, [
    'deriveBits',
    'deriveKey',
  ]);
  const result = await derive(material, {
    name: 'PBKDF2',
    // The VIEW, never `.buffer`: a subarray salt must not drag its whole backing buffer in.
    salt: salt as BufferSource,
    iterations: params.iterations,
    hash: 'SHA-256',
  });
  const durationMs = Math.round(performance.now() - start);

  if (import.meta.env.DEV) {
    // eslint-disable-next-line no-console -- deliberate dev perf instrumentation, mirrors perfTiming's [perf] lines
    console.info(`[perf] kdf.derive: ${durationMs}ms (${params.profile}, ${params.iterations})`);
  }
  // Main thread only: the doc worker imports familyKeyService (for encryptPayload /
  // decryptPayload) and therefore this module, and `logEvent`'s queue must never be
  // enqueued from a Worker (same guard as `perfTiming.record`).
  if (typeof window !== 'undefined' && !opts.untracked) {
    logEvent({
      level: 'info',
      surface: 'kdf',
      message: 'kdf_derive',
      context: {
        perf_op: 'kdf.derive',
        perf_duration_ms: durationMs,
        kind: params.profile,
        count: params.iterations,
      },
    });
  }
  return result;
}

/**
 * Derive a non-extractable AES-KW-256 wrapping key (`wrapKey` / `unwrapKey`). Used by the
 * member, passphrase, invite/link and recovery-kit wraps.
 */
export function derivePbkdf2Key(
  secret: BufferSource,
  salt: Uint8Array,
  params: KdfParams,
  opts: DeriveOptions = {}
): Promise<CryptoKey> {
  return runPbkdf2(
    secret,
    salt,
    params,
    (material, algorithm) =>
      crypto.subtle.deriveKey(
        algorithm,
        material,
        { name: WRAP_ALGO, length: WRAP_KEY_BITS },
        false,
        ['wrapKey', 'unwrapKey']
      ),
    opts
  );
}

/** Derive `bits` raw bits. Used by the doc-side password/PIN hash and the device PIN stretch. */
export function derivePbkdf2Bits(
  secret: BufferSource,
  salt: Uint8Array,
  params: KdfParams,
  bits: number
): Promise<Uint8Array> {
  return runPbkdf2(secret, salt, params, async (material, algorithm) => {
    return new Uint8Array(await crypto.subtle.deriveBits(algorithm, material, bits));
  });
}
