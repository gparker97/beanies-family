import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

// Capture the onTokenAcquired callback so tests can drive it directly,
// simulating a silent refresh succeeding in the auth layer.
const { tokenAcquiredCallbackHolder } = vi.hoisted(() => ({
  tokenAcquiredCallbackHolder: {
    cb: null as (() => void) | null,
  },
}));

vi.mock('@/services/google/googleAuth', () => {
  // Real-ish TokenExpiredError class so `instanceof` checks inside
  // `reportFlushFailure` match. Mirrors the production class shape
  // (name === 'TokenExpiredError', extends Error).
  class TokenExpiredErrorMock extends Error {
    constructor(message = 'Google access token expired and silent refresh failed') {
      super(message);
      this.name = 'TokenExpiredError';
    }
  }
  return {
    onTokenAcquired: vi.fn((cb: () => void) => {
      tokenAcquiredCallbackHolder.cb = cb;
      return () => {
        tokenAcquiredCallbackHolder.cb = null;
      };
    }),
    TokenExpiredError: TokenExpiredErrorMock,
  };
});

vi.mock('@/services/google/silentRefreshAlertContext', () => ({
  buildSilentRefreshAlertContext: vi.fn(() => ({
    silent_refresh_attempts: [
      {
        attempt: 1,
        durationMs: 50,
        classification: 'network',
        errorName: 'TypeError',
        errorMessage: 'Failed to fetch',
      },
    ],
    silent_refresh_had_refresh_token: true,
    silent_refresh_consecutive_failures: 1,
    page_hidden_for_ms: 30_000,
    visibility_state: 'visible',
    refresh_token_age_ms: null,
  })),
}));

vi.mock('@/utils/errorReporter', () => ({
  reportError: vi.fn(),
}));

// Must reset modules between tests to clear module-level state
let offlineQueue: typeof import('../offlineQueue');

describe('offlineQueue', () => {
  beforeEach(async () => {
    vi.resetModules();
    // Clear sessionStorage before each test
    sessionStorage.clear();
    tokenAcquiredCallbackHolder.cb = null;
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

    it('throws underlying write error and keeps queue on flush failure', async () => {
      const mockWrite = vi.fn().mockRejectedValue(new Error('Network error'));
      const mockProvider = { write: mockWrite } as any;
      offlineQueue.setFlushProvider(mockProvider);

      offlineQueue.enqueueOfflineSave('{"data":"retry"}');

      // flushQueue now propagates the underlying write error so the
      // offline-queue-flush surface can include the real cause in Slack
      // (rather than the opaque "flush returned false" placeholder).
      await expect(offlineQueue.flushQueue()).rejects.toThrow('Network error');

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

  // ─── Recovery hooks (2026-05-08 regression fix) ───────────────────────────
  // The original queue retried only on the `online` window event. When
  // a queue got stuck because of an auth failure (token expired, network
  // was fine all along), there was no `online` event coming and the queue
  // sat forever. Two new recovery paths fix this:
  //   - onTokenAcquired (silent refresh succeeded → flush)
  //   - visibilitychange to visible (user returned to tab → flush)

  describe('tokenAcquired flush hook', () => {
    it('flushes queue when onTokenAcquired callback fires', async () => {
      const mockWrite = vi.fn().mockResolvedValue(undefined);
      offlineQueue.setFlushProvider({ write: mockWrite } as any);
      offlineQueue.enqueueOfflineSave('{"data":"auth-recovery"}');

      // setFlushProvider auto-flushed (online), so clear the call history
      // and start from a known state.
      await Promise.resolve();
      mockWrite.mockClear();
      // Re-queue (auto-flush above cleared the queue if it succeeded)
      offlineQueue.enqueueOfflineSave('{"data":"auth-recovery"}');

      expect(tokenAcquiredCallbackHolder.cb).toBeTruthy();
      tokenAcquiredCallbackHolder.cb!();

      await vi.waitFor(() => expect(mockWrite).toHaveBeenCalledWith('{"data":"auth-recovery"}'));
    });

    it('does not flush after clearQueue removes the subscription', async () => {
      const mockWrite = vi.fn().mockResolvedValue(undefined);
      offlineQueue.setFlushProvider({ write: mockWrite } as any);
      offlineQueue.enqueueOfflineSave('{"data":"will-clear"}');

      // Subscription registered via startListening above. Clear it.
      await Promise.resolve();
      offlineQueue.clearQueue();
      mockWrite.mockClear();

      // After clearQueue, the unsub was called — callback holder is null.
      expect(tokenAcquiredCallbackHolder.cb).toBeNull();
    });

    it('does not throw when provider is unset by the time the hook fires', () => {
      // Enqueue first to register the subscription, then never set a provider.
      offlineQueue.enqueueOfflineSave('{"data":"no-provider"}');

      expect(tokenAcquiredCallbackHolder.cb).toBeTruthy();
      // tryFlush bails on the no-provider check; must not throw.
      expect(() => tokenAcquiredCallbackHolder.cb!()).not.toThrow();
    });

    it('reports flush failures via reportError with the token-acquired reason', async () => {
      const { reportError } = await import('@/utils/errorReporter');
      // First enqueue with no provider so the subscription registers without
      // an immediate auto-flush triggering reportError.
      offlineQueue.enqueueOfflineSave('{"data":"will-fail"}');

      const mockWrite = vi.fn().mockRejectedValue(new Error('Network down'));
      // setFlushProvider auto-flushes if onLine; navigate around that by
      // forcing onLine=false during this attach window, then restore.
      Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
      offlineQueue.setFlushProvider({ write: mockWrite } as any);
      Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });

      vi.mocked(reportError).mockClear();

      tokenAcquiredCallbackHolder.cb!();

      await vi.waitFor(() => {
        expect(reportError).toHaveBeenCalledWith(
          expect.objectContaining({
            surface: 'offline-queue-flush',
            message: 'flush rejected after token-acquired: Network down',
          })
        );
      });
    });

    it('forwards the underlying write error into the Slack alert', async () => {
      const { reportError } = await import('@/utils/errorReporter');
      offlineQueue.enqueueOfflineSave('{"data":"will-fail"}');

      const underlying = new Error('TokenExpiredError: Drive write failed');
      const mockWrite = vi.fn().mockRejectedValue(underlying);
      Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
      offlineQueue.setFlushProvider({ write: mockWrite } as any);
      Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });

      vi.mocked(reportError).mockClear();
      tokenAcquiredCallbackHolder.cb!();

      await vi.waitFor(() => {
        expect(reportError).toHaveBeenCalledWith(
          expect.objectContaining({
            surface: 'offline-queue-flush',
            error: underlying,
          })
        );
      });
    });
  });

  describe('visibilitychange flush hook', () => {
    it('flushes queue when tab becomes visible', async () => {
      const mockWrite = vi.fn().mockResolvedValue(undefined);
      offlineQueue.setFlushProvider({ write: mockWrite } as any);
      offlineQueue.enqueueOfflineSave('{"data":"visible-recovery"}');

      // Drain auto-flush.
      await Promise.resolve();
      mockWrite.mockClear();
      offlineQueue.enqueueOfflineSave('{"data":"visible-recovery"}');

      // Tab not hidden → visibility handler triggers a flush.
      Object.defineProperty(document, 'hidden', { value: false, configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));

      await vi.waitFor(() => expect(mockWrite).toHaveBeenCalledWith('{"data":"visible-recovery"}'));
    });

    it('does not flush when tab becomes hidden', async () => {
      const mockWrite = vi.fn().mockResolvedValue(undefined);
      offlineQueue.setFlushProvider({ write: mockWrite } as any);
      offlineQueue.enqueueOfflineSave('{"data":"stay-queued"}');

      await Promise.resolve();
      mockWrite.mockClear();
      offlineQueue.enqueueOfflineSave('{"data":"stay-queued"}');

      Object.defineProperty(document, 'hidden', { value: true, configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));

      // Wait one microtask cycle — should NOT have flushed.
      await Promise.resolve();
      expect(mockWrite).not.toHaveBeenCalled();
    });

    it('clearQueue removes the visibility listener', async () => {
      const mockWrite = vi.fn().mockResolvedValue(undefined);
      offlineQueue.setFlushProvider({ write: mockWrite } as any);
      offlineQueue.enqueueOfflineSave('{"data":"will-clear"}');

      await Promise.resolve();
      offlineQueue.clearQueue();
      mockWrite.mockClear();

      // After clearing, dispatching visibilitychange should not trigger flush.
      Object.defineProperty(document, 'hidden', { value: false, configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));

      await Promise.resolve();
      expect(mockWrite).not.toHaveBeenCalled();
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

  // ─── Concurrent-trigger coalescing (2026-05-16) ──────────────────────────
  // On PWA cold-start, `token-acquired` and `visible` fire within ~10ms of
  // each other. Without coalescing, both triggered duplicate Drive writes
  // and duplicate Slack alerts. The in-flight guard ensures the second
  // trigger piggy-backs on the first attempt silently.

  describe('coalescing concurrent triggers', () => {
    it('only one write fires when token-acquired and visible arrive together', async () => {
      const { reportError } = await import('@/utils/errorReporter');

      // Long-running write — both triggers will land while it's in flight.
      let resolveWrite: () => void = () => {};
      const writePromise = new Promise<void>((r) => {
        resolveWrite = r;
      });
      const mockWrite = vi.fn().mockReturnValue(writePromise);

      // Force offline through provider-attach to avoid the startup auto-flush
      // consuming our coalescing window.
      offlineQueue.enqueueOfflineSave('{"data":"cold-start"}');
      Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
      offlineQueue.setFlushProvider({ write: mockWrite } as any);
      Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });

      vi.mocked(reportError).mockClear();

      // Fire both triggers within the same tick — token-acquired first,
      // then visibilitychange — matching the user-reported PWA cold-start
      // pattern from the Slack alert.
      tokenAcquiredCallbackHolder.cb!();
      Object.defineProperty(document, 'hidden', { value: false, configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));

      // Give microtasks a chance to settle without resolving the write.
      await Promise.resolve();
      await Promise.resolve();

      // Only one write should be in flight.
      expect(mockWrite).toHaveBeenCalledTimes(1);

      // Resolve the write successfully — neither trigger should report.
      resolveWrite();
      await vi.waitFor(() => expect(offlineQueue.hasPendingSave()).toBe(false));
      expect(reportError).not.toHaveBeenCalled();
    });

    it('only one Slack alert fires when both triggers see a failed flush', async () => {
      const { reportError } = await import('@/utils/errorReporter');

      let rejectWrite: (e: unknown) => void = () => {};
      const writePromise = new Promise<void>((_, reject) => {
        rejectWrite = reject;
      });
      const mockWrite = vi.fn().mockReturnValue(writePromise);

      offlineQueue.enqueueOfflineSave('{"data":"cold-start-fail"}');
      Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
      offlineQueue.setFlushProvider({ write: mockWrite } as any);
      Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });

      vi.mocked(reportError).mockClear();

      tokenAcquiredCallbackHolder.cb!();
      Object.defineProperty(document, 'hidden', { value: false, configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));

      await Promise.resolve();
      await Promise.resolve();

      expect(mockWrite).toHaveBeenCalledTimes(1);

      rejectWrite(new Error('Drive 401'));
      await vi.waitFor(() => expect(reportError).toHaveBeenCalled());

      // Exactly one alert, attributed to the FIRST trigger (token-acquired).
      expect(reportError).toHaveBeenCalledTimes(1);
      expect(reportError).toHaveBeenCalledWith(
        expect.objectContaining({
          surface: 'offline-queue-flush',
          message: 'flush rejected after token-acquired: Drive 401',
        })
      );
    });
  });

  describe('startup-reason trigger', () => {
    it('reports flush failures with reason "startup" when setFlushProvider auto-flushes', async () => {
      const { reportError } = await import('@/utils/errorReporter');

      // Pending content already restored (simulating PWA cold-start with
      // sessionStorage-restored queue). Provider attaches with onLine=true,
      // which should kick off tryFlush('startup').
      offlineQueue.enqueueOfflineSave('{"data":"startup-fail"}');
      Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });

      vi.mocked(reportError).mockClear();

      const mockWrite = vi.fn().mockRejectedValue(new Error('Network down'));
      offlineQueue.setFlushProvider({ write: mockWrite } as any);

      await vi.waitFor(() => {
        expect(reportError).toHaveBeenCalledWith(
          expect.objectContaining({
            surface: 'offline-queue-flush',
            message: 'flush rejected after startup: Network down',
          })
        );
      });
    });

    // ─── Silent-refresh diagnostic attachment (2026-05-20) ───────────────────
    describe('TokenExpiredError → silent-refresh diagnostics attached', () => {
      it('attaches silent-refresh context when the flush failure is TokenExpiredError', async () => {
        const { reportError } = await import('@/utils/errorReporter');
        const { TokenExpiredError } = await import('@/services/google/googleAuth');
        const reportErrorMock = reportError as ReturnType<typeof vi.fn>;
        reportErrorMock.mockClear();

        offlineQueue.enqueueOfflineSave('{"data":"auth-blocked"}');
        const tokenErr = new TokenExpiredError();
        const mockWrite = vi.fn().mockRejectedValue(tokenErr);
        offlineQueue.setFlushProvider({ write: mockWrite } as any);

        // Visibility-triggered flush
        Object.defineProperty(document, 'hidden', { value: false, configurable: true });
        document.dispatchEvent(new Event('visibilitychange'));

        await vi.waitFor(() => expect(reportErrorMock).toHaveBeenCalled());

        const call = reportErrorMock.mock.calls.at(-1)?.[0];
        expect(call?.surface).toBe('offline-queue-flush');
        expect(call?.context).toBeDefined();
        expect(call?.context?.silent_refresh_attempts).toEqual([
          expect.objectContaining({ classification: 'network' }),
        ]);
        expect(call?.context?.silent_refresh_had_refresh_token).toBe(true);
        expect(call?.context?.page_hidden_for_ms).toBe(30_000);
      });

      it('does NOT attach silent-refresh context when the failure is a non-auth error', async () => {
        const { reportError } = await import('@/utils/errorReporter');
        const reportErrorMock = reportError as ReturnType<typeof vi.fn>;
        reportErrorMock.mockClear();

        offlineQueue.enqueueOfflineSave('{"data":"drive-404"}');
        const mockWrite = vi.fn().mockRejectedValue(new Error('Drive 404 — file not found'));
        offlineQueue.setFlushProvider({ write: mockWrite } as any);

        Object.defineProperty(document, 'hidden', { value: false, configurable: true });
        document.dispatchEvent(new Event('visibilitychange'));

        await vi.waitFor(() => expect(reportErrorMock).toHaveBeenCalled());

        const call = reportErrorMock.mock.calls.at(-1)?.[0];
        expect(call?.surface).toBe('offline-queue-flush');
        // The misleading silent-refresh diagnostic blob is omitted on non-auth
        // failures; only the always-present consecutive-failure count remains
        // (it drives the sustained-page gate and is not auth-specific noise).
        expect(call?.context).toEqual({ consecutiveFailures: 1 });
      });
    });
  });
});
