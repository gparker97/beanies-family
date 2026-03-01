import { describe, it, expect, beforeEach, vi } from 'vitest';
import { GoogleDriveProvider } from '../googleDriveProvider';

// Mock dependencies
vi.mock('@/services/google/googleAuth', () => ({
  getValidToken: vi.fn(async () => 'mock-token'),
  isTokenValid: vi.fn(() => true),
  requestAccessToken: vi.fn(async () => 'refreshed-token'),
  attemptSilentRefresh: vi.fn(async () => null),
  revokeToken: vi.fn(),
  loadGIS: vi.fn(async () => {}),
  fetchGoogleUserEmail: vi.fn(async () => 'test@example.com'),
  getGoogleAccountEmail: vi.fn(() => null),
  setGoogleAccountEmail: vi.fn(),
}));

const mockUpdateFile = vi.fn();
const mockReadFile = vi.fn().mockResolvedValue('{"version":"2.0"}');
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
      expect(content).toBe('{"version":"2.0"}');
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
    it('revokes token and clears cache', async () => {
      const { revokeToken } = await import('@/services/google/googleAuth');
      await provider.disconnect();
      expect(revokeToken).toHaveBeenCalled();
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

  describe('write — 401 retry with silent refresh', () => {
    it('tries silent refresh before interactive auth on 401', async () => {
      const { DriveApiError: MockDriveApiError } = await import('@/services/google/driveService');
      const { attemptSilentRefresh, requestAccessToken } =
        await import('@/services/google/googleAuth');

      // First write fails with 401
      mockUpdateFile.mockRejectedValueOnce(new MockDriveApiError('Unauthorized', 401));

      // Silent refresh succeeds
      (attemptSilentRefresh as ReturnType<typeof vi.fn>).mockResolvedValueOnce('silent-token');

      await provider.write('{"data":"test"}');

      // Should have tried silent refresh
      expect(attemptSilentRefresh).toHaveBeenCalled();
      // Should NOT have called interactive requestAccessToken
      expect(requestAccessToken).not.toHaveBeenCalled();
      // Should have retried with the silent token
      expect(mockUpdateFile).toHaveBeenCalledWith('silent-token', 'file-123', '{"data":"test"}');
    });

    it('falls back to interactive auth when silent refresh fails', async () => {
      const { DriveApiError: MockDriveApiError } = await import('@/services/google/driveService');
      const { attemptSilentRefresh, requestAccessToken } =
        await import('@/services/google/googleAuth');

      // First write fails with 401
      mockUpdateFile.mockRejectedValueOnce(new MockDriveApiError('Unauthorized', 401));

      // Silent refresh fails
      (attemptSilentRefresh as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);

      await provider.write('{"data":"test"}');

      // Should have tried silent refresh
      expect(attemptSilentRefresh).toHaveBeenCalled();
      // Should have fallen back to interactive auth
      expect(requestAccessToken).toHaveBeenCalled();
      // Should have retried with the interactive token
      expect(mockUpdateFile).toHaveBeenCalledWith('refreshed-token', 'file-123', '{"data":"test"}');
    });

    it('queues for offline on network error', async () => {
      const { enqueueOfflineSave } = await import('../../offlineQueue');

      mockUpdateFile.mockRejectedValueOnce(new TypeError('Failed to fetch'));

      await provider.write('{"data":"offline"}');

      expect(enqueueOfflineSave).toHaveBeenCalledWith('{"data":"offline"}');
    });
  });

  describe('read — 401 retry with silent refresh', () => {
    it('tries silent refresh before interactive auth on 401', async () => {
      const { DriveApiError: MockDriveApiError } = await import('@/services/google/driveService');
      const { attemptSilentRefresh, requestAccessToken } =
        await import('@/services/google/googleAuth');

      // First read fails with 401
      mockReadFile.mockRejectedValueOnce(new MockDriveApiError('Unauthorized', 401));

      // Silent refresh succeeds
      (attemptSilentRefresh as ReturnType<typeof vi.fn>).mockResolvedValueOnce('silent-token');

      // Second read succeeds
      mockReadFile.mockResolvedValueOnce('{"version":"2.0"}');

      const content = await provider.read();

      expect(attemptSilentRefresh).toHaveBeenCalled();
      expect(requestAccessToken).not.toHaveBeenCalled();
      expect(mockReadFile).toHaveBeenCalledWith('silent-token', 'file-123');
      expect(content).toBe('{"version":"2.0"}');
    });

    it('falls back to interactive auth when silent refresh fails', async () => {
      const { DriveApiError: MockDriveApiError } = await import('@/services/google/driveService');
      const { attemptSilentRefresh, requestAccessToken } =
        await import('@/services/google/googleAuth');

      // First read fails with 401
      mockReadFile.mockRejectedValueOnce(new MockDriveApiError('Unauthorized', 401));

      // Silent refresh fails
      (attemptSilentRefresh as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);

      // Second read succeeds
      mockReadFile.mockResolvedValueOnce('{"version":"2.0"}');

      const content = await provider.read();

      expect(attemptSilentRefresh).toHaveBeenCalled();
      expect(requestAccessToken).toHaveBeenCalled();
      expect(mockReadFile).toHaveBeenCalledWith('refreshed-token', 'file-123');
      expect(content).toBe('{"version":"2.0"}');
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
