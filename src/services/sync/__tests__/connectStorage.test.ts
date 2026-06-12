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
  shouldUseRedirectAuth: vi.fn(() => false),
  startRedirectAuth: vi.fn(),
  isTokenValid: vi.fn(() => true),
}));
// Silent recovery is exercised in driveTokenRecovery's own tests; here it is a
// deterministic no-op so the redirect-path assertions are unaffected.
vi.mock('@/services/google/driveTokenRecovery', () => ({
  tryReconnectSilently: vi.fn(() => Promise.resolve(false)),
}));
vi.mock('@/services/sync/providers/googleDriveProvider', () => ({
  GoogleDriveProvider: { createNew: vi.fn() },
}));

import { connectLocalStorage, beginDriveAuthRedirectIfNeeded } from '../connectStorage';
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

    const result = await beginDriveAuthRedirectIfNeeded('/welcome?resume=load-drive', 'a@b.com');

    expect(result).toBe(true);
    expect(mockStartRedirect).toHaveBeenCalledWith('/welcome?resume=load-drive', 'a@b.com');
  });

  it('does NOT redirect (false) when a valid token is already held — caller proceeds inline', async () => {
    mockShouldRedirect.mockReturnValue(true);
    mockIsTokenValid.mockReturnValue(true);

    expect(await beginDriveAuthRedirectIfNeeded('/p')).toBe(false);
    expect(mockStartRedirect).not.toHaveBeenCalled();
  });

  it('does NOT redirect (false) on a popup surface (desktop) even with no token — popup path stays', async () => {
    mockShouldRedirect.mockReturnValue(false);
    mockIsTokenValid.mockReturnValue(false);

    expect(await beginDriveAuthRedirectIfNeeded('/p')).toBe(false);
    expect(mockStartRedirect).not.toHaveBeenCalled();
  });

  it('forceReauth redirects (true) even with a valid token — the switch-account case', async () => {
    mockShouldRedirect.mockReturnValue(true);
    mockIsTokenValid.mockReturnValue(true);

    expect(await beginDriveAuthRedirectIfNeeded('/p', undefined, { forceReauth: true })).toBe(true);
    expect(mockStartRedirect).toHaveBeenCalledWith('/p', undefined);
  });

  it('forceReauth on a popup surface still does NOT redirect (transport decision wins)', async () => {
    mockShouldRedirect.mockReturnValue(false);
    mockIsTokenValid.mockReturnValue(true);

    expect(await beginDriveAuthRedirectIfNeeded('/p', undefined, { forceReauth: true })).toBe(
      false
    );
    expect(mockStartRedirect).not.toHaveBeenCalled();
  });

  it('propagates a startRedirectAuth failure to the caller (never swallowed)', async () => {
    mockShouldRedirect.mockReturnValue(true);
    mockIsTokenValid.mockReturnValue(false);
    mockStartRedirect.mockRejectedValue(new Error('Browser.open rejected'));

    await expect(beginDriveAuthRedirectIfNeeded('/p')).rejects.toThrow('Browser.open rejected');
  });
});
