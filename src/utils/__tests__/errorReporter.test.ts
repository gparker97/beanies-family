import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Stores are mocked at the top so the reporter's top-level imports resolve
// against these factories. The reporter wraps each store call in try/catch
// so missing/throwing stores result in degraded reports — verified below.
vi.mock('@/stores/familyStore', () => ({
  useFamilyStore: vi.fn(() => ({ members: [] })),
}));
vi.mock('@/stores/familyContextStore', () => ({
  useFamilyContextStore: vi.fn(() => ({ activeFamilyId: null, activeFamilyName: null })),
}));
vi.mock('@/stores/syncStore', () => ({
  useSyncStore: vi.fn(() => ({
    storageProviderType: null,
    saveFailureLevel: 'none',
    driveFileNotFound: false,
  })),
}));
// The Slack reporter mirrors into the telemetry firehose; mock it so this
// suite tests the Slack path in isolation (the queue has its own tests).
vi.mock('@/services/telemetry', () => ({
  logEvent: vi.fn(),
}));

import { reportError, __resetErrorReporterForTesting } from '../errorReporter';

// Post-gate, only `severity: 'critical'` reaches Slack. The dedup/payload suites
// below exercise the Slack path, so they report at critical via this thin wrapper
// (keeps them focused without repeating `severity: 'critical'` at every call).
// The gate itself (critical-only) has its own describe block at the bottom.
const reportCritical = (input: Parameters<typeof reportError>[0]) =>
  reportError({ severity: 'critical', ...input });

describe('errorReporter', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    __resetErrorReporterForTesting();
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 200 }));
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // Stub the env var so the URL check passes.
    vi.stubEnv('VITE_BEANIES_ERROR_WEBHOOK_URL', 'https://hooks.slack.com/services/TEST');
    vi.stubEnv('VITE_BUILD_SHA', 'test-sha');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  describe('dedup — first occurrence sends; subsequent count-only', () => {
    it('first occurrence triggers a fetch', () => {
      reportCritical({ surface: 'create-activity', message: 'boom' });
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it('second occurrence within window does NOT fetch and warns dedup-counted', () => {
      reportCritical({ surface: 'create-activity', message: 'boom' });
      reportCritical({ surface: 'create-activity', message: 'boom' });
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy).toHaveBeenCalledWith(
        '[errorReporter] dedup-counted',
        'create-activity',
        'boom',
        expect.stringMatching(/count=2/)
      );
    });

    it('different surfaces with same message both fetch (no cross-surface dedup)', () => {
      reportCritical({ surface: 'create-activity', message: 'boom' });
      reportCritical({ surface: 'edit-activity', message: 'boom' });
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });

    it('nearly-identical messages (different IDs) collapse to one bucket', () => {
      reportCritical({ surface: 'save', message: 'failed for record 123456' });
      reportCritical({ surface: 'save', message: 'failed for record 789012' });
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it('summary message fires at window close when count > 1', async () => {
      vi.useFakeTimers();
      reportCritical({ surface: 'save', message: 'boom' });
      reportCritical({ surface: 'save', message: 'boom' });
      reportCritical({ surface: 'save', message: 'boom' });
      expect(fetchSpy).toHaveBeenCalledTimes(1); // first only

      await vi.advanceTimersByTimeAsync(60_000 + 100);
      expect(fetchSpy).toHaveBeenCalledTimes(2); // first + summary
      const summaryCall = fetchSpy.mock.calls[1];
      const body = JSON.parse((summaryCall![1] as RequestInit).body as string);
      expect(body.text).toMatch(/🔁/);
      expect(body.text).toMatch(/fired 2 more times/);
    });

    it('no summary fires when count == 1 (single-shot error)', async () => {
      vi.useFakeTimers();
      reportCritical({ surface: 'save', message: 'boom' });
      await vi.advanceTimersByTimeAsync(60_000 + 100);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('cross-reload dedup — sessionStorage layer', () => {
    it('suppresses identical errors across simulated page reloads within the window', () => {
      // Initial page load: first occurrence fires.
      reportCritical({ surface: 'app.postInitNoData', message: 'no doc loaded' });
      expect(fetchSpy).toHaveBeenCalledTimes(1);

      // Simulate a page reload: in-memory buckets are gone but sessionStorage
      // persists. This is exactly the reload-loop scenario the Ritterbusch
      // family hit on 2026-05-18 — fix(loop): 502ebab era.
      __resetErrorReporterForTesting({ keepSessionStorage: true });

      // Same error fires again on the new page load — should be suppressed
      // by the sessionStorage layer, even though the in-memory bucket is fresh.
      reportCritical({ surface: 'app.postInitNoData', message: 'no doc loaded' });
      expect(fetchSpy).toHaveBeenCalledTimes(1); // still just the first
      expect(warnSpy).toHaveBeenCalledWith(
        '[errorReporter] dedup-counted-across-reload',
        'app.postInitNoData',
        expect.stringMatching(/^lastFiredAt=/)
      );
    });

    it('allows a fresh fire after the dedup window elapses across reloads', () => {
      vi.useFakeTimers();
      // First fire on this tab.
      reportCritical({ surface: 'app.postInitNoData', message: 'no doc' });
      expect(fetchSpy).toHaveBeenCalledTimes(1);

      // Simulate a reload AND advance past the dedup window.
      __resetErrorReporterForTesting({ keepSessionStorage: true });
      vi.advanceTimersByTime(60_000 + 100);

      // Same error fires after the window — should NOT be suppressed.
      reportCritical({ surface: 'app.postInitNoData', message: 'no doc' });
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });

    it('different surfaces are tracked independently across reloads', () => {
      reportCritical({ surface: 'app.postInitNoData', message: 'no doc' });
      __resetErrorReporterForTesting({ keepSessionStorage: true });
      // Different surface — should still fire.
      reportCritical({ surface: 'create-activity', message: 'failed' });
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });
  });

  describe('failure handling — no silent paths', () => {
    it('does nothing if webhook URL is unset (and warns)', () => {
      vi.stubEnv('VITE_BEANIES_ERROR_WEBHOOK_URL', '');
      reportCritical({ surface: 'x', message: 'y' });
      expect(fetchSpy).not.toHaveBeenCalled();
      // Now via slackPost — uses its own scope tag
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('webhook URL not configured'));
    });

    it('swallows fetch rejection without throwing (and warns)', async () => {
      fetchSpy.mockRejectedValueOnce(new Error('network down'));
      // Should not throw
      expect(() => reportCritical({ surface: 'x', message: 'y' })).not.toThrow();
      // Warn is async (inside the .catch); flush microtasks
      await Promise.resolve();
      await Promise.resolve();
      expect(warnSpy).toHaveBeenCalledWith(
        '[errorReporter] webhook POST failed',
        expect.any(Error)
      );
    });

    it('re-entry guard blocks recursive reportError calls', async () => {
      const ctxMod = await import('@/stores/familyContextStore');
      const ctxMocked = vi.mocked(ctxMod.useFamilyContextStore);
      // Make context build try to re-enter
      ctxMocked.mockImplementationOnce(() => {
        reportCritical({ surface: 'inner', message: 'inner-boom' });
        return { activeFamilyId: null, activeFamilyName: null } as never;
      });
      reportCritical({ surface: 'outer', message: 'outer-boom' });
      // Outer fired; inner got blocked by the re-entry guard
      expect(warnSpy).toHaveBeenCalledWith('[errorReporter] re-entry blocked', 'inner');
    });
  });

  describe('payload structure', () => {
    it('includes surface, message, family info, and build SHA', () => {
      reportCritical({ surface: 'create-activity', message: 'boom' });
      const body = JSON.parse((fetchSpy.mock.calls[0]![1] as RequestInit).body as string);
      expect(body.text).toContain('🚨');
      expect(body.text).toContain('create-activity');
      expect(body.text).toContain('boom');
      expect(body.text).toContain('test-sha');
    });

    it('includes the error stack when an Error is passed', () => {
      const err = new Error('detailed');
      reportCritical({ surface: 'x', message: 'y', error: err });
      const body = JSON.parse((fetchSpy.mock.calls[0]![1] as RequestInit).body as string);
      expect(body.text).toContain('*Stack:*');
      expect(body.text).toContain('Error: detailed');
    });

    it('handles missing Error gracefully', () => {
      reportCritical({ surface: 'x', message: 'y' });
      const body = JSON.parse((fetchSpy.mock.calls[0]![1] as RequestInit).body as string);
      expect(body.text).not.toContain('*Stack:*');
    });
  });

  // The contract guard: Slack pages critical-only; everything else is telemetry
  // + console. This pins the default-quiet behaviour so a future refactor can't
  // silently re-arm or disarm paging.
  describe('Slack page-gate — critical-only (quiet by default)', () => {
    it('does NOT page for unspecified / error / warning severity', () => {
      reportError({ surface: 'background-a', message: 'noise' });
      reportError({ surface: 'background-b', message: 'noise', severity: 'error' });
      reportError({ surface: 'background-c', message: 'noise', severity: 'warning' });
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('pages Slack only for critical severity', () => {
      reportError({ surface: 'fatal-thing', message: 'boom', severity: 'critical' });
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it('mirrors EVERY severity into telemetry, even when Slack is gated out', async () => {
      const { logEvent } = await import('@/services/telemetry');
      vi.mocked(logEvent).mockClear(); // module mock accumulates across the suite
      reportError({ surface: 'a', message: 'm1' }); // unspecified → telemetry only
      reportError({ surface: 'b', message: 'm2', severity: 'warning' }); // telemetry only
      reportError({ surface: 'c', message: 'm3', severity: 'critical' }); // telemetry + Slack
      expect(vi.mocked(logEvent)).toHaveBeenCalledTimes(3);
      expect(fetchSpy).toHaveBeenCalledTimes(1); // only the critical paged
    });
  });
});
