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
const mockGetOrCreateAppFolder = vi.fn().mockResolvedValue('folder-id');
const mockCreateFile = vi.fn().mockResolvedValue({ fileId: 'new-file-id', name: 'test.beanpod' });
const mockClearFolderCache = vi.fn();

vi.mock('@/services/google/driveService', () => ({
  updateFile: (...args: unknown[]) => mockUpdateFile(...args),
  readFile: (...args: unknown[]) => mockReadFile(...args),
  getFileModifiedTime: (...args: unknown[]) => mockGetFileModifiedTime(...args),
  getOrCreateAppFolder: (...args: unknown[]) => mockGetOrCreateAppFolder(...args),
  createFile: (...args: unknown[]) => mockCreateFile(...args),
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

    it('queues for offline on network error', async () => {
      const { enqueueOfflineSave } = await import('../../offlineQueue');

      mockUpdateFile.mockRejectedValueOnce(new TypeError('Failed to fetch'));

      await provider.write('{"data":"offline"}');

      expect(enqueueOfflineSave).toHaveBeenCalledWith('{"data":"offline"}');
    });
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
});
