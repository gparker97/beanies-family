import { setActivePinia, createPinia } from 'pinia';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useSyncStore } from '../syncStore';
import * as syncService from '@/services/sync/syncService';
import type { GlobalSettings } from '@/types/models';

/**
 * Requirement 16 (plan 2026-11-15): the 10 s Drive poll runs only while the document
 * is visible, and probes at once whenever a tab becomes visible. A hidden tab used to
 * poll (and download) on its own every ten seconds, for every tab and window open.
 *
 * A "probe" is one `syncService.remoteChanged()` call, which is the poll's metadata
 * request. Visibility is driven the way the browser drives it: `visibilityState` plus
 * a `visibilitychange` event, which `useToday` (the app's one visibility sink) hears.
 */

const mockGlobalSettings: GlobalSettings = {
  id: 'global_settings',
  theme: 'system',
  language: 'en',
  lastActiveFamilyId: null,
  exchangeRates: [],
  exchangeRateAutoUpdate: true,
  exchangeRateLastFetch: null,
  isTrustedDevice: false,
  trustedDevicePromptShown: false,
};

vi.mock('@/services/indexeddb/repositories/globalSettingsRepository', () => ({
  getDefaultGlobalSettings: () => ({ ...mockGlobalSettings }),
  getGlobalSettings: vi.fn(async () => ({ ...mockGlobalSettings })),
  saveGlobalSettings: vi.fn(async () => ({ ...mockGlobalSettings })),
  setGlobalTheme: vi.fn(),
  setGlobalLanguage: vi.fn(),
  setLastActiveFamilyId: vi.fn(),
  updateGlobalExchangeRates: vi.fn(),
}));
vi.mock('@/services/automerge/repositories/settingsRepository', () => ({
  getDefaultSettings: () => ({ id: 'app_settings', baseCurrency: 'USD', aiApiKeys: {} }),
  getSettings: vi.fn(async () => ({ id: 'app_settings', baseCurrency: 'USD', aiApiKeys: {} })),
  saveSettings: vi.fn(),
}));
vi.mock('@/stores/familyContextStore', () => ({
  useFamilyContextStore: () => ({ activeFamilyId: 'family-123', activeFamilyName: 'Test Family' }),
}));
vi.mock('@/services/indexeddb/database', () => ({
  getActiveFamilyId: vi.fn(() => 'family-123'),
  getDatabase: vi.fn(async () => ({})),
  closeDatabase: vi.fn(async () => {}),
}));
vi.mock('@/services/registry/registryService', () => ({
  addRegistryEntryObserver: () => () => {},
  registerFamily: vi.fn(async () => {}),
  registerFamilyOrThrow: vi.fn(async () => {}),
  removeFamily: vi.fn(async () => {}),
  lookupFamily: vi.fn(async () => null),
}));
vi.mock('@/services/sync/capabilities', () => ({
  getSyncCapabilities: () => ({ hasFileSystemAccess: true }),
  canAutoSync: () => true,
  supportsFileSystemAccess: () => true,
  isNative: () => false,
}));
vi.mock('@/services/automerge/worker/docClient');
vi.mock('@/services/sync/syncService');

const POLL_MS = 10_000;

let visibility: DocumentVisibilityState = 'visible';
function setVisible(visible: boolean): void {
  visibility = visible ? 'visible' : 'hidden';
  document.dispatchEvent(new Event('visibilitychange'));
}

const probes = () => vi.mocked(syncService.remoteChanged).mock.calls.length;

/** Let the poll callback's awaits settle without moving the clock. */
const settle = () => vi.advanceTimersByTimeAsync(0);

describe('syncStore Drive poll: visible tabs only (requirement 16)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => visibility,
    });
    setVisible(true);
    setActivePinia(createPinia());
    vi.clearAllMocks();
    // `unchanged`: these tests count probes, not reloads.
    vi.mocked(syncService.remoteChanged).mockResolvedValue({
      status: 'unchanged',
      basis: 'content',
      revision: 'ver:1',
      modifiedTime: null,
      contentId: 'md5:a',
      adoptRevision: null,
      drift: 0,
    });
  });

  afterEach(() => {
    useSyncStore().pauseFilePolling();
    vi.useRealTimers();
  });

  function startPolling() {
    const store = useSyncStore();
    store.isConfigured = true;
    store.setupAutoSync();
    return store;
  }

  it('probes once at start, then every 10 s while visible (the interval is unchanged)', async () => {
    startPolling();
    await settle();
    expect(probes()).toBe(1); // the immediate probe on creation

    await vi.advanceTimersByTimeAsync(POLL_MS - 1);
    expect(probes()).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(probes()).toBe(2);
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(probes()).toBe(3);
  });

  it('a hidden document issues no probe, however long it stays hidden', async () => {
    startPolling();
    await settle();
    const before = probes();

    setVisible(false);
    await vi.advanceTimersByTimeAsync(POLL_MS * 30);
    expect(probes()).toBe(before);
  });

  it('a poller started while hidden does not probe until the tab is visible', async () => {
    setVisible(false);
    startPolling();
    await vi.advanceTimersByTimeAsync(POLL_MS * 3);
    expect(probes()).toBe(0);

    setVisible(true);
    await settle();
    expect(probes()).toBe(1);
  });

  it('becoming visible probes AT ONCE, every time (not only after a long absence)', async () => {
    startPolling();
    await settle();

    for (let i = 0; i < 3; i++) {
      setVisible(false);
      await vi.advanceTimersByTimeAsync(1_000); // a short absence
      const before = probes();
      setVisible(true);
      await settle(); // no clock movement: the probe is not waiting for a tick
      expect(probes()).toBe(before + 1);
    }
  });

  it.each<[string, (store: ReturnType<typeof useSyncStore>) => void]>([
    ['pauseFilePolling', (store) => store.pauseFilePolling()],
    ['resetState', (store) => store.resetState()],
  ])('%s really stops it: no tick, and no probe on becoming visible', async (_label, stop) => {
    const store = startPolling();
    await settle();
    const before = probes();

    stop(store);
    await vi.advanceTimersByTimeAsync(POLL_MS * 5);
    setVisible(false);
    setVisible(true);
    await settle();
    expect(probes()).toBe(before);
  });

  it('a restart after a stop runs one poller, not two', async () => {
    const store = startPolling();
    await settle();
    store.pauseFilePolling();
    store.resumeFilePolling();
    store.resumeFilePolling(); // a second resume is a no-op while one runs
    await settle();
    const before = probes();

    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(probes()).toBe(before + 1);
  });
});
