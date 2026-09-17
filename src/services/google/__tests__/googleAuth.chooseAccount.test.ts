/**
 * "Sign in with a different Google account" must actually offer a different account.
 *
 * ⚠️ THE DEFECT THIS PINS, and it is an inversion rather than an omission. The only flag callers
 * had was `forceConsent`, which maps to `prompt=consent` — the value that re-asks permission on
 * the account ALREADY signed in and SUPPRESSES Google's chooser. The escape hatch a joiner
 * stranded on the wrong account reaches for was built on it, so on every platform it handed them
 * back the same account. The redirect path was worse still: it hardcoded `'consent'` and could
 * not have shown a chooser whatever it was passed.
 *
 * ⚠️ AND THE PROMPT ALONE IS NOT ENOUGH. Anyone reaching this control is by definition already
 * signed in, so the cached token is valid, the refresh token works, and the silent auth-code
 * exchange succeeds. Each of those returns a token for the account they are trying to leave,
 * before the chooser is ever reached. That is why `chooseAccount` bypasses all three, and why
 * the second test here matters as much as the first.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../pkce', () => ({
  generateCodeVerifier: vi.fn(() => 'verifier'),
  generateCodeChallenge: vi.fn(async () => 'challenge'),
}));
vi.mock('../oauthProxy', () => ({
  exchangeCodeForTokens: vi.fn(async () => ({ access_token: 'a', expires_in: 3600 })),
  refreshAccessToken: vi.fn(async () => ({ access_token: 'refreshed', expires_in: 3600 })),
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

/** The real `window.location`, restored after every test. */
const REAL_LOCATION = window.location;

/**
 * Capture the URL the web redirect path navigates to.
 *
 * ⚠️ PAIRED WITH THE `afterEach` BELOW. The first version redefined `window.location` and
 * never put it back, and each call spread the ALREADY-STUBBED object — so the boxes chained
 * and later tests in the run inherited a location belonging to an earlier one. A test harness
 * that leaks into its neighbours makes every failure after it untrustworthy.
 */
function captureNavigation(): { get href(): string } {
  const box = { href: '' };
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: {
      ...REAL_LOCATION,
      get href() {
        return box.href;
      },
      set href(v: string) {
        box.href = v;
      },
      pathname: '/join',
      search: '',
      origin: 'http://localhost:3000',
    },
  });
  return box;
}

describe('the account chooser is reachable at all', () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    sessionStorage.clear();
    // ⚠️ STUB THE CLIENT ID BEFORE IMPORTING, as the five sibling googleAuth suites do.
    // Without it `googleAuth` throws 'Google Client ID not configured' and all three tests
    // here fail — on CI only, because a developer machine has it in `.env` and the runner
    // does not. It went unnoticed because these tests shipped alongside a brand-asset
    // regression that made 34 suites fail to COLLECT, and a collection failure masks the
    // assertions underneath it.
    vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'test-client-id');
    googleAuth = await import('../googleAuth');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    Object.defineProperty(window, 'location', { configurable: true, value: REAL_LOCATION });
  });

  it('startRedirectAuth asks for select_account when told to', async () => {
    const nav = captureNavigation();
    await googleAuth.startRedirectAuth('/join?fam=f', 'wife@example.com', 'join', {
      prompt: 'select_account',
    });
    expect(nav.href).toContain('prompt=select_account');
    expect(nav.href).not.toContain('prompt=consent');
  });

  it('still defaults to consent for every caller that does not ask', async () => {
    // The default is load-bearing: the reconnect surfaces want a fresh grant on the SAME
    // account, and flipping their behaviour here would be a silent regression elsewhere.
    const nav = captureNavigation();
    await googleAuth.startRedirectAuth('/welcome', 'a@b.com', 'create');
    expect(nav.href).toContain('prompt=consent');
  });

  it('chooseAccount refuses the cached token, which would skip the chooser entirely', async () => {
    // Seed a valid cached token the way a signed-in session holds one.
    googleAuth.__setTokenForTesting?.('cached-token', Date.now() + 3_600_000);
    // Sanity: without the flag, that cached token IS returned. If this ever stops being true
    // the test below proves nothing.
    await expect(googleAuth.requestAccessToken()).resolves.toBe('cached-token');

    // With it, the request must leave the cache behind and go interactive. jsdom has no popup,
    // so the interactive attempt fails — and THAT is the proof: the only way to reach a popup
    // failure is to have declined the cached token first. Before the fix this line resolved to
    // 'cached-token' and the chooser was never reached on any platform.
    await expect(googleAuth.requestAccessToken({ chooseAccount: true })).rejects.toThrow();
  });

  it('offlineAccess KEEPS the cached token — it is a prompt change, not a fresh grant', async () => {
    /**
     * ⚠️ THE EXACT OPPOSITE OF THE TEST ABOVE, and that contrast is the point.
     *
     * `offlineAccess` exists because Google returns a `refresh_token` only when the prompt
     * includes `consent`, and the join path's default prompt is `select_account` alone — so a
     * joiner whose account had already granted these scopes elsewhere ended up with no offline
     * access and Drive died about an hour after they joined.
     *
     * The prompt that fixes it is the same one `chooseAccount` produces. But `chooseAccount`
     * also refuses every silent path (the test above proves that), and refusing the silent
     * token is what forced a full-page redirect instead of the Picker and closed the iOS
     * consent loop. So `offlineAccess` must change the prompt and NOTHING else.
     *
     * If this ever starts rejecting, the loop is back.
     */
    googleAuth.__setTokenForTesting?.('cached-token', Date.now() + 3_600_000);

    await expect(googleAuth.requestAccessToken({ offlineAccess: true })).resolves.toBe(
      'cached-token'
    );
  });
});
