/**
 * envelopeNeedsRecovery (Phase 4) — the pure predicate every password-prompting
 * surface checks BEFORE offering password entry: a kit-born envelope (empty
 * `wrappedKeys`, only recovery material) can never be opened by a password, and
 * `tryUnwrapFamilyKey` would throw its "No wrapped keys" error.
 */
import { describe, it, expect } from 'vitest';
import { envelopeNeedsRecovery } from '@/services/sync/fileSync';
import type { BeanpodFileV4 } from '@/types/syncFileV4';

function env(overrides: Partial<BeanpodFileV4> = {}): BeanpodFileV4 {
  return {
    version: '4.0',
    familyId: 'fam1',
    familyName: 'Test',
    keyId: 'k',
    wrappedKeys: {},
    passkeyWrappedKeys: {},
    inviteKeys: {},
    encryptedPayload: 'x',
    ...overrides,
  } as BeanpodFileV4;
}

describe('envelopeNeedsRecovery', () => {
  it('true for a kit-born envelope (no wraps, a recovery kit)', () => {
    expect(
      envelopeNeedsRecovery(
        env({ recoveryKeys: { k1: { salt: 's', wrapped: 'w', createdAt: 'c' } } })
      )
    ).toBe(true);
  });

  it('true for no wraps + a recovery passphrase', () => {
    expect(envelopeNeedsRecovery(env({ recoveryPassphrase: { salt: 's', wrapped: 'w' } }))).toBe(
      true
    );
  });

  it('false for a legacy envelope with password wraps — password entry stays correct', () => {
    expect(
      envelopeNeedsRecovery(
        env({
          wrappedKeys: { m1: { salt: 's', wrapped: 'w' } },
          recoveryKeys: { k1: { salt: 's', wrapped: 'w', createdAt: 'c' } },
        })
      )
    ).toBe(false);
  });

  it('false for an empty envelope with NO recovery material (corrupt/ancient) — not a recovery case', () => {
    expect(envelopeNeedsRecovery(env())).toBe(false);
  });
});
