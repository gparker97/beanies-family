import { setActivePinia, createPinia } from 'pinia';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useSyncStore } from '../syncStore';
import * as syncService from '@/services/sync/syncService';
import * as docClient from '@/services/automerge/worker/docClient';
import type { GlobalSettings } from '@/types/models';

/**
 * Terminus 1 of the #61/#65 open-guard baseline: `loadFromFile` must commit the
 * heads DRIVE HOLDS so the NEXT open can skip its redundant read.
 *
 * Regression (2026-08-19, found in prod telemetry — PERFORMANCE.md §10). The
 * replace branch discarded `remoteHeads` and committed `null`. Because every
 * cold-open call site calls `loadFromFile()` with no `merge` option, that branch
 * runs on EVERY cold open, and the commit is last-write-wins — so it also wiped
 * the good fingerprint `doSave` had recorded. Result: `baseline-heads-unknown`
 * on every open forever and zero skips in 44h of production R10 traffic.
 *
 * The bug is invisible to a test that only asserts "commitRemoteBaseline was
 * called" — it WAS called, with the wrong argument. These tests assert the
 * ARGUMENT, and the merging/replace branches are given DIFFERENT heads so a
 * branch mix-up cannot coincidentally pass (docs/lessons.md rule 4).
 */

const REPLACE_DRIVE_HEADS = ['drive-head-replace-aaa'];
const MERGE_DRIVE_HEADS = ['drive-head-merge-zzz'];

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

// `activeFamilyId` non-null is what selects the branch that carried the bug —
// with no famId the replace path takes its `dropDoc` + adopt sub-branch, which
// already committed heads correctly.
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
  isNative: () => false,
}));

const fakeEnvelope = { version: '4.0', familyId: 'family-123', encryptedPayload: 'x' };

vi.mock('@/services/sync/fileSync', async (importOriginal) => ({
  // The version DERIVATION is real even where the writers are mocked: a

  // test-local `'4.0'` here would hide the one regression the derivation

  // exists to prevent (a compacted pod written as 4.0).

  beanpodVersionFor: (await importOriginal<typeof import('@/services/sync/fileSync')>())
    .beanpodVersionFor,
  createBeanpodV4: vi.fn(),
  parseBeanpodV4: vi.fn(() => fakeEnvelope),
  tryUnwrapFamilyKey: vi.fn(),
  reEncryptEnvelope: vi.fn(),
  exportToFile: vi.fn(async () => {}),
  importFromFile: vi.fn(async () => ({ success: true })),
}));

vi.mock('@/services/sync/envelopeMerge', () => ({
  preserveLocalKeyDicts: vi.fn((remote: unknown) => remote),
  keyDictSize: vi.fn(() => 0),
  // Real behaviour, not a pass-through: `replaceEnvelope` strips the payload
  // from the long-lived envelope, and a stub that skipped it would hide a
  // regression in exactly the invariant this change introduces.
  withoutPayload: vi.fn((env: Record<string, unknown>) => ({ ...env, encryptedPayload: '' })),
}));

vi.mock('@/services/recurring/recurringProcessor', () => ({
  deduplicateRecurringTransactions: vi.fn(async () => 0),
}));

vi.mock('@/services/automerge/worker/docClient');
vi.mock('@/services/sync/syncService');

vi.mock('@/services/google/googleAuth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/google/googleAuth')>()),
  isTokenValid: vi.fn(() => true),
}));

describe('syncStore.loadFromFile — terminus 1 commits the DRIVE heads (#65)', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    savedGlobalSettings = { ...mockGlobalSettings };

    vi.mocked(syncService.load).mockResolvedValue('{"version":"4.0"}');
    vi.mocked(syncService.getProviderType).mockReturnValue('google_drive');
    vi.mocked(syncService.getState).mockReturnValue({
      isInitialized: true,
      isConfigured: true,
      fileName: 'my-family.beanpod',
      isSyncing: false,
      lastError: null,
    });

    vi.mocked(docClient.initAndLoadCache).mockResolvedValue({ loaded: true } as never);
    vi.mocked(docClient.dropDoc).mockResolvedValue(undefined as never);
  });

  function primeStore() {
    const store = useSyncStore();
    // A non-null key is what routes loadFromFile into the decrypt+merge block.
    store.familyKey = {} as CryptoKey;
    return store;
  }

  it('commits the remote heads on the REPLACE branch (the cold-open path)', async () => {
    // The replace branch: cache hit, then merge remote in. `dirty: true` on
    // purpose — a recovered cache DOES leave our doc ahead of Drive, and that is
    // exactly the state the old code cited to justify committing null. Being
    // ahead is #65's `unpushed-local-changes` to report; it must NOT erase what
    // we know Drive holds.
    vi.mocked(docClient.mergeRemoteEnvelope).mockResolvedValue({
      heads: ['our-doc-head-ahead'],
      dirty: true,
      changed: true,
      remoteHeads: REPLACE_DRIVE_HEADS,
    } as never);

    await primeStore().loadFromFile(); // no `merge` option => the replace branch

    expect(syncService.commitRemoteBaseline).toHaveBeenCalledWith(REPLACE_DRIVE_HEADS);
    // The precise regression: it used to be called, just with null.
    expect(syncService.commitRemoteBaseline).not.toHaveBeenCalledWith(null);
  });

  it('commits the remote heads on the MERGE branch (unchanged behaviour)', async () => {
    vi.mocked(docClient.mergeRemoteEnvelope).mockResolvedValue({
      heads: ['our-doc-head'],
      dirty: false,
      changed: false,
      remoteHeads: MERGE_DRIVE_HEADS,
    } as never);

    await primeStore().loadFromFile({ merge: true });

    expect(syncService.commitRemoteBaseline).toHaveBeenCalledWith(MERGE_DRIVE_HEADS);
  });

  it('commits null when the worker cannot say what Drive holds', async () => {
    // The fail-safe direction is preserved: unknown => never skip. A partial
    // worker double omitting `remoteHeads` must degrade to a read, not throw and
    // not over-claim.
    vi.mocked(docClient.mergeRemoteEnvelope).mockResolvedValue({
      heads: ['our-doc-head'],
      dirty: false,
      changed: false,
    } as never);

    await primeStore().loadFromFile();

    expect(syncService.commitRemoteBaseline).toHaveBeenCalledWith(null);
  });

  it('never commits our own doc heads as the Drive baseline', async () => {
    // The false-skip this whole design exists to prevent: `heads` (our doc, which
    // migrateDoc may have moved past Drive) must never reach the baseline.
    vi.mocked(docClient.mergeRemoteEnvelope).mockResolvedValue({
      heads: ['our-doc-head-MIGRATED'],
      dirty: true,
      changed: true,
      remoteHeads: REPLACE_DRIVE_HEADS,
    } as never);

    await primeStore().loadFromFile();

    expect(syncService.commitRemoteBaseline).not.toHaveBeenCalledWith(['our-doc-head-MIGRATED']);
  });
});
