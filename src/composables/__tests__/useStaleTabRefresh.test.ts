import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ref, nextTick } from 'vue';

// Mock state — declared at module scope so vi.mock factory and test bodies
// can both reach the same refs/spies.
const todayRef = ref('2026-04-27');
const isVisibleRef = ref(true);
const lastVisibleAtRef = ref(Date.now());

const reloadAllStoresMock = vi.fn(async () => {});
const reloadIfFileChangedMock = vi.fn(async () => {});
const pauseFilePollingMock = vi.fn();
const resumeFilePollingMock = vi.fn();
const isSetupCompleteRef = ref(true);

const processRecurringItemsMock = vi.fn(async () => ({ processed: 0 }));
const updateRatesIfStaleMock = vi.fn(async () => {});
const attemptSilentReconnectMock = vi.fn(async () => {});
const showToastMock = vi.fn();
const tMock = vi.fn((key: string) => key);

vi.mock('@/composables/useToday', () => ({
  useToday: () => ({
    today: todayRef,
    isVisible: isVisibleRef,
    lastVisibleAt: lastVisibleAtRef,
    startOfToday: ref(new Date()),
    lastHiddenAt: ref(0),
  }),
}));

vi.mock('@/stores/familyStore', () => ({
  useFamilyStore: () => ({
    get isSetupComplete() {
      return isSetupCompleteRef.value;
    },
  }),
}));

vi.mock('@/stores/syncStore', () => ({
  useSyncStore: () => ({
    reloadAllStores: reloadAllStoresMock,
    reloadIfFileChanged: reloadIfFileChangedMock,
    pauseFilePolling: pauseFilePollingMock,
    resumeFilePolling: resumeFilePollingMock,
  }),
}));

vi.mock('@/services/recurring/recurringProcessor', () => ({
  processRecurringItems: processRecurringItemsMock,
}));

vi.mock('@/services/exchangeRate/exchangeRateService', () => ({
  updateRatesIfStale: updateRatesIfStaleMock,
}));

vi.mock('@/utils/silentReconnect', () => ({
  attemptSilentReconnect: attemptSilentReconnectMock,
}));

vi.mock('@/composables/useToast', () => ({
  showToast: showToastMock,
}));

vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: tMock }),
}));

let useStaleTabRefresh: typeof import('@/composables/useStaleTabRefresh').useStaleTabRefresh;
let __resetStaleTabRefreshForTesting: typeof import('@/composables/useStaleTabRefresh').__resetStaleTabRefreshForTesting;

async function flush() {
  // Allow watchers to fire and the awaited refresh chain to settle.
  // The chain has 5 awaited steps (reloadAllStores → processRecurringItems →
  // Promise.allSettled → reloadIfFileChanged → finally), so we need enough
  // microtask cycles to drain all of them.
  await nextTick();
  for (let i = 0; i < 10; i++) {
    await Promise.resolve();
  }
}

describe('useStaleTabRefresh', () => {
  beforeEach(async () => {
    // Tear down any leftover watcher scope BEFORE mutating shared refs —
    // otherwise a prior test's watchers fire on the reset mutations and
    // pollute the next test's call counts.
    const mod = await import('@/composables/useStaleTabRefresh');
    useStaleTabRefresh = mod.useStaleTabRefresh;
    __resetStaleTabRefreshForTesting = mod.__resetStaleTabRefreshForTesting;
    __resetStaleTabRefreshForTesting();

    vi.clearAllMocks();
    todayRef.value = '2026-04-27';
    isVisibleRef.value = true;
    lastVisibleAtRef.value = Date.now();
    isSetupCompleteRef.value = true;
    reloadAllStoresMock.mockImplementation(async () => {});
    processRecurringItemsMock.mockImplementation(async () => ({ processed: 0 }));
    updateRatesIfStaleMock.mockImplementation(async () => {});
    attemptSilentReconnectMock.mockImplementation(async () => {});
    reloadIfFileChangedMock.mockImplementation(async () => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does NOT fire run on initial subscribe (no immediate watcher)', async () => {
    useStaleTabRefresh();
    await flush();
    expect(reloadAllStoresMock).not.toHaveBeenCalled();
  });

  it('fires run("day-changed") when today ref changes', async () => {
    useStaleTabRefresh();
    todayRef.value = '2026-04-28';
    await flush();
    expect(reloadAllStoresMock).toHaveBeenCalledOnce();
    expect(processRecurringItemsMock).toHaveBeenCalledOnce();
    expect(updateRatesIfStaleMock).toHaveBeenCalledOnce();
    expect(attemptSilentReconnectMock).toHaveBeenCalledOnce();
    expect(reloadIfFileChangedMock).toHaveBeenCalledOnce();
  });

  it('fires run("long-absence") when isVisible flips true after >5 min absence', async () => {
    useStaleTabRefresh();
    // Simulate hidden for 6 minutes
    isVisibleRef.value = false;
    lastVisibleAtRef.value = Date.now() - 6 * 60 * 1000;
    await flush();
    isVisibleRef.value = true;
    await flush();
    expect(reloadAllStoresMock).toHaveBeenCalledOnce();
  });

  it('does NOT fire run on short absence (<5 min)', async () => {
    useStaleTabRefresh();
    isVisibleRef.value = false;
    lastVisibleAtRef.value = Date.now() - 60 * 1000; // 1 minute
    await flush();
    isVisibleRef.value = true;
    await flush();
    expect(reloadAllStoresMock).not.toHaveBeenCalled();
  });

  it('does NOT fire run when isVisible flips true→false', async () => {
    useStaleTabRefresh();
    isVisibleRef.value = false;
    await flush();
    expect(reloadAllStoresMock).not.toHaveBeenCalled();
  });

  it('does NOT fire run when familyStore.isSetupComplete is false', async () => {
    isSetupCompleteRef.value = false;
    useStaleTabRefresh();
    todayRef.value = '2026-04-28';
    await flush();
    expect(reloadAllStoresMock).not.toHaveBeenCalled();
  });

  it('isRefreshing guard blocks concurrent triggers', async () => {
    let resolveReload: () => void;
    reloadAllStoresMock.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveReload = resolve;
        })
    );
    useStaleTabRefresh();
    todayRef.value = '2026-04-28'; // first trigger
    await flush();
    // first run is in flight (awaiting reloadAllStores)
    todayRef.value = '2026-04-29'; // second trigger should be blocked
    await flush();
    expect(reloadAllStoresMock).toHaveBeenCalledTimes(1);
    resolveReload!();
    await flush();
  });

  it('on critical step failure: toasts user, skips downstream, finally resumes polling', async () => {
    reloadAllStoresMock.mockRejectedValueOnce(new Error('decryption failed'));
    useStaleTabRefresh();
    todayRef.value = '2026-04-28';
    await flush();
    expect(showToastMock).toHaveBeenCalledWith(
      'error',
      'error.backgroundRefreshFailed',
      'error.backgroundRefreshFailedHelp',
      expect.objectContaining({ surface: 'stale-tab-refresh' })
    );
    expect(processRecurringItemsMock).not.toHaveBeenCalled();
    expect(updateRatesIfStaleMock).not.toHaveBeenCalled();
    expect(reloadIfFileChangedMock).not.toHaveBeenCalled();
    expect(resumeFilePollingMock).toHaveBeenCalledOnce();
  });

  it('on processRecurringItems failure: logs warning, downstream still runs', async () => {
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    processRecurringItemsMock.mockRejectedValueOnce(new Error('automerge write failed'));
    useStaleTabRefresh();
    todayRef.value = '2026-04-28';
    await flush();
    expect(consoleWarn).toHaveBeenCalledWith(
      '[useStaleTabRefresh] processRecurringItems failed (day-changed)',
      expect.any(Error)
    );
    expect(updateRatesIfStaleMock).toHaveBeenCalledOnce();
    expect(reloadIfFileChangedMock).toHaveBeenCalledOnce();
    expect(showToastMock).not.toHaveBeenCalled();
  });

  it('on updateRatesIfStale failure: logs warning, downstream continues', async () => {
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    updateRatesIfStaleMock.mockRejectedValueOnce(new Error('network'));
    useStaleTabRefresh();
    todayRef.value = '2026-04-28';
    await flush();
    expect(consoleWarn).toHaveBeenCalledWith(
      '[useStaleTabRefresh] updateRatesIfStale failed (day-changed)',
      expect.any(Error)
    );
    expect(reloadIfFileChangedMock).toHaveBeenCalledOnce();
    expect(showToastMock).not.toHaveBeenCalled();
  });

  it('on attemptSilentReconnect failure: logs warning, downstream continues', async () => {
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    attemptSilentReconnectMock.mockRejectedValueOnce(new Error('token revoked'));
    useStaleTabRefresh();
    todayRef.value = '2026-04-28';
    await flush();
    expect(consoleWarn).toHaveBeenCalledWith(
      '[useStaleTabRefresh] attemptSilentReconnect failed (day-changed)',
      expect.any(Error)
    );
    expect(reloadIfFileChangedMock).toHaveBeenCalledOnce();
    expect(showToastMock).not.toHaveBeenCalled();
  });

  it('on reloadIfFileChanged failure: logs warning, finally still resumes polling', async () => {
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    reloadIfFileChangedMock.mockRejectedValueOnce(new Error('drive 404'));
    useStaleTabRefresh();
    todayRef.value = '2026-04-28';
    await flush();
    expect(consoleWarn).toHaveBeenCalledWith(
      '[useStaleTabRefresh] reloadIfFileChanged failed (day-changed)',
      expect.any(Error)
    );
    expect(resumeFilePollingMock).toHaveBeenCalledOnce();
    expect(showToastMock).not.toHaveBeenCalled();
  });

  it('exposes isRefreshing readonly ref', () => {
    const { isRefreshing } = useStaleTabRefresh();
    expect(isRefreshing.value).toBe(false);
  });

  it('repeated useStaleTabRefresh() calls do not double-register watchers', async () => {
    useStaleTabRefresh();
    useStaleTabRefresh();
    useStaleTabRefresh();
    todayRef.value = '2026-04-28';
    await flush();
    expect(reloadAllStoresMock).toHaveBeenCalledTimes(1);
  });
});
