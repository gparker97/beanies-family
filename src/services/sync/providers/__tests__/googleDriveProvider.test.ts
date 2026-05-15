import { describe, it, expect, beforeEach, vi } from 'vitest';
import { GoogleDriveProvider } from '../googleDriveProvider';

// Mock dependencies
vi.mock('@/services/google/googleAuth', () => ({
  getValidTokenSilent: vi.fn(async () => 'mock-token'),
  isTokenValid: vi.fn(() => true),
  requestAccessToken: vi.fn(async () => 'refreshed-token'),
  attemptSilentRefresh: vi.fn(async () => null),
  clearGoogleSessionState: vi.fn(async () => {}),
  fetchGoogleUserEmail: vi.fn(async () => 'test@example.com'),
  getGoogleAccountEmail: vi.fn(() => null),
  setGoogleAccountEmail: vi.fn(),
  TokenExpiredError: class TokenExpiredError extends Error {
    constructor(message = 'Google access token expired and silent refresh failed') {
      super(message);
      this.name = 'TokenExpiredError';
    }
  },
}));

const mockUpdateFile = vi.fn();
const mockReadFile = vi.fn().mockResolvedValue('{"version":"4.0"}');
const mockGetFileModifiedTime = vi.fn().mockResolvedValue('2026-02-26T12:00:00Z');
const mockGetFileMetadata = vi.fn().mockResolvedValue({ mimeType: 'application/octet-stream' });
const mockPatchFileMetadata = vi.fn().mockResolvedValue(undefined);
const mockGetOrCreateAppFolder = vi.fn().mockResolvedValue('folder-id');
const mockCreateFile = vi.fn().mockResolvedValue({ fileId: 'new-file-id', name: 'test.beanpod' });
const mockListBeanpodFiles = vi.fn().mockResolvedValue([]);
const mockClearFolderCache = vi.fn();

vi.mock('@/services/google/driveService', () => ({
  updateFile: (...args: unknown[]) => mockUpdateFile(...args),
  readFile: (...args: unknown[]) => mockReadFile(...args),
  getFileModifiedTime: (...args: unknown[]) => mockGetFileModifiedTime(...args),
  getFileMetadata: (...args: unknown[]) => mockGetFileMetadata(...args),
  patchFileMetadata: (...args: unknown[]) => mockPatchFileMetadata(...args),
  getOrCreateAppFolder: (...args: unknown[]) => mockGetOrCreateAppFolder(...args),
  createFile: (...args: unknown[]) => mockCreateFile(...args),
  listBeanpodFiles: (...args: unknown[]) => mockListBeanpodFiles(...args),
  clearFolderCache: () => mockClearFolderCache(),
  DriveApiError: class DriveApiError extends Error {
    readonly status: number;
    constructor(message: string, status: number) {
      super(message);
      this.name = 'DriveApiError';
      this.status = status;
    }
  },
}));

vi.mock('../../fileHandleStore', () => ({
  storeProviderConfig: vi.fn(async () => {}),
  clearProviderConfig: vi.fn(async () => {}),
  clearFileHandleForFamily: vi.fn(async () => {}),
}));

vi.mock('../../offlineQueue', () => ({
  enqueueOfflineSave: vi.fn(),
  setFlushProvider: vi.fn(),
}));

describe('GoogleDriveProvider', () => {
  let provider: GoogleDriveProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new GoogleDriveProvider('file-123', 'family.beanpod');
  });

  it('has type "google_drive"', () => {
    expect(provider.type).toBe('google_drive');
  });

  describe('write', () => {
    it('calls updateFile with valid token', async () => {
      await provider.write('{"data":"test"}');
      expect(mockUpdateFile).toHaveBeenCalledWith('mock-token', 'file-123', '{"data":"test"}');
    });
  });

  describe('read', () => {
    it('calls readFile with valid token', async () => {
      const content = await provider.read();
      expect(content).toBe('{"version":"4.0"}');
      expect(mockReadFile).toHaveBeenCalledWith('mock-token', 'file-123');
    });
  });

  describe('mimeType migration (legacy .beanpod fix)', () => {
    it('patches legacy application/json mimeType to application/octet-stream after first read', async () => {
      mockGetFileMetadata.mockResolvedValueOnce({ mimeType: 'application/json' });
      await provider.read();
      // Migration is fire-and-forget after read returns. Flush microtasks so it runs.
      await new Promise((r) => setTimeout(r, 0));
      expect(mockGetFileMetadata).toHaveBeenCalledWith('mock-token', 'file-123', 'mimeType');
      expect(mockPatchFileMetadata).toHaveBeenCalledWith('mock-token', 'file-123', {
        mimeType: 'application/octet-stream',
      });
    });

    it('skips PATCH when mimeType is already application/octet-stream', async () => {
      mockGetFileMetadata.mockResolvedValueOnce({ mimeType: 'application/octet-stream' });
      await provider.read();
      await new Promise((r) => setTimeout(r, 0));
      expect(mockGetFileMetadata).toHaveBeenCalled();
      expect(mockPatchFileMetadata).not.toHaveBeenCalled();
    });

    it('only checks once per provider session (subsequent reads skip the metadata fetch)', async () => {
      mockGetFileMetadata.mockResolvedValue({ mimeType: 'application/octet-stream' });
      await provider.read();
      await new Promise((r) => setTimeout(r, 0));
      await provider.read();
      await provider.read();
      await new Promise((r) => setTimeout(r, 0));
      expect(mockGetFileMetadata).toHaveBeenCalledTimes(1);
    });

    it('does not block read or surface errors when migration check fails', async () => {
      mockGetFileMetadata.mockRejectedValueOnce(new Error('metadata fetch failed'));
      const content = await provider.read();
      expect(content).toBe('{"version":"4.0"}');
      await new Promise((r) => setTimeout(r, 0));
      expect(mockPatchFileMetadata).not.toHaveBeenCalled();
    });
  });

  describe('getLastModified', () => {
    it('calls getFileModifiedTime', async () => {
      const time = await provider.getLastModified();
      expect(time).toBe('2026-02-26T12:00:00Z');
      expect(mockGetFileModifiedTime).toHaveBeenCalledWith('mock-token', 'file-123');
    });

    it('returns null on error', async () => {
      mockGetFileModifiedTime.mockRejectedValueOnce(new Error('network'));
      const time = await provider.getLastModified();
      expect(time).toBeNull();
    });
  });

  describe('isReady', () => {
    it('checks token validity', async () => {
      const { isTokenValid } = await import('@/services/google/googleAuth');
      expect(await provider.isReady()).toBe(true);
      expect(isTokenValid).toHaveBeenCalled();
    });
  });

  describe('persist', () => {
    it('stores provider config in IndexedDB', async () => {
      const { storeProviderConfig } = await import('../../fileHandleStore');
      await provider.persist('family-456');
      expect(storeProviderConfig).toHaveBeenCalledWith('family-456', {
        type: 'google_drive',
        driveFileId: 'file-123',
        driveFileName: 'family.beanpod',
      });
    });
  });

  describe('clearPersisted', () => {
    it('clears provider config from IndexedDB', async () => {
      const { clearProviderConfig } = await import('../../fileHandleStore');
      await provider.clearPersisted('family-456');
      expect(clearProviderConfig).toHaveBeenCalledWith('family-456');
    });
  });

  describe('disconnect', () => {
    it('clears Google session state and folder cache', async () => {
      const { clearGoogleSessionState } = await import('@/services/google/googleAuth');
      await provider.disconnect();
      expect(clearGoogleSessionState).toHaveBeenCalled();
      expect(mockClearFolderCache).toHaveBeenCalled();
    });
  });

  describe('getDisplayName', () => {
    it('returns the file name', () => {
      expect(provider.getDisplayName()).toBe('family.beanpod');
    });
  });

  describe('getFileId', () => {
    it('returns the Drive file ID', () => {
      expect(provider.getFileId()).toBe('file-123');
    });
  });

  describe('fromExisting', () => {
    it('creates a provider with existing file ID', () => {
      const p = GoogleDriveProvider.fromExisting('existing-id', 'existing.beanpod');
      expect(p).toBeInstanceOf(GoogleDriveProvider);
      expect(p.getFileId()).toBe('existing-id');
      expect(p.getDisplayName()).toBe('existing.beanpod');
    });
  });

  describe('createNew', () => {
    it('creates a new file on Google Drive', async () => {
      const p = await GoogleDriveProvider.createNew('new-family.beanpod');
      expect(p).toBeInstanceOf(GoogleDriveProvider);
      expect(p.getFileId()).toBe('new-file-id');
      expect(p.getDisplayName()).toBe('test.beanpod'); // returned by mockCreateFile
      expect(mockGetOrCreateAppFolder).toHaveBeenCalled();
      expect(mockCreateFile).toHaveBeenCalled();
    });
  });

  describe('write — 401 recovery (silent-only, no popups)', () => {
    it('tries silent refresh on 401 and retries on success', async () => {
      const { DriveApiError: MockDriveApiError } = await import('@/services/google/driveService');
      const { attemptSilentRefresh, requestAccessToken } =
        await import('@/services/google/googleAuth');

      mockUpdateFile.mockRejectedValueOnce(new MockDriveApiError('Unauthorized', 401));
      (attemptSilentRefresh as ReturnType<typeof vi.fn>).mockResolvedValueOnce('silent-token');

      await provider.write('{"data":"test"}');

      expect(attemptSilentRefresh).toHaveBeenCalled();
      // Must NOT open an unsolicited popup mid-save.
      expect(requestAccessToken).not.toHaveBeenCalled();
      expect(mockUpdateFile).toHaveBeenCalledWith('silent-token', 'file-123', '{"data":"test"}');
    });

    it('on 401 + silent refresh failure: queues offline + throws TokenExpiredError (no popup)', async () => {
      const { DriveApiError: MockDriveApiError } = await import('@/services/google/driveService');
      const { attemptSilentRefresh, requestAccessToken, TokenExpiredError } =
        await import('@/services/google/googleAuth');
      const { enqueueOfflineSave } = await import('../../offlineQueue');

      mockUpdateFile.mockRejectedValueOnce(new MockDriveApiError('Unauthorized', 401));
      (attemptSilentRefresh as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);

      await expect(provider.write('{"data":"test"}')).rejects.toBeInstanceOf(TokenExpiredError);

      expect(attemptSilentRefresh).toHaveBeenCalled();
      // Must NOT open an unsolicited popup.
      expect(requestAccessToken).not.toHaveBeenCalled();
      expect(enqueueOfflineSave).toHaveBeenCalledWith('{"data":"test"}');
    });

    it('when getValidTokenSilent throws TokenExpiredError: queues offline + re-throws (no popup)', async () => {
      const { getValidTokenSilent, requestAccessToken, TokenExpiredError } =
        await import('@/services/google/googleAuth');
      const { enqueueOfflineSave } = await import('../../offlineQueue');

      (getValidTokenSilent as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new TokenExpiredError()
      );

      await expect(provider.write('{"data":"test"}')).rejects.toBeInstanceOf(TokenExpiredError);

      expect(requestAccessToken).not.toHaveBeenCalled();
      expect(enqueueOfflineSave).toHaveBeenCalledWith('{"data":"test"}');
    });

    it('queues for offline when network error persists across retries', async () => {
      const { enqueueOfflineSave } = await import('../../offlineQueue');

      // withRetry retries network errors up to 3 times before giving up. To
      // hit the queue-offline path we have to fail every attempt.
      mockUpdateFile.mockRejectedValue(new TypeError('Failed to fetch'));

      await provider.write('{"data":"offline"}');

      expect(enqueueOfflineSave).toHaveBeenCalledWith('{"data":"offline"}');
    }, 20_000); // exponential backoff: 1s + 2s + 4s = 7s of retries

    it('recovers silently when transient network error resolves on retry', async () => {
      const { enqueueOfflineSave } = await import('../../offlineQueue');
      vi.mocked(enqueueOfflineSave).mockClear();
      // mockReset clears both calls AND implementation (the previous test set
      // a persistent mockRejectedValue that would otherwise leak into this one).
      mockUpdateFile.mockReset();

      // First attempt fails with a TypeError; second attempt succeeds.
      // No banner, no offline queue — purely silent retry.
      mockUpdateFile.mockRejectedValueOnce(new TypeError('Failed to fetch'));

      await provider.write('{"data":"transient"}');

      expect(enqueueOfflineSave).not.toHaveBeenCalled();
      expect(mockUpdateFile).toHaveBeenCalledTimes(2);
    }, 20_000);
  });

  describe('read — 401 recovery (silent-only, no popups)', () => {
    it('tries silent refresh on 401 and retries on success', async () => {
      const { DriveApiError: MockDriveApiError } = await import('@/services/google/driveService');
      const { attemptSilentRefresh, requestAccessToken } =
        await import('@/services/google/googleAuth');

      mockReadFile.mockRejectedValueOnce(new MockDriveApiError('Unauthorized', 401));
      (attemptSilentRefresh as ReturnType<typeof vi.fn>).mockResolvedValueOnce('silent-token');
      mockReadFile.mockResolvedValueOnce('{"version":"4.0"}');

      const content = await provider.read();

      expect(attemptSilentRefresh).toHaveBeenCalled();
      // Must NOT open an unsolicited popup mid-read.
      expect(requestAccessToken).not.toHaveBeenCalled();
      expect(mockReadFile).toHaveBeenCalledWith('silent-token', 'file-123');
      expect(content).toBe('{"version":"4.0"}');
    });

    it('on 401 + silent refresh failure: throws TokenExpiredError (no popup)', async () => {
      const { DriveApiError: MockDriveApiError } = await import('@/services/google/driveService');
      const { attemptSilentRefresh, requestAccessToken, TokenExpiredError } =
        await import('@/services/google/googleAuth');

      mockReadFile.mockRejectedValueOnce(new MockDriveApiError('Unauthorized', 401));
      (attemptSilentRefresh as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);

      await expect(provider.read()).rejects.toBeInstanceOf(TokenExpiredError);

      expect(attemptSilentRefresh).toHaveBeenCalled();
      // Must NOT open an unsolicited popup.
      expect(requestAccessToken).not.toHaveBeenCalled();
    });

    it('when getValidTokenSilent throws TokenExpiredError: re-throws (no popup)', async () => {
      const { getValidTokenSilent, requestAccessToken, TokenExpiredError } =
        await import('@/services/google/googleAuth');

      (getValidTokenSilent as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new TokenExpiredError()
      );

      await expect(provider.read()).rejects.toBeInstanceOf(TokenExpiredError);

      expect(requestAccessToken).not.toHaveBeenCalled();
    });
  });

  describe('getLastModified — TokenExpiredError surfacing', () => {
    it('re-throws TokenExpiredError from getValidTokenSilent', async () => {
      const { getValidTokenSilent, TokenExpiredError } =
        await import('@/services/google/googleAuth');

      (getValidTokenSilent as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new TokenExpiredError()
      );

      await expect(provider.getLastModified()).rejects.toBeInstanceOf(TokenExpiredError);
    });
  });

  describe('getLastModified — 401 handling', () => {
    it('re-throws 401 errors', async () => {
      const { DriveApiError: MockDriveApiError } = await import('@/services/google/driveService');

      mockGetFileModifiedTime.mockRejectedValueOnce(new MockDriveApiError('Unauthorized', 401));

      await expect(provider.getLastModified()).rejects.toThrow('Unauthorized');
    });

    it('returns null for network errors (not 401)', async () => {
      mockGetFileModifiedTime.mockRejectedValueOnce(new TypeError('Failed to fetch'));

      const time = await provider.getLastModified();
      expect(time).toBeNull();
    });

    it('re-throws 404 errors', async () => {
      const { DriveApiError: MockDriveApiError } = await import('@/services/google/driveService');

      mockGetFileModifiedTime.mockRejectedValueOnce(new MockDriveApiError('Not Found', 404));

      await expect(provider.getLastModified()).rejects.toThrow('Not Found');
    });

    it('returns null for non-401/404 API errors', async () => {
      const { DriveApiError: MockDriveApiError } = await import('@/services/google/driveService');

      mockGetFileModifiedTime.mockRejectedValueOnce(new MockDriveApiError('Rate limited', 429));

      const time = await provider.getLastModified();
      expect(time).toBeNull();
    });
  });

  describe('write — 404 handling', () => {
    it('re-throws 404 errors (file deleted)', async () => {
      const { DriveApiError: MockDriveApiError } = await import('@/services/google/driveService');

      mockUpdateFile.mockRejectedValueOnce(new MockDriveApiError('Not Found', 404));

      await expect(provider.write('{"data":"test"}')).rejects.toThrow('Not Found');
    });
  });

  describe('createNew — name collision detection', () => {
    // Drive doesn't dedupe by filename — two .beanpod files can coexist in
    // the same folder with the same name + different fileIds. Pre-fix, this
    // silently orphaned a user's real pod with an empty duplicate (the
    // Shaun-class incident on 2026-05-15). `createNew` now lists the folder
    // first and refuses on collision with a typed error.
    it('throws FileNameCollisionError when a same-named file exists in the folder', async () => {
      const { FileNameCollisionError } = await import('@/types/sync');
      mockListBeanpodFiles.mockResolvedValueOnce([
        { fileId: 'existing-abc', name: 'LaFleur.beanpod', modifiedTime: '2026-05-14T00:00:00Z' },
      ]);
      try {
        await GoogleDriveProvider.createNew('LaFleur.beanpod', { forceConsent: false });
        expect.fail('createNew should have thrown FileNameCollisionError');
      } catch (e) {
        expect(e).toBeInstanceOf(FileNameCollisionError);
        expect((e as InstanceType<typeof FileNameCollisionError>).existingFileId).toBe(
          'existing-abc'
        );
        expect((e as InstanceType<typeof FileNameCollisionError>).fileName).toBe('LaFleur.beanpod');
      }
      // Must NOT have called createFile — the whole point is to prevent the
      // duplicate from being written in the first place.
      expect(mockCreateFile).not.toHaveBeenCalled();
    });

    it('proceeds normally when no same-named file exists in the folder', async () => {
      mockListBeanpodFiles.mockResolvedValueOnce([
        // Different family pod in the same folder — not a collision
        { fileId: 'other', name: 'Smith.beanpod', modifiedTime: '2026-05-14T00:00:00Z' },
      ]);
      mockCreateFile.mockResolvedValueOnce({ fileId: 'new-id', name: 'LaFleur.beanpod' });
      const created = await GoogleDriveProvider.createNew('LaFleur.beanpod', {
        forceConsent: false,
      });
      expect(created.getFileId()).toBe('new-id');
      expect(mockCreateFile).toHaveBeenCalled();
    });

    it('continues to create when the collision check itself fails (best-effort, never blocks)', async () => {
      mockListBeanpodFiles.mockRejectedValueOnce(new Error('Drive listing failed'));
      mockCreateFile.mockResolvedValueOnce({ fileId: 'new-id', name: 'LaFleur.beanpod' });
      const created = await GoogleDriveProvider.createNew('LaFleur.beanpod', {
        forceConsent: false,
      });
      expect(created.getFileId()).toBe('new-id');
      expect(mockCreateFile).toHaveBeenCalled();
    });
  });
});
