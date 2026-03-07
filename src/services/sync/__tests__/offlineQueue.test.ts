import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

// Must reset modules between tests to clear module-level state
let offlineQueue: typeof import('../offlineQueue');

describe('offlineQueue', () => {
  beforeEach(async () => {
    vi.resetModules();
    // Clear sessionStorage before each test
    sessionStorage.clear();
    // Fresh import to reset module state
    offlineQueue = await import('../offlineQueue');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    offlineQueue.clearQueue();
  });

  describe('enqueueOfflineSave', () => {
    it('marks queue as having a pending save', () => {
      expect(offlineQueue.hasPendingSave()).toBe(false);
      offlineQueue.enqueueOfflineSave('{"data":"test"}');
      expect(offlineQueue.hasPendingSave()).toBe(true);
    });

    it('persists content to sessionStorage', () => {
      offlineQueue.enqueueOfflineSave('{"data":"persisted"}');
      expect(sessionStorage.getItem('beanies_offline_queue')).toBe('{"data":"persisted"}');
    });

    it('replaces previously queued content', () => {
      offlineQueue.enqueueOfflineSave('{"version":"1"}');
      offlineQueue.enqueueOfflineSave('{"version":"2"}');
      expect(sessionStorage.getItem('beanies_offline_queue')).toBe('{"version":"2"}');
    });
  });

  describe('clearQueue', () => {
    it('clears in-memory queue', () => {
      offlineQueue.enqueueOfflineSave('{"data":"test"}');
      offlineQueue.clearQueue();
      expect(offlineQueue.hasPendingSave()).toBe(false);
    });

    it('clears sessionStorage', () => {
      offlineQueue.enqueueOfflineSave('{"data":"test"}');
      offlineQueue.clearQueue();
      expect(sessionStorage.getItem('beanies_offline_queue')).toBeNull();
    });
  });

  describe('flushQueue', () => {
    it('returns false when no pending content', async () => {
      const result = await offlineQueue.flushQueue();
      expect(result).toBe(false);
    });

    it('returns false when no flush provider', async () => {
      offlineQueue.enqueueOfflineSave('{"data":"test"}');
      const result = await offlineQueue.flushQueue();
      expect(result).toBe(false);
    });

    it('writes queued content via provider and clears queue', async () => {
      const mockWrite = vi.fn().mockResolvedValue(undefined);
      const mockProvider = { write: mockWrite } as any;
      offlineQueue.setFlushProvider(mockProvider);

      offlineQueue.enqueueOfflineSave('{"data":"flushed"}');

      const result = await offlineQueue.flushQueue();

      expect(result).toBe(true);
      expect(mockWrite).toHaveBeenCalledWith('{"data":"flushed"}');
      expect(offlineQueue.hasPendingSave()).toBe(false);
      expect(sessionStorage.getItem('beanies_offline_queue')).toBeNull();
    });

    it('keeps queue on flush failure', async () => {
      const mockWrite = vi.fn().mockRejectedValue(new Error('Network error'));
      const mockProvider = { write: mockWrite } as any;
      offlineQueue.setFlushProvider(mockProvider);

      offlineQueue.enqueueOfflineSave('{"data":"retry"}');

      const result = await offlineQueue.flushQueue();

      expect(result).toBe(false);
      expect(offlineQueue.hasPendingSave()).toBe(true);
      // Content should still be in sessionStorage for retry
      expect(sessionStorage.getItem('beanies_offline_queue')).toBe('{"data":"retry"}');
    });
  });

  describe('setFlushProvider auto-flush', () => {
    it('auto-flushes when pending content exists and online', async () => {
      offlineQueue.enqueueOfflineSave('{"data":"auto"}');

      Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });

      const mockWrite = vi.fn().mockResolvedValue(undefined);
      offlineQueue.setFlushProvider({ write: mockWrite } as any);

      // Allow the async flushQueue to complete
      await vi.waitFor(() => expect(mockWrite).toHaveBeenCalledWith('{"data":"auto"}'));
      expect(offlineQueue.hasPendingSave()).toBe(false);
    });

    it('does not auto-flush when offline', () => {
      offlineQueue.enqueueOfflineSave('{"data":"offline"}');

      Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });

      const mockWrite = vi.fn();
      offlineQueue.setFlushProvider({ write: mockWrite } as any);

      expect(mockWrite).not.toHaveBeenCalled();

      // Restore
      Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
    });
  });

  describe('handleOnline retry', () => {
    it('retries after 5s on flush failure', async () => {
      vi.useFakeTimers();

      const mockWrite = vi.fn().mockRejectedValue(new Error('fail'));
      offlineQueue.setFlushProvider({ write: mockWrite } as any);
      offlineQueue.enqueueOfflineSave('{"data":"retry"}');

      // Simulate online event
      window.dispatchEvent(new Event('online'));

      // Wait for the initial flush to fail
      await vi.advanceTimersByTimeAsync(0);

      expect(mockWrite).toHaveBeenCalledTimes(1);

      // Now make the write succeed for the retry
      mockWrite.mockResolvedValue(undefined);

      // Advance past the 5s retry
      await vi.advanceTimersByTimeAsync(5000);

      expect(mockWrite).toHaveBeenCalledTimes(2);

      vi.useRealTimers();
    });

    it('does not retry when queue is empty after flush', async () => {
      vi.useFakeTimers();

      const mockWrite = vi.fn().mockResolvedValue(undefined);
      offlineQueue.setFlushProvider({ write: mockWrite } as any);
      offlineQueue.enqueueOfflineSave('{"data":"ok"}');

      window.dispatchEvent(new Event('online'));

      await vi.advanceTimersByTimeAsync(0);

      expect(mockWrite).toHaveBeenCalledTimes(1);

      // Advance past retry window — no retry should happen
      await vi.advanceTimersByTimeAsync(6000);
      expect(mockWrite).toHaveBeenCalledTimes(1);

      vi.useRealTimers();
    });

    it('clearQueue cancels pending retry timer', async () => {
      vi.useFakeTimers();

      const mockWrite = vi.fn().mockRejectedValue(new Error('fail'));
      offlineQueue.setFlushProvider({ write: mockWrite } as any);
      offlineQueue.enqueueOfflineSave('{"data":"cancel"}');

      window.dispatchEvent(new Event('online'));
      await vi.advanceTimersByTimeAsync(0);

      // Clear queue (which calls stopListening → clears retry timer)
      offlineQueue.clearQueue();

      mockWrite.mockResolvedValue(undefined);
      await vi.advanceTimersByTimeAsync(6000);

      // Only the initial failed attempt
      expect(mockWrite).toHaveBeenCalledTimes(1);

      vi.useRealTimers();
    });
  });

  describe('sessionStorage restoration on module load', () => {
    it('restores pending content from sessionStorage', async () => {
      // Pre-populate sessionStorage before importing the module
      sessionStorage.setItem('beanies_offline_queue', '{"data":"restored"}');

      vi.resetModules();
      const freshQueue = await import('../offlineQueue');

      expect(freshQueue.hasPendingSave()).toBe(true);

      // Verify we can flush the restored content
      const mockWrite = vi.fn().mockResolvedValue(undefined);
      freshQueue.setFlushProvider({ write: mockWrite } as any);
      const result = await freshQueue.flushQueue();

      expect(result).toBe(true);
      expect(mockWrite).toHaveBeenCalledWith('{"data":"restored"}');

      freshQueue.clearQueue();
    });

    it('starts with empty queue when sessionStorage is empty', async () => {
      sessionStorage.clear();

      vi.resetModules();
      const freshQueue = await import('../offlineQueue');

      expect(freshQueue.hasPendingSave()).toBe(false);

      freshQueue.clearQueue();
    });
  });
});
