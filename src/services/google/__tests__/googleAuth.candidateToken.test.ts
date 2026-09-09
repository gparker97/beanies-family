/**
 * `tryCandidateRefreshToken` — the "ask Google before you install it" primitive.
 *
 * This exists because adopting a mirrored refresh token BEFORE validating it
 * destroyed working credentials across a whole family and forced a Google consent
 * screen on each device. The behaviours pinned here are the ones that make a
 * refused candidate FREE: nothing persisted, nothing primed, and — the subtle one
 * — no failure counter advanced, because those counters drive the escalation that
 * raises the reconnect surface, and a speculative probe must never push the user
 * toward the very consent screen this work removes.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../pkce', () => ({
  generateCodeVerifier: vi.fn(() => 'mock-code-verifier-abc123'),
  generateCodeChallenge: vi.fn(async () => 'mock-code-challenge-xyz789'),
}));

vi.mock('../oauthProxy', () => ({
  exchangeCodeForTokens: vi.fn(),
  refreshAccessToken: vi.fn(),
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

vi.mock('@/services/indexeddb/database', () => ({
  getActiveFamilyId: vi.fn(() => null),
}));

vi.mock('@/services/telemetry', () => ({ logEvent: vi.fn() }));
vi.mock('@/utils/errorReporter', () => ({ reportError: vi.fn() }));

// `logTokenLifecycle` is the #62 fleet-wide token-pressure counter. An ADOPTED
// token is not a mint, so one of the assertions below is that it stays silent.
vi.mock('../googleRevoke', () => ({
  revokeGrant: vi.fn(async () => ({ ok: true, reason: 'revoked' })),
  logTokenLifecycle: vi.fn(),
}));

let googleAuth: typeof import('../googleAuth');

const CANDIDATE = { token: 'candidate-tok', issuedAt: 1234 };

describe('tryCandidateRefreshToken', () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.resetAllMocks();
    // sessionStorage is HOST state and survives `vi.resetModules()`, so a counter
    // left by an earlier test would change the escalation assertions below.
    try {
      sessionStorage.removeItem('beanies_silent_refresh_failures');
    } catch {
      // Some runners don't expose sessionStorage; harmless.
    }
    Object.defineProperty(document, 'hidden', { value: true, configurable: true });
    vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'test-client-id');
    googleAuth = await import('../googleAuth');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  async function proxy() {
    return await import('../oauthProxy');
  }
  async function store() {
    return await import('@/services/sync/fileHandleStore');
  }

  it('accepted: commits the candidate, keeping its OWN issuedAt', async () => {
    const { refreshAccessToken } = await proxy();
    (refreshAccessToken as ReturnType<typeof vi.fn>).mockResolvedValue({
      access_token: 'fresh-access',
      expires_in: 3600,
      token_type: 'Bearer',
    });

    const outcome = await googleAuth.tryCandidateRefreshToken(
      'fam-1',
      CANDIDATE,
      googleAuth.getSessionEpoch()
    );

    expect(outcome.outcome).toBe('accepted');
    expect(googleAuth.isTokenValid()).toBe(true);
    expect(googleAuth.hasRefreshToken()).toBe(true);
    // ⚠️ NOT `Date.now()`. Re-stamping an adopted token invents a fresh age for a
    // possibly-old credential, which falsifies `refreshTokenAgeMs` in the
    // `invalid_grant` diagnostic — the field that surfaces revocation patterns.
    const { storeGoogleRefreshToken } = await store();
    expect(storeGoogleRefreshToken).toHaveBeenCalledWith('fam-1', 'candidate-tok', {
      issuedAt: 1234,
    });
  });

  it('accepted: does NOT count a mint — an adopted mirror is not a new grant', async () => {
    const { refreshAccessToken } = await proxy();
    (refreshAccessToken as ReturnType<typeof vi.fn>).mockResolvedValue({
      access_token: 'fresh-access',
      expires_in: 3600,
      token_type: 'Bearer',
    });

    await googleAuth.tryCandidateRefreshToken('fam-1', CANDIDATE, googleAuth.getSessionEpoch());

    const { logTokenLifecycle } = await import('../googleRevoke');
    expect(logTokenLifecycle).not.toHaveBeenCalledWith(expect.objectContaining({ op: 'mint' }));
  });

  it('rejected: invalid_grant mutates NOTHING', async () => {
    const { refreshAccessToken } = await proxy();
    (refreshAccessToken as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('Token refresh failed: HTTP 400 — invalid_grant')
    );

    const outcome = await googleAuth.tryCandidateRefreshToken(
      'fam-1',
      CANDIDATE,
      googleAuth.getSessionEpoch()
    );

    expect(outcome.outcome).toBe('rejected');
    // The code Google actually used, not a hardcoded assumption.
    expect(outcome.errorCode).toBe('invalid_grant');
    expect(googleAuth.hasRefreshToken()).toBe(false);
    expect(googleAuth.isTokenValid()).toBe(false);
    const { storeGoogleRefreshToken, clearGoogleRefreshToken } = await store();
    expect(storeGoogleRefreshToken).not.toHaveBeenCalled();
    // Critically: it must not CLEAR anything either. The device's own token is
    // none of this probe's business.
    expect(clearGoogleRefreshToken).not.toHaveBeenCalled();
    expect(googleAuth.getLastSilentRefreshDiagnostics()).toBeNull();
  });

  it('rejected repeatedly: never escalates to the reconnect surface', async () => {
    // ⚠️ THE ASSERTION THAT MATTERS MOST, and it is deliberately behavioural.
    // Both failure counters are module-private, so an earlier draft asserted a
    // diagnostic field instead — and that field is populated from the counter the
    // transient branch does NOT increment, so it read 0 either way: a test that
    // could not fail, guarding the single most important line of the fix.
    //
    // Escalation is what raises the reconnect banner, and reconnecting forces a
    // Google consent screen. A speculative probe failing must never get there.
    const { refreshAccessToken } = await proxy();
    (refreshAccessToken as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('Token refresh failed: HTTP 400 — invalid_grant')
    );
    const onPermanent = vi.fn();
    googleAuth.onTokenPermanentlyExpired(onPermanent);

    // More than either threshold (2 for rejections, 6 for transient exhaustion).
    for (let i = 0; i < 8; i++) {
      await googleAuth.tryCandidateRefreshToken('fam-1', CANDIDATE, googleAuth.getSessionEpoch());
    }

    expect(onPermanent).not.toHaveBeenCalled();
    const { logEvent } = await import('@/services/telemetry');
    expect(logEvent).not.toHaveBeenCalledWith(
      expect.objectContaining({
        context: expect.objectContaining({ action: 'transient-streak-escalated' }),
      })
    );
    expect(logEvent).not.toHaveBeenCalledWith(
      expect.objectContaining({
        context: expect.objectContaining({ action: 'transient-suppressed' }),
      })
    );
  });

  it.each([
    ['a network TypeError', new TypeError('Failed to fetch')],
    ['a proxy 5xx', new Error('Token refresh failed: HTTP 503 — upstream unavailable')],
    // ⚠️ 429 AND 403 ARE TRANSIENT, NOT REFUSALS. `refreshFailure.ts` names them
    // so explicitly: 429 is a rate limit (ours or Google's) and our OAuth proxy
    // returns 403 for a missing API key or a WAF block. Treating either as "Google
    // refused your grant" would force a consent screen for a rate limit.
    ['a rate limit', new Error('Token refresh failed: HTTP 429 — rateLimitExceeded')],
    ['a WAF/API-key 403', new Error('Token refresh failed: HTTP 403 — forbidden')],
    // A bare 4xx from the proxy is a REQUEST defect, not a dead grant. Classifying
    // it as a refusal would be more destructive than the real permanent branch,
    // which retries it — and would permanently strand a device that has no local
    // token but a good mirrored one.
    ['a malformed request', new Error('Token refresh failed: HTTP 400 — invalid_request')],
  ])('transient: %s does not count as a refusal', async (_label, err) => {
    const { refreshAccessToken } = await proxy();
    (refreshAccessToken as ReturnType<typeof vi.fn>).mockRejectedValue(err);

    const outcome = await googleAuth.tryCandidateRefreshToken(
      'fam-1',
      CANDIDATE,
      googleAuth.getSessionEpoch()
    );

    expect(outcome.outcome).toBe('transient');
    const { storeGoogleRefreshToken } = await store();
    expect(storeGoogleRefreshToken).not.toHaveBeenCalled();
  });

  it('transient: reports the failure rather than swallowing it', async () => {
    const { refreshAccessToken } = await proxy();
    (refreshAccessToken as ReturnType<typeof vi.fn>).mockRejectedValue(
      new TypeError('Failed to fetch')
    );

    await googleAuth.tryCandidateRefreshToken('fam-1', CANDIDATE, googleAuth.getSessionEpoch());

    const { reportError } = await import('@/utils/errorReporter');
    expect(reportError).toHaveBeenCalledWith(
      expect.objectContaining({ surface: 'drive-token-adopt' })
    );
  });

  it('unset client id: transient + a developer-actionable report, never a refusal', async () => {
    // A build-config error must not masquerade as "Google refused your token" —
    // that reads as a dead grant in CloudWatch and points triage at the wrong
    // cause forever.
    vi.stubEnv('VITE_GOOGLE_CLIENT_ID', '');
    vi.resetModules();
    googleAuth = await import('../googleAuth');

    const outcome = await googleAuth.tryCandidateRefreshToken(
      'fam-1',
      CANDIDATE,
      googleAuth.getSessionEpoch()
    );

    expect(outcome.outcome).toBe('transient');
    const { refreshAccessToken } = await proxy();
    expect(refreshAccessToken).not.toHaveBeenCalled(); // preflight, before the network
    const { reportError } = await import('@/utils/errorReporter');
    expect(reportError).toHaveBeenCalledWith(
      expect.objectContaining({
        surface: 'drive-token-adopt',
        message: expect.stringContaining('VITE_GOOGLE_CLIENT_ID'),
      })
    );
  });

  it('a sign-out mid-probe commits nothing', async () => {
    const { refreshAccessToken } = await proxy();
    const epochAtStart = googleAuth.getSessionEpoch();
    (refreshAccessToken as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      await googleAuth.clearGoogleSessionState(); // the sign-out lands mid-flight
      return { access_token: 'fresh-access', expires_in: 3600, token_type: 'Bearer' };
    });

    const outcome = await googleAuth.tryCandidateRefreshToken('fam-1', CANDIDATE, epochAtStart);

    expect(outcome.outcome).toBe('transient');
    expect(googleAuth.isTokenValid()).toBe(false);
    expect(googleAuth.hasRefreshToken()).toBe(false);
  });

  it('never joins the silent-refresh dedup', async () => {
    // It must stay callable from inside a permanent-failure callback without
    // awaiting the very refresh that just failed (the deadlock
    // `syncStore.attemptSilentSelfRecovery` defers around).
    const { refreshAccessToken } = await proxy();
    let pendingDuringProbe: boolean | null = null;
    (refreshAccessToken as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      pendingDuringProbe = googleAuth.isSilentRefreshPending();
      return { access_token: 'fresh-access', expires_in: 3600, token_type: 'Bearer' };
    });

    await googleAuth.tryCandidateRefreshToken('fam-1', CANDIDATE, googleAuth.getSessionEpoch());

    expect(pendingDuringProbe).toBe(false);
    expect(googleAuth.isSilentRefreshPending()).toBe(false);
  });

  it("an in-flight ladder's invalid_grant must not destroy a token adopted meanwhile", async () => {
    // ⚠️ THE RACE THE GUARD IN `performSilentRefresh` EXISTS FOR, and the reason
    // this primitive could not simply be dropped in. It writes
    // `currentRefreshToken` OUTSIDE the `pendingSilentRefresh` dedup, and the
    // permanent branch used to destroy whatever token was CURRENT rather than the
    // token Google actually refused. So:
    //
    //   1. the wake listener starts a ladder on a dead token; its fetch hangs
    //   2. a candidate is probed, accepted, and committed
    //   3. the hung attempt returns invalid_grant FOR THE OLD TOKEN
    //
    // …and step 3 would delete the credential Google had just accepted, then raise
    // the reconnect surface — manufacturing exactly the consent this work removes.
    const { refreshAccessToken } = await proxy();
    const { storeGoogleRefreshToken, clearGoogleRefreshToken, getGoogleRefreshToken } =
      await store();

    // The device starts holding a dead token, so a ladder has something to fail on.
    (getGoogleRefreshToken as ReturnType<typeof vi.fn>).mockResolvedValue({
      token: 'dead-tok',
      issuedAt: 100,
    });
    await googleAuth.initializeAuth('fam-1');

    let rejectLadder: (e: Error) => void = () => {};
    const held = new Promise<never>((_res, rej) => {
      rejectLadder = rej;
    });

    (refreshAccessToken as ReturnType<typeof vi.fn>).mockImplementation(
      async (args: { refreshToken: string }) => {
        // The ladder's attempt (on the dead token) hangs. The candidate probe
        // resolves immediately.
        if (args.refreshToken === 'dead-tok') return held;
        return { access_token: 'fresh-access', expires_in: 3600, token_type: 'Bearer' };
      }
    );

    const ladder = googleAuth.attemptSilentRefresh(); // step 1: in flight, hung

    const outcome = await googleAuth.tryCandidateRefreshToken(
      'fam-1',
      { token: 'good-adopted', issuedAt: 9999 },
      googleAuth.getSessionEpoch()
    ); // step 2: accepted and committed
    expect(outcome.outcome).toBe('accepted');

    const onPermanent = vi.fn();
    googleAuth.onTokenPermanentlyExpired(onPermanent);
    rejectLadder(new Error('Token refresh failed: HTTP 400 — invalid_grant')); // step 3
    await ladder;

    // The adopted credential survived, in memory and on disk.
    expect(googleAuth.hasRefreshToken()).toBe(true);
    expect(clearGoogleRefreshToken).not.toHaveBeenCalled();
    expect(storeGoogleRefreshToken).toHaveBeenCalledWith('fam-1', 'good-adopted', {
      issuedAt: 9999,
    });
    // …and no reconnect surface was raised on a healthy session.
    expect(onPermanent).not.toHaveBeenCalled();
    const { logEvent } = await import('@/services/telemetry');
    expect(logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        context: expect.objectContaining({ action: 'permanent-failure-superseded' }),
      })
    );
  });

  it('a rejection worded "expired or revoked" reports THAT code, not invalid_grant', async () => {
    // `isPermanentRefreshFailure` matches either wording. Hardcoding one on the
    // `candidate-refused` event would put a guess into the field triage keys on.
    const { refreshAccessToken } = await proxy();
    (refreshAccessToken as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('Token refresh failed: HTTP 400 — Token has been expired or revoked')
    );

    const result = await googleAuth.tryCandidateRefreshToken(
      'fam-1',
      CANDIDATE,
      googleAuth.getSessionEpoch()
    );

    expect(result.outcome).toBe('rejected');
    expect(result.errorCode).toBe('expired_or_revoked');
  });

  it('a transient 4xx carries its status, so a proxy defect stays queryable', async () => {
    // An `HTTP 400 invalid_request` is a REQUEST defect, not a dead grant. It must
    // not read as a refusal, but it must not vanish into generic network
    // flakiness either — it is the failure that would silently keep every
    // straggler device unhealed forever.
    const { refreshAccessToken } = await proxy();
    (refreshAccessToken as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('Token refresh failed: HTTP 400 — invalid_request')
    );

    const result = await googleAuth.tryCandidateRefreshToken(
      'fam-1',
      CANDIDATE,
      googleAuth.getSessionEpoch()
    );

    expect(result.outcome).toBe('transient');
    expect(result.errorCode).toBe('HTTP 400');
  });
});
