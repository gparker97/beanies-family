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
  isUserCancellation: vi.fn(() => false),
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
} from '../connectStorage';
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
  isUserCancellation,
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

    expect(r).toMatchObject({ status: 'failed', cancelled: true });
    expect(r).not.toHaveProperty('errorKind');
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
    expect(mockStartRedirect).toHaveBeenCalledWith('/p', undefined, 'reconnect');
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

  it('does NOT mark it `cancelled` — there IS something to tell the user', async () => {
    // `cancelled` means "nothing happened, say nothing". A consent denial needs
    // the "tick the file access box" guidance, so the two must stay distinct.
    vi.mocked(GoogleDriveProvider.createNew).mockRejectedValue(
      new DriveConsentDeniedError('Google Drive file access was not granted.')
    );
    const r = await connectDriveStorage('my-family');
    expect((r as { cancelled?: boolean }).cancelled).toBeUndefined();
  });

  it('leaves a genuine failure unclassified, so it still surfaces as an error', async () => {
    vi.mocked(GoogleDriveProvider.createNew).mockRejectedValue(new Error('Drive 500'));
    const r = await connectDriveStorage('my-family');
    expect(r).toMatchObject({ status: 'failed', error: 'Drive 500' });
    expect((r as { errorKind?: string }).errorKind).toBeUndefined();
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
    vi.mocked(isUserCancellation).mockReturnValue(true);
    vi.mocked(GoogleDriveProvider.createNew).mockRejectedValue(
      new Error('Authentication cancelled')
    );
    const r = await connectDriveStorage('my-family');
    expect(r).toMatchObject({ status: 'failed', errorKind: 'cancelled', cancelled: true });
  });

  it('a real fault is NEVER read as a cancel — the typed arms win', async () => {
    vi.mocked(isUserCancellation).mockReturnValue(true); // the regex would say yes…
    vi.mocked(GoogleDriveProvider.createNew).mockRejectedValue(
      new FileNameCollisionError('exists', 'file-1', 'my-family.beanpod', true)
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
    expect(r).toMatchObject({ status: 'failed', cancelled: true, errorKind: 'cancelled' });
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
