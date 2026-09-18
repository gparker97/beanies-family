import { describe, it, expect } from 'vitest';
import {
  ENVELOPE_KEY_DICTS,
  keyDictSize,
  mergeKeyDict,
  mergeNewestWinsDict,
  preserveLocalKeyDicts,
} from '@/services/sync/envelopeMerge';
import type { EnvelopeKeyDictField, MergeRule } from '@/services/sync/envelopeMerge';
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

// ─────────────────────────────────────────────────────────────────────────────
// The registry (ENVELOPE_KEY_DICTS) and the invariants it exists to enforce.
//
// Context for the next reader: this replaced TWO hand-maintained lists of the same
// dicts — one in `preserveLocalKeyDicts`, one in `keyDictSize` — with neither aware of
// the other. A dict missing from the first was silently DROPPED on the next merge,
// destroying key material; a dict missing from the second meant an offline mint never
// published. Both failures were silent. These tests are what make them loud.
// ─────────────────────────────────────────────────────────────────────────────
describe('ENVELOPE_KEY_DICTS — the registry guard', () => {
  it('is exhaustive: omitting a dict is a TYPE error, not a silent drop', () => {
    // @ts-expect-error - `recoveryKeys` is deliberately missing. If this line ever
    // STOPS erroring, the guard is gone and a forgotten dict is silent again.
    const missing: Record<EnvelopeKeyDictField, { rule: MergeRule; required: boolean }> = {
      wrappedKeys: { rule: 'local-wins', required: true },
      passkeyWrappedKeys: { rule: 'local-wins', required: true },
      inviteKeys: { rule: 'local-wins', required: true },
    };
    expect(missing).toBeDefined();
  });

  it('rejects a key that is not an envelope wrap dict', () => {
    const extra: Record<EnvelopeKeyDictField, { rule: MergeRule; required: boolean }> = {
      wrappedKeys: { rule: 'local-wins', required: true },
      passkeyWrappedKeys: { rule: 'local-wins', required: true },
      inviteKeys: { rule: 'local-wins', required: true },
      recoveryKeys: { rule: 'local-wins', required: false },
      // @ts-expect-error - `encryptedPayload` is not a wrap dict.
      encryptedPayload: { rule: 'local-wins', required: true },
    };
    expect(extra).toBeDefined();
  });

  it('does not include the scalar passphrase — it is a wrap, not a map of wraps', () => {
    expect(Object.keys(ENVELOPE_KEY_DICTS)).not.toContain('recoveryPassphrase');
    expect(Object.keys(ENVELOPE_KEY_DICTS).sort()).toEqual([
      'deviceApprovalKeys',
      'inviteKeys',
      'memberLinkKeys',
      'passkeyWrappedKeys',
      'recoveryKeys',
      'wrappedKeys',
    ]);
  });

  it('deviceApprovalKeys is newest-wins — a stale approval must not win the merge', () => {
    // Asserted DIRECTLY for the same reason as memberLinkKeys below: the entry is replaced
    // in place at one key per member, so under 'local-wins' a peer still holding an earlier
    // approval would republish it and the fresh one would silently lose.
    expect(ENVELOPE_KEY_DICTS.deviceApprovalKeys.rule).toBe('newest-wins');
    // Optional, not required: an envelope that has never seen a device approval must not
    // gain `deviceApprovalKeys: {}`, which serialises differently and is a different file.
    expect(ENVELOPE_KEY_DICTS.deviceApprovalKeys.required).toBe(false);
  });

  it('memberLinkKeys is newest-wins — the whole of revocation', () => {
    // Asserted DIRECTLY, not just via behaviour, because this single value is what
    // separates "creating a new link cancels the old one" from a button that looks like
    // it worked and did nothing.
    expect(ENVELOPE_KEY_DICTS.memberLinkKeys.rule).toBe('newest-wins');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PROOF 2 of the revocation contract: the rotation must survive a peer that still
// holds the pre-rotation entry in memory.
//
// This is the test that fails under 'local-wins'. It was written and OBSERVED failing
// against that rule before the registry entry was changed, because a propagation test
// nobody has seen red proves nothing about the rule it is supposed to be pinning.
// ─────────────────────────────────────────────────────────────────────────────
describe('revocation propagation (Proof 2)', () => {
  const dead = {
    wrapped: 'w-old',
    salt: 's',
    expiresAt: '2026-09-24T00:00:00.000Z',
    tokenHash: 'h-old',
    keyId: 'k1',
    createdAt: '2026-09-17T10:00:00.000Z',
  };
  const live = {
    ...dead,
    wrapped: 'w-new',
    tokenHash: 'h-new',
    createdAt: '2026-09-17T11:00:00.000Z',
  };

  it('a rotation on the remote survives a peer holding the old wrap locally', () => {
    const merged = preserveLocalKeyDicts(
      buildEnvelope({ memberLinkKeys: { m1: live } }),
      buildEnvelope({ memberLinkKeys: { m1: dead } })
    );
    expect(merged.memberLinkKeys?.m1.tokenHash).toBe('h-new');
  });

  it('and the same when the rotation is the LOCAL side (symmetry)', () => {
    // A one-directional test also passes under a plain "remote-wins" rule, which is not
    // what was asked for.
    const merged = preserveLocalKeyDicts(
      buildEnvelope({ memberLinkKeys: { m1: dead } }),
      buildEnvelope({ memberLinkKeys: { m1: live } })
    );
    expect(merged.memberLinkKeys?.m1.tokenHash).toBe('h-new');
  });
});

describe('preserveLocalKeyDicts — required vs optional asymmetry', () => {
  it('writes the three REQUIRED dicts as {} when absent on both sides', () => {
    const merged = preserveLocalKeyDicts(buildEnvelope(), buildEnvelope());
    expect(merged.wrappedKeys).toEqual({});
    expect(merged.passkeyWrappedKeys).toEqual({});
    expect(merged.inviteKeys).toEqual({});
  });

  it('OMITS an optional dict absent on both sides — the key must not appear at all', () => {
    // Not `toBeUndefined()`: an envelope that gains `recoveryKeys: undefined` serialises
    // differently and is a different file on Drive.
    const merged = preserveLocalKeyDicts(buildEnvelope(), buildEnvelope());
    expect('recoveryKeys' in merged).toBe(false);
  });
});

describe('mergeNewestWinsDict', () => {
  const old = { wrapped: 'w-old', createdAt: '2026-01-01T00:00:00.000Z' };
  const fresh = { wrapped: 'w-new', createdAt: '2026-06-01T00:00:00.000Z' };

  it('returns undefined when both sides are undefined', () => {
    expect(mergeNewestWinsDict(undefined, undefined)).toBeUndefined();
  });

  it('unions keys that do not collide', () => {
    expect(mergeNewestWinsDict({ a: old }, { b: fresh })).toEqual({ a: old, b: fresh });
  });

  it('the NEWER entry wins a collision, whichever side it is on', () => {
    // Both directions, deliberately. A one-directional test also passes under a plain
    // "remote-wins" rule, which is not what this is for.
    expect(mergeNewestWinsDict({ a: old }, { a: fresh })).toEqual({ a: fresh });
    expect(mergeNewestWinsDict({ a: fresh }, { a: old })).toEqual({ a: fresh });
  });

  it('an entry with no createdAt sorts oldest', () => {
    const undated: { wrapped: string; createdAt?: string } = { wrapped: 'w-undated' };
    expect(mergeNewestWinsDict({ a: undated }, { a: old })).toEqual({ a: old });
    expect(mergeNewestWinsDict({ a: old }, { a: undated })).toEqual({ a: old });
  });
});

describe('keyDictSize', () => {
  it('counts every registry dict plus the scalar passphrase', () => {
    const env = buildEnvelope({
      wrappedKeys: { m1: { wrapped: 'w', salt: 's' } } as BeanpodFileV4['wrappedKeys'],
      recoveryKeys: { k1: { wrapped: 'w', salt: 's', createdAt: 'x' } },
      recoveryPassphrase: { wrapped: 'w', salt: 's' } as BeanpodFileV4['recoveryPassphrase'],
    });
    expect(keyDictSize(env)).toBe(3);
  });

  it('is UNCHANGED by an in-place overwrite — the limitation, pinned', () => {
    // syncStore publishes on `keyDictSize(merged) > keyDictSize(remote)`, a strict `>`.
    // Replacing an entry leaves the count identical, so a rotation or a revocation is
    // INVISIBLE to that signal and must publish explicitly. This test exists so nobody
    // re-derives "the count will publish it".
    const before = buildEnvelope({
      recoveryKeys: { k1: { wrapped: 'a', salt: 's', createdAt: '1' } },
    });
    const after = buildEnvelope({
      recoveryKeys: { k1: { wrapped: 'b', salt: 's', createdAt: '2' } },
    });
    expect(keyDictSize(after)).toBe(keyDictSize(before));
  });
});
