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
import type { OAuthRoundTripAbandonedError } from '@/types/sync';

// Mutable so the visibility-backstop cases can assert that it is ANDROID-ONLY (see the
// `installSheetClosedListeners` docblock: on iOS `visible` also fires when the app returns from
// the background with the sheet still up, which would settle a live trip as dismissed).
const { platform } = vi.hoisted(() => ({ platform: { value: 'android' } }));
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => true, getPlatform: () => platform.value },
}));

const { browserOpen, browserClose, browserAddListener, addListener } = vi.hoisted(() => ({
  browserOpen: vi.fn(),
  browserClose: vi.fn(),
  // Typed params so `mock.calls` is a real tuple — the dismissal cases read the registered
  // `browserFinished` callback back out of it.
  browserAddListener: vi.fn(async (_event: string, _cb: () => void) => ({
    remove: vi.fn(async () => {}),
  })),
  addListener: vi.fn(),
}));
vi.mock('@capacitor/browser', () => ({
  Browser: {
    open: browserOpen,
    close: browserClose,
    // `installNativeAuthListener` registers the `browserFinished` dismissal signal through this.
    addListener: browserAddListener,
  },
}));
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
    browserAddListener.mockResolvedValue({ remove: vi.fn(async () => {}) });
    addListener.mockResolvedValue({ remove: vi.fn(async () => {}) });
    platform.value = 'android';
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

  // ── The awaited round trip (2026-09-22) ─────────────────────────────────────
  //
  // ⚠️ WHAT THESE PROTECT. On native nothing unloads, so the seam that STARTED the trip is still
  // on the stack when it ends — which is why `connectDriveStorage` and `useGoogleReconnect` can
  // await instead of leaving a marker for a remount that never happens. The whole design rests on
  // one property: `awaitNativeOAuthReturn()` ALWAYS settles. Every case below is one way it could
  // fail to, and the "dismissed" ones are the reason the grace timer exists at all.
  describe('awaitNativeOAuthReturn — the trip always settles', () => {
    /**
     * ⚠️ RESOLVE THE ERROR CLASSES THROUGH THE SAME REGISTRY googleAuth SEES. `beforeEach` calls
     * `vi.resetModules()`, so a STATIC `import { DriveConsentDeniedError } from '@/types/sync'`
     * at the top of this file binds a different module instance than the one the re-imported
     * googleAuth closes over — and every `instanceof` silently answers false.
     */
    const syncTypes = () => import('@/types/sync');

    /** Install the listeners and hand back the `browserFinished` callback the plugin registered. */
    function armSheetListeners(): () => void {
      googleAuth.installNativeAuthListener(vi.fn());
      const call = browserAddListener.mock.calls.find((c) => c[0] === 'browserFinished');
      expect(call, 'browserFinished must be registered by installNativeAuthListener').toBeTruthy();
      return call![1] as () => void;
    }

    it('a valid deep link settles it `completed`, and still navigates', async () => {
      await googleAuth.startRedirectAuth('/welcome?resume=setup', undefined, 'create');
      const stored = JSON.parse(sessionStorage.getItem(STATE_KEY)!);
      const trip = googleAuth.awaitNativeOAuthReturn();

      const onComplete = vi.fn();
      await googleAuth.handleNativeAuthRedirect(
        `${NATIVE_REDIRECT}?code=THE_CODE&state=${stored.state}`,
        onComplete
      );

      await expect(trip).resolves.toEqual({ kind: 'completed' });
      expect(onComplete).toHaveBeenCalledWith('/welcome?resume=setup');
    });

    it('`error=access_denied` settles it as ABANDONED/declined — a decision, not a fault', async () => {
      const { reportError } = await import('@/utils/errorReporter');
      await googleAuth.startRedirectAuth('/welcome?resume=setup', undefined, 'create');
      const stored = JSON.parse(sessionStorage.getItem(STATE_KEY)!);
      const trip = googleAuth.awaitNativeOAuthReturn();

      await googleAuth.handleNativeAuthRedirect(
        `${NATIVE_REDIRECT}?error=access_denied&state=${stored.state}`,
        vi.fn()
      );

      const outcome = await trip;
      expect(outcome.kind).toBe('failed');
      if (outcome.kind !== 'failed') return;
      expect(outcome.error).toBeInstanceOf((await syncTypes()).OAuthRoundTripAbandonedError);
      expect((outcome.error as OAuthRoundTripAbandonedError).reason).toBe('declined');
      expect(reportError).not.toHaveBeenCalled();
    });

    it('a consent denial arrives as the DriveConsentDeniedError itself, and stashes nothing', async () => {
      // ⚠️ NO RESUME-REASON STASH ON NATIVE. The awaiting seam has the error in hand; a hint
      // written here could only be read by the wrong flow later (a declined Drive LOAD leaving
      // "allow file access" for the next create screen).
      const { reportError } = await import('@/utils/errorReporter');
      const { exchangeCodeForTokens } = await import('../oauthProxy');
      const { DriveConsentDeniedError } = await syncTypes();
      const denial = new DriveConsentDeniedError('Google Drive file access was not granted.');
      vi.mocked(exchangeCodeForTokens).mockRejectedValueOnce(denial);

      await googleAuth.startRedirectAuth('/welcome?resume=setup', undefined, 'create');
      const stored = JSON.parse(sessionStorage.getItem(STATE_KEY)!);
      const trip = googleAuth.awaitNativeOAuthReturn();

      await googleAuth.handleNativeAuthRedirect(
        `${NATIVE_REDIRECT}?code=THE_CODE&state=${stored.state}`,
        vi.fn()
      );

      await expect(trip).resolves.toEqual({ kind: 'failed', error: denial });
      expect(reportError).toHaveBeenCalledWith(
        expect.objectContaining({
          severity: 'warning',
          context: expect.objectContaining({ error_code: 'drive-consent-denied' }),
        })
      );
      expect(sessionStorage.getItem('beanies:resume-reason')).toBeNull();
    });

    it('a closed sheet with no deep link settles it DISMISSED after the grace', async () => {
      vi.useFakeTimers();
      try {
        const onBrowserFinished = armSheetListeners();
        await googleAuth.startRedirectAuth('/welcome?resume=setup', undefined, 'create');
        const trip = googleAuth.awaitNativeOAuthReturn();

        onBrowserFinished();
        await vi.advanceTimersByTimeAsync(2600);

        const outcome = await trip;
        expect(outcome.kind).toBe('failed');
        if (outcome.kind !== 'failed') return;
        expect((outcome.error as OAuthRoundTripAbandonedError).reason).toBe('dismissed');
      } finally {
        vi.useRealTimers();
      }
    });

    it('a deep link INSIDE the grace wins — the sheet closing WAS the return', async () => {
      vi.useFakeTimers();
      try {
        const onBrowserFinished = armSheetListeners();
        await googleAuth.startRedirectAuth('/welcome?resume=setup', undefined, 'create');
        const stored = JSON.parse(sessionStorage.getItem(STATE_KEY)!);
        const trip = googleAuth.awaitNativeOAuthReturn();

        onBrowserFinished();
        await vi.advanceTimersByTimeAsync(500);
        await googleAuth.handleNativeAuthRedirect(
          `${NATIVE_REDIRECT}?code=THE_CODE&state=${stored.state}`,
          vi.fn()
        );
        await vi.advanceTimersByTimeAsync(3000);

        await expect(trip).resolves.toEqual({ kind: 'completed' });
      } finally {
        vi.useRealTimers();
      }
    });

    it('settles even when the trip ENDED before anyone awaited it', async () => {
      // The window between `Browser.open` resolving and the gate reaching its await is real; a
      // settled trip must stay readable until the next arm or the seam hangs forever.
      await googleAuth.startRedirectAuth('/welcome?resume=setup', undefined, 'create');
      const stored = JSON.parse(sessionStorage.getItem(STATE_KEY)!);
      await googleAuth.handleNativeAuthRedirect(
        `${NATIVE_REDIRECT}?code=THE_CODE&state=${stored.state}`,
        vi.fn()
      );

      await expect(googleAuth.awaitNativeOAuthReturn()).resolves.toEqual({ kind: 'completed' });
    });

    it('with NOTHING ever armed it resolves failed and reports — never hangs', async () => {
      const { reportError } = await import('@/utils/errorReporter');
      const outcome = await googleAuth.awaitNativeOAuthReturn();
      expect(outcome.kind).toBe('failed');
      expect(reportError).toHaveBeenCalledWith(
        expect.objectContaining({ surface: 'native-oauth', severity: 'error' })
      );
    });

    it('a SECOND start supersedes the first, which settles dismissed rather than hanging', async () => {
      await googleAuth.startRedirectAuth('/welcome?resume=setup', undefined, 'create');
      const first = googleAuth.awaitNativeOAuthReturn();

      await googleAuth.startRedirectAuth('/welcome?resume=setup', undefined, 'create');

      const outcome = await first;
      expect(outcome.kind).toBe('failed');
      if (outcome.kind !== 'failed') return;
      expect((outcome.error as OAuthRoundTripAbandonedError).reason).toBe('dismissed');
    });

    it('ANDROID: a visibilitychange→visible with no deep link also settles it dismissed', async () => {
      // Custom Tabs are a separate activity, so MainActivity is paused while the tab is up —
      // `visible` can only mean the tab is gone. This is the backstop for Android's own
      // `browserFinished` heuristic (Browser.java calls it that in its own comment).
      vi.useFakeTimers();
      try {
        platform.value = 'android';
        googleAuth.installNativeAuthListener(vi.fn());
        await googleAuth.startRedirectAuth('/welcome?resume=setup', undefined, 'create');
        const trip = googleAuth.awaitNativeOAuthReturn();

        Object.defineProperty(document, 'visibilityState', {
          value: 'visible',
          configurable: true,
        });
        document.dispatchEvent(new Event('visibilitychange'));
        await vi.advanceTimersByTimeAsync(2600);

        const outcome = await trip;
        expect(outcome.kind).toBe('failed');
        if (outcome.kind !== 'failed') return;
        expect((outcome.error as OAuthRoundTripAbandonedError).reason).toBe('dismissed');
      } finally {
        vi.useRealTimers();
      }
    });

    it('iOS: visibilitychange→visible arms NOTHING — the sheet may still be up', async () => {
      // ⚠️ DO NOT WIDEN THE BACKSTOP TO iOS. The sheet is a modal over the same view controller,
      // so `visible` ALSO fires when the app returns from the background with consent still on
      // screen (a phone call mid-consent) — it would settle a live trip as dismissed under an
      // open sheet.
      vi.useFakeTimers();
      try {
        platform.value = 'ios';
        googleAuth.installNativeAuthListener(vi.fn());
        await googleAuth.startRedirectAuth('/welcome?resume=setup', undefined, 'create');
        let settled = false;
        void googleAuth.awaitNativeOAuthReturn().then(() => {
          settled = true;
        });

        Object.defineProperty(document, 'visibilityState', {
          value: 'visible',
          configurable: true,
        });
        document.dispatchEvent(new Event('visibilitychange'));
        await vi.advanceTimersByTimeAsync(5000);

        expect(settled, 'the trip must still be live — the sheet may not be gone').toBe(false);
      } finally {
        vi.useRealTimers();
      }
    });

    it('a failed Browser.open settles the trip AND rethrows to the caller', async () => {
      browserOpen.mockRejectedValueOnce(new Error('no browser'));
      await expect(
        googleAuth.startRedirectAuth('/welcome?resume=setup', undefined, 'create')
      ).rejects.toThrow('no browser');

      const outcome = await googleAuth.awaitNativeOAuthReturn();
      expect(outcome.kind).toBe('failed');
      if (outcome.kind !== 'failed') return;
      expect(outcome.error.message).toBe('no browser');
    });

    it('a throw OUT of the handler body still settles the trip, and is reported', async () => {
      // ⚠️ THE TRIGGER IS THE `return_*` LOG, which is the body's FIRST statement and sits
      // outside every try in it. An earlier version of this case threw from `onComplete`
      // instead and passed for the WRONG reason: `onComplete` was then inside the exchange's
      // try, so a thrown router turned a SUCCESSFUL exchange into a reported `exchange-failed`
      // on a live token. The case below pins that separately.
      const { reportError } = await import('@/utils/errorReporter');
      const { logEvent } = await import('@/services/telemetry');
      await googleAuth.startRedirectAuth('/welcome?resume=setup', undefined, 'create');
      const stored = JSON.parse(sessionStorage.getItem(STATE_KEY)!);
      const trip = googleAuth.awaitNativeOAuthReturn();

      vi.mocked(logEvent).mockImplementationOnce(() => {
        throw new Error('telemetry blew up');
      });
      await googleAuth.handleNativeAuthRedirect(
        `${NATIVE_REDIRECT}?code=THE_CODE&state=${stored.state}`,
        vi.fn()
      );

      const outcome = await trip;
      expect(outcome.kind).toBe('failed');
      expect(reportError).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'native OAuth completion threw outside its arms',
          severity: 'error',
        })
      );
    });

    it('a throwing NAVIGATION never turns a committed token into a failure', async () => {
      // ⚠️ THE SINK TODAY CANNOT ACTUALLY THROW, and saying so is more useful than overstating
      // this. `App.vue`'s sink is `void router.replace(...)`: the `void` swallows a rejection,
      // and vue-router RESOLVES with a `NavigationFailure` rather than rejecting when a guard
      // cancels. So this pins a property of the CONTRACT, not a live bug — `onComplete` is
      // injected, and the next sink someone writes may well throw.
      //
      // The property: a navigation failure must never be reported as an auth failure. When
      // `onComplete` sat inside the exchange's try, a throwing sink filed `exchange-failed`
      // against a token that HAD been committed, called `onComplete` a second time, and handed
      // the awaiting seam `failed` — so the resume screen would drop back to the storage picker
      // and the person would re-consent on a live connection.
      const { reportError } = await import('@/utils/errorReporter');
      await googleAuth.startRedirectAuth('/welcome?resume=setup', undefined, 'create');
      const stored = JSON.parse(sessionStorage.getItem(STATE_KEY)!);
      const trip = googleAuth.awaitNativeOAuthReturn();

      const onComplete = vi.fn(() => {
        throw new Error('router blew up');
      });
      await googleAuth.handleNativeAuthRedirect(
        `${NATIVE_REDIRECT}?code=THE_CODE&state=${stored.state}`,
        onComplete
      );

      await expect(trip).resolves.toEqual({ kind: 'completed' });
      expect(onComplete).toHaveBeenCalledTimes(1);
      expect(reportError).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'navigating to the OAuth returnPath threw',
          severity: 'warning',
        })
      );
      expect(reportError).not.toHaveBeenCalledWith(
        expect.objectContaining({ message: 'native OAuth code exchange failed' })
      );
    });

    it('the picker and calendar arms each emit their own settling event', async () => {
      // Without a named action these two settled silently: CloudWatch saw `start` → `return_*`
      // → nothing, which is indistinguishable from a trip that never came back.
      const { logEvent } = await import('@/services/telemetry');
      // ARM a trip first — `settleNativeTrip` logs only for a LIVE trip, and in production the
      // picker's own `startRedirectAuth` is what arms it. Then reshape the stash as a picker
      // return, keeping the state nonce so the CSRF check still passes.
      await googleAuth.startRedirectAuth('/join', undefined, 'join');
      const stored = JSON.parse(sessionStorage.getItem(STATE_KEY)!);
      sessionStorage.setItem(STATE_KEY, JSON.stringify({ ...stored, grant: 'picker' }));

      await googleAuth.handleNativeAuthRedirect(
        `${NATIVE_REDIRECT}?picked_file_ids=f1&state=${stored.state}`,
        vi.fn()
      );
      expect(logEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          surface: 'native-oauth',
          context: expect.objectContaining({ action: 'complete_picker' }),
        })
      );
    });
  });
});
