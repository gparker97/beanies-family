import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Native (Capacitor) OAuth deep-link flow — ADR-029 A2. Mirrors the heavy mock
// setup of googleAuth.test.ts and adds the Capacitor plugin mocks. Mocking
// @capacitor/core's isNativePlatform() → true makes capabilities.isNative()
// true, which is what routes googleAuth down the native branches.

vi.mock('../pkce', () => ({
  generateCodeVerifier: vi.fn(() => 'mock-verifier'),
  generateCodeChallenge: vi.fn(async () => 'mock-challenge'),
}));
vi.mock('../oauthProxy', () => ({
  exchangeCodeForTokens: vi.fn(async () => ({
    access_token: 'tok',
    refresh_token: 'rt',
    expires_in: 3600,
    token_type: 'Bearer',
    scope: 'drive.file userinfo.email',
  })),
  refreshAccessToken: vi.fn(),
}));
vi.mock('@/services/sync/fileHandleStore', () => ({
  storeGoogleRefreshToken: vi.fn(async () => {}),
  getGoogleRefreshToken: vi.fn(async () => null),
  clearGoogleRefreshToken: vi.fn(async () => {}),
}));
vi.mock('@/services/indexeddb/database', () => ({ getActiveFamilyId: vi.fn(() => null) }));
vi.mock('@/services/telemetry', () => ({ logEvent: vi.fn() }));
vi.mock('@/utils/errorReporter', () => ({ reportError: vi.fn() }));
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => true, getPlatform: () => 'android' },
}));

const { browserOpen, browserClose, addListener } = vi.hoisted(() => ({
  browserOpen: vi.fn(),
  browserClose: vi.fn(),
  addListener: vi.fn(),
}));
vi.mock('@capacitor/browser', () => ({ Browser: { open: browserOpen, close: browserClose } }));
vi.mock('@capacitor/app', () => ({ App: { addListener } }));

const NATIVE_REDIRECT = 'https://beanies.family/oauth/native';
// The iOS custom-scheme bridge target — the second transport the same handler
// must accept. Kept as a literal here on purpose: this suite is the contract
// test for the deep-link shape, so importing the constant would make it assert
// against itself.
const NATIVE_BRIDGE = 'family.beanies.app://oauth/native';
const STATE_KEY = 'beanies_redirect_auth';

let googleAuth: typeof import('../googleAuth');

function setPending(state: string, returnPath = '/welcome?resume=setup'): void {
  sessionStorage.setItem(STATE_KEY, JSON.stringify({ codeVerifier: 'v', returnPath, state }));
}

describe('googleAuth — native (Capacitor) OAuth deep-link (ADR-029 A2)', () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.resetAllMocks();
    browserOpen.mockResolvedValue(undefined);
    browserClose.mockResolvedValue(undefined);
    addListener.mockResolvedValue({ remove: vi.fn(async () => {}) });
    Object.defineProperty(document, 'hidden', { value: true, configurable: true });
    sessionStorage.clear();
    vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'cid.apps.googleusercontent.com');
    const { exchangeCodeForTokens } = await import('../oauthProxy');
    (exchangeCodeForTokens as ReturnType<typeof vi.fn>).mockResolvedValue({
      access_token: 'tok',
      refresh_token: 'rt',
      expires_in: 3600,
      token_type: 'Bearer',
      scope: 'drive.file userinfo.email',
    });
    googleAuth = await import('../googleAuth');
  });

  afterEach(() => {
    googleAuth.__resetNativeAuthForTesting();
    vi.unstubAllEnvs();
  });

  it('shouldUseRedirectAuth() is true on native — the single source of truth for the transport (ADR-029)', () => {
    expect(googleAuth.shouldUseRedirectAuth()).toBe(true);
  });

  it('Drive-load redirect round-trips LOAD_DRIVE_PATH: startRedirectAuth → valid deep link → onComplete(LOAD_DRIVE_PATH)', async () => {
    // The load-picker path now sets `beanies_redirect_auth` (it didn't before —
    // it used the popup, so the returning deep link was "ignored"). Pin the
    // round-trip: the picker's returnPath survives and the listener navigates to it.
    await googleAuth.startRedirectAuth('/welcome?resume=load-drive', 'a@b.com', 'join');
    expect(browserOpen).toHaveBeenCalledOnce();
    const stored = JSON.parse(sessionStorage.getItem(STATE_KEY)!);
    expect(stored.returnPath).toBe('/welcome?resume=load-drive');

    const onComplete = vi.fn();
    await googleAuth.handleNativeAuthRedirect(
      `${NATIVE_REDIRECT}?code=THE_CODE&state=${stored.state}`,
      onComplete
    );
    expect(onComplete).toHaveBeenCalledWith('/welcome?resume=load-drive');
  });

  it('startRedirectAuth (native) opens the system browser with the App Link redirect_uri + a state param', async () => {
    await googleAuth.startRedirectAuth('/welcome?resume=setup', 'a@b.com', 'create');

    expect(browserOpen).toHaveBeenCalledOnce();
    const url = new URL((browserOpen.mock.calls[0][0] as { url: string }).url);
    expect(url.searchParams.get('redirect_uri')).toBe(NATIVE_REDIRECT);
    expect(url.searchParams.get('state')).toBeTruthy();
    expect(url.searchParams.get('prompt')).toBe('consent'); // offline-access invariant

    const stored = JSON.parse(sessionStorage.getItem(STATE_KEY)!);
    expect(stored.state).toBeTruthy();
    expect(stored.returnPath).toBe('/welcome?resume=setup');
  });

  it('ignores a deep link that is not the OAuth redirect', async () => {
    const onComplete = vi.fn();
    await googleAuth.handleNativeAuthRedirect('https://beanies.family/blog/post', onComplete);
    expect(browserClose).not.toHaveBeenCalled();
    expect(onComplete).not.toHaveBeenCalled();
  });

  it('ignores the redirect when no native auth is in flight (stray/cold-launch/spoofed)', async () => {
    const { logEvent } = await import('@/services/telemetry');
    const { reportError } = await import('@/utils/errorReporter');
    const onComplete = vi.fn();
    await googleAuth.handleNativeAuthRedirect(`${NATIVE_REDIRECT}?code=x&state=y`, onComplete);
    expect(reportError).not.toHaveBeenCalled();
    expect(onComplete).not.toHaveBeenCalled();
    expect(logEvent).toHaveBeenCalled();
  });

  it('treats an OAuth error param as a benign cancel (no reportError, no navigation)', async () => {
    setPending('s');
    const { reportError } = await import('@/utils/errorReporter');
    const onComplete = vi.fn();
    await googleAuth.handleNativeAuthRedirect(
      `${NATIVE_REDIRECT}?error=access_denied&state=s`,
      onComplete
    );
    expect(reportError).not.toHaveBeenCalled();
    expect(onComplete).not.toHaveBeenCalled();
  });

  it('discards the code on a state mismatch (CSRF) and reports it — never exchanges', async () => {
    setPending('expected');
    const { reportError } = await import('@/utils/errorReporter');
    const { exchangeCodeForTokens } = await import('../oauthProxy');
    const onComplete = vi.fn();
    await googleAuth.handleNativeAuthRedirect(
      `${NATIVE_REDIRECT}?code=abc&state=ATTACKER`,
      onComplete
    );
    expect(reportError).toHaveBeenCalledWith(
      expect.objectContaining({ surface: 'native-oauth-state-mismatch' })
    );
    expect(exchangeCodeForTokens).not.toHaveBeenCalled();
    expect(onComplete).not.toHaveBeenCalled();
  });

  it('reports when the redirect has a matching state but no code', async () => {
    setPending('good');
    const { reportError } = await import('@/utils/errorReporter');
    const onComplete = vi.fn();
    await googleAuth.handleNativeAuthRedirect(`${NATIVE_REDIRECT}?state=good`, onComplete);
    expect(reportError).toHaveBeenCalledWith(expect.objectContaining({ surface: 'native-oauth' }));
    expect(onComplete).not.toHaveBeenCalled();
  });

  it('on a valid redirect: completes the exchange, closes the browser, navigates to returnPath', async () => {
    setPending('good', '/welcome?resume=setup');
    const { exchangeCodeForTokens } = await import('../oauthProxy');
    const onComplete = vi.fn();
    await googleAuth.handleNativeAuthRedirect(
      `${NATIVE_REDIRECT}?code=THE_CODE&state=good`,
      onComplete
    );
    expect(exchangeCodeForTokens).toHaveBeenCalledOnce();
    expect(browserClose).toHaveBeenCalled();
    expect(onComplete).toHaveBeenCalledWith('/welcome?resume=setup');
    // the one-time code was consumed
    expect(sessionStorage.getItem('beanies_redirect_auth_code')).toBeNull();
  });

  it('installNativeAuthListener is idempotent (registers at most one appUrlOpen listener)', async () => {
    const onComplete = vi.fn();
    googleAuth.installNativeAuthListener(onComplete);
    googleAuth.installNativeAuthListener(onComplete);
    // allow the addListener promise(s) to settle
    await Promise.resolve();
    expect(addListener).toHaveBeenCalledTimes(1);
    expect(addListener).toHaveBeenCalledWith('appUrlOpen', expect.any(Function));
  });

  // ── Custom-scheme bridge transport ──────────────────────────────────────
  // On iOS the return arrives on `family.beanies.app://oauth/native` rather than
  // the https Universal Link, because Apple fires Universal Links only on
  // user-initiated taps. Both must behave identically; these parameterise the
  // load-bearing cases over the two transports rather than duplicating the suite.
  describe.each([
    ['universal', NATIVE_REDIRECT, 'return_universal'],
    ['custom_scheme', NATIVE_BRIDGE, 'return_custom_scheme'],
  ])('transport: %s', (_label, base, expectedAction) => {
    it('completes the exchange and navigates to returnPath', async () => {
      setPending('good', '/welcome?resume=setup');
      const { exchangeCodeForTokens } = await import('../oauthProxy');
      const onComplete = vi.fn();
      await googleAuth.handleNativeAuthRedirect(`${base}?code=THE_CODE&state=good`, onComplete);
      expect(exchangeCodeForTokens).toHaveBeenCalledOnce();
      expect(browserClose).toHaveBeenCalled();
      expect(onComplete).toHaveBeenCalledWith('/welcome?resume=setup');
    });

    it('still discards the code on a state mismatch (CSRF)', async () => {
      setPending('expected');
      const { reportError } = await import('@/utils/errorReporter');
      const { exchangeCodeForTokens } = await import('../oauthProxy');
      const onComplete = vi.fn();
      await googleAuth.handleNativeAuthRedirect(`${base}?code=abc&state=ATTACKER`, onComplete);
      expect(reportError).toHaveBeenCalledWith(
        expect.objectContaining({ surface: 'native-oauth-state-mismatch' })
      );
      expect(exchangeCodeForTokens).not.toHaveBeenCalled();
      expect(onComplete).not.toHaveBeenCalled();
    });

    it('logs which transport delivered the return', async () => {
      setPending('good');
      const { logEvent } = await import('@/services/telemetry');
      await googleAuth.handleNativeAuthRedirect(`${base}?code=abc&state=good`, vi.fn());
      expect(logEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          surface: 'native-oauth',
          context: expect.objectContaining({ action: expectedAction }),
        })
      );
    });

    it('emits the success counter so the failure rate is measurable', async () => {
      setPending('good');
      const { logEvent } = await import('@/services/telemetry');
      await googleAuth.handleNativeAuthRedirect(`${base}?code=abc&state=good`, vi.fn());
      expect(logEvent).toHaveBeenCalledWith(
        expect.objectContaining({ context: expect.objectContaining({ action: 'complete' }) })
      );
    });
  });

  // The old guard was `url.startsWith(NATIVE_REDIRECT_URI)`, which accepted these.
  it.each([`${NATIVE_REDIRECT}xyz`, `${NATIVE_BRIDGE}xyz`, 'https://evil.com/oauth/native'])(
    'ignores the look-alike deep link %s',
    async (url) => {
      setPending('good');
      const onComplete = vi.fn();
      await googleAuth.handleNativeAuthRedirect(`${url}?code=abc&state=good`, onComplete);
      expect(browserClose).not.toHaveBeenCalled();
      expect(onComplete).not.toHaveBeenCalled();
    }
  );

  // A custom scheme is invokable by any installed app or web page, so a corrupt
  // stash is now reachable. It used to throw into the `void`-ed promise at the
  // listener call site (an unhandled rejection).
  it('treats an unparseable pending-auth stash as "nothing in flight" instead of throwing', async () => {
    sessionStorage.setItem(STATE_KEY, '{not valid json');
    const { logEvent } = await import('@/services/telemetry');
    const { exchangeCodeForTokens } = await import('../oauthProxy');
    const onComplete = vi.fn();

    await expect(
      googleAuth.handleNativeAuthRedirect(`${NATIVE_BRIDGE}?code=abc&state=good`, onComplete)
    ).resolves.toBeUndefined();

    expect(exchangeCodeForTokens).not.toHaveBeenCalled();
    expect(onComplete).not.toHaveBeenCalled();
    expect(logEvent).toHaveBeenCalledWith(
      expect.objectContaining({ context: expect.objectContaining({ action: 'stash_unparseable' }) })
    );
  });

  it('emits the start counter so a never-returned flow shows as an absence', async () => {
    const { logEvent } = await import('@/services/telemetry');
    await googleAuth.startRedirectAuth('/welcome?resume=setup', undefined, 'create');
    expect(logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        surface: 'native-oauth',
        context: expect.objectContaining({ action: 'start' }),
      })
    );
  });
});
