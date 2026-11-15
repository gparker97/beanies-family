/**
 * Requirement 15: the envelope fingerprint the clean skip rests on. It must see an
 * in-place ROTATION of every key dict (a count, `keyDictSize`, cannot), the scalar
 * recovery passphrase, and any field added later; it must not see key order or the
 * payload.
 */
import { describe, it, expect } from 'vitest';
import type { BeanpodFileV4 } from '@/types/syncFileV4';
import {
  ENVELOPE_KEY_DICTS,
  envelopeFingerprint,
  type EnvelopeKeyDictField,
} from '../envelopeMerge';

const wrap = (wrapped: string) => ({ wrapped, createdAt: '2026-11-01T00:00:00.000Z' });

function envelope(): BeanpodFileV4 {
  const dicts = Object.fromEntries(
    (Object.keys(ENVELOPE_KEY_DICTS) as EnvelopeKeyDictField[]).map((f) => [
      f,
      { slot: wrap(`${f}-v1`) },
    ])
  );
  return {
    version: '4.0',
    familyId: 'fam',
    familyName: 'Fam',
    keyId: 'k',
    ...dicts,
    recoveryPassphrase: { ...wrap('pass-v1'), salt: 's' },
    encryptedPayload: 'payload-a',
  } as unknown as BeanpodFileV4;
}

describe('envelopeFingerprint', () => {
  it('is a sha-256 hex digest', async () => {
    expect(await envelopeFingerprint(envelope())).toMatch(/^[0-9a-f]{64}$/);
  });

  it.each(Object.keys(ENVELOPE_KEY_DICTS) as EnvelopeKeyDictField[])(
    'changes on an in-place rotation of %s (same slot, new wrap: the count is unchanged)',
    async (field) => {
      const before = envelope();
      const after = envelope();
      // eslint-disable-next-line security/detect-object-injection -- field is from the registry
      (after as unknown as Record<string, unknown>)[field] = { slot: wrap(`${field}-v2`) };
      expect(await envelopeFingerprint(after)).not.toBe(await envelopeFingerprint(before));
    }
  );

  it('changes on a rotation of recoveryPassphrase', async () => {
    const after = envelope();
    after.recoveryPassphrase = { ...after.recoveryPassphrase!, wrapped: 'pass-v2' };
    expect(await envelopeFingerprint(after)).not.toBe(await envelopeFingerprint(envelope()));
  });

  it('changes on an added field no registry knows about', async () => {
    const after = { ...envelope(), someFutureWrap: { x: 1 } } as BeanpodFileV4;
    expect(await envelopeFingerprint(after)).not.toBe(await envelopeFingerprint(envelope()));
  });

  it('is stable under key reordering, at the top and inside a dict', async () => {
    const a = envelope();
    a.inviteKeys = { first: wrap('i1'), second: wrap('i2') } as never;
    const reversed = Object.fromEntries(Object.entries(a).reverse()) as unknown as BeanpodFileV4;
    reversed.inviteKeys = { second: wrap('i2'), first: wrap('i1') } as never;
    expect(await envelopeFingerprint(reversed)).toBe(await envelopeFingerprint(a));
  });

  it('ignores the payload', async () => {
    const b = { ...envelope(), encryptedPayload: 'a-completely-different-payload' };
    expect(await envelopeFingerprint(b)).toBe(await envelopeFingerprint(envelope()));
  });

  it('takes the canonical text at the call: a later in-place change cannot leak in', async () => {
    const env = envelope();
    const pending = envelopeFingerprint(env);
    env.inviteKeys = { late: wrap('late') } as never;
    expect(await pending).toBe(await envelopeFingerprint(envelope()));
  });
});
