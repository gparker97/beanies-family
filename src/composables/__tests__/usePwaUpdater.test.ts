import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ref, nextTick } from 'vue';

// --- mocks (declared before importing the SUT) ---
const needRefresh = ref(false);
const updateServiceWorker = vi.fn(async () => {});
type Listener = () => void;
const sw = vi.hoisted(() => ({
  listeners: [] as Array<() => void>,
  active: {} as object | null,
}));
vi.mock('virtual:pwa-register/vue', () => ({
  useRegisterSW: (opts: { onRegisteredSW?: (u: string, r: unknown) => void }) => {
    // simulate registration so the poll callback has a registration
    opts.onRegisteredSW?.('/sw.js', {
      get active() {
        return sw.active;
      },
      addEventListener: (_type: string, fn: Listener) => sw.listeners.push(fn),
    } as unknown as ServiceWorkerRegistration);
    return { needRefresh, updateServiceWorker };
  },
}));

let capturedGuard:
  ((to: { fullPath: string }, from: unknown, next: (v?: unknown) => void) => void) | undefined;
const beforeEach_ = vi.fn((fn: typeof capturedGuard) => {
  capturedGuard = fn;
  return () => {}; // remove handle
});
let capturedAfterEach: (() => void) | undefined;
const afterEach_ = vi.fn((fn: () => void) => {
  capturedAfterEach = fn;
  return () => {};
});
vi.mock('@/router', () => ({
  default: {
    beforeEach: (fn: typeof capturedGuard) => beforeEach_(fn),
    afterEach: (fn: () => void) => afterEach_(fn),
    currentRoute: { value: { fullPath: '/nook' } },
  },
}));

const isSyncing = ref(false);
vi.mock('@/stores/syncStore', () => ({
  useSyncStore: () => ({
    get isSyncing() {
      return isSyncing.value;
    },
  }),
}));

const hasOpenOverlays = vi.fn(() => false);
vi.mock('@/utils/overlayStack', () => ({ hasOpenOverlays: () => hasOpenOverlays() }));

const poll = vi.hoisted(() => ({ callback: undefined as undefined | (() => unknown) }));
vi.mock('@/composables/usePollWhileVisible', () => ({
  usePollWhileVisible: vi.fn((cb: () => unknown) => {
    poll.callback = cb;
    return { stop: vi.fn() };
  }),
}));
const safeServiceWorkerUpdate = vi.hoisted(() => vi.fn());
vi.mock('@/utils/safeServiceWorkerUpdate', () => ({ safeServiceWorkerUpdate }));
const hardReload = vi.hoisted(() => vi.fn<() => Promise<void>>(async () => {}));
vi.mock('@/utils/hardReload', () => ({ hardReload, isChunkRecoveryInProgress: () => false }));
vi.mock('@/utils/diagnosticContext', () => ({ getBuildSha: () => 'new2222bbbb' }));

// The runner is unit-tested on its own (webUpdate.test.ts); here only the wiring.
const web = vi.hoisted(() => ({
  runUpdateCheck: vi.fn(async (_o: { trigger: string; userRequested?: boolean }) => 'current'),
  logUpdaterEvent: vi.fn(),
  logDeferred: vi.fn(),
  hooks: null as null | { isApplying(): boolean; applyWaitingIfQuiet(): boolean },
}));
vi.mock('@/utils/webUpdate', () => ({
  runUpdateCheck: web.runUpdateCheck,
  logUpdaterEvent: web.logUpdaterEvent,
  logDeferred: web.logDeferred,
  currentUpdateScreen: () => 'shell',
  setSwPathHooks: (h: typeof web.hooks) => {
    web.hooks = h;
  },
  sha7: (s: string) => s.slice(0, 7),
  errorName: (e: unknown) => (e instanceof Error ? e.name : 'unknown'),
}));

import {
  usePwaUpdater,
  __resetPwaUpdaterForTesting,
  PWA_POST_UPDATE_ROUTE_KEY,
} from '../usePwaUpdater';
import { signalNewerFileSeen, setPreAuthIdle } from '@/utils/appUpdateSignals';
import { FORCED_RECORD_KEY } from '@/utils/forcedUpdate';

function loggedActions(): string[] {
  return web.logUpdaterEvent.mock.calls.map((c) => (c[0] as { action: string }).action);
}
function logged(action: string) {
  return web.logUpdaterEvent.mock.calls
    .map((c) => c[0] as { action: string; detail?: string; durationMs?: number; once?: boolean })
    .find((e) => e.action === action);
}

describe('usePwaUpdater', () => {
  beforeEach(() => {
    __resetPwaUpdaterForTesting();
    needRefresh.value = false;
    isSyncing.value = false;
    hasOpenOverlays.mockReturnValue(false);
    updateServiceWorker.mockReset();
    updateServiceWorker.mockResolvedValue(undefined);
    beforeEach_.mockClear();
    afterEach_.mockClear();
    capturedGuard = undefined;
    capturedAfterEach = undefined;
    poll.callback = undefined;
    sw.listeners = [];
    sw.active = {};
    safeServiceWorkerUpdate.mockClear();
    hardReload.mockReset();
    hardReload.mockResolvedValue(undefined);
    web.runUpdateCheck.mockReset();
    web.runUpdateCheck.mockResolvedValue('current');
    web.logUpdaterEvent.mockClear();
    web.logDeferred.mockClear();
    web.hooks = null;
    sessionStorage.clear();
    // The success path schedules a backstop reload via setTimeout; stub reload
    // so it can never navigate the test environment.
    vi.spyOn(window.location, 'reload').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    __resetPwaUpdaterForTesting();
    vi.restoreAllMocks();
  });

  describe('the service-worker path (unchanged behaviour)', () => {
    it('applies immediately + writes the resume key when a new SW is ready and the app is quiet', async () => {
      usePwaUpdater();
      needRefresh.value = true;
      await nextTick();
      await Promise.resolve();
      expect(updateServiceWorker).toHaveBeenCalledTimes(1);
      expect(sessionStorage.getItem(PWA_POST_UPDATE_ROUTE_KEY)).toBe('/nook');
      expect(beforeEach_).toHaveBeenCalledTimes(1); // guard also armed for the busy case
    });

    it('does NOT apply immediately when busy (overlay open); arms the route guard instead', async () => {
      hasOpenOverlays.mockReturnValue(true);
      usePwaUpdater();
      needRefresh.value = true;
      await nextTick();
      await Promise.resolve();
      expect(updateServiceWorker).not.toHaveBeenCalled();
      expect(sessionStorage.getItem(PWA_POST_UPDATE_ROUTE_KEY)).toBeNull();
      expect(beforeEach_).toHaveBeenCalledTimes(1);
    });

    it('does NOT apply immediately while syncing', async () => {
      isSyncing.value = true;
      usePwaUpdater();
      needRefresh.value = true;
      await nextTick();
      await Promise.resolve();
      expect(updateServiceWorker).not.toHaveBeenCalled();
    });

    it('the armed route guard applies the update on the next quiet navigation', async () => {
      hasOpenOverlays.mockReturnValue(true); // busy when the update arrives
      usePwaUpdater();
      needRefresh.value = true;
      await nextTick();
      await Promise.resolve();
      expect(capturedGuard).toBeTypeOf('function');

      // user becomes quiet, then navigates
      hasOpenOverlays.mockReturnValue(false);
      const next = vi.fn();
      capturedGuard!({ fullPath: '/budget' }, {}, next);
      await Promise.resolve();
      expect(updateServiceWorker).toHaveBeenCalledTimes(1);
      expect(sessionStorage.getItem(PWA_POST_UPDATE_ROUTE_KEY)).toBe('/budget');
      expect(next).toHaveBeenCalledWith(false); // cancel SPA nav; the reload supersedes it
    });

    it('the route guard defers (lets navigation through) while still busy', async () => {
      hasOpenOverlays.mockReturnValue(true);
      usePwaUpdater();
      needRefresh.value = true;
      await nextTick();
      await Promise.resolve();
      const next = vi.fn();
      capturedGuard!({ fullPath: '/budget' }, {}, next); // still busy
      await Promise.resolve();
      expect(updateServiceWorker).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalledWith(); // navigation allowed; guard stays armed
    });

    it('a failed SW update falls back to hardReload, and a hardReload rejection is caught + logged', async () => {
      updateServiceWorker.mockRejectedValue(new Error('activation failed'));
      hardReload.mockRejectedValue(new TypeError('replace blocked'));
      vi.spyOn(console, 'error').mockImplementation(() => {});
      usePwaUpdater();
      needRefresh.value = true;
      await nextTick();
      await vi.waitFor(() =>
        expect(
          web.logUpdaterEvent.mock.calls.some(
            (c) => (c[0] as { detail?: string }).detail === 'stage=hard-reload'
          )
        ).toBe(true)
      );
      expect(hardReload).toHaveBeenCalledTimes(1);
      expect(logged('sw-update-failed')?.detail).toBe('stage=apply');
    });
  });

  describe('service-worker lifecycle telemetry', () => {
    it('logs found (on an update, not the first install), installed with its duration, applying', async () => {
      usePwaUpdater();
      sw.listeners.forEach((fn) => fn());
      needRefresh.value = true;
      await nextTick();
      await Promise.resolve();
      expect(loggedActions()).toEqual(expect.arrayContaining(['found', 'installed', 'applying']));
      expect(logged('installed')?.durationMs).toBeTypeOf('number');
      expect(logged('applying')?.detail).toBe('via=sw');
    });

    it('does not log found for the very first install (no active worker)', () => {
      sw.active = null;
      usePwaUpdater();
      sw.listeners.forEach((fn) => fn());
      expect(loggedActions()).not.toContain('found');
    });

    it('logs deferred with the quiet blocker when a waiting worker cannot apply yet', async () => {
      hasOpenOverlays.mockReturnValue(true);
      usePwaUpdater();
      needRefresh.value = true;
      await nextTick();
      expect(web.logDeferred).toHaveBeenCalledWith('overlay', 'shell');
    });
  });

  describe('the freshness check', () => {
    it('the poll updates the SW (with a failure sink) and RETURNS the freshness promise', async () => {
      usePwaUpdater();
      const result = poll.callback!();
      expect(result).toBeInstanceOf(Promise);
      await result;
      expect(safeServiceWorkerUpdate).toHaveBeenCalledWith(
        expect.anything(),
        'pwa-updater-poll',
        expect.any(Function)
      );
      expect(web.runUpdateCheck).toHaveBeenCalledWith({ trigger: 'visible' });
      // No navigation check until the build is known behind.
      expect(afterEach_).not.toHaveBeenCalled();
    });

    it('logs sw-update-failed from the poll’s failure sink', () => {
      usePwaUpdater();
      void poll.callback!();
      const sink = safeServiceWorkerUpdate.mock.calls[0]![2] as (e: unknown) => void;
      sink(new TypeError('Failed to fetch'));
      expect(logged('sw-update-failed')).toMatchObject({ detail: 'stage=poll' });
    });

    it('on the first behind, arms ONE afterEach that re-checks on navigation', async () => {
      web.runUpdateCheck.mockResolvedValue('deferred');
      usePwaUpdater();
      await poll.callback!();
      await poll.callback!();
      expect(afterEach_).toHaveBeenCalledTimes(1);
      capturedAfterEach!();
      await Promise.resolve();
      expect(web.runUpdateCheck).toHaveBeenLastCalledWith({ trigger: 'nav' });
    });

    it('a newer-version file: one immediate check per burst; urgency lasts a short window, then lapses', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-11-11T12:00:00Z'));
      usePwaUpdater();
      signalNewerFileSeen();
      signalNewerFileSeen();
      signalNewerFileSeen();
      expect(web.runUpdateCheck).toHaveBeenCalledTimes(1);
      expect(web.runUpdateCheck).toHaveBeenCalledWith({ trigger: 'newer-file' });
      // Inside the window a deferred check keeps its urgency on the next ask...
      vi.setSystemTime(new Date('2026-11-11T12:01:00Z'));
      await poll.callback!();
      expect(web.runUpdateCheck).toHaveBeenLastCalledWith({ trigger: 'newer-file' });
      // ...and a retry after the burst window gets its own immediate check.
      signalNewerFileSeen();
      expect(web.runUpdateCheck).toHaveBeenCalledTimes(3);
      // Past the window (no new sighting) a poll is routine again: the waiver must not
      // follow the person to a different screen.
      vi.setSystemTime(new Date('2026-11-11T12:04:00Z'));
      await poll.callback!();
      expect(web.runUpdateCheck).toHaveBeenLastCalledWith({ trigger: 'visible' });
      vi.useRealTimers();
    });

    it('the idle edge does not refetch right after a check that said current', async () => {
      web.runUpdateCheck.mockResolvedValue('current');
      usePwaUpdater();
      await poll.callback!();
      expect(web.runUpdateCheck).toHaveBeenCalledTimes(1);
      setPreAuthIdle(true);
      expect(web.runUpdateCheck).toHaveBeenCalledTimes(1);
      setPreAuthIdle(false);
    });

    it('re-checks the moment the login landing becomes idle, and stops when disposed', () => {
      usePwaUpdater();
      setPreAuthIdle(true);
      expect(web.runUpdateCheck).toHaveBeenCalledTimes(1);
      expect(web.runUpdateCheck).toHaveBeenCalledWith({ trigger: 'nav' });
      setPreAuthIdle(false);
      __resetPwaUpdaterForTesting();
      setPreAuthIdle(true);
      expect(web.runUpdateCheck).toHaveBeenCalledTimes(1);
      setPreAuthIdle(false);
    });

    it('the newer-file handler is cleared when the scope is disposed', () => {
      usePwaUpdater();
      __resetPwaUpdaterForTesting();
      signalNewerFileSeen();
      expect(web.runUpdateCheck).not.toHaveBeenCalled();
    });

    it('exposes the SW path to the runner: applying flag + apply-if-quiet', async () => {
      usePwaUpdater();
      expect(web.hooks!.isApplying()).toBe(false);
      expect(web.hooks!.applyWaitingIfQuiet()).toBe(false); // nothing waiting

      hasOpenOverlays.mockReturnValue(true);
      needRefresh.value = true;
      await nextTick();
      expect(web.hooks!.applyWaitingIfQuiet()).toBe(false); // waiting, not quiet

      hasOpenOverlays.mockReturnValue(false);
      expect(web.hooks!.applyWaitingIfQuiet()).toBe(true);
      expect(web.hooks!.isApplying()).toBe(true);
      await Promise.resolve();
      expect(updateServiceWorker).toHaveBeenCalledTimes(1);
    });
  });

  describe('reconciling a forced reload at init', () => {
    it('logs applied via=forced and removes the record when this build is the target', () => {
      sessionStorage.setItem(
        FORCED_RECORD_KEY,
        JSON.stringify({ from: 'old1111aaaa', to: 'new2222bbbb' })
      );
      usePwaUpdater();
      expect(logged('applied')).toMatchObject({ detail: 'via=forced,from=old1111', once: false });
      expect(sessionStorage.getItem(FORCED_RECORD_KEY)).toBeNull();
    });

    it('logs force-failed and KEEPS the record when the build is still the old one', () => {
      sessionStorage.setItem(
        FORCED_RECORD_KEY,
        JSON.stringify({ from: 'new2222bbbb', to: 'newer333cccc' })
      );
      usePwaUpdater();
      expect(logged('force-failed')).toMatchObject({
        detail: 'to=newer33,from=new2222',
        once: false,
      });
      expect(sessionStorage.getItem(FORCED_RECORD_KEY)).not.toBeNull();
    });

    it('logs nothing without a record', () => {
      usePwaUpdater();
      expect(loggedActions()).not.toContain('applied');
      expect(loggedActions()).not.toContain('force-failed');
    });
  });
});
