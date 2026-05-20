import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useGoogleReconnect } from '../useGoogleReconnect';

vi.mock('@/services/google/googleAuth', () => ({
  requestAccessToken: vi.fn(async () => 'mock-token'),
  hasRefreshToken: vi.fn(() => false),
  shouldUseRedirectAuth: vi.fn(() => false),
  startRedirectAuth: vi.fn(async () => {
    /* noop in tests — would navigate the page in real browser */
  }),
}));

describe('useGoogleReconnect', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reconnect calls requestAccessToken and returns true on success', async () => {
    const { reconnect } = useGoogleReconnect();
    const result = await reconnect();
    expect(result).toBe(true);

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

    expect(result).toBe(false);
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
    // Returns true even though page would navigate in a real browser —
    // ensures callers don't treat the in-flight redirect as a failure.
    expect(result).toBe(true);
  });
});
