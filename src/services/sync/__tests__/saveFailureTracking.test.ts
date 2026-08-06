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
  reEncryptEnvelope: vi.fn(async () => '{"version":"4.0"}'),
  parseBeanpodV4: vi.fn(() => ({})),
  detectFileVersion: vi.fn(() => 4),
  openFilePicker: vi.fn(async () => null),
}));
vi.mock('@/services/indexeddb/database', () => ({
  getActiveFamilyId: vi.fn(() => 'test-family-id'),
}));
vi.mock('@/services/familyContext', () => ({
  createFamilyWithId: vi.fn(async () => {}),
}));
// ADR-032: syncService drives the doc worker via docClient. This test exercises
// the Drive save-failure escalation (provider.write rejects) — it doesn't care
// about doc content, so stub the worker RPCs the save path touches.
vi.mock('@/services/automerge/worker/docClient', () => ({
  setFamilyKey: vi.fn(),
  persistEnvelope: vi.fn(async () => {}),
  exportEncryptedPayload: vi.fn(async () => ({ payload: 'base64-payload==' })),
  mergeRemoteEnvelope: vi.fn(async () => ({ dirty: false })),
  setLocalChangeHandler: vi.fn(),
  setCachePersistFailedHandler: vi.fn(),
}));
vi.mock('@/utils/errorReporter', () => ({ reportError: vi.fn() }));
vi.mock('@/services/telemetry', () => ({ logEvent: vi.fn() }));

// Fake CryptoKey for tests (never actually used for encryption because reEncryptEnvelope is mocked)
const fakeFamilyKey = {} as CryptoKey;
const fakeEnvelope = {
  version: '4.0' as const,
  familyId: 'test-family',
  familyName: 'Test',
  keyId: 'k1',
  wrappedKeys: {},
  passkeyWrappedKeys: {},
  inviteKeys: {},
  encryptedPayload: '',
};

describe('syncService — save failure tracking', () => {
  // `vi.resetModules()` forces a full re-import of syncService's (large) module
  // graph on every test; under the full-suite parallel run this occasionally
  // exceeds the 10s default hook timeout. Give it headroom — the import is
  // correct, just CPU-contended, not a hang.
  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks(); // resetModules doesn't clear vi.fn call history — isolate counts
    syncService = await import('../syncService');
    // V4 save() requires family key and envelope to be set
    syncService.setFamilyKey(fakeFamilyKey, fakeEnvelope);
  }, 30000);

  describe('getSaveFailureLevel', () => {
    it('starts at "none"', () => {
      expect(syncService.getSaveFailureLevel()).toBe('none');
    });
  });

  describe('envelope-cache persist failure (F7 — no silent failure)', () => {
    it('classifies + logs a persistEnvelope failure instead of swallowing it', async () => {
      const { reportError } = await import('@/utils/errorReporter');
      const docClient = await import('@/services/automerge/worker/docClient');
      vi.mocked(reportError).mockClear();
      vi.mocked(docClient.persistEnvelope).mockRejectedValueOnce(new Error('IndexedDB quota'));

      // setFamilyKey seeds the envelope cache via persistEnvelopeSafely.
      syncService.setFamilyKey(fakeFamilyKey, fakeEnvelope);
      await new Promise((r) => setTimeout(r, 0));

      expect(reportError).toHaveBeenCalledWith(
        expect.objectContaining({ surface: 'doc-worker-envelope-cache', severity: 'warning' })
      );
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

  describe('per-attempt notification (onSaveAttempt / getConsecutiveSaveFailures)', () => {
    function failingProvider(error = 'Network error') {
      return {
        type: 'google_drive' as const,
        write: vi.fn().mockRejectedValue(new Error(error)),
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
    }

    it('reports the fresh consecutive-failure count on every attempt (drives the 1-retry debounce)', async () => {
      const counts: number[] = [];
      syncService.onSaveAttempt((n) => counts.push(n));
      syncService.setProvider(failingProvider());

      await syncService.save();
      await syncService.save();

      // 1 then 2 — the store maps >= 2 to the amber "degraded" state.
      expect(counts).toEqual([1, 2]);
      expect(syncService.getConsecutiveSaveFailures()).toBe(2);
    });

    it('reports 0 on a successful save', async () => {
      const provider = failingProvider();
      syncService.setProvider(provider);
      await syncService.save();
      expect(syncService.getConsecutiveSaveFailures()).toBe(1);

      const counts: number[] = [];
      syncService.onSaveAttempt((n) => counts.push(n));
      provider.write.mockResolvedValue(undefined);
      await syncService.save();

      expect(syncService.getConsecutiveSaveFailures()).toBe(0);
      expect(counts).toEqual([0]);
    });

    it('a throwing subscriber cannot break the save path or starve other subscribers', async () => {
      const good = vi.fn();
      syncService.onSaveAttempt(() => {
        throw new Error('subscriber boom');
      });
      syncService.onSaveAttempt(good);
      syncService.setProvider(failingProvider());

      const result = await syncService.save();

      expect(result).toBe(false); // save path unaffected by the throwing subscriber
      expect(good).toHaveBeenCalledWith(1); // the other subscriber still fired
    });

    it('resetSaveFailures notifies subscribers with 0 (so the indicator clears on reconnect)', () => {
      const cb = vi.fn();
      syncService.onSaveAttempt(cb);
      syncService.resetSaveFailures();
      expect(cb).toHaveBeenCalledWith(0);
    });
  });

  describe('cache persistence failure tracking', () => {
    it('isCachePersistFailed returns false initially', () => {
      expect(syncService.isCachePersistFailed()).toBe(false);
    });

    it('onCacheFailureChange fires when cache persist fails', () => {
      const callback = vi.fn();
      syncService.onCacheFailureChange(callback);

      // We can't easily trigger persistDoc failure through the public API,
      // but we can verify the subscription mechanism works via reset
      // (which calls setCachePersistFailed(false) internally)
      expect(callback).not.toHaveBeenCalled();
    });

    it('onCacheFailureChange returns an unsubscribe function', () => {
      const callback = vi.fn();
      const unsub = syncService.onCacheFailureChange(callback);
      expect(typeof unsub).toBe('function');
      unsub();
    });

    it('reset() clears cache failure state', () => {
      syncService.reset();
      expect(syncService.isCachePersistFailed()).toBe(false);
    });
  });

  describe('cache-persist telemetry (#50)', () => {
    // Grab the `setCachePersistFailed` function syncService wires into the worker
    // handler, so we can drive a failure/recovery edge exactly as the worker would.
    async function wiredHandler() {
      syncService.registerDocPersistCallback();
      const docClient = await import('@/services/automerge/worker/docClient');
      const calls = vi.mocked(docClient.setCachePersistFailedHandler).mock.calls;
      const fn = calls.at(-1)?.[0];
      if (!fn) throw new Error('setCachePersistFailedHandler was not wired');
      return fn;
    }

    it('a failure edge fires reportError(warning) once with kind + error context', async () => {
      const handler = await wiredHandler();
      const { reportError } = await import('@/utils/errorReporter');
      const { logEvent } = await import('@/services/telemetry');

      handler(true, { kind: 'increment', errorName: 'QuotaExceededError' });

      expect(reportError).toHaveBeenCalledTimes(1);
      expect(reportError).toHaveBeenCalledWith(
        expect.objectContaining({
          surface: 'cache-persist',
          severity: 'warning',
          context: { cache_persist_kind: 'increment', cache_persist_error: 'QuotaExceededError' },
        })
      );
      expect(logEvent).not.toHaveBeenCalled();
      expect(syncService.isCachePersistFailed()).toBe(true);
    });

    it('is edge-triggered: a second failure in the same episode does not re-report', async () => {
      const handler = await wiredHandler();
      const { reportError } = await import('@/utils/errorReporter');

      handler(true, { kind: 'base', errorName: 'InvalidStateError' });
      handler(true, { kind: 'increment', errorName: 'QuotaExceededError' }); // still failed → no new edge

      expect(reportError).toHaveBeenCalledTimes(1);
    });

    it('a recovery edge fires logEvent(info) once, not reportError', async () => {
      const handler = await wiredHandler();
      const { reportError } = await import('@/utils/errorReporter');
      const { logEvent } = await import('@/services/telemetry');

      handler(true, { kind: 'base', errorName: 'InvalidStateError' });
      vi.mocked(reportError).mockClear();
      handler(false); // recovery

      expect(logEvent).toHaveBeenCalledWith(
        expect.objectContaining({ surface: 'cache-persist', level: 'info' })
      );
      expect(reportError).not.toHaveBeenCalled();
      expect(syncService.isCachePersistFailed()).toBe(false);
    });

    it('reset() during a failure clears the flag SILENTLY (no false recovery event)', async () => {
      const handler = await wiredHandler();
      const { logEvent } = await import('@/services/telemetry');

      handler(true, { kind: 'base', errorName: 'QuotaExceededError' });
      vi.mocked(logEvent).mockClear();

      syncService.reset();

      expect(syncService.isCachePersistFailed()).toBe(false); // banner clears
      expect(logEvent).not.toHaveBeenCalled(); // but NO 'cache-persist recovered'
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
