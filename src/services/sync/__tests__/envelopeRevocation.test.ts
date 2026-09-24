/**
 * Revocation tombstones (tracker #77). Envelope dicts merge by union, so a deletion never
 * propagates; these pin that a TOMBSTONE does — in both merge directions, across a second
 * device that still holds the revoked wrap, and without locking out a re-claimed member.
 */
import { describe, it, expect } from 'vitest';
import type { BeanpodFileV4 } from '@/types/syncFileV4';
import {
  applyRevokedKeys,
  memberRevocationKey,
  mergeEnvelopes,
  memberHasKeyMaterial,
  mergeRevokedKeys,
  revocationKey,
  revocationTombstonesForMember,
} from '../envelopeMerge';

const NOW = '2026-09-23T00:00:00.000Z';

function env(overrides: Partial<BeanpodFileV4> = {}): BeanpodFileV4 {
  return {
    version: '4.0',
    familyId: 'fam',
    familyName: 'Fam',
    keyId: 'k1',
    wrappedKeys: {},
    passkeyWrappedKeys: {},
    inviteKeys: {},
    encryptedPayload: 'x',
    ...overrides,
  };
}

/** A device's envelope still holding every wrap of the removed member `gone`. */
const withGone = () =>
  env({
    wrappedKeys: {
      gone: { salt: 's', wrapped: 'pw-gone' },
      stay: { salt: 's', wrapped: 'pw-stay' },
    },
    passkeyWrappedKeys: {
      credGone: { wrapped: 'pk-gone', hkdfSalt: 'h', memberId: 'gone' },
      credStay: { wrapped: 'pk-stay', hkdfSalt: 'h', memberId: 'stay' },
      credLegacy: { wrapped: 'pk-legacy', hkdfSalt: 'h' },
    },
    inviteKeys: { inv1: { salt: 's', wrapped: 'inv', expiresAt: NOW } },
    deviceApprovalKeys: {
      gone: {
        salt: 's',
        wrapped: 'appr',
        approverPublicKey: 'p',
        publicKeyHash: 'h',
        createdAt: NOW,
        expiresAt: NOW,
      },
    },
  });

function removalOf(base: BeanpodFileV4, memberId: string): BeanpodFileV4 {
  const { tombstones } = revocationTombstonesForMember(base, memberId, {
    mode: 'remove',
    now: NOW,
  });
  return applyRevokedKeys({ ...base, revokedKeys: tombstones }).envelope;
}

describe('removal tombstones', () => {
  it('drops every wrap attributed to the member, plus every invite, and nothing else', () => {
    const after = removalOf(withGone(), 'gone');

    expect(Object.keys(after.wrappedKeys)).toEqual(['stay']);
    expect(Object.keys(after.passkeyWrappedKeys).sort()).toEqual(['credLegacy', 'credStay']);
    expect(after.inviteKeys).toEqual({});
    expect(after.deviceApprovalKeys).toEqual({});
  });

  it('a peer still holding the revoked wraps cannot resurrect them — either direction', () => {
    const revoked = removalOf(withGone(), 'gone');
    const stalePeer = withGone();

    const peerAdoptsFile = mergeEnvelopes(revoked, stalePeer).envelope;
    const fileAdoptsPeer = mergeEnvelopes(stalePeer, revoked).envelope;

    for (const merged of [peerAdoptsFile, fileAdoptsPeer]) {
      expect(merged.wrappedKeys.gone).toBeUndefined();
      expect(merged.passkeyWrappedKeys.credGone).toBeUndefined();
      expect(merged.inviteKeys.inv1).toBeUndefined();
      expect(merged.revokedKeys?.[memberRevocationKey('gone')]).toBeDefined();
    }
  });

  it('also filters when there is no local side at all (the early-return path)', () => {
    const file = {
      ...withGone(),
      revokedKeys: { [memberRevocationKey('gone')]: { revokedAt: NOW } },
    };
    expect(mergeEnvelopes(file, null).envelope.wrappedKeys.gone).toBeUndefined();
  });

  it('never drops a keyless entry (`wrapped: ""`): the old-client magic-link overwrite stays', () => {
    const base = env({
      memberLinkKeys: {
        gone: {
          salt: '',
          wrapped: '',
          tokenHash: '',
          keyId: 'k1',
          createdAt: NOW,
          expiresAt: new Date(0).toISOString(),
        },
      },
    });
    expect(removalOf(base, 'gone').memberLinkKeys?.gone).toBeDefined();
  });

  it('counts legacy passkey wraps it cannot attribute, and leaves them alone', () => {
    const { unattributedPasskeys } = revocationTombstonesForMember(withGone(), 'gone', {
      mode: 'remove',
      now: NOW,
    });
    expect(unattributedPasskeys).toBe(1);
  });
});

describe('unclaim tombstones are value-pinned', () => {
  it('revoke the current wraps but not a later re-wrap of the same slot', () => {
    const before = withGone();
    const { tombstones } = revocationTombstonesForMember(before, 'gone', {
      mode: 'unclaim',
      now: NOW,
    });
    const unclaimed = applyRevokedKeys({ ...before, revokedKeys: tombstones }).envelope;
    expect(unclaimed.wrappedKeys.gone).toBeUndefined();

    // Re-claim: a NEW wrap in the same slot must survive every later merge.
    const reclaimed = {
      ...unclaimed,
      wrappedKeys: { ...unclaimed.wrappedKeys, gone: { salt: 's2', wrapped: 'pw-new' } },
    };
    expect(mergeEnvelopes(reclaimed, withGone()).envelope.wrappedKeys.gone?.wrapped).toBe('pw-new');
  });

  it('unclaim → re-claim → unclaim: the second wrap is revoked too (keys never collide)', () => {
    const first = revocationTombstonesForMember(withGone(), 'gone', { mode: 'unclaim', now: NOW });
    const reclaimed = env({ wrappedKeys: { gone: { salt: 's2', wrapped: 'pw-new' } } });
    const second = revocationTombstonesForMember(reclaimed, 'gone', {
      mode: 'unclaim',
      now: '2026-09-24T00:00:00.000Z',
    });
    const all = mergeRevokedKeys(first.tombstones, second.tombstones);

    expect(Object.keys(all ?? {})).toContain(revocationKey('wrappedKeys', 'gone', 'pw-gone'));
    expect(Object.keys(all ?? {})).toContain(revocationKey('wrappedKeys', 'gone', 'pw-new'));
    expect(
      applyRevokedKeys({ ...reclaimed, revokedKeys: all }).envelope.wrappedKeys.gone
    ).toBeUndefined();
  });
});

describe('mergeRevokedKeys', () => {
  it('is a union where the EARLIEST revocation wins a collision', () => {
    const merged = mergeRevokedKeys(
      { a: { revokedAt: '2026-09-02T00:00:00.000Z' } },
      { a: { revokedAt: '2026-09-01T00:00:00.000Z' }, b: { revokedAt: NOW } }
    );
    expect(merged).toEqual({
      a: { revokedAt: '2026-09-01T00:00:00.000Z' },
      b: { revokedAt: NOW },
    });
  });
});

describe('mergeEnvelopes — the publish signal', () => {
  it('asks to publish a tombstone the file has not got (a count cannot see it)', () => {
    const local = removalOf(withGone(), 'gone');
    const file = withGone();
    const result = mergeEnvelopes(file, local);
    expect(result.needsPublish).toBe(true);
    // An ordinary removal on its way out is NOT old-client resurrection: the file does not
    // record these tombstones yet, so the metric stays at zero.
    expect(result.filtered).toBe(0);
  });

  it('asks to publish when the FILE still carries revoked wraps (an old client re-published them)', () => {
    const repolluted = { ...withGone(), revokedKeys: removalOf(withGone(), 'gone').revokedKeys };
    const result = mergeEnvelopes(repolluted, removalOf(withGone(), 'gone'));
    expect(result.filtered).toBeGreaterThan(0);
    expect(result.needsPublish).toBe(true);
  });

  it('stays quiet when both sides already agree', () => {
    const clean = removalOf(withGone(), 'gone');
    expect(mergeEnvelopes(clean, clean)).toMatchObject({ needsPublish: false, filtered: 0 });
  });

  it('still asks to publish a locally-added key entry (the old keyDictSize signal)', () => {
    const file = env();
    const local = env({ wrappedKeys: { newbie: { salt: 's', wrapped: 'w' } } });
    expect(mergeEnvelopes(file, local).needsPublish).toBe(true);
  });
});

describe('memberHasKeyMaterial', () => {
  it('sees every attributed dict, device approvals included', () => {
    const onlyApproval = env({ deviceApprovalKeys: withGone().deviceApprovalKeys });
    expect(memberHasKeyMaterial(onlyApproval, 'gone')).toBe(true);
    expect(memberHasKeyMaterial(onlyApproval, 'stay')).toBe(false);
  });

  it('ignores a keyless revocation overwrite', () => {
    const tombstoned = env({
      memberLinkKeys: {
        gone: { salt: '', wrapped: '', tokenHash: '', keyId: 'k1', createdAt: NOW, expiresAt: NOW },
      },
    });
    expect(memberHasKeyMaterial(tombstoned, 'gone')).toBe(false);
  });
});

// ── Recovery kits (tracker #99): a slot tombstone retires one kit, with attribution ──
import { slotTombstoneEntryKey } from '../envelopeMerge';

describe('recovery kit tombstones (#99)', () => {
  const kits = () =>
    env({
      recoveryKeys: {
        kitA: { salt: 's', wrapped: 'wa', createdAt: NOW, createdBy: 'm1' },
        kitB: { salt: 's', wrapped: 'wb', createdAt: NOW },
      },
    });

  it('slotTombstoneEntryKey is the inverse of revocationKey for slot-wide keys only', () => {
    expect(slotTombstoneEntryKey('recoveryKeys', revocationKey('recoveryKeys', 'kitA'))).toBe(
      'kitA'
    );
    expect(
      slotTombstoneEntryKey('recoveryKeys', revocationKey('recoveryKeys', 'kitA', 'wa'))
    ).toBeNull();
    expect(slotTombstoneEntryKey('recoveryKeys', revocationKey('wrappedKeys', 'kitA'))).toBeNull();
    expect(slotTombstoneEntryKey('recoveryKeys', memberRevocationKey('m1'))).toBeNull();
    expect(slotTombstoneEntryKey('recoveryKeys', 'recoveryKeys:')).toBeNull();
  });

  it('drops only the tombstoned kit, keeps revokedBy, and survives a merge with a stale peer', () => {
    const tombstones = {
      [revocationKey('recoveryKeys', 'kitA')]: { revokedAt: NOW, revokedBy: 'm2' },
    };
    const local = applyRevokedKeys({
      ...kits(),
      revokedKeys: mergeRevokedKeys(undefined, tombstones),
    }).envelope;
    expect(Object.keys(local.recoveryKeys ?? {})).toEqual(['kitB']);
    expect(local.revokedKeys?.['recoveryKeys:kitA']).toEqual({ revokedAt: NOW, revokedBy: 'm2' });

    // A peer that never saw the tombstone still carries kitA's wrap.
    const stalePeer = kits();
    const merged = mergeEnvelopes(stalePeer, local);
    expect(Object.keys(merged.envelope.recoveryKeys ?? {})).toEqual(['kitB']);
    expect(merged.envelope.revokedKeys?.['recoveryKeys:kitA']?.revokedBy).toBe('m2');
    expect(merged.needsPublish).toBe(true);

    // And in the other direction: the tombstone side merging the stale side.
    const other = mergeEnvelopes(local, stalePeer);
    expect(Object.keys(other.envelope.recoveryKeys ?? {})).toEqual(['kitB']);
  });

  it('a createdBy on a live kit rides through the merge untouched', () => {
    const merged = mergeEnvelopes(env(), kits());
    expect(merged.envelope.recoveryKeys?.kitA?.createdBy).toBe('m1');
    expect(merged.envelope.recoveryKeys?.kitB?.createdBy).toBeUndefined();
  });
});
