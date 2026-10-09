import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
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
  // The account-mismatch classifier drops the cached token: this is where the
  // app LEARNS the session cannot reach the file, and `isTokenValid()` is a
  // local clock check that would otherwise keep blessing it for up to an hour.
  invalidateAccessToken: vi.fn(),
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
const mockListFilesInFolder = vi.fn().mockResolvedValue([]);
const mockDeleteFile = vi.fn().mockResolvedValue(undefined);
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
  listFilesInFolder: (...args: unknown[]) => mockListFilesInFolder(...args),
  deleteFile: (...args: unknown[]) => mockDeleteFile(...args),
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

// Spy that calls through, so the `drive-write` queue event can be asserted without
// changing what the real telemetry module does for every other test here.
const { logEventSpy } = vi.hoisted(() => ({ logEventSpy: vi.fn() }));
vi.mock('@/services/telemetry', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/telemetry')>();
  return {
    ...actual,
    logEvent: (...args: Parameters<typeof actual.logEvent>) => {
      logEventSpy(...args);
      return actual.logEvent(...args);
    },
  };
});

vi.mock('../../offlineQueue', () => ({
  enqueueOfflineSave: vi.fn(),
  setFlushProvider: vi.fn(),
}));

describe('GoogleDriveProvider', () => {
  let provider: GoogleDriveProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    // updateFile now returns the write ack { version } (#61 C14b); a successful
    // write must resolve to a parseable ack, not undefined.
    mockUpdateFile.mockResolvedValue({ version: '1' });
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

    it('returns the write ack with a namespaced revision (#61 C14b)', async () => {
      mockUpdateFile.mockResolvedValueOnce({ version: '42' });
      const ack = await provider.write('{"data":"test"}');
      expect(ack).toEqual({ revision: 'ver:42' });
    });

    it('returns { revision: null } when the write ack has no version (malformed body)', async () => {
      mockUpdateFile.mockResolvedValueOnce({ version: null });
      const ack = await provider.write('{"data":"test"}');
      expect(ack).toEqual({ revision: null });
    });
  });

  describe('getRemoteMarker (#61 C14a)', () => {
    it('returns the namespaced revision + mtime in one probe', async () => {
      mockGetFileMetadata.mockResolvedValueOnce({
        modifiedTime: '2026-08-13T00:00:00Z',
        version: '7',
        headRevisionId: 'abc',
      });
      const marker = await provider.getRemoteMarker();
      expect(marker).toEqual({ revision: 'ver:7', modifiedTime: '2026-08-13T00:00:00Z' });
    });

    it('returns null revision + mtime when the probe fails transiently', async () => {
      mockGetFileMetadata.mockRejectedValueOnce(new Error('transient network'));
      const marker = await provider.getRemoteMarker();
      expect(marker).toEqual({ revision: null, modifiedTime: null });
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

    it('does NOT register a flush target — read-only builds must not write (finding 11)', async () => {
      const { setFlushProvider } = await import('../../offlineQueue');
      vi.mocked(setFlushProvider).mockClear();
      GoogleDriveProvider.fromExisting('existing-id', 'existing.beanpod');
      // Flush registration is owned by syncService.setProvider, not the build.
      expect(setFlushProvider).not.toHaveBeenCalled();
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

    it("passes chooseAccount through to requestAccessToken (create's different-account recovery)", async () => {
      const { requestAccessToken } = await import('@/services/google/googleAuth');
      await GoogleDriveProvider.createNew('new-family.beanpod', {
        forceConsent: false,
        chooseAccount: true,
      });
      expect(requestAccessToken).toHaveBeenLastCalledWith({
        forceConsent: false,
        chooseAccount: true,
      });
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
      expect(enqueueOfflineSave).toHaveBeenCalledWith('auth');
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
      expect(enqueueOfflineSave).toHaveBeenCalledWith('auth');
    });

    it('queues for offline when network error persists across retries', async () => {
      const { enqueueOfflineSave } = await import('../../offlineQueue');

      // withRetry retries network errors up to 3 times before giving up. To
      // hit the queue-offline path we have to fail every attempt.
      mockUpdateFile.mockRejectedValue(new TypeError('Failed to fetch'));

      await provider.write('{"data":"offline"}');

      expect(enqueueOfflineSave).toHaveBeenCalledWith('network');
    }, 20_000); // exponential backoff: 1s + 2s + 4s = 7s of retries

    it('recovers silently when transient network error resolves on retry', async () => {
      const { enqueueOfflineSave } = await import('../../offlineQueue');
      vi.mocked(enqueueOfflineSave).mockClear();
      // mockReset clears both calls AND implementation (the previous test set
      // a persistent mockRejectedValue that would otherwise leak into this one).
      mockUpdateFile.mockReset();

      // First attempt fails with a TypeError; second attempt succeeds with an ack.
      // No banner, no offline queue — purely silent retry.
      mockUpdateFile.mockResolvedValue({ version: '1' });
      mockUpdateFile.mockRejectedValueOnce(new TypeError('Failed to fetch'));

      await provider.write('{"data":"transient"}');

      expect(enqueueOfflineSave).not.toHaveBeenCalled();
      expect(mockUpdateFile).toHaveBeenCalledTimes(2);
    }, 20_000);

    it("queues offline on Safari/iOS 'Load failed' network error (2026-06-19 finding 6)", async () => {
      const { enqueueOfflineSave } = await import('../../offlineQueue');
      vi.mocked(enqueueOfflineSave).mockClear();
      mockUpdateFile.mockReset();
      // WebKit throws `TypeError: Load failed` (no "fetch" substring) — the old
      // `.includes('fetch')` guard missed it and the save was LOST.
      mockUpdateFile.mockRejectedValue(new TypeError('Load failed'));

      await provider.write('{"data":"ios"}');

      expect(enqueueOfflineSave).toHaveBeenCalledWith('network');
    }, 20_000);
  });

  describe('account-mismatch classifier (finding 9 — reworked to access-based, 2026-08-14)', () => {
    it('read() SUCCEEDS despite a nominal account mismatch (no pre-emptive gate)', async () => {
      const { getGoogleAccountEmail } = await import('@/services/google/googleAuth');
      // Provider bound to account A; live session is account B — but B CAN reach it.
      const bound = GoogleDriveProvider.fromExisting('file-A', 'a.beanpod', 'a@example.com');
      (getGoogleAccountEmail as ReturnType<typeof vi.fn>).mockReturnValue('b@example.com');
      mockReadFile.mockResolvedValueOnce('{"version":"4.0"}');

      // The op must proceed — nominal mismatch is no longer a pre-emptive error.
      await expect(bound.read()).resolves.toBe('{"version":"4.0"}');
      expect(mockReadFile).toHaveBeenCalled();
    });

    it('read() 404 WITH an account mismatch → reconnect TokenExpiredError (not missing-file)', async () => {
      const { getGoogleAccountEmail, TokenExpiredError } =
        await import('@/services/google/googleAuth');
      const { DriveApiError: MockDriveApiError } = await import('@/services/google/driveService');
      const bound = GoogleDriveProvider.fromExisting('file-A', 'a.beanpod', 'a@example.com');
      (getGoogleAccountEmail as ReturnType<typeof vi.fn>).mockReturnValue('b@example.com');
      mockReadFile.mockRejectedValueOnce(new MockDriveApiError('Not Found', 404));

      await expect(bound.read()).rejects.toBeInstanceOf(TokenExpiredError);

      // ⚠️ AND THE CACHED TOKEN IS DROPPED. This is the ONE place the app learns
      // the live session cannot reach the file — there is no 401 here, only a
      // 404 plus a session check. Without this, `isTokenValid()` keeps answering
      // true on its local clock, `tryReconnectSilently` returns at its first line
      // without contacting Google, and the reconnect this error raises reports
      // success on a connection that is still wrong.
      const { invalidateAccessToken } = await import('@/services/google/googleAuth');
      expect(invalidateAccessToken).toHaveBeenCalled();
    });

    it('read() 404 WITHOUT a mismatch → re-throws the raw 404 (missing-file recovery)', async () => {
      const { invalidateAccessToken } = await import('@/services/google/googleAuth');
      (invalidateAccessToken as ReturnType<typeof vi.fn>).mockClear();
      const { getGoogleAccountEmail } = await import('@/services/google/googleAuth');
      const { DriveApiError: MockDriveApiError } = await import('@/services/google/driveService');
      const bound = GoogleDriveProvider.fromExisting('file-A', 'a.beanpod', 'a@example.com');
      (getGoogleAccountEmail as ReturnType<typeof vi.fn>).mockReturnValue('a@example.com'); // matches
      mockReadFile.mockRejectedValueOnce(new MockDriveApiError('Not Found', 404));

      await expect(bound.read()).rejects.toBeInstanceOf(MockDriveApiError);
      // A missing file is not a bad token — leave the credential alone.
      expect(invalidateAccessToken).not.toHaveBeenCalled();
    });

    it('write() 404 WITH an account mismatch → reconnect TokenExpiredError', async () => {
      const { getGoogleAccountEmail, TokenExpiredError } =
        await import('@/services/google/googleAuth');
      const { DriveApiError: MockDriveApiError } = await import('@/services/google/driveService');
      const bound = GoogleDriveProvider.fromExisting('file-A', 'a.beanpod', 'a@example.com');
      (getGoogleAccountEmail as ReturnType<typeof vi.fn>).mockReturnValue('b@example.com');
      mockUpdateFile.mockRejectedValueOnce(new MockDriveApiError('Not Found', 404));

      await expect(bound.write('{"data":"x"}')).rejects.toBeInstanceOf(TokenExpiredError);
    });

    it('rebindProvenAccount changes the binding (true) and is a no-op when equal (false)', () => {
      const bound = GoogleDriveProvider.fromExisting('file-A', 'a.beanpod', 'a@example.com');
      expect(bound.rebindProvenAccount('a@example.com')).toBe(false);
      expect(bound.rebindProvenAccount('b@example.com')).toBe(true);
      expect(bound.getAccountEmail()).toBe('b@example.com');
    });

    it('allows read() when the bound account is not yet known (null bound email)', async () => {
      const { getGoogleAccountEmail } = await import('@/services/google/googleAuth');
      const unbound = GoogleDriveProvider.fromExisting('file-A', 'a.beanpod', null);
      (getGoogleAccountEmail as ReturnType<typeof vi.fn>).mockReturnValue('b@example.com');
      mockReadFile.mockResolvedValueOnce('{"version":"4.0"}');

      await expect(unbound.read()).resolves.toBe('{"version":"4.0"}');
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

  describe('write — transient failures queue, never hard-fail (#127)', () => {
    /** What `driveService.driveRequest` throws when OUR sized deadline fires. */
    async function driveTimeout(): Promise<Error> {
      const { DriveApiError: MockDriveApiError } = await import('@/services/google/driveService');
      return Object.assign(
        new MockDriveApiError(
          'Drive request timed out after 61000 ms (2850000 bytes sent) — slow or stalled connection',
          408
        ),
        { name: 'DriveTimeoutError', timedOut: true, timeoutMs: 61_000, bodyBytes: 2_850_000 }
      );
    }

    function queueEvents() {
      return logEventSpy.mock.calls
        .map((c) => c[0] as { surface: string; message: string; context?: Record<string, unknown> })
        .filter((e) => e.surface === 'drive-write');
    }

    beforeEach(async () => {
      vi.useFakeTimers();
      mockUpdateFile.mockReset();
      logEventSpy.mockClear();
      const { enqueueOfflineSave } = await import('../../offlineQueue');
      vi.mocked(enqueueOfflineSave).mockClear();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('a DriveTimeoutError is retried ONCE, then queued as `timeout` (no throw)', async () => {
      const { enqueueOfflineSave } = await import('../../offlineQueue');
      mockUpdateFile.mockRejectedValue(await driveTimeout());

      const p = provider.write('{"data":"big"}');
      await vi.advanceTimersByTimeAsync(1000);
      const ack = await p;

      expect(mockUpdateFile).toHaveBeenCalledTimes(2);
      expect(ack).toEqual({ revision: null, queued: true, queuedReason: 'timeout' });
      expect(enqueueOfflineSave).toHaveBeenCalledTimes(1);
      expect(enqueueOfflineSave).toHaveBeenCalledWith('timeout');
      const events = queueEvents();
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        message: 'Drive write queued offline',
        context: {
          action: 'queue-offline',
          detail: 'timeout',
          http_status: 408,
          // Which timer fired: OUR sized deadline.
          error_code: 'DriveTimeoutError',
        },
      });
    });

    it("the PLATFORM's own timeout (status-less `TypeError('The request timed out.')`) is a timeout too", async () => {
      const { enqueueOfflineSave } = await import('../../offlineQueue');
      mockUpdateFile.mockRejectedValue(new TypeError('The request timed out.'));

      const p = provider.write('{"data":"big"}');
      await vi.advanceTimersByTimeAsync(1000);
      const ack = await p;

      expect(mockUpdateFile).toHaveBeenCalledTimes(2);
      expect(ack).toEqual({ revision: null, queued: true, queuedReason: 'timeout' });
      expect(enqueueOfflineSave).toHaveBeenCalledWith('timeout');
      const [event] = queueEvents();
      // `TypeError` = the platform aborted first (iOS ~60 s), not our deadline.
      expect(event!.context).toMatchObject({ detail: 'timeout', error_code: 'TypeError' });
      expect(event!.context).not.toHaveProperty('http_status');
    });

    it('a timeout on the 401 silent-refresh RETRY is queued too (it used to escape the arms)', async () => {
      const { DriveApiError: MockDriveApiError } = await import('@/services/google/driveService');
      const { attemptSilentRefresh } = await import('@/services/google/googleAuth');
      const { enqueueOfflineSave } = await import('../../offlineQueue');
      mockUpdateFile.mockRejectedValueOnce(new MockDriveApiError('Unauthorized', 401));
      mockUpdateFile.mockRejectedValue(await driveTimeout());
      vi.mocked(attemptSilentRefresh).mockResolvedValueOnce('silent-token');

      const p = provider.write('{"data":"big"}');
      await vi.advanceTimersByTimeAsync(1000);
      const ack = await p;

      expect(mockUpdateFile).toHaveBeenCalledTimes(3);
      expect(mockUpdateFile).toHaveBeenLastCalledWith('silent-token', 'file-123', '{"data":"big"}');
      expect(ack).toEqual({ revision: null, queued: true, queuedReason: 'timeout' });
      expect(enqueueOfflineSave).toHaveBeenCalledWith('timeout');
      expect(enqueueOfflineSave).not.toHaveBeenCalledWith('auth');
    });

    it('5xx keeps its budget of 3 retries, then queues as `server` with the constant message', async () => {
      const { DriveApiError: MockDriveApiError } = await import('@/services/google/driveService');
      const { enqueueOfflineSave } = await import('../../offlineQueue');
      mockUpdateFile.mockRejectedValue(new MockDriveApiError('Backend Error', 503));

      const p = provider.write('{"data":"x"}');
      await vi.advanceTimersByTimeAsync(1000 + 2000 + 4000);
      const ack = await p;

      expect(mockUpdateFile).toHaveBeenCalledTimes(4);
      expect(ack).toEqual({ revision: null, queued: true, queuedReason: 'server' });
      expect(enqueueOfflineSave).toHaveBeenCalledWith('server');
      expect(queueEvents()[0]).toMatchObject({
        message: 'Drive write queued offline',
        context: { action: 'queue-offline', detail: 'server', http_status: 503 },
      });
    });

    it('a GENUINE Google 408 (no `timedOut`) is `server`, not a client timeout', async () => {
      const { DriveApiError: MockDriveApiError } = await import('@/services/google/driveService');
      mockUpdateFile.mockRejectedValue(new MockDriveApiError('Request Timeout', 408));

      const p = provider.write('{"data":"x"}');
      await vi.advanceTimersByTimeAsync(7000);
      const ack = await p;

      expect(mockUpdateFile).toHaveBeenCalledTimes(4);
      expect(ack).toEqual({ revision: null, queued: true, queuedReason: 'server' });
      expect(queueEvents()[0]!.context).toMatchObject({ detail: 'server', http_status: 408 });
    });

    it('a network failure keeps its budget and now LOGS `drive-write` (it was silent)', async () => {
      const { enqueueOfflineSave } = await import('../../offlineQueue');
      mockUpdateFile.mockRejectedValue(new TypeError('Failed to fetch'));

      const p = provider.write('{"data":"x"}');
      await vi.advanceTimersByTimeAsync(7000);
      const ack = await p;

      expect(mockUpdateFile).toHaveBeenCalledTimes(4);
      expect(ack).toEqual({ revision: null, queued: true, queuedReason: 'network' });
      expect(enqueueOfflineSave).toHaveBeenCalledWith('network');
      const events = queueEvents();
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        message: 'Drive write queued offline',
        context: { action: 'queue-offline', detail: 'network', error_code: 'TypeError' },
      });
    });

    it('a non-transient failure (400) throws at once: no retry, no queue, no queue event', async () => {
      const { DriveApiError: MockDriveApiError } = await import('@/services/google/driveService');
      const { enqueueOfflineSave } = await import('../../offlineQueue');
      mockUpdateFile.mockRejectedValue(new MockDriveApiError('Bad Request', 400));

      await expect(provider.write('{"data":"x"}')).rejects.toThrow('Bad Request');
      expect(mockUpdateFile).toHaveBeenCalledTimes(1);
      expect(enqueueOfflineSave).not.toHaveBeenCalled();
      expect(queueEvents()).toHaveLength(0);
    });

    it('the auth arm keeps its message contract ("silent refresh failed")', async () => {
      // `syncStore.isAuthTransientSyncError` matches on this text.
      const { DriveApiError: MockDriveApiError } = await import('@/services/google/driveService');
      const { attemptSilentRefresh } = await import('@/services/google/googleAuth');
      const { enqueueOfflineSave } = await import('../../offlineQueue');
      mockUpdateFile.mockRejectedValueOnce(new MockDriveApiError('Unauthorized', 401));
      vi.mocked(attemptSilentRefresh).mockResolvedValueOnce(null);

      await expect(provider.write('{"data":"x"}')).rejects.toThrow('silent refresh failed');
      expect(enqueueOfflineSave).toHaveBeenCalledWith('auth');
      expect(queueEvents()).toHaveLength(0);
    });

    it('an instant network failure does not spend the timeout retry: net, timeout, timeout → queued at 3 calls', async () => {
      const timeout = await driveTimeout();
      mockUpdateFile
        .mockRejectedValueOnce(new TypeError('Failed to fetch'))
        .mockRejectedValueOnce(timeout)
        .mockRejectedValueOnce(timeout);
      const p = provider.write('{"data":"test"}');
      await vi.advanceTimersByTimeAsync(1000);
      await vi.advanceTimersByTimeAsync(2000);
      await expect(p).resolves.toMatchObject({ queued: true, queuedReason: 'timeout' });
      expect(mockUpdateFile).toHaveBeenCalledTimes(3);
    });

    it('three network failures then a timeout hit the attempt cap: queued as timeout at 4 calls', async () => {
      const timeout = await driveTimeout();
      mockUpdateFile
        .mockRejectedValueOnce(new TypeError('Failed to fetch'))
        .mockRejectedValueOnce(new TypeError('Failed to fetch'))
        .mockRejectedValueOnce(new TypeError('Failed to fetch'))
        .mockRejectedValueOnce(timeout);
      const p = provider.write('{"data":"test"}');
      await vi.advanceTimersByTimeAsync(1000);
      await vi.advanceTimersByTimeAsync(2000);
      await vi.advanceTimersByTimeAsync(4000);
      await expect(p).resolves.toMatchObject({ queued: true, queuedReason: 'timeout' });
      expect(mockUpdateFile).toHaveBeenCalledTimes(4);
    });

    it('read(): a timeout is retried once, then rethrown RAW for classifyReadFailure', async () => {
      const timeout = await driveTimeout();
      mockReadFile.mockRejectedValue(timeout);
      try {
        const p = provider.read();
        const settled = expect(p).rejects.toBe(timeout);
        await vi.advanceTimersByTimeAsync(1000);
        await settled;
        expect(mockReadFile).toHaveBeenCalledTimes(2);
      } finally {
        mockReadFile.mockReset();
        mockReadFile.mockResolvedValue('{"version":"4.0"}');
      }
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

    it('throws CollisionCheckUnavailableError and does NOT create when the collision check fails', async () => {
      // 2026-06-19, finding 5: a list failure means we can't tell whether a
      // same-name file exists. Creating blindly risks a SECOND orphan .beanpod,
      // so we surface a retryable error instead of swallowing + creating.
      const { CollisionCheckUnavailableError } = await import('@/types/sync');
      mockListBeanpodFiles.mockRejectedValueOnce(new Error('Drive listing failed'));
      await expect(
        GoogleDriveProvider.createNew('LaFleur.beanpod', { forceConsent: false })
      ).rejects.toBeInstanceOf(CollisionCheckUnavailableError);
      expect(mockCreateFile).not.toHaveBeenCalled();
    });
  });

  describe('aux change-log (ADR-032 Plan B)', () => {
    beforeEach(() => {
      // resolveAuxFolder reads the .beanpod's parent folder.
      mockGetFileMetadata.mockResolvedValue({ parents: ['folder-id'] });
    });

    it('writeAux creates a sibling chunk file in the .beanpod folder', async () => {
      mockCreateFile.mockResolvedValueOnce({
        fileId: 'chunk-1',
        name: 'changes/a-0.beanchanges',
      });
      await provider.writeAux('changes/a-0.beanchanges', 'CIPHERTEXT');
      expect(mockCreateFile).toHaveBeenCalledWith(
        'mock-token',
        'folder-id',
        'changes/a-0.beanchanges',
        'CIPHERTEXT'
      );
    });

    it('listAux returns the chunk names in the folder', async () => {
      mockListFilesInFolder.mockResolvedValueOnce([
        { id: 'c1', name: 'changes/a-0.beanchanges' },
        { id: 'c2', name: 'changes/b-0.beanchanges' },
      ]);
      expect(await provider.listAux()).toEqual([
        'changes/a-0.beanchanges',
        'changes/b-0.beanchanges',
      ]);
      expect(mockListFilesInFolder).toHaveBeenCalledWith('mock-token', 'folder-id', '.beanchanges');
    });

    it('readAux resolves name→id via a list, then reads the file', async () => {
      mockListFilesInFolder.mockResolvedValue([{ id: 'c1', name: 'changes/a-0.beanchanges' }]);
      mockReadFile.mockResolvedValueOnce('CHUNK_BODY');
      expect(await provider.readAux('changes/a-0.beanchanges')).toBe('CHUNK_BODY');
      expect(mockReadFile).toHaveBeenCalledWith('mock-token', 'c1');
    });

    it('readAux returns null for an absent (pruned) chunk', async () => {
      mockListFilesInFolder.mockResolvedValue([]);
      expect(await provider.readAux('changes/gone-9.beanchanges')).toBeNull();
      expect(mockReadFile).not.toHaveBeenCalled();
    });

    it('deleteAux resolves name→id and deletes; no-op when already absent', async () => {
      mockListFilesInFolder.mockResolvedValueOnce([{ id: 'c1', name: 'changes/a-0.beanchanges' }]);
      await provider.deleteAux('changes/a-0.beanchanges');
      expect(mockDeleteFile).toHaveBeenCalledWith('mock-token', 'c1');

      mockDeleteFile.mockClear();
      mockListFilesInFolder.mockResolvedValueOnce([]);
      await provider.deleteAux('changes/gone-9.beanchanges');
      expect(mockDeleteFile).not.toHaveBeenCalled();
    });
  });

  /**
   * The aux surface had to address a `.beanpod`-named sibling before the
   * automatic safety copy (R2) could exist at all. Two bugs, both silent.
   */
  describe('aux objects that are not .beanchanges', () => {
    /**
     * ⚠️ THE MOCK MUST HONOUR `nameContains`, or these tests prove nothing.
     * A `mockResolvedValueOnce` returns its list whatever was queried, so a
     * `.beanchanges`-scoped lookup would still "find" a `.beanpod` sibling and
     * the original bug passes. Drive's filter is a SUBSTRING match, and
     * modelling that is also what makes the exact-match test meaningful.
     */
    let folder: { id: string; name: string }[];

    beforeEach(() => {
      mockGetFileMetadata.mockResolvedValue({ parents: ['parent-folder'] });
      folder = [];
      mockListFilesInFolder.mockImplementation(
        async (_token: string, _folderId: string, nameContains?: string) =>
          nameContains ? folder.filter((f) => f.name.includes(nameContains)) : [...folder]
      );
    });

    it('finds a sibling whose name listAux would never have mapped', async () => {
      // ⚠️ `listAux()` queries `.beanchanges` ONLY and REPLACES the name→id map
      // with the result. `readAux`/`deleteAux` refreshed through it on a miss, so
      // any other suffix was unreachable — and `deleteAux` reports "already
      // gone" as success, so the no-op looked like a delete.
      folder = [{ id: 'copy-id', name: 'family before tidy.beanpod' }];
      mockReadFile.mockResolvedValueOnce('{"version":"4.0"}');

      const out = await provider.readAux('family before tidy.beanpod');

      expect(out).toBe('{"version":"4.0"}');
      expect(mockReadFile).toHaveBeenCalledWith('mock-token', 'copy-id');
    });

    it('matches the name EXACTLY, because Drive queries by substring', async () => {
      // ⚠️ THE HAZARD RUNS THIS WAY ROUND, and the first version of this test
      // had it backwards: a query for the SHORTER name matches a LONGER
      // sibling. With the fixture reversed the mocked query returned nothing,
      // so `files.find(...)` was never reached and the test passed whether the
      // code compared names or just took `files[0]`. Verified by mutation.
      folder = [{ id: 'wrong-id', name: 'my family.beanpod' }];

      const out = await provider.readAux('family.beanpod');

      expect(out).toBeNull();
      expect(mockReadFile).not.toHaveBeenCalled();
    });

    it('OVERWRITES a name that already exists, instead of duplicating it', async () => {
      // Drive allows two files with one name in a folder. `writeAux` only ever
      // created, so every compaction would have left another rollback copy
      // behind and the file picker would fill up with them. The `AuxStore`
      // contract has always said "create/overwrite".
      folder = [{ id: 'existing-id', name: 'family before tidy.beanpod' }];

      await provider.writeAux('family before tidy.beanpod', 'payload');

      expect(mockUpdateFile).toHaveBeenCalledWith('mock-token', 'existing-id', 'payload');
      expect(mockCreateFile).not.toHaveBeenCalled();
    });

    it('creates it the first time', async () => {
      folder = [];

      await provider.writeAux('family before tidy.beanpod', 'payload');

      expect(mockCreateFile).toHaveBeenCalled();
      expect(mockUpdateFile).not.toHaveBeenCalled();
    });

    it('really deletes one, rather than reporting an idempotent no-op', async () => {
      folder = [{ id: 'copy-id', name: 'family before tidy.beanpod' }];

      await provider.deleteAux('family before tidy.beanpod');

      expect(mockDeleteFile).toHaveBeenCalledWith('mock-token', 'copy-id');
    });

    it('leaves listAux scoped to .beanchanges — the transport owns that map', async () => {
      // Widening it would have been the tempting fix and is the wrong one: its
      // only caller is the change-log transport, which must keep seeing exactly
      // its own chunks.
      folder = [{ id: 'copy-id', name: 'family before tidy.beanpod' }];
      const names = await provider.listAux();
      // The `.beanpod` sibling is in the folder and must NOT appear.
      expect(names).toEqual([]);
      expect(mockListFilesInFolder).toHaveBeenCalledWith(
        'mock-token',
        'parent-folder',
        '.beanchanges'
      );
    });
  });
});
