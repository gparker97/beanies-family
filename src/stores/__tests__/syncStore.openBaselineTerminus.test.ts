import { setActivePinia, createPinia } from 'pinia';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { nextTick } from 'vue';
import { useSyncStore } from '../syncStore';
import * as syncService from '@/services/sync/syncService';
import * as docClient from '@/services/automerge/worker/docClient';
import type { FamilyMember, GlobalSettings, RegistryEntry } from '@/types/models';
import { features } from '@/config/features';
import * as registryService from '@/services/registry/registryService';
import { useFamilyStore } from '../familyStore';
import { useAuthStore } from '../authStore';

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

// The registry owner-sync observers syncStore installs, so the owner-sync wiring tests below can
// serve a registry GET to them.
const registryObservers = vi.hoisted(() => new Set<(e: RegistryEntry) => void>());

vi.mock('@/services/registry/registryService', () => ({
  addRegistryEntryObserver: (fn: (e: RegistryEntry) => void) => {
    registryObservers.add(fn);
    return () => registryObservers.delete(fn);
  },
  registerFamily: vi.fn(async () => {}),
  registerFamilyOrThrow: vi.fn(async () => {}),
  removeFamily: vi.fn(async () => {}),
  lookupFamily: vi.fn(async () => null),
}));

// The registry owner-sync wiring is gated on `features.registry` (env-derived; CI has no .env).
vi.mock('@/config/features', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/config/features')>();
  return { ...mod, features: { ...mod.features, registry: true } };
});
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

vi.mock('@/services/sync/envelopeMerge', async (importOriginal) => ({
  // Pure helpers the store reads but these tests do not stub (the registry, the
  // family-identity check, the monotonic stamp) come from the real module.
  ...(await importOriginal<typeof import('@/services/sync/envelopeMerge')>()),
  preserveLocalKeyDicts: vi.fn((remote: unknown) => remote),
  keyDictSize: vi.fn(() => 0),
  mergeEnvelopes: vi.fn((remote: unknown) => ({
    envelope: remote,
    needsPublish: false,
    filtered: 0,
  })),
  applyRevokedKeys: vi.fn((env: unknown) => ({ envelope: env, filtered: 0 })),
  mergeRevokedKeys: vi.fn((a: unknown, b: unknown) => ({ ...(a ?? {}), ...(b ?? {}) })),
  revocationTombstonesForMember: vi.fn(() => ({ tombstones: {}, unattributedPasskeys: 0 })),
  revocationKey: vi.fn((field: string, key: string) => `${field}:${key}`),
  slotTombstoneEntryKey: vi.fn(() => null),
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
      saveQueued: false,
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

/**
 * Registry owner sync, wired into the store (plan 2026-10-06-registry-owner-sync, Testing Plan
 * item 2). This file's successful `loadFromFile` reaches `runPostLoadDriveHousekeeping`, the
 * terminus that marks the authoritative load, so it is the cheapest place to prove the hooks:
 * the observer, the owner watcher, the transfer hook and the `ownerSync` payload. The decisions
 * themselves are tested with fakes in `registryOwnerSync.test.ts`.
 */
describe('syncStore — registry owner sync wiring', () => {
  const OWNER_ID = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';

  function member(over: Partial<FamilyMember>): FamilyMember {
    return {
      id: OWNER_ID,
      name: 'Greg',
      email: 'greg@example.com',
      role: 'owner',
      gender: 'male',
      ageGroup: 'adult',
      color: '#000000',
      createdAt: '2026-10-06',
      updatedAt: '2026-10-06',
      ...over,
    } as FamilyMember;
  }

  function serve(ownerMemberId: string | null, ownerEmail: string | null, familyId = 'family-123') {
    const entry = {
      familyId,
      provider: 'google_drive',
      ownerMemberId,
      ownerEmail,
      updatedAt: '2026-10-06',
    } as RegistryEntry;
    for (const o of [...registryObservers]) o(entry);
  }

  /** The payloads of every owner-sync PUT so far. */
  function ownerSyncWrites() {
    return vi
      .mocked(registryService.registerFamily)
      .mock.calls.map(([, payload]) => payload)
      .filter((p) => p.ownerSync === true);
  }

  async function flush() {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  }

  beforeEach(() => {
    registryObservers.clear();
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
      saveQueued: false,
    });
    vi.mocked(docClient.initAndLoadCache).mockResolvedValue({ loaded: true } as never);
    vi.mocked(docClient.dropDoc).mockResolvedValue(undefined as never);
    vi.mocked(docClient.mergeRemoteEnvelope).mockResolvedValue({
      heads: ['h'],
      dirty: false,
      changed: false,
      remoteHeads: ['h'],
    } as never);
    vi.mocked(registryService.registerFamily).mockResolvedValue({
      pointerAccepted: true,
      owner: { memberId: OWNER_ID, email: 'greg@example.com' },
    });
    vi.mocked(syncService.save).mockResolvedValue(true);
  });

  /** The registered owner, signed in on this device, with this roster email. */
  function ownerDevice(rosterEmail = 'greg@example.com') {
    const store = useSyncStore();
    store.familyKey = {} as CryptoKey;
    useAuthStore().currentUser = {
      memberId: OWNER_ID,
      email: rosterEmail,
    } as ReturnType<typeof useAuthStore>['currentUser'];
    useFamilyStore().members = [member({ email: rosterEmail })];
    return store;
  }

  /**
   * `loadFromFile` reloads every store from the (mocked, empty) document, so the roster is put
   * back afterwards, as the real reload would have produced it.
   */
  async function load(store: ReturnType<typeof useSyncStore>, rosterEmail = 'greg@example.com') {
    await store.loadFromFile();
    useFamilyStore().members = [member({ email: rosterEmail })];
    await nextTick();
    await flush();
  }

  it('does not sync before the authoritative load, then syncs once it completes', async () => {
    const store = ownerDevice();
    serve(OWNER_ID, 'old@example.com');
    await flush();
    expect(ownerSyncWrites()).toHaveLength(0);

    await load(store);

    const writes = ownerSyncWrites();
    expect(writes).toHaveLength(1);
    expect(writes[0]!.ownerMemberId).toBe(OWNER_ID);
    expect(writes[0]!.ownerEmail).toBe('greg@example.com');
    expect(writes[0]!.writerMemberId).toBe(OWNER_ID);
    expect(writes[0]!.ownerSyncReason).toBe('drift');
    expect(syncService.save).not.toHaveBeenCalled(); // an email sync never saves
  });

  it('ambient writes never carry ownerSync', async () => {
    const store = ownerDevice();
    store.ensureRegistered(true);
    const [, payload] = vi.mocked(registryService.registerFamily).mock.calls.at(-1)!;
    expect(payload.ownerSync).toBe(false);
  });

  it('sends a placeholder owner email as null', async () => {
    const store = ownerDevice('1717171717@temp.beanies.family');
    store.ensureRegistered();
    const [, payload] = vi.mocked(registryService.registerFamily).mock.calls.at(-1)!;
    expect(payload.ownerEmail).toBeNull();
  });

  it('the roster watcher fires on an owner email edit; an unchanged owner writes nothing', async () => {
    const store = ownerDevice();
    await load(store);
    serve(OWNER_ID, 'greg@example.com'); // in sync
    await flush();
    expect(ownerSyncWrites()).toHaveLength(0);

    // A new members array with the same owner: the primitive key is unchanged.
    useFamilyStore().members = [member({}), member({ id: 'kid', role: 'member', email: '' })];
    await nextTick();
    await flush();
    expect(ownerSyncWrites()).toHaveLength(0);

    useFamilyStore().members = [member({ email: 'greg.new@example.com' })];
    await nextTick();
    await flush();
    expect(ownerSyncWrites()).toHaveLength(1);
    expect(ownerSyncWrites()[0]!.ownerEmail).toBe('greg.new@example.com');
  });

  it('a two-owner roster never triggers an owner sync', async () => {
    const store = ownerDevice();
    await load(store);
    useFamilyStore().members = [
      member({ email: 'greg.new@example.com' }),
      member({ id: 'jill', email: 'jill@example.com' }),
    ];
    serve(OWNER_ID, 'old@example.com');
    await nextTick();
    await flush();
    expect(ownerSyncWrites()).toHaveLength(0);
  });

  it('resetState forgets the authoritative load', async () => {
    const store = ownerDevice();
    await load(store);
    store.resetState();
    serve(OWNER_ID, 'old@example.com');
    await flush();
    expect(ownerSyncWrites()).toHaveLength(0);
  });

  it('an ownerSync write sends no newsletter opt-in; an ambient write still does', async () => {
    const store = ownerDevice();
    useAuthStore().newsletterOptIn = true;
    store.ensureRegistered(true);
    const [, ambient] = vi.mocked(registryService.registerFamily).mock.calls.at(-1)!;
    expect(ambient.subscribeNewsletter).toBe(true);

    await load(store);
    serve(OWNER_ID, 'old@example.com');
    await flush();
    expect(ownerSyncWrites()).toHaveLength(1);
    expect(ownerSyncWrites()[0]!.subscribeNewsletter).toBeNull();
  });

  it('an ambient write in a two-owner state still names the first owner, as before owner sync', async () => {
    const store = ownerDevice();
    useFamilyStore().members = [
      member({}),
      member({ id: 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb', email: 'jill@example.com' }),
    ];
    store.ensureRegistered();
    const [, payload] = vi.mocked(registryService.registerFamily).mock.calls.at(-1)!;
    expect(payload.ownerMemberId).toBe(OWNER_ID);
    expect(payload.ownerEmail).toBe('greg@example.com');
    expect(payload).not.toHaveProperty('ownerSyncReason', expect.anything());
  });

  describe('a transfer made on this device (marker, save, then reason transfer)', () => {
    const JILL_ID = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';
    const markerKey = 'beanies.ownerTransferPending.family-123';

    beforeEach(() => localStorage.removeItem(markerKey));

    /** Greg (writer, registered owner) with Jill as a joined member, loaded and in sync. */
    async function loadedOwnerWithJill() {
      const store = ownerDevice();
      await store.loadFromFile();
      useFamilyStore().members = [
        member({}),
        member({ id: JILL_ID, name: 'Jill', email: 'jill@example.com', role: 'member' }),
      ];
      serve(OWNER_ID, 'greg@example.com'); // in sync
      await nextTick();
      await flush();
      vi.mocked(registryService.registerFamily).mockClear();
      vi.mocked(syncService.save).mockClear();
      vi.mocked(registryService.registerFamily).mockResolvedValue({
        pointerAccepted: true,
        owner: { memberId: JILL_ID, email: 'jill@example.com' },
        outcome: 'handover',
      });
      return store;
    }

    it('stores the marker, saves, then writes reason transfer and clears the marker', async () => {
      await loadedOwnerWithJill();
      let markerAtWrite: string | null = null;
      vi.mocked(registryService.registerFamily).mockImplementation(async () => {
        markerAtWrite = localStorage.getItem(markerKey);
        return {
          pointerAccepted: true,
          owner: { memberId: JILL_ID, email: 'jill@example.com' },
          outcome: 'handover',
        };
      });

      expect(await useFamilyStore().transferOwnership(JILL_ID)).toBe(true);
      await vi.waitFor(() => expect(ownerSyncWrites()).toHaveLength(1));
      await flush();

      expect(markerAtWrite).toBe(JSON.stringify(JILL_ID));
      const write = ownerSyncWrites()[0]!;
      expect(write.ownerSyncReason).toBe('transfer');
      expect(write.ownerMemberId).toBe(JILL_ID);
      expect(write.writerMemberId).toBe(OWNER_ID);
      const saveOrder = vi.mocked(syncService.save).mock.invocationCallOrder[0]!;
      const writeOrder = vi.mocked(registryService.registerFamily).mock.invocationCallOrder.at(-1)!;
      expect(saveOrder).toBeLessThan(writeOrder);
      expect(localStorage.getItem(markerKey)).toBeNull();
    });

    it('a failed mutate stores no marker and writes nothing', async () => {
      await loadedOwnerWithJill();
      vi.mocked(docClient.mutate).mockRejectedValueOnce(new Error('worker down'));

      expect(await useFamilyStore().transferOwnership(JILL_ID)).toBe(false);
      for (let i = 0; i < 4; i++) await flush();

      expect(localStorage.getItem(markerKey)).toBeNull();
      expect(ownerSyncWrites()).toHaveLength(0);
    });

    it('a failed save keeps the marker and writes nothing', async () => {
      await loadedOwnerWithJill();
      vi.mocked(syncService.save).mockResolvedValue(false);

      await useFamilyStore().transferOwnership(JILL_ID);
      await vi.waitFor(() => expect(syncService.save).toHaveBeenCalled());
      await flush();

      expect(ownerSyncWrites()).toHaveLength(0);
      expect(localStorage.getItem(markerKey)).toBe(JSON.stringify(JILL_ID));
    });

    it('with the registry feature off: no marker, no save, no PUT', async () => {
      await loadedOwnerWithJill();
      (features as { registry: boolean }).registry = false;
      try {
        expect(await useFamilyStore().transferOwnership(JILL_ID)).toBe(true);
        for (let i = 0; i < 4; i++) await flush();
        expect(syncService.save).not.toHaveBeenCalled();
        expect(ownerSyncWrites()).toHaveLength(0);
        expect(localStorage.getItem(markerKey)).toBeNull();
      } finally {
        (features as { registry: boolean }).registry = true;
      }
    });
  });

  it('a late sign-in re-runs the check (the watcher source includes the signed-in member)', async () => {
    const store = ownerDevice();
    useAuthStore().currentUser = null;
    await load(store);
    serve(OWNER_ID, 'old@example.com'); // drift, but nobody is signed in to fix it
    await flush();
    expect(ownerSyncWrites()).toHaveLength(0);

    useAuthStore().currentUser = {
      memberId: OWNER_ID,
      email: 'greg@example.com',
    } as ReturnType<typeof useAuthStore>['currentUser'];
    await nextTick();
    await flush();
    expect(ownerSyncWrites()).toHaveLength(1);
  });

  it('marks the authoritative load at the END of the open housekeeping', async () => {
    const store = ownerDevice();
    const markPodCreated = vi.spyOn(useAuthStore(), 'markPodCreated');
    serve(OWNER_ID, 'old@example.com'); // drift is waiting for the load
    await load(store);
    expect(ownerSyncWrites()).toHaveLength(1);
    const writeOrder = vi.mocked(registryService.registerFamily).mock.invocationCallOrder.at(-1)!;
    expect(markPodCreated.mock.invocationCallOrder[0]!).toBeLessThan(writeOrder);
  });

  it('logs the outcome on the registry surface with allowlisted keys only', async () => {
    const telemetry = await import('@/services/telemetry/logEvent');
    const spy = vi.spyOn(telemetry, 'logEvent');
    vi.mocked(registryService.registerFamily).mockResolvedValue({
      pointerAccepted: true,
      owner: { memberId: OWNER_ID, email: 'greg@example.com' },
      outcome: 'email-synced',
    });
    const store = ownerDevice();
    await load(store);
    serve(OWNER_ID, 'old@example.com');
    await flush();
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'info',
        surface: 'registry',
        context: { action: 'owner-sync', detail: 'email-synced', kind: 'email-synced' },
      })
    );
  });
});
