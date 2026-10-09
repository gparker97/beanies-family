import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the capability probe + the picker; mock the Drive-side deps just so the
// module imports cleanly (these tests only exercise connectLocalStorage).
vi.mock('@/services/sync/capabilities', () => ({
  supportsFileSystemAccess: vi.fn(),
  isNative: vi.fn(() => false),
}));
vi.mock('@/services/sync/syncService', () => ({
  selectSyncFile: vi.fn(),
  selectNativeLocalFile: vi.fn(),
  setProvider: vi.fn(),
  getProvider: vi.fn(() => null),
}));
vi.mock('@/services/google/googleAuth', () => ({
  whenRedirectAuthSettled: vi.fn(async () => {}),
  shouldUseRedirectAuth: vi.fn(() => false),
  startRedirectAuth: vi.fn(),
  isTokenValid: vi.fn(() => true),
  awaitNativeOAuthReturn: vi.fn(async () => ({ kind: 'completed' })),
  preferRedirectAuth: vi.fn(),
}));
// `reportCreateDriveFailure` is the one report per create-flow Drive failure.
vi.mock('@/utils/errorReporter', () => ({ reportError: vi.fn() }));
vi.mock('@/services/telemetry/logEvent', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/telemetry/logEvent')>()),
  logEvent: vi.fn(),
}));
// Silent recovery is exercised in driveTokenRecovery's own tests; here it is a
// deterministic no-op so the redirect-path assertions are unaffected.
vi.mock('@/services/google/driveTokenRecovery', () => ({
  tryReconnectSilently: vi.fn(() => Promise.resolve(false)),
}));
const mockProbeRead = vi.fn();
const mockFromExisting = vi.fn(() => ({ read: mockProbeRead, persist: vi.fn(async () => {}) }));
vi.mock('@/services/sync/providers/googleDriveProvider', () => ({
  GoogleDriveProvider: {
    createNew: vi.fn(),
    fromExisting: (...args: unknown[]) => mockFromExisting(...(args as [])),
  },
}));
// The campaign-tag stash (#118) is a deterministic "no tag" unless a test sets one; its own
// suite covers storage. `createReturnPath` reads it on web only.
const mockPeekAttribution = vi.fn((): Record<string, string> | null => null);
vi.mock('@/utils/attributionStash', () => ({
  peekAttribution: () => mockPeekAttribution(),
}));
// The create funnel (#128): `connectDriveStorage` closes an open `drive-consent` step.
const mockTrackOnboardingStep = vi.fn();
vi.mock('@/services/telemetry/onboardingAttempt', () => ({
  trackOnboardingStep: (...args: unknown[]) => mockTrackOnboardingStep(...args),
}));
const mockCurrentCreateAttempt = vi.fn(
  (): { id: string; startedAt: number; step: string } | null => null
);
vi.mock('@/utils/createAttemptState', () => ({
  currentCreateAttempt: () => mockCurrentCreateAttempt(),
}));
vi.mock('@/services/sync/fileSync', async (importOriginal) => ({
  // The version DERIVATION is real even where the writers are mocked: a
  // test-local `'4.0'` here would hide the one regression the derivation
  // exists to prevent (a compacted pod written as 4.0).
  beanpodVersionFor: (await importOriginal<typeof import('@/services/sync/fileSync')>())
    .beanpodVersionFor,
}));

import {
  connectLocalStorage,
  connectDriveStorage,
  beginDriveAuthRedirectIfNeeded,
  gateCreateDriveAuth,
  resolveExistingBeanpod,
  adoptDriveStub,
  reportCreateDriveFailure,
} from '../connectStorage';
import { POPUP_BLOCKED_MESSAGE } from '@/services/google/oauthError';
import { reportError } from '@/utils/errorReporter';
import { GoogleDriveProvider } from '@/services/sync/providers/googleDriveProvider';
import {
  DriveConsentDeniedError,
  FileNameCollisionError,
  OAuthRoundTripAbandonedError,
} from '@/types/sync';
import { supportsFileSystemAccess, isNative } from '@/services/sync/capabilities';
import {
  shouldUseRedirectAuth,
  startRedirectAuth,
  isTokenValid,
  awaitNativeOAuthReturn,
  preferRedirectAuth,
} from '@/services/google/googleAuth';
import * as syncService from '@/services/sync/syncService';

const mockSupports = vi.mocked(supportsFileSystemAccess);
const mockIsNative = vi.mocked(isNative);
const mockSelect = vi.mocked(syncService.selectSyncFile);
const mockSelectNative = vi.mocked(syncService.selectNativeLocalFile);
const mockShouldRedirect = vi.mocked(shouldUseRedirectAuth);
const mockStartRedirect = vi.mocked(startRedirectAuth);
const mockIsTokenValid = vi.mocked(isTokenValid);

describe('connectLocalStorage', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('flags an unsupported browser (Firefox/Safari) distinctly — not as a cancel — and never opens the picker', async () => {
    mockSupports.mockReturnValue(false);

    const r = await connectLocalStorage();

    expect(r).toMatchObject({ status: 'failed', errorKind: 'unsupported-browser' });
    // Crucially NOT cancelled — a cancel would surface the generic "try again",
    // which is wrong here (a retry can never succeed in this browser).
    expect(r).not.toHaveProperty('cancelled');
    // No point opening a picker that doesn't exist.
    expect(mockSelect).not.toHaveBeenCalled();
  });

  it('connects when a capable browser selects a file', async () => {
    mockSupports.mockReturnValue(true);
    mockSelect.mockResolvedValue(true);

    expect(await connectLocalStorage()).toEqual({ status: 'connected', type: 'local' });
  });

  it('on native, writes to an app-private file (no picker, no unsupported-browser) — ADR-029 A3', async () => {
    mockIsNative.mockReturnValue(true);
    mockSupports.mockReturnValue(false); // FSA absent in a WebView — must NOT matter
    mockSelectNative.mockResolvedValue(true);

    expect(await connectLocalStorage('the-smiths')).toEqual({ status: 'connected', type: 'local' });
    expect(mockSelectNative).toHaveBeenCalledWith('the-smiths');
    // The web FSA picker is never consulted on native.
    expect(mockSelect).not.toHaveBeenCalled();
  });

  it('reports a dismissed picker as cancelled (not unsupported-browser) in a capable browser', async () => {
    mockSupports.mockReturnValue(true);
    mockSelect.mockResolvedValue(false);

    const r = await connectLocalStorage();

    // `errorKind` is the ONE discriminator; there is no separate `cancelled` flag any more.
    expect(r).toMatchObject({ status: 'failed', errorKind: 'cancelled' });
    expect(r).not.toHaveProperty('cancelled');
  });

  it('surfaces a thrown picker error as a generic (reportable) failure', async () => {
    mockSupports.mockReturnValue(true);
    mockSelect.mockRejectedValue(new Error('boom'));

    const r = await connectLocalStorage();

    expect(r).toMatchObject({ status: 'failed', error: 'boom' });
    expect(r).not.toHaveProperty('cancelled');
    expect(r).not.toHaveProperty('errorKind');
  });
});

describe('beginDriveAuthRedirectIfNeeded', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockStartRedirect.mockResolvedValue(undefined);
  });

  it('redirects (true) on a redirect surface with no valid token, forwarding returnPath + loginHint', async () => {
    mockShouldRedirect.mockReturnValue(true);
    mockIsTokenValid.mockReturnValue(false);

    const result = await beginDriveAuthRedirectIfNeeded(
      '/welcome?resume=load-drive',
      'a@b.com',
      'join'
    );

    expect(result).toBe(true);
    expect(mockStartRedirect).toHaveBeenCalledWith('/welcome?resume=load-drive', 'a@b.com', 'join');
  });

  it('does NOT redirect (false) when a valid token is already held — caller proceeds inline', async () => {
    mockShouldRedirect.mockReturnValue(true);
    mockIsTokenValid.mockReturnValue(true);

    expect(await beginDriveAuthRedirectIfNeeded('/p', undefined, 'create')).toBe(false);
    expect(mockStartRedirect).not.toHaveBeenCalled();
  });

  it('does NOT redirect (false) on a popup surface (desktop) even with no token — popup path stays', async () => {
    mockShouldRedirect.mockReturnValue(false);
    mockIsTokenValid.mockReturnValue(false);

    expect(await beginDriveAuthRedirectIfNeeded('/p', undefined, 'create')).toBe(false);
    expect(mockStartRedirect).not.toHaveBeenCalled();
  });

  it('forceReauth redirects (true) even with a valid token — the switch-account case', async () => {
    mockShouldRedirect.mockReturnValue(true);
    mockIsTokenValid.mockReturnValue(true);

    expect(
      await beginDriveAuthRedirectIfNeeded('/p', undefined, 'reconnect', { forceReauth: true })
    ).toBe(true);
    // ⚠️ `select_account consent`, NOT the default `consent`, which SUPPRESSES the chooser: a
    // switch of account would otherwise land straight back on the account being left.
    expect(mockStartRedirect).toHaveBeenCalledWith('/p', undefined, 'reconnect', {
      prompt: 'select_account consent',
    });
  });

  it('forceReauth on a popup surface still does NOT redirect (transport decision wins)', async () => {
    mockShouldRedirect.mockReturnValue(false);
    mockIsTokenValid.mockReturnValue(true);

    expect(
      await beginDriveAuthRedirectIfNeeded('/p', undefined, 'reconnect', { forceReauth: true })
    ).toBe(false);
    expect(mockStartRedirect).not.toHaveBeenCalled();
  });

  it('propagates a startRedirectAuth failure to the caller (never swallowed)', async () => {
    mockShouldRedirect.mockReturnValue(true);
    mockIsTokenValid.mockReturnValue(false);
    mockStartRedirect.mockRejectedValue(new Error('Browser.open rejected'));

    await expect(beginDriveAuthRedirectIfNeeded('/p', undefined, 'create')).rejects.toThrow(
      'Browser.open rejected'
    );
  });
});

describe('resolveExistingBeanpod — adopt-existing classification (2026-06-19)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockFromExisting.mockReturnValue({ read: mockProbeRead, persist: vi.fn(async () => {}) });
  });

  it('rejects a collision owned by a DIFFERENT account — never adopts, never even reads', async () => {
    const r = await resolveExistingBeanpod({ fileId: 'f1', ownedByCurrentAccount: false });
    expect(r).toEqual({ kind: 'reject-different-account' });
    expect(mockProbeRead).not.toHaveBeenCalled();
  });

  it('adopts silently when the owned file is the empty {} placeholder (orphan stub)', async () => {
    mockProbeRead.mockResolvedValue('{}');
    const r = await resolveExistingBeanpod({ fileId: 'f1', ownedByCurrentAccount: true });
    expect(r).toEqual({ kind: 'adopt-stub', fileId: 'f1' });
  });

  it('adopts silently when the owned file is empty/zero-byte', async () => {
    mockProbeRead.mockResolvedValue('');
    const r = await resolveExistingBeanpod({ fileId: 'f1', ownedByCurrentAccount: true });
    expect(r).toEqual({ kind: 'adopt-stub', fileId: 'f1' });
  });

  it('confirms (adopt-existing) when the owned file is a real V4 envelope', async () => {
    mockProbeRead.mockResolvedValue('{"version":"4.0","familyId":"fam"}');
    const r = await resolveExistingBeanpod({ fileId: 'f1', ownedByCurrentAccount: true });
    expect(r).toEqual({ kind: 'adopt-existing', fileId: 'f1' });
  });

  it('fails SAFE to adopt-existing (confirm) when the probe read throws — never re-throws', async () => {
    mockProbeRead.mockRejectedValue(new Error('network blip'));
    const r = await resolveExistingBeanpod({ fileId: 'f1', ownedByCurrentAccount: true });
    expect(r).toEqual({ kind: 'adopt-existing', fileId: 'f1' });
  });
});

describe('adoptDriveStub', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockFromExisting.mockReturnValue({ read: mockProbeRead, persist: vi.fn() });
  });

  it('installs a provider on the orphan fileId and returns connected', async () => {
    const persist = vi.fn(async () => {});
    mockFromExisting.mockReturnValue({ read: mockProbeRead, persist });
    const r = await adoptDriveStub('orphan-1', 'the-smiths', { activeFamilyId: 'fam-1' });
    expect(r).toEqual({ status: 'connected', type: 'google_drive' });
    expect(mockFromExisting).toHaveBeenCalledWith('orphan-1', 'the-smiths.beanpod');
    // Bound to the family the caller named, not to whatever the database's active id happens to be.
    expect(syncService.setProvider).toHaveBeenCalledWith(expect.anything(), 'fam-1');
    expect(persist).toHaveBeenCalledWith('fam-1');
  });
});

describe('isStubBeanpod is structural: any populated file is adopt-existing, whatever its version', () => {
  // ⚠️ THE PROBE USED TO END IN A VERSION SNIFF (`!== '4.0'`), so a compacted
  // 5.0 pod, on a build that did not know 5.0, read as an EMPTY PLACEHOLDER
  // and was overwritten with a brand-new family, with no confirm.
  const populated = (version: string) =>
    JSON.stringify({
      version,
      familyId: 'fam',
      familyName: 'n',
      keyId: 'k',
      wrappedKeys: {},
      encryptedPayload: 'x',
    });
  for (const v of ['4.0', '5.0', '6.0']) {
    it(`treats a ${v} envelope as populated (confirm-gated adopt-existing)`, async () => {
      mockProbeRead.mockResolvedValue(populated(v));
      const r = await resolveExistingBeanpod({ fileId: 'f1', ownedByCurrentAccount: true });
      expect(r).toEqual({ kind: 'adopt-existing', fileId: 'f1' });
    });
  }
  for (const [label, text] of [
    ['empty', ''],
    ['whitespace', '  \n'],
    ['the createNew placeholder', '{}'],
    ['null', null],
  ] as const) {
    it(`treats ${label} as the stub`, async () => {
      mockProbeRead.mockResolvedValue(text as string);
      const r = await resolveExistingBeanpod({ fileId: 'f1', ownedByCurrentAccount: true });
      expect(r).toEqual({ kind: 'adopt-stub', fileId: 'f1' });
    });
  }
});

/**
 * A user who leaves Google's file-access checkbox unticked has made a DECISION,
 * not hit a fault — but the message Google gives us ("…file access was not
 * granted") contains none of the words `isUserCancellation` looks for
 * (/cancel|dismiss|popup_closed|user_cancel/). So it used to fall through to the
 * generic failure branch, where `CreatePodView` reported it at `critical` and
 * paged #beanies-errors, while `App.vue` classified the identical condition as
 * `warning` and `ResumePodSetup` as `error`. Three callers, three answers.
 *
 * Typing it here is what makes all three agree.
 */
describe('gateCreateDriveAuth — one gate, two transports', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('proceeds when a token is already in hand — no redirect at all', async () => {
    mockShouldRedirect.mockReturnValue(false);
    mockIsTokenValid.mockReturnValue(true);
    await expect(gateCreateDriveAuth(undefined)).resolves.toEqual({ kind: 'proceed' });
    expect(mockStartRedirect).not.toHaveBeenCalled();
  });

  it('WEB: reports `redirecting` and does NOT await — the page is unloading', async () => {
    mockShouldRedirect.mockReturnValue(true);
    mockIsTokenValid.mockReturnValue(false);
    mockIsNative.mockReturnValue(false);
    await expect(gateCreateDriveAuth('a@b.com')).resolves.toEqual({ kind: 'redirecting' });
    expect(mockStartRedirect).toHaveBeenCalledWith('/welcome?resume=setup', 'a@b.com', 'create');
    expect(awaitNativeOAuthReturn).not.toHaveBeenCalled();
  });

  it('WEB: the return path carries a stored campaign tag through the OAuth hop (#118)', async () => {
    // WebKit clears script-writable storage across the cross-site hop; main.ts re-captures the
    // tag from this query on the post-redirect boot.
    mockShouldRedirect.mockReturnValue(true);
    mockIsTokenValid.mockReturnValue(false);
    mockIsNative.mockReturnValue(false);
    mockPeekAttribution.mockReturnValue({ utm_source: 'chatgpt', oppref: 'opp.1' });
    await expect(gateCreateDriveAuth(undefined)).resolves.toEqual({ kind: 'redirecting' });
    expect(mockStartRedirect).toHaveBeenCalledWith(
      '/welcome?resume=setup&utm_source=chatgpt&oppref=opp.1',
      undefined,
      'create'
    );
  });

  it('NATIVE: awaits the round trip and proceeds in place — nothing unloaded', async () => {
    mockShouldRedirect.mockReturnValue(true);
    mockIsTokenValid.mockReturnValue(false);
    mockIsNative.mockReturnValue(true);
    vi.mocked(awaitNativeOAuthReturn).mockResolvedValue({ kind: 'completed' });
    await expect(gateCreateDriveAuth(undefined)).resolves.toEqual({ kind: 'proceed' });
    expect(awaitNativeOAuthReturn).toHaveBeenCalled();
  });

  it("NATIVE: hands back the trip's own error, so the caller classifies it once", async () => {
    mockShouldRedirect.mockReturnValue(true);
    mockIsTokenValid.mockReturnValue(false);
    mockIsNative.mockReturnValue(true);
    const denial = new DriveConsentDeniedError('file access not granted');
    vi.mocked(awaitNativeOAuthReturn).mockResolvedValue({ kind: 'failed', error: denial });
    await expect(gateCreateDriveAuth(undefined)).resolves.toEqual({
      kind: 'failed',
      error: denial,
    });
  });

  it('catches a START failure instead of throwing — the probe has no envelope of its own', async () => {
    // ⚠️ AN UNCAUGHT THROW HERE LEAVES THE RESUME SCREEN ON ITS PROBING SPINNER FOR GOOD.
    mockShouldRedirect.mockReturnValue(true);
    mockIsTokenValid.mockReturnValue(false);
    mockStartRedirect.mockRejectedValue(new Error('no client id'));
    const gate = await gateCreateDriveAuth(undefined);
    expect(gate.kind).toBe('failed');
    if (gate.kind !== 'failed') return;
    expect(gate.error.message).toBe('no client id');
  });
});

describe('connectDriveStorage — a declined consent is typed, not sniffed', () => {
  beforeEach(() => {
    vi.mocked(shouldUseRedirectAuth).mockReturnValue(false);
    vi.mocked(isTokenValid).mockReturnValue(true);
  });

  it('🔴 reports a denied file-access scope as errorKind consent-denied', async () => {
    vi.mocked(GoogleDriveProvider.createNew).mockRejectedValue(
      new DriveConsentDeniedError('Google Drive file access was not granted.')
    );
    const r = await connectDriveStorage('my-family');
    expect(r).toMatchObject({ status: 'failed', errorKind: 'consent-denied' });
  });

  it('files an unrecognised failure as `unknown`, carrying the raw failure for the report', async () => {
    const raw = new Error('Drive 500');
    vi.mocked(GoogleDriveProvider.createNew).mockRejectedValue(raw);
    const r = await connectDriveStorage('my-family');
    expect(r).toMatchObject({ status: 'failed', error: 'Drive 500', errorKind: 'unknown' });
    expect((r as { cause?: unknown }).cause).toBe(raw);
  });

  it('does not shadow the collision classification', async () => {
    vi.mocked(GoogleDriveProvider.createNew).mockRejectedValue(
      new FileNameCollisionError('exists', 'file-1', 'my-family.beanpod', true)
    );
    const r = await connectDriveStorage('my-family');
    expect(r).toMatchObject({ status: 'failed', errorKind: 'name-collision' });
  });

  it('a CLOSED DESKTOP POPUP is `cancelled` too — the native fix must not be the only half', async () => {
    // ⚠️ THE POPUP REJECTS WITH A PLAIN `Error`, not `OAuthRoundTripAbandonedError`, so it used
    // to fall through with no `errorKind` — and the callers' generic arms render `error`
    // verbatim. That painted the untranslated "Authentication cancelled" into a Chinese UI and
    // made the resume screen say "sign-in failed" to someone who closed the chooser themselves.
    vi.mocked(GoogleDriveProvider.createNew).mockRejectedValue(
      new Error('Authentication cancelled')
    );
    const r = await connectDriveStorage('my-family');
    expect(r).toMatchObject({ status: 'failed', errorKind: 'cancelled' });
  });

  it('a real fault is NEVER read as a cancel, the typed arms win', async () => {
    // The message alone would match `isUserCancellation`'s regex…
    vi.mocked(GoogleDriveProvider.createNew).mockRejectedValue(
      new FileNameCollisionError('cancelled', 'file-1', 'my-family.beanpod', true)
    );
    const r = await connectDriveStorage('my-family');
    expect(r).toMatchObject({ status: 'failed', errorKind: 'name-collision' }); // …and is outranked
  });
});

describe('connectDriveStorage on NATIVE — it awaits, and never reports `redirecting`', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockShouldRedirect.mockReturnValue(true);
    mockIsTokenValid.mockReturnValue(false);
    mockIsNative.mockReturnValue(true);
  });

  it("a completed trip connects in place and binds the provider to the CALLER's family", async () => {
    vi.mocked(awaitNativeOAuthReturn).mockResolvedValue({ kind: 'completed' });
    const persist = vi.fn(async () => {});
    const provider = { persist } as unknown as InstanceType<typeof GoogleDriveProvider>;
    vi.mocked(GoogleDriveProvider.createNew).mockResolvedValue(provider);

    const r = await connectDriveStorage('the-smiths', { activeFamilyId: 'fam-1' });

    expect(r).toEqual({ status: 'connected', type: 'google_drive' });
    // ⚠️ THE SECOND ARGUMENT IS THE POINT. An unbound provider surviving a native round trip is
    // what reached a create write on a production iPhone on 2026-09-21.
    expect(syncService.setProvider).toHaveBeenCalledWith(provider, 'fam-1');
    expect(persist).toHaveBeenCalledWith('fam-1');
  });

  it('an abandoned trip is `cancelled`, and CARRIES AN errorKind so the copy stays translated', async () => {
    // ⚠️ WITHOUT `errorKind` the callers fall into their generic arm and render `error` verbatim
    // — and `error` here is `OAuthRoundTripAbandonedError`'s English-only message, which would
    // paint "Google sign-in was closed before it finished." into a Chinese UI.
    vi.mocked(awaitNativeOAuthReturn).mockResolvedValue({
      kind: 'failed',
      error: new OAuthRoundTripAbandonedError('dismissed'),
    });
    const r = await connectDriveStorage('the-smiths');
    expect(r).toMatchObject({ status: 'failed', errorKind: 'cancelled' });
    expect(GoogleDriveProvider.createNew).not.toHaveBeenCalled();
  });

  it('a described access_denied from the trip is `access-denied`; a policy code is `app-blocked`', async () => {
    // `googleAuth` settles a described access_denied as a plain failure (`classifyOAuthError`).
    // A description does not prove a block (the #128 fixture is a localized plain decline), nor
    // is it the person's own Cancel; only Google's explicit policy codes are a block.
    vi.mocked(awaitNativeOAuthReturn).mockResolvedValue({
      kind: 'failed',
      error: new Error('access_denied: Access blocked by your admin'),
    });
    expect(await connectDriveStorage('the-smiths')).toMatchObject({
      status: 'failed',
      error: 'access_denied: Access blocked by your admin',
      errorKind: 'access-denied',
    });
    vi.mocked(awaitNativeOAuthReturn).mockResolvedValue({
      kind: 'failed',
      error: new Error('admin_policy_enforced'),
    });
    expect(await connectDriveStorage('the-smiths')).toMatchObject({
      status: 'failed',
      errorKind: 'app-blocked',
    });
    expect(GoogleDriveProvider.createNew).not.toHaveBeenCalled();
  });

  it('a consent denial from the trip classifies exactly as the popup arm does', async () => {
    vi.mocked(awaitNativeOAuthReturn).mockResolvedValue({
      kind: 'failed',
      error: new DriveConsentDeniedError('Google Drive file access was not granted.'),
    });
    const r = await connectDriveStorage('the-smiths');
    expect(r).toMatchObject({ status: 'failed', errorKind: 'consent-denied' });
  });
});

describe("connectDriveStorage — Google's access_denied is a cancel (#128 B1)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockShouldRedirect.mockReturnValue(false);
    mockIsTokenValid.mockReturnValue(false);
  });

  it('classifies a popup rejection carrying access_denied as `cancelled`, not a generic fault', async () => {
    vi.mocked(GoogleDriveProvider.createNew).mockRejectedValue(new Error('access_denied'));
    const r = await connectDriveStorage('my-family');
    expect(r).toMatchObject({ status: 'failed', errorKind: 'cancelled' });
  });

  it('an access_denied WITH a description is `access-denied`: neither a Cancel nor a proven block', async () => {
    vi.mocked(GoogleDriveProvider.createNew).mockRejectedValue(
      new Error('access_denied: Access blocked by your administrator')
    );
    const r = await connectDriveStorage('my-family');
    expect(r).toMatchObject({
      status: 'failed',
      error: 'access_denied: Access blocked by your administrator',
      errorKind: 'access-denied',
    });
  });
});

describe('connectDriveStorage — closes the open drive-consent funnel step (#128)', () => {
  const OPEN_AT_CONSENT = { id: 'a-1', startedAt: 0, step: 'drive-consent' };

  beforeEach(() => {
    vi.resetAllMocks();
    mockShouldRedirect.mockReturnValue(false);
    mockIsTokenValid.mockReturnValue(true);
    mockCurrentCreateAttempt.mockReturnValue(OPEN_AT_CONSENT);
  });

  it('emits `submitted` on a connect', async () => {
    const provider = { persist: vi.fn(async () => {}) } as unknown as InstanceType<
      typeof GoogleDriveProvider
    >;
    vi.mocked(GoogleDriveProvider.createNew).mockResolvedValue(provider);
    await connectDriveStorage('my-family');
    expect(mockTrackOnboardingStep).toHaveBeenCalledTimes(1);
    expect(mockTrackOnboardingStep).toHaveBeenCalledWith('drive-consent', 'submitted');
  });

  it('emits `back` with the errorKind for a cancel and a consent denial', async () => {
    vi.mocked(GoogleDriveProvider.createNew).mockRejectedValue(new Error('access_denied'));
    await connectDriveStorage('my-family');
    expect(mockTrackOnboardingStep).toHaveBeenLastCalledWith('drive-consent', 'back', {
      error_code: 'cancelled',
    });

    vi.mocked(GoogleDriveProvider.createNew).mockRejectedValue(
      new DriveConsentDeniedError('Google Drive file access was not granted.')
    );
    await connectDriveStorage('my-family');
    expect(mockTrackOnboardingStep).toHaveBeenLastCalledWith('drive-consent', 'back', {
      error_code: 'consent-denied',
    });
  });

  it('emits `back` with the REAL code for any other fault, and `submitted` for a collision', async () => {
    vi.mocked(GoogleDriveProvider.createNew).mockRejectedValue(new Error('Drive 500'));
    await connectDriveStorage('my-family');
    expect(mockTrackOnboardingStep).toHaveBeenLastCalledWith('drive-consent', 'back', {
      error_code: 'unknown',
    });

    vi.mocked(GoogleDriveProvider.createNew).mockRejectedValue(
      Object.assign(new Error('full'), { status: 403, reason: 'storageQuotaExceeded' })
    );
    await connectDriveStorage('my-family');
    expect(mockTrackOnboardingStep).toHaveBeenLastCalledWith('drive-consent', 'back', {
      error_code: 'drive-full',
    });

    vi.mocked(GoogleDriveProvider.createNew).mockRejectedValue(
      new FileNameCollisionError('exists', 'file-1', 'my-family.beanpod', true)
    );
    await connectDriveStorage('my-family');
    expect(mockTrackOnboardingStep).toHaveBeenLastCalledWith('drive-consent', 'submitted');
  });

  it('emits nothing when the step is not drive-consent (finalize after a redirect return)', async () => {
    mockCurrentCreateAttempt.mockReturnValue({ ...OPEN_AT_CONSENT, step: 'pin' });
    vi.mocked(GoogleDriveProvider.createNew).mockRejectedValue(new Error('Drive 500'));
    await connectDriveStorage('my-family');
    mockCurrentCreateAttempt.mockReturnValue(null);
    await connectDriveStorage('my-family');
    expect(mockTrackOnboardingStep).not.toHaveBeenCalled();
  });

  it('emits nothing while redirecting (the callback page records that exit)', async () => {
    mockShouldRedirect.mockReturnValue(true);
    mockIsTokenValid.mockReturnValue(false);
    mockIsNative.mockReturnValue(false);
    vi.mocked(startRedirectAuth).mockResolvedValue(undefined as never);
    const r = await connectDriveStorage('my-family');
    expect(r).toEqual({ status: 'redirecting' });
    expect(mockTrackOnboardingStep).not.toHaveBeenCalled();
  });
});

describe('connectDriveStorage — a blocked popup falls back to the redirect, once', () => {
  // The tab's transport, as `shouldUseRedirectAuth()` reports it: a popup surface until
  // `preferRedirectAuth()` records the preference (the real module's in-memory flag).
  let preferred = false;

  beforeEach(() => {
    vi.resetAllMocks();
    preferred = false;
    vi.mocked(preferRedirectAuth).mockImplementation(() => {
      preferred = true;
    });
    mockShouldRedirect.mockImplementation(() => preferred);
    mockIsTokenValid.mockReturnValue(false);
    mockIsNative.mockReturnValue(false);
    mockStartRedirect.mockResolvedValue(undefined);
    vi.mocked(GoogleDriveProvider.createNew).mockRejectedValue(new Error(POPUP_BLOCKED_MESSAGE));
  });

  it('records the preference and re-runs ONCE through the create gate, which starts the redirect', async () => {
    const r = await connectDriveStorage('my-family', { googleEmail: 'a@b.com' });

    expect(r).toEqual({ status: 'redirecting' });
    expect(preferRedirectAuth).toHaveBeenCalledTimes(1);
    // The SAME gate every redirect surface uses: create's return path, the login hint, 'create'.
    expect(mockStartRedirect).toHaveBeenCalledTimes(1);
    expect(mockStartRedirect).toHaveBeenCalledWith('/welcome?resume=setup', 'a@b.com', 'create');
    // No second popup: the re-run never reached `createNew`.
    expect(GoogleDriveProvider.createNew).toHaveBeenCalledTimes(1);
  });

  it("a re-run that fails hands back THAT failure's classified code, never popup-blocked", async () => {
    mockStartRedirect.mockRejectedValue(new Error('Google Client ID not configured'));
    const r = await connectDriveStorage('my-family');
    expect(r).toMatchObject({ status: 'failed', errorKind: 'unknown' });
    expect(preferRedirectAuth).toHaveBeenCalledTimes(1);
    expect(GoogleDriveProvider.createNew).toHaveBeenCalledTimes(1);
  });

  it('does not re-run if the preference did not take (it would only open a second popup)', async () => {
    vi.mocked(preferRedirectAuth).mockImplementation(() => {});
    const r = await connectDriveStorage('my-family');
    expect(r).toMatchObject({ status: 'failed', errorKind: 'popup-blocked' });
    expect(GoogleDriveProvider.createNew).toHaveBeenCalledTimes(1);
    expect(mockStartRedirect).not.toHaveBeenCalled();
  });

  it('no other failure records the preference', async () => {
    vi.mocked(GoogleDriveProvider.createNew).mockRejectedValue(
      new Error('Authentication cancelled')
    );
    const r = await connectDriveStorage('my-family');
    expect(r).toMatchObject({ status: 'failed', errorKind: 'cancelled' });
    expect(preferRedirectAuth).not.toHaveBeenCalled();
  });
});

describe('connectDriveStorage — "use a different Google account" (chooseAccount)', () => {
  const provider = { persist: vi.fn(async () => {}) } as unknown as InstanceType<
    typeof GoogleDriveProvider
  >;

  beforeEach(() => {
    vi.resetAllMocks();
    mockStartRedirect.mockResolvedValue(undefined);
    vi.mocked(GoogleDriveProvider.createNew).mockResolvedValue(provider);
  });

  it('POPUP surface: the chooser rides createNew; no redirect', async () => {
    mockShouldRedirect.mockReturnValue(false);
    mockIsTokenValid.mockReturnValue(true);
    await connectDriveStorage('my-family', { googleEmail: 'a@b.com', chooseAccount: true });
    expect(GoogleDriveProvider.createNew).toHaveBeenCalledWith('my-family.beanpod', {
      forceConsent: false,
      chooseAccount: true,
    });
    expect(mockStartRedirect).not.toHaveBeenCalled();
  });

  it('WEB REDIRECT surface: redirects even with a valid token, with no hint and the chooser prompt', async () => {
    mockShouldRedirect.mockReturnValue(true);
    mockIsTokenValid.mockReturnValue(true);
    mockIsNative.mockReturnValue(false);
    const r = await connectDriveStorage('my-family', {
      googleEmail: 'a@b.com',
      chooseAccount: true,
    });
    expect(r).toEqual({ status: 'redirecting' });
    // No login hint: it would pre-select the very account being left.
    expect(mockStartRedirect).toHaveBeenCalledWith('/welcome?resume=setup', undefined, 'create', {
      prompt: 'select_account consent',
    });
    expect(GoogleDriveProvider.createNew).not.toHaveBeenCalled();
  });

  it('NATIVE: the chooser rides the system-browser trip; createNew never gets chooseAccount (it would throw TokenExpiredError)', async () => {
    mockShouldRedirect.mockReturnValue(true);
    mockIsTokenValid.mockReturnValue(true);
    mockIsNative.mockReturnValue(true);
    vi.mocked(awaitNativeOAuthReturn).mockResolvedValue({ kind: 'completed' });
    const r = await connectDriveStorage('my-family', { chooseAccount: true });
    expect(r).toEqual({ status: 'connected', type: 'google_drive' });
    expect(mockStartRedirect).toHaveBeenCalledWith(expect.any(String), undefined, 'create', {
      prompt: 'select_account consent',
    });
    expect(GoogleDriveProvider.createNew).toHaveBeenCalledWith('my-family.beanpod', {
      forceConsent: false,
      chooseAccount: false,
    });
  });

  it('without chooseAccount the hint is forwarded and the default prompt is kept', async () => {
    mockShouldRedirect.mockReturnValue(true);
    mockIsTokenValid.mockReturnValue(false);
    mockIsNative.mockReturnValue(false);
    await connectDriveStorage('my-family', { googleEmail: 'a@b.com' });
    expect(mockStartRedirect).toHaveBeenCalledWith('/welcome?resume=setup', 'a@b.com', 'create');
  });
});

describe('connectDriveStorage — the 150 s connect cap is named, so it classifies as timeout', () => {
  it('a createNew that never settles comes back as `timeout`, not `unknown`', async () => {
    vi.resetAllMocks();
    vi.useFakeTimers();
    try {
      mockShouldRedirect.mockReturnValue(false);
      mockIsTokenValid.mockReturnValue(true);
      vi.mocked(GoogleDriveProvider.createNew).mockReturnValue(new Promise(() => {}));
      const pending = connectDriveStorage('my-family');
      await vi.advanceTimersByTimeAsync(150_000);
      expect(await pending).toMatchObject({ status: 'failed', errorKind: 'timeout' });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('reportCreateDriveFailure — the one report per failure', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockIsNative.mockReturnValue(false);
    mockShouldRedirect.mockReturnValue(false);
  });

  it('reports at the registry severity with error_code and a transport + reason detail', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const error = Object.assign(new Error('Quota'), { status: 403, reason: 'quotaExceeded' });

    reportCreateDriveFailure('createPod.connectDrive', 'drive-busy', error);

    expect(reportError).toHaveBeenCalledTimes(1);
    expect(reportError).toHaveBeenCalledWith({
      surface: 'createPod.connectDrive',
      message: 'Quota',
      severity: 'warning',
      error,
      context: {
        provider_type: 'google_drive',
        error_code: 'drive-busy',
        detail: 'transport=popup;reason=quotaExceeded',
      },
    });
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it('pages only for the critical codes, logging to console.error', () => {
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockShouldRedirect.mockReturnValue(true);

    reportCreateDriveFailure('resumeSetup.connectDrive', 'unknown', 'boom');

    expect(reportError).toHaveBeenCalledWith(
      expect.objectContaining({
        severity: 'critical',
        message: 'boom',
        context: expect.objectContaining({ error_code: 'unknown', detail: 'transport=redirect' }),
      })
    );
    expect(errorLog).toHaveBeenCalledTimes(1);
    errorLog.mockRestore();
  });

  it('derives the native transport itself (native also reads as a redirect surface)', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockIsNative.mockReturnValue(true);
    mockShouldRedirect.mockReturnValue(true);
    reportCreateDriveFailure('resumeSetup.probeDriveAuth', 'cancelled', new Error('closed'));
    expect(reportError).toHaveBeenCalledWith(
      expect.objectContaining({
        context: expect.objectContaining({ detail: 'transport=native' }),
      })
    );
  });

  it('the console line says "write" for the pod write and "connect" for every other surface', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const error = new Error('full');

    reportCreateDriveFailure('resumeSetup.write', 'drive-full', error);
    reportCreateDriveFailure('resumeSetup.connectDrive', 'drive-full', error);
    reportCreateDriveFailure('createPod.connectDrive', 'drive-full', error);

    expect(warn.mock.calls.map((c) => c[0])).toEqual([
      '[resumeSetup.write] Google Drive write failed (drive-full):',
      '[resumeSetup.connectDrive] Google Drive connect failed (drive-full):',
      '[createPod.connectDrive] Google Drive connect failed (drive-full):',
    ]);
    warn.mockRestore();
  });

  it('a connect failure is NOT also logged by the module (no parallel connect-storage warn)', async () => {
    const { logEvent } = await import('@/services/telemetry/logEvent');
    vi.mocked(GoogleDriveProvider.createNew).mockRejectedValue(new Error('Drive 500'));
    mockIsTokenValid.mockReturnValue(true);
    await connectDriveStorage('my-family');
    expect(vi.mocked(logEvent)).not.toHaveBeenCalled();
    expect(reportError).not.toHaveBeenCalled();
  });
});
