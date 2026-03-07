import { describe, it, expect, vi, beforeEach } from 'vitest';

// We test the sha256 logic directly since the env var is baked at import time.
// Instead, we test validateInviteToken by mocking the module's env.

describe('inviteToken', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('isInviteGateEnabled returns false when env var is empty', async () => {
    vi.stubEnv('VITE_INVITE_BEAN_HASHES', '');
    const { isInviteGateEnabled } = await import('../inviteToken');
    expect(isInviteGateEnabled()).toBe(false);
  });

  it('isInviteGateEnabled returns true when env var has hashes', async () => {
    vi.stubEnv('VITE_INVITE_BEAN_HASHES', 'abc123');
    const { isInviteGateEnabled } = await import('../inviteToken');
    expect(isInviteGateEnabled()).toBe(true);
  });

  it('validateInviteToken returns true when gate is disabled', async () => {
    vi.stubEnv('VITE_INVITE_BEAN_HASHES', '');
    const { validateInviteToken } = await import('../inviteToken');
    expect(await validateInviteToken('anything')).toBe(true);
  });

  it('validateInviteToken rejects empty token', async () => {
    vi.stubEnv('VITE_INVITE_BEAN_HASHES', 'abc123');
    const { validateInviteToken } = await import('../inviteToken');
    expect(await validateInviteToken('')).toBe(false);
    expect(await validateInviteToken('   ')).toBe(false);
  });

  it('validateInviteToken accepts valid token', async () => {
    // SHA-256 of "test-token" (lowercase)
    // echo -n "test-token" | sha256sum
    const hash = '4c5dc9b7708905f77f5e5d16316b5dfb425e68cb326dcd55a860e90a7707031e';
    vi.stubEnv('VITE_INVITE_BEAN_HASHES', hash);
    const { validateInviteToken } = await import('../inviteToken');
    expect(await validateInviteToken('test-token')).toBe(true);
  });

  it('validateInviteToken is case-insensitive', async () => {
    // SHA-256 of "test-token" (lowercased)
    const hash = '4c5dc9b7708905f77f5e5d16316b5dfb425e68cb326dcd55a860e90a7707031e';
    vi.stubEnv('VITE_INVITE_BEAN_HASHES', hash);
    const { validateInviteToken } = await import('../inviteToken');
    expect(await validateInviteToken('Test-Token')).toBe(true);
    expect(await validateInviteToken('TEST-TOKEN')).toBe(true);
  });

  it('validateInviteToken rejects invalid token', async () => {
    const hash = '4c5dc9b7708905f77f5e5d16316b5dfb425e68cb326dcd55a860e90a7707031e';
    vi.stubEnv('VITE_INVITE_BEAN_HASHES', hash);
    const { validateInviteToken } = await import('../inviteToken');
    expect(await validateInviteToken('wrong-token')).toBe(false);
  });

  it('validateInviteToken supports multiple hashes', async () => {
    const hash1 = '4c5dc9b7708905f77f5e5d16316b5dfb425e68cb326dcd55a860e90a7707031e'; // test-token
    const hash2 = 'abc123'; // dummy second hash
    vi.stubEnv('VITE_INVITE_BEAN_HASHES', `${hash1}, ${hash2}`);
    const { validateInviteToken } = await import('../inviteToken');
    expect(await validateInviteToken('test-token')).toBe(true);
  });
});
