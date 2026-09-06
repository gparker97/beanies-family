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
  beginDriveAuthRedirectIfNeeded,
  resolveExistingBeanpod,
  adoptDriveStub,
} from '../connectStorage';
import { supportsFileSystemAccess, isNative } from '@/services/sync/capabilities';
import {
  shouldUseRedirectAuth,
  startRedirectAuth,
  isTokenValid,
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
    expect(syncService.setProvider).toHaveBeenCalled();
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
