/**
 * The sticky redirect preference, and the popup opener that only OBSERVES a block.
 *
 * ⚠️ THE SPLIT THESE TESTS PIN. The opener cannot tell a person's tap from a gesture-less
 * background `requestAccessToken` (the photo sweep after a laptop sleep), so it logs a block and
 * records nothing; recording there would silently flip a healthy desktop tab to redirect sign-in.
 * The ONE writer is `preferRedirectAuth()`, called only by create's popup-blocked fallback.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { POPUP_AUTH_TIMEOUT_NAME, POPUP_BLOCKED_MESSAGE } from '../oauthError';

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
// A desktop browser tab: every platform signal says "popup".
vi.mock('@/services/sync/capabilities', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/sync/capabilities')>()),
  isNative: vi.fn(() => false),
  isIosOrIpadOs: vi.fn(() => false),
  isStandalone: vi.fn(() => false),
}));

const PREFERENCE_KEY = 'beanies_prefer_redirect_auth';

let googleAuth: typeof import('../googleAuth');
let logEvent: ReturnType<typeof vi.fn>;
let reportError: ReturnType<typeof vi.fn>;

async function freshModule(): Promise<void> {
  vi.resetModules();
  googleAuth = await import('../googleAuth');
  logEvent = vi.mocked((await import('@/services/telemetry')).logEvent);
  reportError = vi.mocked((await import('@/utils/errorReporter')).reportError);
}

function actions(): unknown[] {
  return logEvent.mock.calls.map(
    ([e]) => (e as { context?: { action?: unknown } }).context?.action
  );
}

function setUserActivation(isActive: boolean | undefined): void {
  Object.defineProperty(navigator, 'userActivation', {
    configurable: true,
    value: isActive === undefined ? undefined : { isActive },
  });
}

describe('sticky redirect preference', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    sessionStorage.clear();
    vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'test-client-id');
    await freshModule();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.useRealTimers();
    setUserActivation(undefined);
  });

  it('a desktop tab starts on the popup transport', () => {
    expect(googleAuth.isRedirectAuthPreferred()).toBe(false);
    expect(googleAuth.shouldUseRedirectAuth()).toBe(false);
  });

  it('a blocked popup is LOGGED with its activation state and records NOTHING', async () => {
    // The background case: a gesture-less token request whose popup the browser refuses.
    setUserActivation(false);
    vi.spyOn(window, 'open').mockReturnValue(null);

    await expect(googleAuth.requestAccessToken({ forceConsent: true })).rejects.toThrow(
      POPUP_BLOCKED_MESSAGE
    );

    expect(logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        surface: 'google-auth',
        level: 'info',
        context: { action: 'popup_blocked', detail: 'activation=false' },
      })
    );
    // Observed, never recorded: the transport is unchanged and nothing was persisted.
    expect(googleAuth.shouldUseRedirectAuth()).toBe(false);
    expect(sessionStorage.getItem(PREFERENCE_KEY)).toBeNull();
    expect(actions()).not.toContain('redirect_preferred');
  });

  it('the opener reports activation as unknown where the browser has no userActivation', () => {
    setUserActivation(undefined);
    vi.spyOn(window, 'open').mockReturnValue(null);
    expect(googleAuth.openOAuthPopup('beanies-oauth')).toBeNull();
    expect(logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        context: { action: 'popup_blocked', detail: 'activation=unknown' },
      })
    );
  });

  it('an opened popup logs nothing', () => {
    const popup = { closed: false } as unknown as Window;
    vi.spyOn(window, 'open').mockReturnValue(popup);
    expect(googleAuth.openOAuthPopup('beanies-oauth')).toBe(popup);
    expect(logEvent).not.toHaveBeenCalled();
  });

  it('preferRedirectAuth makes shouldUseRedirectAuth true, persists per tab, and logs once', () => {
    googleAuth.preferRedirectAuth();
    googleAuth.preferRedirectAuth();

    expect(googleAuth.shouldUseRedirectAuth()).toBe(true);
    expect(sessionStorage.getItem(PREFERENCE_KEY)).toBe('1');
    expect(actions().filter((a) => a === 'redirect_preferred')).toHaveLength(1);
  });

  it('stays true when sessionStorage throws: the in-memory flag is primary, and the failure warns once', () => {
    vi.stubGlobal('sessionStorage', {
      getItem: () => null,
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    googleAuth.preferRedirectAuth();

    expect(googleAuth.shouldUseRedirectAuth()).toBe(true);
    expect(reportError).toHaveBeenCalledTimes(1);
    expect(reportError).toHaveBeenCalledWith(
      expect.objectContaining({ surface: 'redirect-preference-storage' })
    );
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('a reload in the same tab keeps the preference, read ONCE at module init', async () => {
    sessionStorage.setItem(PREFERENCE_KEY, '1');
    await freshModule();
    const getItem = vi.fn(() => null);
    vi.stubGlobal('sessionStorage', { getItem, setItem: vi.fn() });

    expect(googleAuth.isRedirectAuthPreferred()).toBe(true);
    expect(googleAuth.shouldUseRedirectAuth()).toBe(true);
    // A synchronous in-memory read: the transport decision never touches storage.
    expect(getItem).not.toHaveBeenCalled();
  });

  it('a new session (empty sessionStorage) tries the popup again', async () => {
    googleAuth.preferRedirectAuth();
    sessionStorage.clear();
    await freshModule();
    expect(googleAuth.shouldUseRedirectAuth()).toBe(false);
  });

  it('the popup cap rejects with POPUP_AUTH_TIMEOUT_NAME, so the create classifier files it as a timeout', async () => {
    vi.useFakeTimers();
    const popup = {
      closed: false,
      close: vi.fn(),
      location: { href: '' },
    } as unknown as Window;
    vi.spyOn(window, 'open').mockReturnValue(popup);

    const pending = googleAuth.requestAccessToken({ forceConsent: true });
    const caught = pending.catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(120_000);

    const e = (await caught) as Error;
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe(POPUP_AUTH_TIMEOUT_NAME);
  });
});
