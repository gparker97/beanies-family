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

// ── Phase 3 (2026-08-28 rethink): recovery fields ride the same preservation rules ──
import { keyDictSize as kds } from '../envelopeMerge';

describe('recovery fields (Phase 3)', () => {
  const base = (over: Partial<import('@/types/syncFileV4').BeanpodFileV4> = {}) =>
    ({
      version: '4.0',
      familyId: 'f',
      familyName: 'Beans',
      keyId: 'k',
      wrappedKeys: {},
      passkeyWrappedKeys: {},
      inviteKeys: {},
      encryptedPayload: 'x',
      ...over,
    }) as import('@/types/syncFileV4').BeanpodFileV4;

  it('a locally generated kit survives an old-writer incoming envelope', () => {
    const local = base({
      recoveryKeys: { kit1: { salt: 's', wrapped: 'w', createdAt: '2026-08-28' } },
      recoveryPassphrase: { salt: 'ps', wrapped: 'pw' },
    });
    const incoming = base(); // an old client never wrote the fields
    const merged = preserveLocalKeyDicts(incoming, local);
    expect(merged.recoveryKeys).toEqual(local.recoveryKeys);
    expect(merged.recoveryPassphrase).toEqual(local.recoveryPassphrase);
  });

  it('incoming entries win on collision; unions otherwise', () => {
    const local = base({
      recoveryKeys: { kit1: { salt: 'L', wrapped: 'L', createdAt: 'L' } },
    });
    const incoming = base({
      recoveryKeys: {
        kit1: { salt: 'R', wrapped: 'R', createdAt: 'R' },
        kit2: { salt: 'R2', wrapped: 'R2', createdAt: 'R2' },
      },
      recoveryPassphrase: { salt: 'RP', wrapped: 'RP' },
    });
    const merged = preserveLocalKeyDicts(incoming, local);
    // Local-wins per key, matching the other dicts — and the scalar follows suit.
    expect(merged.recoveryKeys!.kit1.salt).toBe('L');
    expect(merged.recoveryKeys!.kit2.salt).toBe('R2');
    expect(merged.recoveryPassphrase!.salt).toBe('RP'); // local had none → incoming survives
  });

  it('keyDictSize counts kits + passphrase (the offline-publish signal)', () => {
    expect(kds(base())).toBe(0);
    expect(
      kds(
        base({
          recoveryKeys: { a: { salt: '', wrapped: '', createdAt: '' } },
          recoveryPassphrase: { salt: '', wrapped: '' },
        })
      )
    ).toBe(2);
  });
});

describe('preserveLocalKeyDicts and the envelope version', () => {
  it('still copies incoming.version by spread, so the DERIVATION is what protects a compacted pod', () => {
    // ⚠️ DO NOT "FIX" THIS by adding a local-wins or max rule for `version`
    // here. That is wrong on the adopt/rebase branches and wrong again for the
    // rollback. The version is derived from the document at write time
    // (`beanpodVersionFor`); this pin exists so the next reader knows the
    // spread is expected and the protection lives elsewhere.
    const incoming = buildEnvelope({ version: '4.0' });
    const local = buildEnvelope({ version: '5.0' });
    expect(preserveLocalKeyDicts(incoming, local).version).toBe('4.0');
  });
});
