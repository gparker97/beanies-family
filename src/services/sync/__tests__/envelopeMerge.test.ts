import { describe, it, expect } from 'vitest';
import { mergeKeyDict, preserveLocalKeyDicts } from '@/services/sync/envelopeMerge';
import type { BeanpodFileV4 } from '@/types/syncFileV4';

// Helper: build a minimal envelope. Tests only care about the three key
// dicts; the rest is structural padding.
function buildEnvelope(overrides: Partial<BeanpodFileV4> = {}): BeanpodFileV4 {
  return {
    version: '4.0',
    familyId: 'fam-1',
    familyName: 'Test',
    keyId: 'k1',
    wrappedKeys: {},
    passkeyWrappedKeys: {},
    inviteKeys: {},
    encryptedPayload: 'payload',
    ...overrides,
  };
}

describe('mergeKeyDict', () => {
  it('returns undefined when both sides are undefined', () => {
    expect(mergeKeyDict(undefined, undefined)).toBeUndefined();
  });

  it('returns local entries when remote is undefined', () => {
    expect(mergeKeyDict<number>(undefined, { a: 1 })).toEqual({ a: 1 });
  });

  it('returns remote entries when local is undefined', () => {
    expect(mergeKeyDict<number>({ a: 1 }, undefined)).toEqual({ a: 1 });
  });

  it('local wins on duplicate keys (the divergence-bug fix)', () => {
    expect(mergeKeyDict<string>({ a: 'remote' }, { a: 'local' })).toEqual({ a: 'local' });
  });

  it('preserves remote-only entries', () => {
    expect(mergeKeyDict<string>({ a: 'r' }, { b: 'l' })).toEqual({ a: 'r', b: 'l' });
  });

  it('does not mutate either input', () => {
    const remote = { a: 1 };
    const local = { b: 2 };
    const result = mergeKeyDict(remote, local);
    expect(remote).toEqual({ a: 1 });
    expect(local).toEqual({ b: 2 });
    expect(result).not.toBe(remote);
    expect(result).not.toBe(local);
  });
});

describe('preserveLocalKeyDicts', () => {
  const sampleWrapped = { wrapped: 'w', salt: 's' };
  const sampleWrappedAlt = { wrapped: 'w-alt', salt: 's-alt' };
  const sampleInvite = { wrapped: 'iw', salt: 'is', expiresAt: '2099-01-01' };
  const samplePasskey = { wrapped: 'pw', hkdfSalt: 'phs' };

  it('returns incoming unchanged when local is null', () => {
    const incoming = buildEnvelope({ wrappedKeys: { m1: sampleWrapped } });
    expect(preserveLocalKeyDicts(incoming, null)).toBe(incoming);
  });

  it('returns incoming unchanged when local is undefined', () => {
    const incoming = buildEnvelope({ wrappedKeys: { m1: sampleWrapped } });
    expect(preserveLocalKeyDicts(incoming, undefined)).toBe(incoming);
  });

  it('local wins on duplicate wrappedKey memberIds (the bug)', () => {
    const incoming = buildEnvelope({ wrappedKeys: { m1: sampleWrapped } });
    const local = buildEnvelope({ wrappedKeys: { m1: sampleWrappedAlt } });
    const result = preserveLocalKeyDicts(incoming, local);
    expect(result.wrappedKeys.m1).toEqual(sampleWrappedAlt);
  });

  it('preserves remote-only wrappedKey entries', () => {
    const incoming = buildEnvelope({ wrappedKeys: { m1: sampleWrapped } });
    const local = buildEnvelope({ wrappedKeys: { m2: sampleWrappedAlt } });
    const result = preserveLocalKeyDicts(incoming, local);
    expect(result.wrappedKeys.m1).toEqual(sampleWrapped);
    expect(result.wrappedKeys.m2).toEqual(sampleWrappedAlt);
  });

  it('preserves local-only wrappedKey entries', () => {
    const incoming = buildEnvelope({ wrappedKeys: {} });
    const local = buildEnvelope({ wrappedKeys: { m2: sampleWrappedAlt } });
    const result = preserveLocalKeyDicts(incoming, local);
    expect(result.wrappedKeys.m2).toEqual(sampleWrappedAlt);
  });

  it('applies the same merge to inviteKeys and passkeyWrappedKeys', () => {
    const incoming = buildEnvelope({
      inviteKeys: { tokenA: sampleInvite },
      passkeyWrappedKeys: { credA: samplePasskey },
    });
    const local = buildEnvelope({
      inviteKeys: { tokenB: { ...sampleInvite, wrapped: 'iw-local' } },
      passkeyWrappedKeys: { credB: { ...samplePasskey, wrapped: 'pw-local' } },
    });
    const result = preserveLocalKeyDicts(incoming, local);
    expect(Object.keys(result.inviteKeys).sort()).toEqual(['tokenA', 'tokenB']);
    expect(Object.keys(result.passkeyWrappedKeys).sort()).toEqual(['credA', 'credB']);
  });

  it('returns a fresh object — never mutates incoming or local', () => {
    const incoming = buildEnvelope({ wrappedKeys: { m1: sampleWrapped } });
    const local = buildEnvelope({ wrappedKeys: { m1: sampleWrappedAlt } });
    const result = preserveLocalKeyDicts(incoming, local);
    expect(incoming.wrappedKeys.m1).toEqual(sampleWrapped); // unchanged
    expect(local.wrappedKeys.m1).toEqual(sampleWrappedAlt); // unchanged
    expect(result).not.toBe(incoming);
    expect(result).not.toBe(local);
    expect(result.wrappedKeys).not.toBe(incoming.wrappedKeys);
    expect(result.wrappedKeys).not.toBe(local.wrappedKeys);
  });

  it('preserves non-key envelope fields from incoming (familyId, payload, etc.)', () => {
    const incoming = buildEnvelope({
      familyId: 'remote-fam',
      familyName: 'Remote Family',
      encryptedPayload: 'remote-payload',
    });
    const local = buildEnvelope({
      familyId: 'local-fam',
      familyName: 'Local Family',
      encryptedPayload: 'local-payload',
      wrappedKeys: { m1: sampleWrapped },
    });
    const result = preserveLocalKeyDicts(incoming, local);
    // Non-key fields come from incoming (fetched envelope is the source of
    // truth for the encrypted payload; only key dicts get local-wins merge).
    expect(result.familyId).toBe('remote-fam');
    expect(result.familyName).toBe('Remote Family');
    expect(result.encryptedPayload).toBe('remote-payload');
    expect(result.wrappedKeys.m1).toEqual(sampleWrapped);
  });
});
