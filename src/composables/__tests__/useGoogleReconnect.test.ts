import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useGoogleReconnect, reconnectSucceeded } from '../useGoogleReconnect';
import { DriveConsentDeniedError, OAuthRoundTripAbandonedError } from '@/types/sync';

vi.mock('@/services/google/googleAuth', () => ({
  requestAccessToken: vi.fn(async () => 'mock-token'),
  hasRefreshToken: vi.fn(() => false),
  shouldUseRedirectAuth: vi.fn(() => false),
  invalidateAccessToken: vi.fn(),
  isUserCancellation: vi.fn(() => false),
  startRedirectAuth: vi.fn(async () => {
    /* noop in tests — would navigate the page in real browser */
  }),
  awaitNativeOAuthReturn: vi.fn(async () => ({ kind: 'completed' })),
}));

// Native vs web is the whole distinction this composable now draws: on web the page unloads and
// it returns `'redirecting'`; on native nothing unloads and it AWAITS the round trip.
const { isNative } = vi.hoisted(() => ({ isNative: vi.fn(() => false) }));
vi.mock('@/services/sync/capabilities', () => ({ isNative }));

// ⚠️ MOCKED DELIBERATELY. Left unmocked, `tryReconnectSilently` reached into a
// googleAuth factory that has no `isTokenValid`, threw inside its own try, and
// was swallowed by its own catch — so it always returned false and the
// `'recovered'` arm was exercised by nothing at all. A silent path that no test
// can enter is a silent path no test can protect.
const { tryReconnectSilently } = vi.hoisted(() => ({
  tryReconnectSilently: vi.fn(async () => false),
}));
vi.mock('@/services/google/driveTokenRecovery', () => ({ tryReconnectSilently }));

const { logEvent } = vi.hoisted(() => ({ logEvent: vi.fn() }));
vi.mock('@/services/telemetry', () => ({ logEvent }));

describe('useGoogleReconnect', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    // ⚠️ `clearAllMocks` clears CALLS, not return values, so a `mockReturnValue` set by an earlier
    // case leaks into every later one. Restore the web defaults explicitly.
    const { shouldUseRedirectAuth, isUserCancellation } =
      await import('@/services/google/googleAuth');
    vi.mocked(shouldUseRedirectAuth).mockReturnValue(false);
    vi.mocked(isUserCancellation).mockReturnValue(false);
    isNative.mockReturnValue(false);
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

  it('NATIVE: awaits the round trip and reports `reconnected` — the one-tap fix', async () => {
    // ⚠️ THE WHOLE POINT OF THE 2026-09-22 CHANGE. On Capacitor the system browser opens over a
    // live WebView, so this stack survives the trip and the caller's `reconnectSucceeded` branch
    // runs in place. It used to need a per-surface marker + latch + watcher, of which exactly one
    // of the four surfaces had one — the other three cost the person a second tap.
    const { shouldUseRedirectAuth, awaitNativeOAuthReturn } =
      await import('@/services/google/googleAuth');
    vi.mocked(shouldUseRedirectAuth).mockReturnValue(true);
    isNative.mockReturnValue(true);
    vi.mocked(awaitNativeOAuthReturn).mockResolvedValue({ kind: 'completed' });

    const { reconnect } = useGoogleReconnect();
    const result = await reconnect();

    expect(result).toBe('reconnected');
    expect(reconnectSucceeded(result)).toBe(true);
  });

  it("NATIVE: a failed trip surfaces as `failed`, with the trip's own message", async () => {
    const { shouldUseRedirectAuth, awaitNativeOAuthReturn } =
      await import('@/services/google/googleAuth');
    vi.mocked(shouldUseRedirectAuth).mockReturnValue(true);
    isNative.mockReturnValue(true);
    vi.mocked(awaitNativeOAuthReturn).mockResolvedValue({
      kind: 'failed',
      error: new DriveConsentDeniedError('Google Drive file access was not granted.'),
    });

    const { reconnect, reconnectError } = useGoogleReconnect();
    const result = await reconnect();

    expect(result).toBe('failed');
    expect(reconnectError.value).toBe('Google Drive file access was not granted.');
  });

  it('an ABANDONED native trip is logged as a decision, not a fault, and says nothing itself', async () => {
    // ⚠️ TWO THINGS AT ONCE, BOTH ABOUT NATIVE MAKING "close the sheet" COMMON.
    // (1) `reconnectError` must stay NULL: four call sites render it verbatim and this error's
    //     message is untranslated English; null is what lets each fall back to its own `t()` key.
    // (2) The event must NOT land in the `warn`/`reconnect-failed` bucket, which is the reconnect
    //     SUCCESS-RATE denominator. Counting people who changed their mind as failures measures
    //     nothing.
    const { shouldUseRedirectAuth, awaitNativeOAuthReturn } =
      await import('@/services/google/googleAuth');
    vi.mocked(shouldUseRedirectAuth).mockReturnValue(true);
    isNative.mockReturnValue(true);
    vi.mocked(awaitNativeOAuthReturn).mockResolvedValue({
      kind: 'failed',
      error: new OAuthRoundTripAbandonedError('dismissed'),
    });

    const { reconnect, reconnectError } = useGoogleReconnect();
    const result = await reconnect();

    expect(result).toBe('failed');
    expect(reconnectSucceeded(result)).toBe(false);
    expect(reconnectError.value).toBeNull();
    expect(logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'info',
        context: expect.objectContaining({ action: 'reconnect-abandoned' }),
      })
    );
  });

  it('a CLOSED DESKTOP POPUP is a decision too — the native arm must not be the only one', async () => {
    // ⚠️ THE POPUP IS THE COMMON TRANSPORT, and it rejects with a plain `Error`, not
    // `OAuthRoundTripAbandonedError`. Classifying only the native error left desktop painting
    // the raw English "Authentication cancelled" and counting a deliberate abort as a failure in
    // the reconnect success rate.
    const { requestAccessToken, isUserCancellation } = await import('@/services/google/googleAuth');
    vi.mocked(isUserCancellation).mockReturnValue(true);
    vi.mocked(requestAccessToken).mockRejectedValueOnce(new Error('Authentication cancelled'));

    const { reconnect, reconnectError } = useGoogleReconnect();
    const result = await reconnect();

    expect(result).toBe('failed');
    expect(reconnectError.value).toBeNull();
    expect(logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'info',
        context: expect.objectContaining({ action: 'reconnect-abandoned' }),
      })
    );
  });

  it('a GENUINE failure still reports as one, with the reason attached', async () => {
    const { requestAccessToken, isUserCancellation } = await import('@/services/google/googleAuth');
    vi.mocked(isUserCancellation).mockReturnValue(false);
    vi.mocked(requestAccessToken).mockRejectedValueOnce(new Error('Drive 500'));

    const { reconnect, reconnectError } = useGoogleReconnect();
    expect(await reconnect()).toBe('failed');
    expect(reconnectError.value).toBe('Drive 500');
    expect(logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'warn',
        context: expect.objectContaining({ action: 'reconnect-failed' }),
      })
    );
  });

  it('reports `recovered` when the silent path restores the connection', async () => {
    // The cheapest possible reconnect: no consent screen at all. Until the
    // recovery module was mocked, no test could reach this arm.
    tryReconnectSilently.mockResolvedValueOnce(true);
    const { reconnect } = useGoogleReconnect();

    const result = await reconnect();

    expect(result).toBe('recovered');
    expect(reconnectSucceeded(result)).toBe(true);
    const { requestAccessToken } = await import('@/services/google/googleAuth');
    expect(requestAccessToken).not.toHaveBeenCalled();
  });

  it('counts EVERY outcome, including the redirect nobody was measuring', async () => {
    // ⚠️ SIX SURFACES RAISE A RECONNECT and between them they emitted almost
    // nothing: every redirect arm was silent, so a native user who dismissed the
    // consent tab left no trace at all, and the success arms were counted on two
    // of the six — so the reconnect success RATE was not measurable. Emitting in
    // the composable makes it one number for all six.
    const { shouldUseRedirectAuth } = await import('@/services/google/googleAuth');

    const { reconnect } = useGoogleReconnect();
    await reconnect();
    expect(logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        context: expect.objectContaining({ action: 'reconnect-reconnected' }),
      })
    );

    logEvent.mockClear();
    vi.mocked(shouldUseRedirectAuth).mockReturnValueOnce(true);
    await reconnect();
    expect(logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'info',
        context: expect.objectContaining({ action: 'reconnect-redirecting' }),
      })
    );

    logEvent.mockClear();
    tryReconnectSilently.mockResolvedValueOnce(true);
    await reconnect();
    expect(logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        context: expect.objectContaining({ action: 'reconnect-recovered' }),
      })
    );
  });

  it('reports a FAILED reconnect at warn, with the reason attached', async () => {
    const { requestAccessToken } = await import('@/services/google/googleAuth');
    vi.mocked(requestAccessToken).mockRejectedValueOnce(new Error('popup_closed'));

    const { reconnect } = useGoogleReconnect();
    const result = await reconnect();

    expect(result).toBe('failed');
    expect(logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'warn',
        context: expect.objectContaining({ action: 'reconnect-failed', detail: 'popup_closed' }),
      })
    );
  });

  it('does NOT destroy a working access token just because the button was pressed', async () => {
    // ⚠️ THIS ASSERTION IS INVERTED FROM THE ONE IT REPLACES, on purpose.
    //
    // An earlier fix invalidated the cached token at the top of every reconnect,
    // to stop `tryReconnectSilently` short-circuiting on `isTokenValid()` after a
    // grant was revoked elsewhere. That is a real bug — but this button also
    // renders for ANY `syncStore.error`, so pressing it on a non-auth failure
    // threw away a token Google still accepted, and forcing the ladder to run
    // every time pushed `consecutiveSilentRefreshFailures` toward the
    // permanent-failure banner before the consent screen could open.
    //
    // The 401 is now observed where it arrives (`driveService.driveRequest`),
    // which covers every consumer of `isTokenValid()` rather than this one
    // button. See `driveService.test.ts`.
    const { invalidateAccessToken } = await import('@/services/google/googleAuth');

    const { reconnect } = useGoogleReconnect();
    await reconnect();

    expect(invalidateAccessToken).not.toHaveBeenCalled();
  });
});
