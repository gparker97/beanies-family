/**
 * envelopeNeedsRecovery (Phase 4) — the pure predicate every password-prompting
 * surface checks BEFORE offering password entry: a kit-born envelope (empty
 * `wrappedKeys`, only recovery material) can never be opened by a password, and
 * `tryUnwrapFamilyKey` would throw its "No wrapped keys" error.
 */
import { describe, it, expect } from 'vitest';
import {
  envelopeNeedsRecovery,
  envelopeCapabilities,
  UnlockFailedError,
} from '@/services/sync/fileSync';
import { isRemoteBlocker } from '@/types/sync';
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

describe('envelopeCapabilities', () => {
  const kit = { k1: { salt: 's', wrapped: 'w', createdAt: 'c' } };
  const phrase = { salt: 's', wrapped: 'w', createdAt: 'c' };
  const pw = { m1: { salt: 's', wrapped: 'w' } };

  it('reports each wrap kind independently', () => {
    expect(envelopeCapabilities(env())).toEqual({
      password: false,
      passphrase: false,
      kit: false,
    });
    expect(envelopeCapabilities(env({ wrappedKeys: pw }))).toMatchObject({ password: true });
    expect(envelopeCapabilities(env({ recoveryKeys: kit }))).toMatchObject({ kit: true });
    expect(envelopeCapabilities(env({ recoveryPassphrase: phrase }))).toMatchObject({
      passphrase: true,
    });
    expect(
      envelopeCapabilities(env({ wrappedKeys: pw, recoveryKeys: kit, recoveryPassphrase: phrase }))
    ).toEqual({ password: true, passphrase: true, kit: true });
  });

  it('still agrees with envelopeNeedsRecovery on every combination', () => {
    // The predicate is now DERIVED from capabilities, so this pins that the rewrite
    // changed no behaviour — including the case that matters most.
    for (const overrides of [
      {},
      { wrappedKeys: pw },
      { recoveryKeys: kit },
      { recoveryPassphrase: phrase },
      { wrappedKeys: pw, recoveryKeys: kit },
      { wrappedKeys: pw, recoveryPassphrase: phrase },
      { recoveryKeys: kit, recoveryPassphrase: phrase },
      { wrappedKeys: pw, recoveryKeys: kit, recoveryPassphrase: phrase },
    ]) {
      const e = env(overrides);
      const c = envelopeCapabilities(e);
      expect(envelopeNeedsRecovery(e)).toBe(!c.password && (c.kit || c.passphrase));
    }
  });

  it('an envelope with NO wraps at all is not "needs recovery" — offer sites must key on !password', () => {
    // The trap this whole change exists for. `envelopeNeedsRecovery` is FALSE here, so a
    // surface keyed on it falls through to a password form for a file no password can
    // open. Offer sites key on `!caps.password` instead.
    const e = env();
    expect(envelopeNeedsRecovery(e)).toBe(false);
    expect(envelopeCapabilities(e).password).toBe(false);
  });
});

describe('UnlockFailedError', () => {
  it('is NOT a RemoteBlocker — a wrong password must never latch the session breaker', () => {
    // THE guard. `isRemoteBlocker` duck-types on `blockCode` + `inlineMessageKey`, and
    // `decryptPendingFile` tests it BEFORE the credential check. An unlock error carrying
    // those fields would call `notePodUnopenable` and set `podUnopenableHere`, so one
    // typo would close the password form for the rest of the session.
    for (const e of [
      new UnlockFailedError('no-candidates', 'loginFlow.recoveryOnlyBody'),
      new UnlockFailedError('incorrect-secret', 'password.decryptionError'),
    ]) {
      expect(isRemoteBlocker(e)).toBe(false);
      expect('blockCode' in e).toBe(false);
      expect('inlineMessageKey' in e).toBe(false);
      expect(e.messageKey).toBeTruthy();
    }
  });
});
