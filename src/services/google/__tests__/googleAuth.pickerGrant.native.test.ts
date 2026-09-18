import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * #98 — the PICKER grant on the NATIVE (Capacitor) deep-link arm.
 *
 * This is the platform the whole mechanism exists for, and the arm is one reorder away from three
 * different disasters. Each test below pins one of them:
 *
 *   1. the Drive fallthrough would EXCHANGE the `drive.file`-only code and commit it over the
 *      app's main Drive token, silently stripping `userinfo.email`;
 *   2. the `error` arm would call `clearGoogleSessionState()`, signing a joiner out of Google for
 *      closing a file chooser;
 *   3. the `!code` arm would file a `reportError`, paging a developer for the same non-event.
 *
 * The picker arm therefore sits immediately BELOW the CSRF check and ABOVE all three, and clears
 * only its own stash. If someone later "tidies" the ladder back, these fail.
 */

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
  Capacitor: { isNativePlatform: () => true, getPlatform: () => 'ios' },
}));

const { browserOpen, browserClose, addListener } = vi.hoisted(() => ({
  browserOpen: vi.fn(),
  browserClose: vi.fn(),
  addListener: vi.fn(),
}));
vi.mock('@capacitor/browser', () => ({ Browser: { open: browserOpen, close: browserClose } }));
vi.mock('@capacitor/app', () => ({ App: { addListener } }));

const NATIVE_REDIRECT = 'https://beanies.family/oauth/native';
const STATE_KEY = 'beanies_redirect_auth';
const DRIVE_CODE_KEY = 'beanies_redirect_auth_code';
const PICKER_KEY = 'beanies_redirect_auth_code:picker';
const DRIVE_FILE = 'https://www.googleapis.com/auth/drive.file';
const RETURN = '/join?fam=abc';

let googleAuth: typeof import('../googleAuth');

async function startPicker(): Promise<{ state: string }> {
  await googleAuth.startRedirectAuth(RETURN, 'joiner@example.com', 'join', {
    grant: 'picker',
    scope: DRIVE_FILE,
    extraParams: { trigger_onepick: 'true' },
  });
  return JSON.parse(sessionStorage.getItem(STATE_KEY)!) as { state: string };
}

describe('googleAuth — picker grant (native deep-link routing)', () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.resetAllMocks();
    browserOpen.mockResolvedValue(undefined);
    browserClose.mockResolvedValue(undefined);
    addListener.mockResolvedValue({ remove: vi.fn(async () => {}) });
    sessionStorage.clear();
    vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'cid.apps.googleusercontent.com');
    googleAuth = await import('../googleAuth');
  });
  afterEach(() => {
    googleAuth.__resetNativeAuthForTesting();
    vi.unstubAllEnvs();
  });

  it('the outbound URL carries trigger_onepick and EXACTLY the drive.file scope', async () => {
    await startPicker();
    const url = new URL((browserOpen.mock.calls[0][0] as { url: string }).url);
    expect(url.searchParams.get('trigger_onepick')).toBe('true');
    expect(url.searchParams.get('scope')).toBe(DRIVE_FILE);
    expect(url.searchParams.get('scope')).not.toContain('userinfo.email');
    expect(url.searchParams.get('access_type')).toBe('offline');
    expect(url.searchParams.get('prompt')).toBe('consent');
  });

  it('the native stash records the picker grant (it used to be dropped)', async () => {
    await startPicker();
    const stored = JSON.parse(sessionStorage.getItem(STATE_KEY)!);
    expect(stored.grant).toBe('picker');
  });

  /** INVARIANT 1: the scope-limited code is never exchanged and never committed. */
  it('stashes the selection, clears its own stash, and NEVER exchanges the code', async () => {
    const stored = await startPicker();
    const { exchangeCodeForTokens } = await import('../oauthProxy');
    const onComplete = vi.fn();

    await googleAuth.handleNativeAuthRedirect(
      `${NATIVE_REDIRECT}?code=PICKER_CODE&picked_file_ids=FILE_A&state=${stored.state}`,
      onComplete
    );

    expect(JSON.parse(sessionStorage.getItem(PICKER_KEY)!)).toMatchObject({ ids: 'FILE_A' });
    // ⚠️ The three things that must NOT happen.
    expect(exchangeCodeForTokens).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(DRIVE_CODE_KEY)).toBeNull();
    expect(sessionStorage.getItem(STATE_KEY)).toBeNull();
    expect(onComplete).toHaveBeenCalledWith(RETURN);
  });

  /** INVARIANT 2: closing the chooser must not cost the joiner their Google session. */
  it('a cancel (no code, no ids) does not report, does not exchange, and returns to the join', async () => {
    const stored = await startPicker();
    const { reportError } = await import('@/utils/errorReporter');
    const { exchangeCodeForTokens } = await import('../oauthProxy');
    const onComplete = vi.fn();

    await googleAuth.handleNativeAuthRedirect(
      `${NATIVE_REDIRECT}?state=${stored.state}`,
      onComplete
    );

    expect(reportError).not.toHaveBeenCalled();
    expect(exchangeCodeForTokens).not.toHaveBeenCalled();
    expect(onComplete).toHaveBeenCalledWith(RETURN);
  });

  it('a decline (error=access_denied) is handled by the picker arm, not the error arm', async () => {
    const stored = await startPicker();
    const onComplete = vi.fn();

    await googleAuth.handleNativeAuthRedirect(
      `${NATIVE_REDIRECT}?error=access_denied&state=${stored.state}`,
      onComplete
    );

    // Reached the picker arm: it returned to the join rather than tearing the session down.
    expect(onComplete).toHaveBeenCalledWith(RETURN);
  });

  /**
   * THE REORDER'S ONE BEHAVIOUR DELTA, pinned deliberately. A state mismatch is now rejected
   * BEFORE the error arm, which also closes a small hole: any installed app could previously
   * invoke the custom scheme with `?error=x` during a live auth and force a session teardown
   * without ever matching the nonce.
   */
  it('a state mismatch is rejected before the picker arm is ever reached', async () => {
    await startPicker();
    const { reportError } = await import('@/utils/errorReporter');
    const onComplete = vi.fn();

    await googleAuth.handleNativeAuthRedirect(
      `${NATIVE_REDIRECT}?code=X&picked_file_ids=FILE_A&state=WRONG`,
      onComplete
    );

    expect(sessionStorage.getItem(PICKER_KEY)).toBeNull();
    expect(onComplete).not.toHaveBeenCalled();
    expect(reportError).toHaveBeenCalledWith(
      expect.objectContaining({ surface: 'native-oauth-state-mismatch' })
    );
  });

  it('an error return with a MISMATCHED state now reports instead of silently clearing', async () => {
    await startPicker();
    const { reportError } = await import('@/utils/errorReporter');

    await googleAuth.handleNativeAuthRedirect(
      `${NATIVE_REDIRECT}?error=access_denied&state=WRONG`,
      vi.fn()
    );

    expect(reportError).toHaveBeenCalledWith(
      expect.objectContaining({ surface: 'native-oauth-state-mismatch' })
    );
  });

  /** The regression guard on the reorder: the Drive arm must be untouched. */
  it('a DRIVE grant still exchanges inline, unchanged by the reorder', async () => {
    await googleAuth.startRedirectAuth('/welcome?resume=setup', 'a@b.com', 'create');
    const stored = JSON.parse(sessionStorage.getItem(STATE_KEY)!);
    const { exchangeCodeForTokens } = await import('../oauthProxy');
    const onComplete = vi.fn();

    await googleAuth.handleNativeAuthRedirect(
      `${NATIVE_REDIRECT}?code=DRIVE_CODE&state=${stored.state}`,
      onComplete
    );

    expect(exchangeCodeForTokens).toHaveBeenCalledOnce();
    expect(sessionStorage.getItem(PICKER_KEY)).toBeNull();
    expect(onComplete).toHaveBeenCalledWith('/welcome?resume=setup');
  });

  it('a DRIVE grant with an error is still a benign cancel (no report)', async () => {
    await googleAuth.startRedirectAuth('/welcome?resume=setup', 'a@b.com', 'create');
    const stored = JSON.parse(sessionStorage.getItem(STATE_KEY)!);
    const { reportError } = await import('@/utils/errorReporter');

    await googleAuth.handleNativeAuthRedirect(
      `${NATIVE_REDIRECT}?error=access_denied&state=${stored.state}`,
      vi.fn()
    );

    expect(reportError).not.toHaveBeenCalled();
  });
});
