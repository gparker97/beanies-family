import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Isolated harness for the #62 account-switch reset (different-account sign-in
// tears down the departed account). Kept in its own file so the reconcile hook —
// which runs on EVERY initializeAuth — is exercised without the churn of the main
// googleAuth suite (whose many initializeAuth calls + dispatched async would
// pollute these assertions).

vi.mock('../pkce', () => ({
  generateCodeVerifier: vi.fn(() => 'verifier'),
  generateCodeChallenge: vi.fn(async () => 'challenge'),
}));
vi.mock('../oauthProxy', () => ({
  exchangeCodeForTokens: vi.fn(async () => ({ access_token: 'a', expires_in: 3600 })),
  refreshAccessToken: vi.fn(async () => ({ access_token: 'a', expires_in: 3600 })),
}));
vi.mock('@/services/sync/fileHandleStore', () => ({
  storeGoogleRefreshToken: vi.fn(async () => {}),
  getGoogleRefreshToken: vi.fn(async () => null),
  clearGoogleRefreshToken: vi.fn(async () => {}),
  clearProviderConfig: vi.fn(async () => {}),
  getLastGoogleAccount: vi.fn(() => null),
  setLastGoogleAccount: vi.fn(() => {}),
  clearLastGoogleAccount: vi.fn(() => {}),
}));
vi.mock('@/services/indexeddb/database', () => ({ getActiveFamilyId: vi.fn(() => null) }));
vi.mock('@/services/telemetry', () => ({ logEvent: vi.fn() }));
vi.mock('@/utils/errorReporter', () => ({ reportError: vi.fn() }));
vi.mock('../googleRevoke', () => ({
  revokeGrant: vi.fn(async () => ({ ok: true, reason: 'revoked' })),
  logTokenLifecycle: vi.fn(),
}));

let googleAuth: typeof import('../googleAuth');

/** Prime the fresh module's verified-email cache to `email` (via a unique token
 *  so fetchGoogleUserEmail never short-circuits on a stale cache). */
async function primeVerifiedEmail(email: string) {
  globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ email }) });
  await googleAuth.fetchGoogleUserEmail(`tok-${email}`);
}

describe('account-switch reset (#62)', () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks(); // clears history, keeps factory implementations
    Object.defineProperty(document, 'hidden', { value: true, configurable: true });
    googleAuth = await import('../googleAuth');
  });

  afterEach(() => {
    googleAuth?.__resetWakeListenerForTesting?.();
    vi.useRealTimers();
  });

  it('revokes + clears the previous family when a DIFFERENT account signs in', async () => {
    const fhs = await import('@/services/sync/fileHandleStore');
    const { revokeGrant } = await import('../googleRevoke');
    (fhs.getGoogleRefreshToken as ReturnType<typeof vi.fn>).mockImplementation(
      async (fid: string) => (fid === 'family-OLD' ? { token: 'old-rt', issuedAt: null } : null)
    );
    (fhs.getLastGoogleAccount as ReturnType<typeof vi.fn>).mockReturnValue({
      email: 'old@example.com',
      familyId: 'family-OLD',
    });
    await primeVerifiedEmail('new@example.com');

    await googleAuth.initializeAuth('family-NEW');

    // The teardown is DISPATCHED (not awaited) — wait for its last step to settle.
    await vi.waitFor(() => expect(fhs.clearProviderConfig).toHaveBeenCalledWith('family-OLD'));
    expect(revokeGrant).toHaveBeenCalledWith(
      'old-rt',
      expect.objectContaining({ grant: 'drive', trigger: 'account-change' })
    );
    expect(fhs.clearGoogleRefreshToken).toHaveBeenCalledWith('family-OLD');
    expect(fhs.setLastGoogleAccount).toHaveBeenCalledWith('new@example.com', 'family-NEW');
  });

  it('does NOT tear down when the SAME account signs in (different family)', async () => {
    const fhs = await import('@/services/sync/fileHandleStore');
    const { revokeGrant } = await import('../googleRevoke');
    (fhs.getLastGoogleAccount as ReturnType<typeof vi.fn>).mockReturnValue({
      email: 'me@example.com',
      familyId: 'family-OLD',
    });
    await primeVerifiedEmail('me@example.com');

    await googleAuth.initializeAuth('family-NEW');
    // reconcile is dispatched (not awaited) — wait for its breadcrumb write.
    await vi.waitFor(() =>
      expect(fhs.setLastGoogleAccount).toHaveBeenCalledWith('me@example.com', 'family-NEW')
    );

    expect(revokeGrant).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ trigger: 'account-change' })
    );
    expect(fhs.clearProviderConfig).not.toHaveBeenCalled();
  });

  it('does NOT tear down when the new sign-in is the SAME family (guard)', async () => {
    const fhs = await import('@/services/sync/fileHandleStore');
    const { revokeGrant } = await import('../googleRevoke');
    (fhs.getLastGoogleAccount as ReturnType<typeof vi.fn>).mockReturnValue({
      email: 'old@example.com',
      familyId: 'family-SAME',
    });
    await primeVerifiedEmail('new@example.com'); // different account, same family

    await googleAuth.initializeAuth('family-SAME');
    await new Promise((r) => setTimeout(r, 5));

    expect(revokeGrant).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ trigger: 'account-change' })
    );
    expect(fhs.clearProviderConfig).not.toHaveBeenCalled();
  });

  it('is a no-op on cold boot (no verified email) — no breadcrumb read/write', async () => {
    const fhs = await import('@/services/sync/fileHandleStore');
    // No primeVerifiedEmail: cachedEmail + accessToken are null on the fresh
    // module → ensureVerifiedGoogleAccountEmail() returns null → early return.
    await googleAuth.initializeAuth('family-COLD');
    await new Promise((r) => setTimeout(r, 5));

    expect(fhs.getLastGoogleAccount).not.toHaveBeenCalled();
    expect(fhs.setLastGoogleAccount).not.toHaveBeenCalled();
  });
});
