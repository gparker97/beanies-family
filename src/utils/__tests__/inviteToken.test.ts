import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// We test the sha256 logic directly since the env var is baked at import time.
// Instead, we test validateInviteToken by mocking the module's env.
//
// The gate needs BOTH env vars (see features.ts): the explicit VITE_INVITE_GATE
// switch AND non-empty hashes. `armGate()` sets both — token validation only
// runs when the gate is armed, since validateInviteToken short-circuits to
// `true` (allow everyone) whenever the gate is off. Setting hashes alone would
// leave the gate OFF and make every "rejects …" assertion pass vacuously.
function armGate(hashes: string): void {
  vi.stubEnv('VITE_INVITE_GATE', 'true');
  vi.stubEnv('VITE_INVITE_BEAN_HASHES', hashes);
}

describe('inviteToken', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('features.inviteGate is false when env var is empty', async () => {
    vi.stubEnv('VITE_INVITE_BEAN_HASHES', '');
    const { features } = await import('@/config/features');
    expect(features.inviteGate).toBe(false);
    // 20s: first dynamic import pays one-off init cost under full-suite contention —
    // the recurring pass-in-isolation flake (see TravelPlansPage.smoke.test.ts).
  }, 20_000);

  it('features.inviteGate is true when env var has hashes', async () => {
    armGate('abc123');
    const { features } = await import('@/config/features');
    expect(features.inviteGate).toBe(true);
  });

  it('validateInviteToken returns true when gate is disabled', async () => {
    vi.stubEnv('VITE_INVITE_BEAN_HASHES', '');
    const { validateInviteToken } = await import('../inviteToken');
    expect(await validateInviteToken('anything')).toBe(true);
  });

  it('validateInviteToken rejects empty token', async () => {
    armGate('abc123');
    const { validateInviteToken } = await import('../inviteToken');
    expect(await validateInviteToken('')).toBe(false);
    expect(await validateInviteToken('   ')).toBe(false);
  });

  it('validateInviteToken accepts valid token', async () => {
    // SHA-256 of "test-token" (lowercase)
    // echo -n "test-token" | sha256sum
    const hash = '4c5dc9b7708905f77f5e5d16316b5dfb425e68cb326dcd55a860e90a7707031e';
    armGate(hash);
    const { validateInviteToken } = await import('../inviteToken');
    expect(await validateInviteToken('test-token')).toBe(true);
  });

  it('validateInviteToken is case-insensitive', async () => {
    // SHA-256 of "test-token" (lowercased)
    const hash = '4c5dc9b7708905f77f5e5d16316b5dfb425e68cb326dcd55a860e90a7707031e';
    armGate(hash);
    const { validateInviteToken } = await import('../inviteToken');
    expect(await validateInviteToken('Test-Token')).toBe(true);
    expect(await validateInviteToken('TEST-TOKEN')).toBe(true);
  });

  it('validateInviteToken rejects invalid token', async () => {
    const hash = '4c5dc9b7708905f77f5e5d16316b5dfb425e68cb326dcd55a860e90a7707031e';
    armGate(hash);
    const { validateInviteToken } = await import('../inviteToken');
    expect(await validateInviteToken('wrong-token')).toBe(false);
  });

  it('validateInviteToken supports multiple hashes', async () => {
    const hash1 = '4c5dc9b7708905f77f5e5d16316b5dfb425e68cb326dcd55a860e90a7707031e'; // test-token
    const hash2 = 'abc123'; // dummy second hash
    armGate(`${hash1}, ${hash2}`);
    const { validateInviteToken } = await import('../inviteToken');
    expect(await validateInviteToken('test-token')).toBe(true);
  });
});
