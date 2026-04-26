import { describe, it, expect, beforeEach, vi } from 'vitest';

// --- Mocks ---------------------------------------------------------------

// Translation: return the key back so we can assert which message was set.
vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

// inviteService: dynamically imported inside the composable, so we mock the
// module at the path it imports from. Using untyped vi.fn() + mockImplementation
// keeps the mock signatures permissive (the real consumer's types still apply).
const buildInviteLinkMock = vi.fn();
const generateInviteTokenMock = vi.fn();
const createInvitePackageMock = vi.fn();
const hashInviteTokenMock = vi.fn();
const isInviteExpiredMock = vi.fn();
vi.mock('@/services/crypto/inviteService', () => ({
  buildInviteLink: (...args: unknown[]) => buildInviteLinkMock(...args),
  generateInviteToken: (...args: unknown[]) => generateInviteTokenMock(...args),
  createInvitePackage: (...args: unknown[]) => createInvitePackageMock(...args),
  hashInviteToken: (...args: unknown[]) => hashInviteTokenMock(...args),
  isInviteExpired: (...args: unknown[]) => isInviteExpiredMock(...args),
}));

// Drive API
const shareFileWithEmailMock = vi.fn();
const resolveCanonicalFolderIdMock = vi.fn();
vi.mock('@/services/google/driveService', () => ({
  shareFileWithEmail: (...args: unknown[]) => shareFileWithEmailMock(...args),
  resolveCanonicalFolderId: (...args: unknown[]) => resolveCanonicalFolderIdMock(...args),
}));

const getValidTokenMock = vi.fn();
vi.mock('@/services/google/googleAuth', () => ({
  getValidToken: (...args: unknown[]) => getValidTokenMock(...args),
}));

// QR generation
const generateInviteQRMock = vi.fn();
vi.mock('@/utils/qrCode', () => ({
  generateInviteQR: (...args: unknown[]) => generateInviteQRMock(...args),
}));

// Pinia stores
const syncStoreState = {
  storageProviderType: 'google_drive' as 'google_drive' | 'local' | null,
  fileName: 'family.beanpod',
  driveFileId: 'drive-file-id-123',
  familyKey: { type: 'mock-key' } as unknown as CryptoKey,
  addInvitePackage: vi.fn(async () => undefined),
};
vi.mock('@/stores/syncStore', () => ({
  useSyncStore: () => syncStoreState,
}));

const familyContextState = {
  activeFamilyId: 'family-abc',
};
vi.mock('@/stores/familyContextStore', () => ({
  useFamilyContextStore: () => familyContextState,
}));

// --- Subject under test (imported AFTER mocks are registered) -----------

import { useInviteFlow } from '../useInviteFlow';

// --- Tests ---------------------------------------------------------------

describe('useInviteFlow', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    // Restore mock defaults
    syncStoreState.storageProviderType = 'google_drive';
    syncStoreState.driveFileId = 'drive-file-id-123';
    syncStoreState.familyKey = { type: 'mock-key' } as unknown as CryptoKey;
    buildInviteLinkMock.mockImplementation((params: Record<string, unknown>) => {
      const parts = [`fam=${params.familyId}`];
      if (params.token) parts.push(`token=${params.token}`);
      if (params.inviteeEmail)
        parts.push(`hint=${encodeURIComponent(params.inviteeEmail as string)}`);
      return `https://beanies.family/join#${parts.join('&')}`;
    });
    generateInviteTokenMock.mockReturnValue('token-fresh');
    createInvitePackageMock.mockResolvedValue({
      salt: 'salt',
      wrapped: 'wrapped',
      expiresAt: '2030-01-01T00:00:00Z',
    });
    hashInviteTokenMock.mockResolvedValue('hash-fresh');
    isInviteExpiredMock.mockReturnValue(false);
    shareFileWithEmailMock.mockResolvedValue(undefined);
    resolveCanonicalFolderIdMock.mockResolvedValue('folder-id');
    getValidTokenMock.mockResolvedValue('access-token');
    generateInviteQRMock.mockImplementation(
      async (link: string) => `data:image/png;base64,${btoa(link)}`
    );
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  describe('regenerateLinkForEmail', () => {
    it('generates a fresh link + QR on first call (no cached token)', async () => {
      const flow = useInviteFlow();

      const ok = await flow.regenerateLinkForEmail('joey@gmail.com');

      expect(ok).toBe(true);
      expect(generateInviteTokenMock).toHaveBeenCalledOnce();
      expect(createInvitePackageMock).toHaveBeenCalledOnce();
      expect(syncStoreState.addInvitePackage).toHaveBeenCalledWith(
        'hash-fresh',
        expect.any(Object)
      );
      expect(flow.inviteLink.value).toContain('token=token-fresh');
      expect(flow.inviteLink.value).toContain('hint=');
      expect(flow.inviteQrUrl.value).toMatch(/^data:image\/png;base64,/);
      expect(flow.error.value).toBeNull();
    });

    it('reuses the cached token on a second call (no envelope-slot churn)', async () => {
      const flow = useInviteFlow();

      // First call burns a fresh token
      await flow.regenerateLinkForEmail('joey@gmail.com');
      expect(generateInviteTokenMock).toHaveBeenCalledTimes(1);

      // Second call with a different email — should reuse the cached token
      const ok = await flow.regenerateLinkForEmail('emma@gmail.com');

      expect(ok).toBe(true);
      expect(generateInviteTokenMock).toHaveBeenCalledTimes(1); // not called again
      expect(syncStoreState.addInvitePackage).toHaveBeenCalledTimes(1); // no new envelope write
      expect(flow.inviteLink.value).toContain('token=token-fresh'); // same token
      expect(flow.inviteLink.value).toContain('hint=emma'); // new hint
    });

    it('regenerates a fresh token when the cache is expired', async () => {
      const flow = useInviteFlow();

      // Burn a fresh token
      await flow.regenerateLinkForEmail('joey@gmail.com');
      expect(generateInviteTokenMock).toHaveBeenCalledTimes(1);

      // Pretend the cache expired
      isInviteExpiredMock.mockReturnValue(true);
      generateInviteTokenMock.mockReturnValueOnce('token-second');

      const ok = await flow.regenerateLinkForEmail('emma@gmail.com');

      expect(ok).toBe(true);
      expect(generateInviteTokenMock).toHaveBeenCalledTimes(2);
      expect(flow.inviteLink.value).toContain('token=token-second');
    });

    it('clears the cache and surfaces error on envelope-write failure', async () => {
      const flow = useInviteFlow();

      syncStoreState.addInvitePackage.mockRejectedValueOnce(new Error('envelope write failed'));

      const ok = await flow.regenerateLinkForEmail('joey@gmail.com');

      expect(ok).toBe(false);
      expect(flow.error.value).not.toBeNull();
      expect(flow.error.value?.code).toBe('link-generation-failed');
      expect(flow.error.value?.recovery).toBe('retry');
      // Best-effort fallback URL is rendered so user isn't left empty-handed
      expect(flow.inviteLink.value).toContain('hint=');
      expect(flow.inviteLink.value).not.toContain('token=');
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('regenerateLinkForEmail failed'),
        expect.any(Object)
      );
    });

    it('keeps the link usable when QR generation fails (non-critical)', async () => {
      const flow = useInviteFlow();

      generateInviteQRMock.mockRejectedValueOnce(new Error('canvas unavailable'));

      const ok = await flow.regenerateLinkForEmail('joey@gmail.com');

      expect(ok).toBe(true);
      expect(flow.inviteLink.value).toContain('token=token-fresh');
      expect(flow.inviteQrUrl.value).toBe('');
      expect(flow.error.value).toBeNull(); // QR failure does NOT set error
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('QR generation failed'),
        expect.any(Object)
      );
    });

    it('returns a token-less URL when no family key is available', async () => {
      const flow = useInviteFlow();
      syncStoreState.familyKey = null as unknown as CryptoKey;

      const ok = await flow.regenerateLinkForEmail('joey@gmail.com');

      expect(ok).toBe(true);
      expect(generateInviteTokenMock).not.toHaveBeenCalled();
      expect(flow.inviteLink.value).not.toContain('token=');
      expect(flow.inviteLink.value).toContain('hint=');
    });
  });

  describe('shareDriveAccess', () => {
    it('shares with Drive, regenerates link, and resolves true on success', async () => {
      const flow = useInviteFlow();

      const ok = await flow.shareDriveAccess('joey@gmail.com');

      expect(ok).toBe(true);
      expect(getValidTokenMock).toHaveBeenCalled();
      // Two share calls: .beanpod + folder
      expect(shareFileWithEmailMock).toHaveBeenCalledWith(
        'access-token',
        'drive-file-id-123',
        'joey@gmail.com',
        'writer'
      );
      expect(shareFileWithEmailMock).toHaveBeenCalledWith(
        'access-token',
        'folder-id',
        'joey@gmail.com',
        'writer'
      );
      expect(flow.lastSharedEmail.value).toBe('joey@gmail.com');
      expect(flow.inviteLink.value).toContain('hint=joey');
      expect(flow.error.value).toBeNull();
    });

    it('rejects invalid email format synchronously (no API call)', async () => {
      const flow = useInviteFlow();

      const ok = await flow.shareDriveAccess('not-an-email');

      expect(ok).toBe(false);
      expect(getValidTokenMock).not.toHaveBeenCalled();
      expect(shareFileWithEmailMock).not.toHaveBeenCalled();
      expect(flow.error.value?.code).toBe('invalid-email');
      expect(flow.error.value?.recovery).toBe('edit-email');
    });

    it('rejects unshareable emails (.local, .test, etc.) synchronously', async () => {
      const flow = useInviteFlow();

      const ok = await flow.shareDriveAccess('user@somewhere.local');

      expect(ok).toBe(false);
      expect(shareFileWithEmailMock).not.toHaveBeenCalled();
      expect(flow.error.value?.code).toBe('unshareable-email');
      expect(flow.error.value?.recovery).toBe('edit-email');
    });

    it('surfaces invalid-google-email when Drive 403s with "not a Google account"', async () => {
      const flow = useInviteFlow();
      shareFileWithEmailMock.mockRejectedValueOnce(
        new Error('The invitee is not a Google account')
      );

      const ok = await flow.shareDriveAccess('typo@gmial.com');

      expect(ok).toBe(false);
      expect(flow.error.value?.code).toBe('invalid-google-email');
      expect(flow.error.value?.recovery).toBe('edit-email');
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('shareDriveAccess failed'),
        expect.any(Object)
      );
    });

    it('surfaces drive-share-failed on generic network errors with retry recovery', async () => {
      const flow = useInviteFlow();
      shareFileWithEmailMock.mockRejectedValueOnce(new Error('network timeout'));

      const ok = await flow.shareDriveAccess('joey@gmail.com');

      expect(ok).toBe(false);
      expect(flow.error.value?.code).toBe('drive-share-failed');
      expect(flow.error.value?.recovery).toBe('retry');
    });

    it('treats folder-share failure as non-fatal and still resolves true', async () => {
      const flow = useInviteFlow();
      // First share (file) succeeds; second share (folder) fails
      shareFileWithEmailMock.mockResolvedValueOnce(undefined);
      shareFileWithEmailMock.mockRejectedValueOnce(new Error('folder permission denied'));

      const ok = await flow.shareDriveAccess('joey@gmail.com');

      expect(ok).toBe(true); // Still success — folder is best-effort
      expect(flow.lastSharedEmail.value).toBe('joey@gmail.com');
      expect(flow.error.value).toBeNull();
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Folder share failed (non-fatal)'),
        expect.any(Error)
      );
    });

    it('rejects when no driveFileId is configured', async () => {
      const flow = useInviteFlow();
      syncStoreState.driveFileId = '';

      const ok = await flow.shareDriveAccess('joey@gmail.com');

      expect(ok).toBe(false);
      expect(flow.error.value?.code).toBe('drive-share-failed');
      expect(getValidTokenMock).not.toHaveBeenCalled();
    });
  });

  describe('reset', () => {
    it('clears UI state but preserves the cached token', async () => {
      const flow = useInviteFlow();

      await flow.regenerateLinkForEmail('joey@gmail.com');
      expect(flow.inviteLink.value).not.toBe('');

      flow.reset();

      expect(flow.inviteLink.value).toBe('');
      expect(flow.inviteQrUrl.value).toBe('');
      expect(flow.error.value).toBeNull();
      expect(flow.lastSharedEmail.value).toBeNull();

      // The cached token should still be reused on the next call
      await flow.regenerateLinkForEmail('emma@gmail.com');
      expect(generateInviteTokenMock).toHaveBeenCalledTimes(1); // not called again
    });
  });
});
