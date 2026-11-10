import { describe, expect, it } from 'vitest';
import { alertEligible, alertTokenExp, mintAlertToken, signAlertToken } from './alertToken.mjs';

// ⚠️ THE GOLDEN VECTOR, shared with the verifier's suite
// (infrastructure/lambda/flight-status/__tests__/alertToken.test.mjs). If it fails here, the signer
// drifted from the verifier: fix the code, not the vector.
const GOLDEN_SECRET = 'golden-secret-0123456789abcdef0123456789abcdef';
const GOLDEN_EXP = 1767225600;
// eslint-disable-next-line no-secrets/no-secrets -- the golden vector: a test-only HMAC over a test-only secret
const GOLDEN_TOKEN = 'v1.1767225600.dICtDBR0aBeA-FvqZbvRrIw2US04o2s7lU-LLFB5gjM';

const HOUR = 3600;
const WEEK = 7 * 24 * HOUR;

describe('alert token signer', () => {
  it('signs the golden vector', () => {
    expect(signAlertToken(GOLDEN_SECRET, GOLDEN_EXP)).toBe(GOLDEN_TOKEN);
  });

  it('exp is the next whole UTC hour plus 7 days, shared by every mint in that hour', () => {
    const hour = Date.parse('2026-12-24T23:00:00Z');
    const expected = hour / 1000 + HOUR + WEEK;
    expect(alertTokenExp(hour)).toBe(expected);
    expect(alertTokenExp(hour + 1)).toBe(expected);
    expect(alertTokenExp(hour + HOUR * 1000 - 1)).toBe(expected);
    expect(alertTokenExp(hour + HOUR * 1000)).toBe(expected + HOUR);
    // Unlinkable: two mints in the same hour are byte-identical.
    expect(mintAlertToken(GOLDEN_SECRET, hour + 5_000)).toBe(
      mintAlertToken(GOLDEN_SECRET, hour + 3_000_000)
    );
    expect(mintAlertToken(GOLDEN_SECRET, hour)).toMatch(/^v1\.\d+\.[A-Za-z0-9_-]{43}$/);
  });

  it('a missing secret throws', () => {
    expect(() => signAlertToken('', GOLDEN_EXP)).toThrow(/secret is missing/);
  });
});

describe('alertEligible (mirrors the client isEntitled)', () => {
  it.each([
    [{ enforced: false, state: 'read_only' }, true],
    [{ enforced: true, state: 'trial' }, true],
    [{ enforced: true, state: 'beta' }, true],
    [{ enforced: true, state: 'active', plan: 'full' }, true],
    [{ enforced: true, state: 'active', plan: 'basic' }, false],
    [{ enforced: true, state: 'active', plan: null }, false],
    [{ enforced: true, state: 'read_only' }, false],
    [null, false],
    [undefined, false],
  ])('%j → %s', (entitlement, want) => {
    expect(alertEligible(entitlement)).toBe(want);
  });
});
