import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useGoogleReconnect, reconnectSucceeded } from '../useGoogleReconnect';

vi.mock('@/services/google/googleAuth', () => ({
  requestAccessToken: vi.fn(async () => 'mock-token'),
  hasRefreshToken: vi.fn(() => false),
  shouldUseRedirectAuth: vi.fn(() => false),
  invalidateAccessToken: vi.fn(),
  startRedirectAuth: vi.fn(async () => {
    /* noop in tests — would navigate the page in real browser */
  }),
}));

describe('useGoogleReconnect', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reconnect calls requestAccessToken and reports reconnected on success', async () => {
    const { reconnect } = useGoogleReconnect();
    const result = await reconnect();
    expect(result).toBe('reconnected');
    expect(reconnectSucceeded(result)).toBe(true);

    const { requestAccessToken } = await import('@/services/google/googleAuth');
    expect(requestAccessToken).toHaveBeenCalledWith({ forceConsent: true });
  });

  it('reconnect sets reconnectError on failure', async () => {
    const { requestAccessToken } = await import('@/services/google/googleAuth');
    (requestAccessToken as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('Auth failed')
    );

    const { reconnect, reconnectError } = useGoogleReconnect();
    const result = await reconnect();

    expect(result).toBe('failed');
    expect(reconnectSucceeded(result)).toBe(false);
    expect(reconnectError.value).toBe('Auth failed');
  });

  it('isReconnecting is true during reconnect', async () => {
    const { requestAccessToken } = await import('@/services/google/googleAuth');
    let resolveAuth: (v: string) => void;
    (requestAccessToken as ReturnType<typeof vi.fn>).mockReturnValueOnce(
      new Promise<string>((resolve) => {
        resolveAuth = resolve;
      })
    );

    const { reconnect, isReconnecting } = useGoogleReconnect();
    expect(isReconnecting.value).toBe(false);

    const promise = reconnect();
    expect(isReconnecting.value).toBe(true);

    resolveAuth!('token');
    await promise;
    expect(isReconnecting.value).toBe(false);
  });

  it('always forces consent on the popup path, even when a refresh token exists', async () => {
    // Regression guard for the 2026-05-20 fix: a stale stored token must NOT
    // suppress consent — otherwise Google uses prompt=select_account and returns
    // no new refresh token (the reconnect-every-launch bug).
    const { hasRefreshToken, requestAccessToken } = await import('@/services/google/googleAuth');
    (hasRefreshToken as ReturnType<typeof vi.fn>).mockReturnValueOnce(true);

    const { reconnect } = useGoogleReconnect();
    await reconnect();

    expect(requestAccessToken).toHaveBeenCalledWith({ forceConsent: true });
  });

  it('routes through startRedirectAuth on standalone PWAs', async () => {
    const { shouldUseRedirectAuth, startRedirectAuth, requestAccessToken } =
      await import('@/services/google/googleAuth');
    (shouldUseRedirectAuth as ReturnType<typeof vi.fn>).mockReturnValueOnce(true);

    const { reconnect } = useGoogleReconnect();
    const result = await reconnect();

    expect(startRedirectAuth).toHaveBeenCalled();
    expect(requestAccessToken).not.toHaveBeenCalled();
    // ⚠️ `'redirecting'`, and it must NOT satisfy `reconnectSucceeded`. The page
    // is on its way to Google and nothing has been acquired. This used to be
    // `true`, and two call sites read that as success: they cleared the reconnect
    // banner and fired a Drive read plus a full pod upload on the still-dead
    // token while the user was looking at the consent screen.
    expect(result).toBe('redirecting');
    expect(reconnectSucceeded(result)).toBe(false);
  });

  it('drops the cached access token BEFORE trying the silent path', async () => {
    // Without this a "reconnect" can reconnect nothing: when the grant was
    // revoked on ANOTHER device the local token has not passed its own expiry,
    // so `tryReconnectSilently` short-circuits on `isTokenValid()` and returns
    // true without contacting Google. The caller then reports success and the
    // next request 401s identically, forever.
    const { invalidateAccessToken } = await import('@/services/google/googleAuth');

    const { reconnect } = useGoogleReconnect();
    await reconnect();

    expect(invalidateAccessToken).toHaveBeenCalled();
  });
});
