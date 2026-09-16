/**
 * Enclave verification: the memo, the classification, and the refusal.
 *
 * The classification case is the one that matters most. A FAILED VERIFICATION is the event this
 * module exists to detect — a rotated measurement, a broken root of trust, or an active MITM — and
 * an earlier version folded it in with a network blip, which would have told the family "beanies
 * AI is busy, try again in a moment" and paged nobody.
 *
 * `@tinfoilsh/verifier` is mocked throughout: the real thing makes six network requests across
 * four serial rounds and verifies a signature chain. The live path has its own proof, and it is
 * deliberately NOT a unit test — `scripts/spikes/enclave-attestation.mjs` runs the real verifier
 * against the real enclave, and is what you re-run when any of this changes.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const verify = vi.fn();
vi.mock('@tinfoilsh/verifier', () => ({
  Verifier: class {
    verify = verify;
  },
}));
vi.mock('@/utils/errorReporter', () => ({ reportError: vi.fn() }));
vi.mock('@/services/telemetry', () => ({ logEvent: vi.fn() }));

const OK = { hpkePublicKey: 'ed86fde6', measurement: {} };

/** The library signals a failed verification with this name; the classification keys on it. */
class AttestationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AttestationError';
  }
}

let mod: typeof import('../attestation');

beforeEach(async () => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  mod = await import('../attestation');
  mod.__resetEnclaveVerificationForTesting();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('verifyEnclave', () => {
  it('returns the attested HPKE key, which is the whole point', async () => {
    verify.mockResolvedValue(OK);
    const result = await mod.verifyEnclave();
    expect(result).toEqual({
      hpkePublicKey: 'ed86fde6',
      enclave: 'inference.tinfoil.sh',
      verified: true,
    });
  });

  it('verifies ONCE for two concurrent callers', async () => {
    verify.mockResolvedValue(OK);
    const [a, b] = await Promise.all([mod.verifyEnclave(), mod.verifyEnclave()]);
    expect(verify).toHaveBeenCalledTimes(1);
    expect(a).toEqual(b);
  });

  it('does NOT cache a failure — one blip must not disable the tier for the session', async () => {
    verify.mockRejectedValueOnce(new Error('network')).mockResolvedValue(OK);
    await expect(mod.verifyEnclave()).rejects.toBeTruthy();
    await expect(mod.verifyEnclave()).resolves.toMatchObject({ verified: true });
    expect(verify).toHaveBeenCalledTimes(2);
  });

  it('re-verifies once the TTL expires', async () => {
    vi.useFakeTimers();
    verify.mockResolvedValue(OK);
    await mod.verifyEnclave();
    vi.advanceTimersByTime(11 * 60_000);
    await mod.verifyEnclave();
    expect(verify).toHaveBeenCalledTimes(2);
  });

  it('re-verifies after invalidate, which is what a failed sealed request triggers', async () => {
    verify.mockResolvedValue(OK);
    await mod.verifyEnclave();
    mod.invalidateEnclaveVerification();
    await mod.verifyEnclave();
    expect(verify).toHaveBeenCalledTimes(2);
  });

  // ⚠️ The classification. `upstream_busy` renders as a friendly "busy, try again" toast with
  // deliberately NO error surface, so misclassifying here means a broken root of trust pages
  // nobody and tells the family to retry into it.
  it('classifies a FAILED VERIFICATION as attestation_failed, never as transient', async () => {
    verify.mockRejectedValue(new AttestationError('Code measurement mismatch'));
    await expect(mod.verifyEnclave()).rejects.toMatchObject({ code: 'attestation_failed' });
  });

  it('classifies an unreachable enclave as transient, because it is', async () => {
    verify.mockRejectedValue(new TypeError('fetch failed'));
    await expect(mod.verifyEnclave()).rejects.toMatchObject({ code: 'upstream_busy' });
  });

  it('refuses when verification passes but yields no key to encrypt to', async () => {
    verify.mockResolvedValue({ measurement: {} });
    await expect(mod.verifyEnclave()).rejects.toMatchObject({ code: 'attestation_failed' });
  });

  // One caller cancelling must not take another down with it. The work is shared; its lifetime
  // is not. An earlier version threaded the first caller's signal into the memo, so caller B —
  // still on screen, never cancelled — got a timeout it could not explain.
  it("does not let one caller's cancellation break another's", async () => {
    let release!: (v: unknown) => void;
    verify.mockReturnValue(new Promise((r) => (release = r)));

    const cancelled = new AbortController();
    const a = mod.verifyEnclave(cancelled.signal);
    const b = mod.verifyEnclave();
    a.catch(() => undefined);

    cancelled.abort();
    await expect(a).rejects.toBeTruthy();

    release(OK);
    await expect(b).resolves.toMatchObject({ verified: true });
  });
});
