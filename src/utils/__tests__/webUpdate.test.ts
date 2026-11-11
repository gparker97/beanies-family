import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { FreshnessOutcome } from '../buildFreshness';

const logEvent = vi.hoisted(() => vi.fn());
vi.mock('@/services/telemetry', () => ({ logEvent }));

const env = vi.hoisted(() => ({
  native: false,
  sha: 'old1111aaaa',
  oauthPending: false,
  redirectUnsettled: false,
  quietBlocker: null as null | 'overlay' | 'escape-layer' | 'syncing' | 'not-ready',
  auth: { isInitialized: true, isAuthenticated: false, needsPodSetup: false },
  routeMeta: {} as Record<string, unknown>,
}));

vi.mock('@/utils/diagnosticContext', () => ({
  getBuildSha: () => env.sha,
  getBuildTime: () => '2026-11-10T10:00:00.000Z',
}));
vi.mock('@/services/sync/capabilities', () => ({ isNative: () => env.native }));
vi.mock('@/stores/authStore', () => ({ useAuthStore: () => env.auth }));
vi.mock('@/router', () => ({
  default: {
    get currentRoute() {
      return { value: { meta: env.routeMeta, fullPath: '/welcome' } };
    },
  },
}));
vi.mock('@/services/google/googleAuth', () => ({
  isInteractiveOAuthPending: () => env.oauthPending,
  isRedirectAuthUnsettled: () => env.redirectUnsettled,
}));
vi.mock('@/utils/appQuiet', () => ({ appQuietBlocker: () => env.quietBlocker }));

const checkBuildFreshness = vi.hoisted(() =>
  vi.fn<(local: { sha: string; builtAt: string | null }) => Promise<FreshnessOutcome>>()
);
vi.mock('@/utils/buildFreshness', () => ({ checkBuildFreshness }));

const hardReload = vi.hoisted(() => vi.fn<() => Promise<void>>(async () => {}));
vi.mock('@/utils/hardReload', () => ({
  hardReload,
  isChunkRecoveryInProgress: () => false,
}));

import {
  runUpdateCheck,
  setSwPathHooks,
  logUpdaterEvent,
  __resetWebUpdateForTesting,
} from '../webUpdate';
import { setPreAuthIdle } from '../appUpdateSignals';
import {
  __resetForcedUpdateForTesting,
  readForcedRecord,
  writeForcedRecord,
  BEHIND_SINCE_KEY,
} from '../forcedUpdate';
import { FORCE_CAP_MS } from '../updatePolicy';

const BEHIND: FreshnessOutcome = { kind: 'behind', remoteSha: 'new2222bbbb' };

function actions(): string[] {
  return logEvent.mock.calls.map((c) => (c[0] as { context: { action: string } }).context.action);
}
function eventFor(action: string) {
  return logEvent.mock.calls
    .map((c) => c[0] as { level: string; flush?: boolean; context: Record<string, unknown> })
    .find((e) => e.context.action === action);
}

describe('runUpdateCheck', () => {
  beforeEach(() => {
    __resetWebUpdateForTesting();
    __resetForcedUpdateForTesting();
    logEvent.mockClear();
    hardReload.mockReset();
    hardReload.mockResolvedValue(undefined);
    checkBuildFreshness.mockReset();
    env.redirectUnsettled = false;
    sessionStorage.clear();
    localStorage.clear();
    env.native = false;
    env.sha = 'old1111aaaa';
    env.oauthPending = false;
    env.quietBlocker = null;
    env.auth = { isInitialized: true, isAuthenticated: false, needsPodSetup: false };
    env.routeMeta = {};
    setPreAuthIdle(true);
    window.location.hash = '';
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    setPreAuthIdle(false);
    (document.activeElement as HTMLElement | null)?.blur?.();
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  describe('refusals', () => {
    it('never checks on native', async () => {
      env.native = true;
      expect(await runUpdateCheck({ trigger: 'visible', userRequested: true })).toBe('unavailable');
      expect(checkBuildFreshness).not.toHaveBeenCalled();
    });

    it('never checks a dev build', async () => {
      env.sha = 'dev';
      expect(await runUpdateCheck({ trigger: 'visible' })).toBe('unavailable');
      expect(checkBuildFreshness).not.toHaveBeenCalled();
    });
  });

  it('passes this build’s identity to the freshness check', async () => {
    checkBuildFreshness.mockResolvedValue({ kind: 'current' });
    expect(await runUpdateCheck({ trigger: 'visible' })).toBe('current');
    expect(checkBuildFreshness).toHaveBeenCalledWith({
      sha: 'old1111aaaa',
      builtAt: '2026-11-10T10:00:00.000Z',
    });
    expect(eventFor('checked')?.context.detail).toBe(
      'outcome=current,trigger=visible,screen=landing'
    );
  });

  it('logs nothing when offline, and check-failed for any other unavailability', async () => {
    checkBuildFreshness.mockResolvedValue({ kind: 'unavailable', reason: 'offline' });
    expect(await runUpdateCheck({ trigger: 'visible' })).toBe('unavailable');
    expect(logEvent).not.toHaveBeenCalled();

    checkBuildFreshness.mockResolvedValue({ kind: 'unavailable', reason: 'shape' });
    expect(await runUpdateCheck({ trigger: 'nav' })).toBe('unavailable');
    expect(eventFor('check-failed')).toMatchObject({
      level: 'warn',
      context: { error_code: 'shape', detail: 'trigger=nav' },
    });
    expect(hardReload).not.toHaveBeenCalled();
  });

  describe('behind', () => {
    beforeEach(() => {
      checkBuildFreshness.mockResolvedValue(BEHIND);
    });

    it('forces on the idle landing: record, flushed `forced`, then hardReload', async () => {
      expect(await runUpdateCheck({ trigger: 'visible' })).toBe('reloading');
      expect(readForcedRecord()).toEqual({ from: 'old1111aaaa', to: 'new2222bbbb' });
      expect(eventFor('forced')).toMatchObject({
        level: 'warn',
        flush: true,
        context: { detail: 'trigger=visible,screen=landing,to=new2222,user=false' },
      });
      expect(hardReload).toHaveBeenCalledTimes(1);
    });

    it('defers while a redirect sign-in is unredeemed or being redeemed (read-only probe)', async () => {
      env.redirectUnsettled = true;
      expect(await runUpdateCheck({ trigger: 'visible', userRequested: true })).toBe('deferred');
      expect(eventFor('deferred')).toMatchObject({
        context: { detail: expect.stringContaining('blocker=oauth') },
      });
      expect(hardReload).not.toHaveBeenCalled();
      env.redirectUnsettled = false;
    });

    it('before auth has initialised: defers', async () => {
      env.auth = { isInitialized: false, isAuthenticated: false, needsPodSetup: false };
      expect(await runUpdateCheck({ trigger: 'visible' })).toBe('deferred');
      expect(eventFor('deferred')).toMatchObject({
        context: { detail: expect.stringContaining('blocker=auth-init') },
      });
      expect(hardReload).not.toHaveBeenCalled();
    });

    it('defers on a non-idle login view and logs the blocker', async () => {
      setPreAuthIdle(false);
      expect(await runUpdateCheck({ trigger: 'visible' })).toBe('deferred');
      expect(eventFor('deferred')?.context.detail).toBe('blocker=not-idle,screen=other');
      expect(hardReload).not.toHaveBeenCalled();
    });

    it('defers over a focused text field', async () => {
      const field = document.createElement('input');
      field.type = 'password';
      document.body.appendChild(field);
      field.focus();
      expect(await runUpdateCheck({ trigger: 'visible' })).toBe('deferred');
      expect(eventFor('deferred')?.context.detail).toBe('blocker=editing,screen=landing');
    });

    it('a focused button is not editing', async () => {
      const btn = document.createElement('button');
      document.body.appendChild(btn);
      btn.focus();
      expect(await runUpdateCheck({ trigger: 'visible' })).toBe('reloading');
    });

    it('defers while the URL carries a fragment, even when asked', async () => {
      window.location.hash = '#kit=abc';
      expect(await runUpdateCheck({ trigger: 'visible', userRequested: true })).toBe('deferred');
      expect(eventFor('deferred')?.context.detail).toBe('blocker=hash,screen=landing');
    });

    it('defers while an interactive OAuth is pending', async () => {
      env.oauthPending = true;
      expect(await runUpdateCheck({ trigger: 'newer-file' })).toBe('deferred');
    });

    it('on the shell: waits for the cap, counted from the persisted first sighting', async () => {
      env.auth = { isInitialized: true, isAuthenticated: true, needsPodSetup: false };
      expect(await runUpdateCheck({ trigger: 'visible' })).toBe('deferred');
      expect(eventFor('deferred')?.context.detail).toBe('blocker=cap-not-reached,screen=shell');

      // A previous page load first saw this sha behind 11 minutes ago.
      localStorage.setItem(
        BEHIND_SINCE_KEY,
        JSON.stringify({ sha: 'new2222bbbb', since: Date.now() - FORCE_CAP_MS - 60_000 })
      );
      expect(await runUpdateCheck({ trigger: 'nav' })).toBe('reloading');
    });

    it('on the shell: a newer-version file skips the cap, but never the quiet rule', async () => {
      env.auth = { isInitialized: true, isAuthenticated: true, needsPodSetup: false };
      env.quietBlocker = 'overlay';
      expect(await runUpdateCheck({ trigger: 'newer-file' })).toBe('deferred');
      expect(eventFor('deferred')?.context.detail).toBe('blocker=overlay,screen=shell');
      env.quietBlocker = null;
      expect(await runUpdateCheck({ trigger: 'newer-file' })).toBe('reloading');
    });

    it('stands down while the SW path is applying', async () => {
      setSwPathHooks({ isApplying: () => true, applyWaitingIfQuiet: () => false });
      expect(await runUpdateCheck({ trigger: 'visible', userRequested: true })).toBe('deferred');
      expect(eventFor('deferred')?.context.detail).toBe('blocker=sw-applying,screen=landing');
      expect(hardReload).not.toHaveBeenCalled();
    });

    it('prefers a waiting worker (the SW path) over forcing when quiet', async () => {
      const applyWaitingIfQuiet = vi.fn(() => true);
      setSwPathHooks({ isApplying: () => false, applyWaitingIfQuiet });
      expect(await runUpdateCheck({ trigger: 'visible' })).toBe('reloading');
      expect(applyWaitingIfQuiet).toHaveBeenCalledTimes(1);
      expect(hardReload).not.toHaveBeenCalled();
      expect(readForcedRecord()).toBeNull();
    });

    it('re-checks at the last moment: a screen that changed calls the force off', async () => {
      // The second decision sees the SW path start in between.
      let calls = 0;
      setSwPathHooks({
        isApplying: () => {
          calls += 1;
          return calls > 1;
        },
        applyWaitingIfQuiet: () => false,
      });
      expect(await runUpdateCheck({ trigger: 'visible' })).toBe('deferred');
      expect(actions()).not.toContain('forced');
      expect(eventFor('deferred')?.context.detail).toBe('blocker=sw-applying,screen=landing');
      expect(hardReload).not.toHaveBeenCalled();
      expect(readForcedRecord()).toBeNull();
    });

    it('logs force-suppressed (and no `forced`) when the once-per-sha guard refuses', async () => {
      writeForcedRecord({ from: 'old1111aaaa', to: 'new2222bbbb' });
      expect(await runUpdateCheck({ trigger: 'visible' })).toBe('deferred');
      expect(actions()).not.toContain('forced');
      expect(eventFor('force-suppressed')?.context).toMatchObject({
        detail: 'to=new2222',
        error_code: 'once-per-sha',
      });
    });

    it('a tap overrides the guard', async () => {
      writeForcedRecord({ from: 'old1111aaaa', to: 'new2222bbbb' });
      expect(await runUpdateCheck({ trigger: 'visible', userRequested: true })).toBe('reloading');
      expect(eventFor('forced')?.context.detail).toContain('user=true');
    });

    it('a hardReload rejection resolves to failed and logs force-failed', async () => {
      hardReload.mockRejectedValue(new TypeError('replace blocked'));
      expect(await runUpdateCheck({ trigger: 'visible' })).toBe('failed');
      expect(eventFor('force-failed')?.context).toMatchObject({
        detail: 'to=new2222,from=old1111',
        error_code: 'TypeError',
      });
    });
  });

  describe('single-flight', () => {
    it('an overlapping request joins the check in progress', async () => {
      let release!: (o: FreshnessOutcome) => void;
      checkBuildFreshness.mockImplementation(() => new Promise((r) => (release = r)));
      const a = runUpdateCheck({ trigger: 'visible' });
      const b = runUpdateCheck({ trigger: 'nav' });
      release({ kind: 'current' });
      expect(await a).toBe('current');
      expect(await b).toBe('current');
      expect(checkBuildFreshness).toHaveBeenCalledTimes(1);
    });

    it('a more permissive request that joins a deferred check runs once more', async () => {
      setPreAuthIdle(false); // 'other': a routine check defers, a tap does not
      let release!: (o: FreshnessOutcome) => void;
      checkBuildFreshness.mockImplementationOnce(() => new Promise((r) => (release = r)));
      checkBuildFreshness.mockResolvedValue(BEHIND);
      const routine = runUpdateCheck({ trigger: 'visible' });
      const tap = runUpdateCheck({ trigger: 'visible', userRequested: true });
      release(BEHIND);
      expect(await routine).toBe('deferred');
      expect(await tap).toBe('reloading');
      expect(checkBuildFreshness).toHaveBeenCalledTimes(2);
    });

    it('starts a fresh check once the previous one settled', async () => {
      checkBuildFreshness.mockResolvedValue({ kind: 'current' });
      await runUpdateCheck({ trigger: 'visible' });
      await runUpdateCheck({ trigger: 'visible' });
      expect(checkBuildFreshness).toHaveBeenCalledTimes(2);
    });

    it('never rejects, even when a dependency throws', async () => {
      checkBuildFreshness.mockRejectedValue(new Error('unexpected'));
      expect(await runUpdateCheck({ trigger: 'visible' })).toBe('failed');
      expect(eventFor('check-failed')?.context.error_code).toBe('internal');
    });
  });

  describe('logging dedup', () => {
    it('logs each distinct action|detail once per page load', () => {
      logUpdaterEvent({ level: 'info', action: 'deferred', message: 'm', detail: 'blocker=a' });
      logUpdaterEvent({ level: 'info', action: 'deferred', message: 'm', detail: 'blocker=a' });
      logUpdaterEvent({ level: 'info', action: 'deferred', message: 'm', detail: 'blocker=b' });
      expect(logEvent).toHaveBeenCalledTimes(2);
    });

    it('`once: false` events (forced, applied, force-failed) always log', () => {
      logUpdaterEvent({ level: 'warn', action: 'forced', message: 'm', detail: 'x', once: false });
      logUpdaterEvent({ level: 'warn', action: 'forced', message: 'm', detail: 'x', once: false });
      expect(logEvent).toHaveBeenCalledTimes(2);
    });

    it('carries only allowlisted context keys on the pwa-updater surface', () => {
      logUpdaterEvent({
        level: 'info',
        action: 'installed',
        message: 'm',
        detail: 'd',
        errorCode: 'e',
        durationMs: 12,
      });
      const ev = logEvent.mock.calls[0]![0] as { surface: string; context: object };
      expect(ev.surface).toBe('pwa-updater');
      expect(Object.keys(ev.context).sort()).toEqual(
        ['action', 'detail', 'error_code', 'perf_duration_ms'].sort()
      );
    });
  });
});
