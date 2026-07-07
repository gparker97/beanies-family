import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const DEFAULT_TOKENS = {
  access_token: 'mock-access-token',
  refresh_token: 'mock-refresh-token',
  expires_in: 3600,
  token_type: 'Bearer',
  scope: 'drive.file userinfo.email',
};

// Control isNative() per-test via a hoisted flag (vi.mock factories are hoisted).
const caps = vi.hoisted(() => ({ native: false }));
vi.mock('@/services/sync/capabilities', () => ({
  isNative: () => caps.native,
  isIosOrIpadOs: () => false,
  isStandalone: () => false,
  supportsFileSystemAccess: () => false,
}));

vi.mock('../pkce', () => ({
  generateCodeVerifier: vi.fn(() => 'mock-code-verifier'),
  generateCodeChallenge: vi.fn(async () => 'mock-code-challenge'),
}));

vi.mock('../oauthProxy', () => ({
  exchangeCodeForTokens: vi.fn(async () => ({
    access_token: 'mock-access-token',
    refresh_token: 'mock-refresh-token',
    expires_in: 3600,
    token_type: 'Bearer',
    scope: 'drive.file userinfo.email',
  })),
  refreshAccessToken: vi.fn(async () => ({
    access_token: 'mock-refreshed-token',
    expires_in: 3600,
    token_type: 'Bearer',
  })),
}));

vi.mock('@/services/sync/fileHandleStore', () => ({
  storeGoogleRefreshToken: vi.fn(async () => {}),
  getGoogleRefreshToken: vi.fn(async () => null),
  clearGoogleRefreshToken: vi.fn(async () => {}),
}));
vi.mock('@/services/indexeddb/database', () => ({ getActiveFamilyId: vi.fn(() => null) }));
vi.mock('@/services/telemetry', () => ({ logEvent: vi.fn() }));
vi.mock('@/utils/errorReporter', () => ({ reportError: vi.fn() }));

let googleAuth: typeof import('../googleAuth');

function seedPendingCode(): void {
  sessionStorage.setItem('beanies_redirect_auth_code', 'code-xyz');
  sessionStorage.setItem(
    'beanies_redirect_auth',
    JSON.stringify({ codeVerifier: 'v', returnPath: '/welcome?resume=load-drive' })
  );
}

describe('googleAuth — ensureRedirectAuthSettled (iOS redirect-auth race fix)', () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    caps.native = false;
    vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'cid.apps.googleusercontent.com');
    try {
      sessionStorage.clear();
    } catch {
      /* not all runners expose sessionStorage */
    }
    // Re-establish the default exchange impl each test — mockResolved/RejectedValue
    // set in a prior test would otherwise persist (clearAllMocks clears calls, not
    // implementations). See docs/lessons: resetAllMocks vs clearAllMocks.
    const { exchangeCodeForTokens } = await import('../oauthProxy');
    vi.mocked(exchangeCodeForTokens).mockReset();
    vi.mocked(exchangeCodeForTokens).mockResolvedValue({ ...DEFAULT_TOKENS });
    googleAuth = await import('../googleAuth');
    googleAuth.__resetRedirectSettleForTesting();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  const exchange = async () =>
    (await import('../oauthProxy')).exchangeCodeForTokens as ReturnType<typeof vi.fn>;

  it('no-ops to null on native without invoking completeRedirectAuth', async () => {
    caps.native = true;
    seedPendingCode();
    const result = await googleAuth.ensureRedirectAuthSettled();
    expect(result).toBeNull();
    expect(await exchange()).not.toHaveBeenCalled();
    // The one-time code is NOT consumed on native — the deep-link listener owns it.
    expect(sessionStorage.getItem('beanies_redirect_auth_code')).toBe('code-xyz');
  });

  it('resolves null with no pending code (no added work on the common path)', async () => {
    const result = await googleAuth.ensureRedirectAuthSettled();
    expect(result).toBeNull();
    expect(await exchange()).not.toHaveBeenCalled();
  });

  it('redeems the code exactly once across concurrent callers; token valid after', async () => {
    seedPendingCode();
    expect(googleAuth.isTokenValid()).toBe(false); // before settle
    const [a, b] = await Promise.all([
      googleAuth.ensureRedirectAuthSettled(),
      googleAuth.ensureRedirectAuthSettled(),
    ]);
    expect(a).toBe('mock-access-token');
    expect(b).toBe('mock-access-token');
    expect(await exchange()).toHaveBeenCalledTimes(1); // ONE redemption shared by both
    expect(googleAuth.isTokenValid()).toBe(true); // false → true transition
  });

  it('is reject-sticky: a failed exchange stays rejected without re-invoking the inner', async () => {
    (await exchange()).mockRejectedValue(new Error('exchange boom'));
    seedPendingCode();

    await expect(googleAuth.ensureRedirectAuthSettled()).rejects.toThrow('exchange boom');
    // Second call returns the SAME rejected memo — the inner is NOT re-run (which,
    // without the memo, would find no code and resolve null instead of rejecting).
    await expect(googleAuth.ensureRedirectAuthSettled()).rejects.toThrow('exchange boom');
    expect(await exchange()).toHaveBeenCalledTimes(1);
  });

  it('propagates DriveConsentDeniedError to awaiters (typed-error semantics preserved)', async () => {
    (await exchange()).mockResolvedValue({
      access_token: 'at',
      expires_in: 3600,
      token_type: 'Bearer',
      scope: 'userinfo.email', // drive.file NOT granted
    });
    seedPendingCode();
    // Assert on the error identity by name (not `instanceof`) — `vi.resetModules()`
    // gives the re-imported googleAuth a different class instance than a top-level
    // import would hold, so `instanceof` is unreliable across that boundary.
    await expect(googleAuth.ensureRedirectAuthSettled()).rejects.toMatchObject({
      name: 'DriveConsentDeniedError',
    });
  });

  it('__resetRedirectSettleForTesting clears the memo so a later redemption re-runs', async () => {
    seedPendingCode();
    await googleAuth.ensureRedirectAuthSettled();
    expect(await exchange()).toHaveBeenCalledTimes(1);

    googleAuth.__resetRedirectSettleForTesting();
    seedPendingCode(); // a fresh page-load would carry a fresh code
    await googleAuth.ensureRedirectAuthSettled();
    expect(await exchange()).toHaveBeenCalledTimes(2);
  });

  describe('whenRedirectAuthSettled (non-throwing consumer wrapper)', () => {
    it('resolves void and logs one breadcrumb when settlement rejects (never silent)', async () => {
      (await exchange()).mockRejectedValue(new Error('exchange boom'));
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      seedPendingCode();

      await expect(googleAuth.whenRedirectAuthSettled()).resolves.toBeUndefined();
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('redirect-auth settle failed'),
        expect.any(Error)
      );
      warn.mockRestore();
    });

    it('resolves void on success with no breadcrumb', async () => {
      seedPendingCode();
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      await expect(googleAuth.whenRedirectAuthSettled()).resolves.toBeUndefined();
      expect(warn).not.toHaveBeenCalledWith(
        expect.stringContaining('redirect-auth settle failed'),
        expect.anything()
      );
      warn.mockRestore();
    });
  });
});

describe('googleAuth — single-redeemer tripwire (import-scoped)', () => {
  // Load every source module's raw text. `completeRedirectAuth` must be *imported*
  // only by googleAuth.ts itself — the memo (ensureRedirectAuthSettled) + the native
  // listener are the sole redemption callers. Any other file re-introducing a raw
  // call would re-open the double-consume window this fix closed.
  const sources = import.meta.glob('/src/**/*.{ts,vue}', {
    query: '?raw',
    import: 'default',
    eager: true,
  }) as Record<string, string>;

  const isCommentLine = (line: string): boolean => {
    const t = line.trim();
    return t.startsWith('*') || t.startsWith('//') || t.startsWith('/*');
  };

  it('no non-googleAuth, non-test source references completeRedirectAuth outside comments', () => {
    const offenders: string[] = [];
    for (const [path, content] of Object.entries(sources)) {
      if (
        path.includes('/googleAuth.ts') ||
        path.includes('__tests__') ||
        path.includes('.test.') ||
        path.includes('.spec.')
      )
        continue;
      content.split('\n').forEach((line, i) => {
        if (line.includes('completeRedirectAuth') && !isCommentLine(line)) {
          offenders.push(`${path}:${i + 1}: ${line.trim()}`);
        }
      });
    }
    expect(
      offenders,
      `completeRedirectAuth must not be referenced outside googleAuth.ts (except comments):\n${offenders.join('\n')}`
    ).toEqual([]);
  });
});
