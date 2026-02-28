import { describe, it, expect, beforeEach, vi } from 'vitest';

// Must reset modules between tests to clear module-level state
let syncService: typeof import('../syncService');

// Mock all heavy dependencies that syncService imports at module level
vi.mock('../capabilities', () => ({
  supportsFileSystemAccess: vi.fn(() => false),
}));
vi.mock('../fileHandleStore', () => ({
  getFileHandle: vi.fn(async () => null),
  verifyPermission: vi.fn(async () => true),
  getProviderConfig: vi.fn(async () => null),
}));
vi.mock('../fileSync', () => ({
  createSyncFileData: vi.fn(async () => ({
    version: '3.0',
    exportedAt: '2026-02-28T12:00:00Z',
    encrypted: false,
    data: {},
  })),
  validateSyncFileData: vi.fn(() => true),
  importSyncFileData: vi.fn(async () => ({})),
  openFilePicker: vi.fn(async () => null),
}));
vi.mock('@/services/crypto/encryption', () => ({
  encryptSyncData: vi.fn(async () => 'encrypted'),
  decryptSyncData: vi.fn(async () => '{}'),
}));
vi.mock('@/services/indexeddb/database', () => ({
  getActiveFamilyId: vi.fn(() => 'test-family-id'),
}));
vi.mock('@/services/familyContext', () => ({
  createFamilyWithId: vi.fn(async () => {}),
}));
vi.mock('@/services/sync/settingsWAL', () => ({
  clearSettingsWAL: vi.fn(),
}));

describe('syncService — save failure tracking', () => {
  beforeEach(async () => {
    vi.resetModules();
    syncService = await import('../syncService');
  });

  describe('getSaveFailureLevel', () => {
    it('starts at "none"', () => {
      expect(syncService.getSaveFailureLevel()).toBe('none');
    });
  });

  describe('getLastSaveError', () => {
    it('starts as null', () => {
      expect(syncService.getLastSaveError()).toBeNull();
    });
  });

  describe('onSaveFailureChange', () => {
    it('returns an unsubscribe function', () => {
      const unsub = syncService.onSaveFailureChange(vi.fn());
      expect(typeof unsub).toBe('function');
      unsub();
    });

    it('does not fire callback on subscribe', () => {
      const callback = vi.fn();
      syncService.onSaveFailureChange(callback);
      expect(callback).not.toHaveBeenCalled();
    });
  });

  describe('resetSaveFailures', () => {
    it('resets level to "none" and clears error', () => {
      // We can't easily simulate failures through save() because of all the
      // dependencies, but we can test resetSaveFailures from a known state
      syncService.resetSaveFailures();
      expect(syncService.getSaveFailureLevel()).toBe('none');
      expect(syncService.getLastSaveError()).toBeNull();
    });
  });

  describe('failure level escalation via save()', () => {
    it('escalates to "warning" after first save failure', async () => {
      const callback = vi.fn();
      syncService.onSaveFailureChange(callback);

      // Set up a provider that will fail on write
      const mockProvider = {
        type: 'google_drive' as const,
        write: vi.fn().mockRejectedValue(new Error('Network error')),
        read: vi.fn(),
        getLastModified: vi.fn(),
        isReady: vi.fn().mockResolvedValue(true),
        requestAccess: vi.fn(),
        persist: vi.fn(),
        clearPersisted: vi.fn(),
        disconnect: vi.fn(),
        getDisplayName: vi.fn(() => 'test.beanpod'),
        getFileId: vi.fn(() => 'file-123'),
        getAccountEmail: vi.fn(() => null),
      };
      syncService.setProvider(mockProvider);

      // Attempt save — will fail
      const result = await syncService.save();
      expect(result).toBe(false);

      // Should escalate to warning
      expect(syncService.getSaveFailureLevel()).toBe('warning');
      expect(syncService.getLastSaveError()).toBe('Network error');
      expect(callback).toHaveBeenCalledWith('warning', 'Network error');
    });

    it('escalates to "critical" after 3 consecutive failures', async () => {
      const callback = vi.fn();
      syncService.onSaveFailureChange(callback);

      const mockProvider = {
        type: 'google_drive' as const,
        write: vi.fn().mockRejectedValue(new Error('Server error')),
        read: vi.fn(),
        getLastModified: vi.fn(),
        isReady: vi.fn().mockResolvedValue(true),
        requestAccess: vi.fn(),
        persist: vi.fn(),
        clearPersisted: vi.fn(),
        disconnect: vi.fn(),
        getDisplayName: vi.fn(() => 'test.beanpod'),
        getFileId: vi.fn(() => 'file-123'),
        getAccountEmail: vi.fn(() => null),
      };
      syncService.setProvider(mockProvider);

      // Fail 3 times
      await syncService.save();
      await syncService.save();
      await syncService.save();

      expect(syncService.getSaveFailureLevel()).toBe('critical');
      // Callback should have been called for warning (after 1st) and critical (after 3rd)
      expect(callback).toHaveBeenCalledWith('warning', 'Server error');
      expect(callback).toHaveBeenCalledWith('critical', 'Server error');
    });

    it('resets to "none" after a successful save', async () => {
      const callback = vi.fn();

      const mockProvider = {
        type: 'google_drive' as const,
        write: vi.fn().mockRejectedValue(new Error('Temporary error')),
        read: vi.fn(),
        getLastModified: vi.fn(),
        isReady: vi.fn().mockResolvedValue(true),
        requestAccess: vi.fn(),
        persist: vi.fn(),
        clearPersisted: vi.fn(),
        disconnect: vi.fn(),
        getDisplayName: vi.fn(() => 'test.beanpod'),
        getFileId: vi.fn(() => 'file-123'),
        getAccountEmail: vi.fn(() => null),
      };
      syncService.setProvider(mockProvider);

      // Fail once to get to warning
      await syncService.save();
      expect(syncService.getSaveFailureLevel()).toBe('warning');

      // Subscribe after the first failure
      syncService.onSaveFailureChange(callback);

      // Now succeed
      mockProvider.write.mockResolvedValue(undefined);
      const result = await syncService.save();
      expect(result).toBe(true);

      expect(syncService.getSaveFailureLevel()).toBe('none');
      expect(syncService.getLastSaveError()).toBeNull();
      expect(callback).toHaveBeenCalledWith('none', null);
    });

    it('resetSaveFailures resets from critical to none', async () => {
      const callback = vi.fn();

      const mockProvider = {
        type: 'google_drive' as const,
        write: vi.fn().mockRejectedValue(new Error('Error')),
        read: vi.fn(),
        getLastModified: vi.fn(),
        isReady: vi.fn().mockResolvedValue(true),
        requestAccess: vi.fn(),
        persist: vi.fn(),
        clearPersisted: vi.fn(),
        disconnect: vi.fn(),
        getDisplayName: vi.fn(() => 'test.beanpod'),
        getFileId: vi.fn(() => 'file-123'),
        getAccountEmail: vi.fn(() => null),
      };
      syncService.setProvider(mockProvider);

      // Get to critical (3 failures)
      await syncService.save();
      await syncService.save();
      await syncService.save();
      expect(syncService.getSaveFailureLevel()).toBe('critical');

      syncService.onSaveFailureChange(callback);

      // Reset
      syncService.resetSaveFailures();
      expect(syncService.getSaveFailureLevel()).toBe('none');
      expect(syncService.getLastSaveError()).toBeNull();
      expect(callback).toHaveBeenCalledWith('none', null);
    });
  });

  describe('reset() clears failure state', () => {
    it('resets save failure tracking when reset is called', async () => {
      const mockProvider = {
        type: 'google_drive' as const,
        write: vi.fn().mockRejectedValue(new Error('Error')),
        read: vi.fn(),
        getLastModified: vi.fn(),
        isReady: vi.fn().mockResolvedValue(true),
        requestAccess: vi.fn(),
        persist: vi.fn(),
        clearPersisted: vi.fn(),
        disconnect: vi.fn(),
        getDisplayName: vi.fn(() => 'test.beanpod'),
        getFileId: vi.fn(() => 'file-123'),
        getAccountEmail: vi.fn(() => null),
      };
      syncService.setProvider(mockProvider);

      await syncService.save();
      expect(syncService.getSaveFailureLevel()).toBe('warning');

      syncService.reset();
      expect(syncService.getSaveFailureLevel()).toBe('none');
      expect(syncService.getLastSaveError()).toBeNull();
    });
  });
});
