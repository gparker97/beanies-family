/**
 * The family-eviction decision (tracker #77), as a pure function: a removed member's
 * device forgets the family only when nobody still in it uses the device.
 */
import { describe, it, expect } from 'vitest';
import { shouldEvictFamily } from '../deviceCredentials';

describe('shouldEvictFamily', () => {
  const base = {
    memberIsRemoved: true,
    liveMemberIdsWithDeviceCredential: [] as string[],
    sessionMemberIsLive: false,
    hasUnpushedWork: false,
  };

  it('evicts when the member is removed and nobody live uses this device', () => {
    expect(shouldEvictFamily(base)).toBe('evict');
  });

  it('never evicts on mere absence — only on the authenticated removal record', () => {
    expect(shouldEvictFamily({ ...base, memberIsRemoved: false })).toBe('not-removed');
  });

  it('keeps the family for a shared device where a live member holds a credential', () => {
    expect(shouldEvictFamily({ ...base, liveMemberIdsWithDeviceCredential: ['kid'] })).toBe(
      'live-credential'
    );
  });

  it('keeps the family while this copy holds work the file has not got', () => {
    // A live member signing in by password or magic link leaves no device credential.
    expect(shouldEvictFamily({ ...base, hasUnpushedWork: true })).toBe('unsynced');
  });

  it('keeps the family while a live member holds the session here', () => {
    expect(shouldEvictFamily({ ...base, sessionMemberIsLive: true })).toBe('live-session');
  });
});
