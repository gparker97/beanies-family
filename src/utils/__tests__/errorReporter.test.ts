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

import {
  reportError,
  redactContext,
  normalizeMessage,
  __resetErrorReporterForTesting,
} from '../errorReporter';

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

  describe('redactContext — privacy contract', () => {
    it('drops disallowed keys and warns', () => {
      const result = redactContext({
        memberName: 'Alice',
        activityTitle: 'Soccer',
        transactionAmount: 100,
        family_id: 'fam_123',
      });
      expect(result).toEqual({ family_id: 'fam_123' });
      expect(warnSpy).toHaveBeenCalledWith(
        '[errorReporter] dropped non-allowlisted context key:',
        'memberName'
      );
    });

    it('preserves email as the only PII', () => {
      const result = redactContext({
        family_email: 'greg@example.com',
        family_name: 'Robinsons',
        family_id: 'fam_123',
      });
      expect(result).toEqual({
        family_email: 'greg@example.com',
        family_name: 'Robinsons',
        family_id: 'fam_123',
      });
    });

    it('truncates string values longer than 200 chars', () => {
      const long = 'x'.repeat(500);
      const result = redactContext({ family_name: long });
      expect((result.family_name as string).length).toBe(201); // 200 + ellipsis
      expect((result.family_name as string).endsWith('…')).toBe(true);
    });

    it('enforces last-4-chars on _tail fields', () => {
      const result = redactContext({
        file_id_tail: 'abcdefghijklmn',
        invite_token_tail: 'ZYXWVUTSR',
      });
      expect(result.file_id_tail).toBe('…klmn');
      expect(result.invite_token_tail).toBe('…UTSR');
    });
  });

  describe('normalizeMessage — collapse nearly-identical errors', () => {
    it('replaces UUIDs', () => {
      expect(normalizeMessage('Failed to load 1a2b3c4d-5e6f-7a8b-9c0d-1e2f3a4b5c6d')).toBe(
        'Failed to load <uuid>'
      );
    });

    it('replaces ISO timestamps', () => {
      expect(normalizeMessage('saved at 2026-04-27T14:42:18.123Z')).toBe('saved at <ts>');
      expect(normalizeMessage('saved at 2026-04-27T14:42:18Z')).toBe('saved at <ts>');
    });

    it('replaces 6+ digit numeric IDs', () => {
      expect(normalizeMessage('record 123456 not found')).toBe('record <id> not found');
    });

    it('replaces 8+ char hex strings', () => {
      expect(normalizeMessage('hash abc123def456 mismatch')).toBe('hash <hex> mismatch');
    });

    it('preserves non-id content', () => {
      expect(normalizeMessage('Could not save activity')).toBe('Could not save activity');
    });
  });

  describe('dedup — first occurrence sends; subsequent count-only', () => {
    it('first occurrence triggers a fetch', () => {
      reportError({ surface: 'create-activity', message: 'boom' });
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it('second occurrence within window does NOT fetch and warns dedup-counted', () => {
      reportError({ surface: 'create-activity', message: 'boom' });
      reportError({ surface: 'create-activity', message: 'boom' });
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy).toHaveBeenCalledWith(
        '[errorReporter] dedup-counted',
        'create-activity',
        'boom',
        expect.stringMatching(/count=2/)
      );
    });

    it('different surfaces with same message both fetch (no cross-surface dedup)', () => {
      reportError({ surface: 'create-activity', message: 'boom' });
      reportError({ surface: 'edit-activity', message: 'boom' });
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });

    it('nearly-identical messages (different IDs) collapse to one bucket', () => {
      reportError({ surface: 'save', message: 'failed for record 123456' });
      reportError({ surface: 'save', message: 'failed for record 789012' });
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it('summary message fires at window close when count > 1', async () => {
      vi.useFakeTimers();
      reportError({ surface: 'save', message: 'boom' });
      reportError({ surface: 'save', message: 'boom' });
      reportError({ surface: 'save', message: 'boom' });
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
      reportError({ surface: 'save', message: 'boom' });
      await vi.advanceTimersByTimeAsync(60_000 + 100);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('cross-reload dedup — sessionStorage layer', () => {
    it('suppresses identical errors across simulated page reloads within the window', () => {
      // Initial page load: first occurrence fires.
      reportError({ surface: 'app.postInitNoData', message: 'no doc loaded' });
      expect(fetchSpy).toHaveBeenCalledTimes(1);

      // Simulate a page reload: in-memory buckets are gone but sessionStorage
      // persists. This is exactly the reload-loop scenario the Ritterbusch
      // family hit on 2026-05-18 — fix(loop): 502ebab era.
      __resetErrorReporterForTesting({ keepSessionStorage: true });

      // Same error fires again on the new page load — should be suppressed
      // by the sessionStorage layer, even though the in-memory bucket is fresh.
      reportError({ surface: 'app.postInitNoData', message: 'no doc loaded' });
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
      reportError({ surface: 'app.postInitNoData', message: 'no doc' });
      expect(fetchSpy).toHaveBeenCalledTimes(1);

      // Simulate a reload AND advance past the dedup window.
      __resetErrorReporterForTesting({ keepSessionStorage: true });
      vi.advanceTimersByTime(60_000 + 100);

      // Same error fires after the window — should NOT be suppressed.
      reportError({ surface: 'app.postInitNoData', message: 'no doc' });
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });

    it('different surfaces are tracked independently across reloads', () => {
      reportError({ surface: 'app.postInitNoData', message: 'no doc' });
      __resetErrorReporterForTesting({ keepSessionStorage: true });
      // Different surface — should still fire.
      reportError({ surface: 'create-activity', message: 'failed' });
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });
  });

  describe('failure handling — no silent paths', () => {
    it('does nothing if webhook URL is unset (and warns)', () => {
      vi.stubEnv('VITE_BEANIES_ERROR_WEBHOOK_URL', '');
      reportError({ surface: 'x', message: 'y' });
      expect(fetchSpy).not.toHaveBeenCalled();
      // Now via slackPost — uses its own scope tag
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('webhook URL not configured'));
    });

    it('swallows fetch rejection without throwing (and warns)', async () => {
      fetchSpy.mockRejectedValueOnce(new Error('network down'));
      // Should not throw
      expect(() => reportError({ surface: 'x', message: 'y' })).not.toThrow();
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
        reportError({ surface: 'inner', message: 'inner-boom' });
        return { activeFamilyId: null, activeFamilyName: null } as never;
      });
      reportError({ surface: 'outer', message: 'outer-boom' });
      // Outer fired; inner got blocked by the re-entry guard
      expect(warnSpy).toHaveBeenCalledWith('[errorReporter] re-entry blocked', 'inner');
    });
  });

  describe('payload structure', () => {
    it('includes surface, message, family info, and build SHA', () => {
      reportError({ surface: 'create-activity', message: 'boom' });
      const body = JSON.parse((fetchSpy.mock.calls[0]![1] as RequestInit).body as string);
      expect(body.text).toContain('🚨');
      expect(body.text).toContain('create-activity');
      expect(body.text).toContain('boom');
      expect(body.text).toContain('test-sha');
    });

    it('includes the error stack when an Error is passed', () => {
      const err = new Error('detailed');
      reportError({ surface: 'x', message: 'y', error: err });
      const body = JSON.parse((fetchSpy.mock.calls[0]![1] as RequestInit).body as string);
      expect(body.text).toContain('*Stack:*');
      expect(body.text).toContain('Error: detailed');
    });

    it('handles missing Error gracefully', () => {
      reportError({ surface: 'x', message: 'y' });
      const body = JSON.parse((fetchSpy.mock.calls[0]![1] as RequestInit).body as string);
      expect(body.text).not.toContain('*Stack:*');
    });
  });
});
