import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ref, nextTick } from 'vue';

// --- mocks (declared before importing the SUT) ---
const needRefresh = ref(false);
const updateServiceWorker = vi.fn(async () => {});
vi.mock('virtual:pwa-register/vue', () => ({
  useRegisterSW: (opts: { onRegisteredSW?: (u: string, r: unknown) => void }) => {
    // simulate registration so the poll callback would have a registration
    opts.onRegisteredSW?.('/sw.js', {} as ServiceWorkerRegistration);
    return { needRefresh, updateServiceWorker };
  },
}));

let capturedGuard:
  | ((to: { fullPath: string }, from: unknown, next: (v?: unknown) => void) => void)
  | undefined;
const beforeEach_ = vi.fn((fn: typeof capturedGuard) => {
  capturedGuard = fn;
  return () => {}; // remove handle
});
vi.mock('@/router', () => ({
  default: {
    beforeEach: (fn: typeof capturedGuard) => beforeEach_(fn),
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
vi.mock('@/composables/usePollWhileVisible', () => ({
  usePollWhileVisible: vi.fn(() => ({ stop: vi.fn() })),
}));
vi.mock('@/utils/safeServiceWorkerUpdate', () => ({ safeServiceWorkerUpdate: vi.fn() }));
vi.mock('@/utils/hardReload', () => ({ hardReload: vi.fn() }));

import {
  usePwaUpdater,
  __resetPwaUpdaterForTesting,
  PWA_POST_UPDATE_ROUTE_KEY,
} from '../usePwaUpdater';

describe('usePwaUpdater', () => {
  beforeEach(() => {
    __resetPwaUpdaterForTesting();
    needRefresh.value = false;
    isSyncing.value = false;
    hasOpenOverlays.mockReturnValue(false);
    updateServiceWorker.mockClear();
    beforeEach_.mockClear();
    capturedGuard = undefined;
    sessionStorage.clear();
    // The success path schedules a backstop reload via setTimeout; stub reload
    // so it can never navigate the test environment.
    vi.spyOn(window.location, 'reload').mockImplementation(() => {});
  });

  afterEach(() => {
    __resetPwaUpdaterForTesting();
    vi.restoreAllMocks();
  });

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
});
