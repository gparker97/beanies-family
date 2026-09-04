/**
 * The payload-failure classification has to SURVIVE the trip out of the store.
 *
 * Every consumer branches on the class — the boot path dead-ends only for
 * too-large, the resume flow picks its copy from it, the background poller
 * stops for it — and each of those decisions guards against permanent loss of
 * un-synced increments. Yet the whole chain went in with no test at all, and
 * three of its behaviours flipped twice across two commits.
 *
 * `grep -rln payloadError src/` returned 7 source files and 0 test files before
 * this one existed: re-flattening any of them was CI-green.
 */
import { setActivePinia, createPinia } from 'pinia';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PayloadTooLargeError, CorruptPayloadError } from '@/types/sync';
import type { GlobalSettings } from '@/types/models';

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
let savedGlobalSettings = { ...mockGlobalSettings };

vi.mock('@/services/indexeddb/repositories/globalSettingsRepository', () => ({
  getDefaultGlobalSettings: () => ({ ...mockGlobalSettings }),
  getGlobalSettings: vi.fn(async () => ({ ...savedGlobalSettings })),
  saveGlobalSettings: vi.fn(async (partial: Partial<GlobalSettings>) => {
    savedGlobalSettings = { ...savedGlobalSettings, ...partial, id: 'global_settings' };
    return { ...savedGlobalSettings };
  }),
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
  registerFamily: vi.fn(async () => {}),
  registerFamilyOrThrow: vi.fn(async () => {}),
  removeFamily: vi.fn(async () => {}),
  lookupFamily: vi.fn(async () => null),
}));

vi.mock('@/services/sync/capabilities', () => ({
  getSyncCapabilities: () => ({ hasFileSystemAccess: true }),
  canAutoSync: () => true,
  supportsFileSystemAccess: () => true,
  // loadFromFile now awaits whenRedirectAuthSettled() → ensureRedirectAuthSettled(),
  // which reads isNative(); web (false) → no pending code → immediate no-op.
  isNative: () => false,
}));

vi.mock('@/services/sync/fileSync', () => ({
  exportToFile: vi.fn(async () => {}),
  importFromFile: vi.fn(async () => ({ success: true })),
}));

// Auto-mock: the real module spawns a Web Worker, and the store touches far
// more of its surface than this suite cares about. Only the one call under
// test is given a behaviour.
vi.mock('@/services/automerge/worker/docClient');

import * as docClient from '@/services/automerge/worker/docClient';
import { useSyncStore } from '../syncStore';

const tooLarge = () => new PayloadTooLargeError('oom', 'materialize', 'family-123', 3_000_000);
const corrupt = () => new CorruptPayloadError('bad bytes', 'load', 'family-123', 3_000_000);

/**
 * A REAL 32-byte AES key, base64. A short string would make `importFamilyKey`
 * throw before `initAndLoadCache` is ever called, and every assertion below
 * would then pass or fail for the wrong reason.
 */
const KEY_B64 = btoa(String.fromCharCode(...new Uint8Array(32).fill(7)));

describe('payload failures propagate instead of flattening', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    savedGlobalSettings = { ...mockGlobalSettings };
    vi.mocked(docClient.loadProjectionSnapshot).mockResolvedValue({ hit: false });
  });

  it('loadFromPersistenceCache returns the ERROR, not a bare {success:false}', async () => {
    // Flattened, App.vue's path 2 falls through to path 3, which calls
    // `initDoc()` — a fresh EMPTY doc — while the cache DB is still open on this
    // family (the too-large branch deliberately does not clear it). The next
    // mutation then writes that empty doc as the BASE and deletes every
    // preserved increment. This assertion is the only thing standing between
    // that and a green CI.
    vi.mocked(docClient.initAndLoadCache).mockRejectedValue(tooLarge());

    const r = await useSyncStore().loadFromPersistenceCache(KEY_B64, 'family-123');

    expect(r.success).toBe(false);
    expect(r.payloadError).toBeInstanceOf(PayloadTooLargeError);
    expect(r.payloadError?.step).toBe('materialize');
  });

  it('carries a CORRUPT payload out too, so the boot path can tell them apart', async () => {
    // The two classes take opposite branches upstream: too-large dead-ends,
    // corrupt falls through to a Drive re-seed. Both have to arrive typed.
    vi.mocked(docClient.initAndLoadCache).mockRejectedValue(corrupt());

    const r = await useSyncStore().loadFromPersistenceCache(KEY_B64, 'family-123');

    expect(r.payloadError).toBeInstanceOf(CorruptPayloadError);
    expect(r.payloadError).not.toBeInstanceOf(PayloadTooLargeError);
  });

  it('leaves an ordinary cache failure as a plain {success:false}', async () => {
    // The classification must not widen: a transient IndexedDB error is not a
    // payload failure and must keep its existing fall-through behaviour.
    vi.mocked(docClient.initAndLoadCache).mockRejectedValue(new Error('IDB unavailable'));

    const r = await useSyncStore().loadFromPersistenceCache(KEY_B64, 'family-123');

    expect(r.success).toBe(false);
    expect(r.payloadError).toBeUndefined();
  });
});
