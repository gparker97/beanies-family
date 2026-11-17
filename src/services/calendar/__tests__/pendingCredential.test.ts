import { describe, it, expect, beforeEach } from 'vitest';
import { pendingCredential, type PendingCalendarCredential } from '../pendingCredential';

function credential(overrides: Partial<PendingCalendarCredential> = {}): PendingCalendarCredential {
  return {
    id: 'pending-1',
    kind: 'view',
    accountEmail: 'me@example.com',
    refreshToken: 'rt-1',
    grantedScopes: ['scope-a'],
    ...overrides,
  };
}

describe('pendingCredential (single in-memory slot)', () => {
  beforeEach(() => pendingCredential.clear());

  it('starts empty', () => {
    expect(pendingCredential.peek()).toBeNull();
    expect(pendingCredential.take()).toBeNull();
  });

  it('peek leaves the credential in place', () => {
    pendingCredential.set(credential());
    expect(pendingCredential.peek()?.id).toBe('pending-1');
    expect(pendingCredential.peek()?.id).toBe('pending-1');
  });

  it('take returns the credential and empties the slot', () => {
    pendingCredential.set(credential());
    expect(pendingCredential.take()).toMatchObject({ id: 'pending-1', refreshToken: 'rt-1' });
    expect(pendingCredential.peek()).toBeNull();
  });

  it('holds one credential: a second set replaces the first', () => {
    pendingCredential.set(credential());
    pendingCredential.set(credential({ id: 'pending-2', kind: 'sync', refreshToken: 'rt-2' }));
    expect(pendingCredential.take()).toMatchObject({ id: 'pending-2', kind: 'sync' });
    expect(pendingCredential.take()).toBeNull();
  });

  it('clear drops the credential', () => {
    pendingCredential.set(credential());
    pendingCredential.clear();
    expect(pendingCredential.peek()).toBeNull();
  });

  it("keeps its own copy, so a caller's later mutation cannot change what is held", () => {
    const input = credential();
    pendingCredential.set(input);
    input.grantedScopes.push('scope-b');
    input.refreshToken = 'tampered';
    expect(pendingCredential.peek()).toMatchObject({
      refreshToken: 'rt-1',
      grantedScopes: ['scope-a'],
    });
  });
});
