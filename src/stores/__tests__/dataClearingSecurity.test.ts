import { setActivePinia, createPinia } from 'pinia';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { GlobalSettings } from '@/types/models';
import { saveNow } from '@/services/sync/syncService';
import * as docClient from '@/services/automerge/worker/docClient';

// ---------------------------------------------------------------------------
// Mocks — must be declared before importing stores
// ---------------------------------------------------------------------------

// Global settings repository: track saved state in closure
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

// Trusted auto-open service (Phase 4): the wrapped replacement for the plaintext
// `cachedFamilyKeys` store. Mocked as an in-memory Map at the SERVICE boundary so
// these tests stay at the store-contract level: `cacheFamilyKey` must WRAP (store
// via the service), `getCachedFamilyKey` must read the wrapped store first, and the
// clear paths must empty it. The Map is deliberately VALUE-AGNOSTIC — it faithfully
// hands back exactly what the store put in (a CryptoKey or an exported-b64 string,
// whichever the store↔service contract uses), so the round-trip assertion pins the
// store's behavior, not the service's internal wire type.
const autoOpenState = vi.hoisted(() => ({ map: new Map<string, unknown>() }));

vi.mock('@/services/auth/trustedAutoOpen', () => ({
  saveTrustedAutoOpenKey: vi.fn(async (familyId: string, key: unknown) => {
    autoOpenState.map.set(familyId, key);
  }),
  loadTrustedAutoOpenKey: vi.fn(
    async (familyId: string) => autoOpenState.map.get(familyId) ?? null
  ),
  hasTrustedAutoOpenKey: vi.fn(async (familyId: string) => autoOpenState.map.has(familyId)),
  removeTrustedAutoOpenKey: vi.fn(async (familyId: string) => {
    autoOpenState.map.delete(familyId);
  }),
  clearAllTrustedAutoOpenKeys: vi.fn(async () => {
    autoOpenState.map.clear();
  }),
}));

vi.mock('@/services/automerge/repositories/settingsRepository', () => ({
  getDefaultSettings: () => ({
    id: 'app_settings',
    baseCurrency: 'USD',
    displayCurrency: 'USD',
    exchangeRates: [],
    theme: 'light',
    syncEnabled: false,
    aiProvider: 'none',
    aiApiKeys: {},
  }),
  getSettings: vi.fn(async () => ({
    id: 'app_settings',
    baseCurrency: 'USD',
    displayCurrency: 'USD',
    exchangeRates: [],
    theme: 'light',
    syncEnabled: false,
    aiProvider: 'none',
    aiApiKeys: {},
  })),
  saveSettings: vi.fn(),
  setBaseCurrency: vi.fn(),
  setDisplayCurrency: vi.fn(),
  setTheme: vi.fn(),
  setLanguage: vi.fn(),
  setSyncEnabled: vi.fn(),
  setAutoSyncEnabled: vi.fn(),
  setAIProvider: vi.fn(),
  setAIApiKey: vi.fn(),
  setExchangeRateAutoUpdate: vi.fn(),
  updateExchangeRates: vi.fn(),
  addExchangeRate: vi.fn(),
  removeExchangeRate: vi.fn(),
  setPreferredCurrencies: vi.fn(),
  addCustomInstitution: vi.fn(),
  removeCustomInstitution: vi.fn(),
  convertAmount: vi.fn(),
}));

// Database operations
const mockDeleteFamilyDatabase = vi.fn(async (_familyId?: string) => {});
const mockClearAllData = vi.fn(async () => {});
const mockGetActiveFamilyId = vi.fn(() => 'family-123');

vi.mock('@/services/indexeddb/database', () => ({
  deleteFamilyDatabase: (familyId?: string) => mockDeleteFamilyDatabase(familyId),
  clearAllData: () => mockClearAllData(),
  getActiveFamilyId: () => mockGetActiveFamilyId(),
  getDatabase: vi.fn(async () => ({})),
  initializeDatabase: vi.fn(async () => ({})),
}));

// Doc worker (ADR-032): mock the RPC surface so we can assert the cross-family
// in-memory teardown (`reset`) runs on sign-out — even on a trusted device where
// the cache DB is preserved. Mirrors the mock in syncStore.resume.test.ts.
vi.mock('@/services/automerge/worker/docClient', () => ({
  beginQuietTeardown: vi.fn(),
  setFamilyKey: vi.fn(async () => {}),
  setKey: vi.fn(async () => {}),
  initDoc: vi.fn(async () => ({ loaded: true })),
  initAndLoadCache: vi.fn(async () => ({ loaded: false })),
  openCache: vi.fn(async () => ({ loaded: false })),
  persistEnvelope: vi.fn(async () => {}),
  mergeRemoteEnvelope: vi.fn(async () => ({ dirty: false })),
  verifyEnvelope: vi.fn(async () => {}),
  exportEncryptedPayload: vi.fn(async () => ({ payload: 'base64==' })),
  dropDoc: vi.fn(async () => {}),
  reset: vi.fn(async () => {}),
  clearCache: vi.fn(async () => {}),
  setLocalChangeHandler: vi.fn(),
  setCachePersistFailedHandler: vi.fn(),
}));

// Sync service — uses shared auto-mock from __mocks__/syncService.ts
vi.mock('@/services/sync/syncService');

vi.mock('@/services/sync/capabilities', () => ({
  getSyncCapabilities: () => ({ hasFileSystemAccess: true }),
  canAutoSync: () => true,
}));

vi.mock('@/services/sync/fileSync', async (importOriginal) => ({
  // The version DERIVATION is real even where the writers are mocked: a

  // test-local `'4.0'` here would hide the one regression the derivation

  // exists to prevent (a compacted pod written as 4.0).

  beanpodVersionFor: (await importOriginal<typeof import('@/services/sync/fileSync')>())
    .beanpodVersionFor,
  exportToFile: vi.fn(async () => {}),
  importFromFile: vi.fn(async () => ({ success: true })),
}));

vi.mock('@/services/registry/registryService', () => ({
  registerFamily: vi.fn(async () => {}),
  removeFamily: vi.fn(async () => {}),
}));

vi.mock('@/services/indexeddb/registryDatabase', () => ({
  getRegistryDatabase: vi.fn(async () => ({
    getAll: vi.fn(async () => []),
    get: vi.fn(async () => null),
    put: vi.fn(async () => {}),
    add: vi.fn(async () => {}),
  })),
}));

vi.mock('@/services/automerge/repositories/familyMemberRepository', () => ({
  getAllMembers: vi.fn(async () => []),
  createMember: vi.fn(),
  updateMember: vi.fn(),
  deleteMember: vi.fn(),
}));

vi.mock('@/services/automerge/repositories/accountRepository', () => ({
  getAllAccounts: vi.fn(async () => []),
  createAccount: vi.fn(),
  updateAccount: vi.fn(),
  deleteAccount: vi.fn(),
}));

vi.mock('@/services/automerge/repositories/transactionRepository', () => ({
  getAllTransactions: vi.fn(async () => []),
  createTransaction: vi.fn(),
  updateTransaction: vi.fn(),
  deleteTransaction: vi.fn(),
}));

vi.mock('@/services/automerge/repositories/assetRepository', () => ({
  getAllAssets: vi.fn(async () => []),
  createAsset: vi.fn(),
  updateAsset: vi.fn(),
  deleteAsset: vi.fn(),
}));

vi.mock('@/services/automerge/repositories/goalRepository', () => ({
  getAllGoals: vi.fn(async () => []),
  createGoal: vi.fn(),
  updateGoal: vi.fn(),
  deleteGoal: vi.fn(),
}));

vi.mock('@/services/automerge/repositories/recurringItemRepository', () => ({
  getAllRecurringItems: vi.fn(async () => []),
  createRecurringItem: vi.fn(),
  updateRecurringItem: vi.fn(),
  deleteRecurringItem: vi.fn(),
}));

vi.mock('@/stores/familyContextStore', () => ({
  useFamilyContextStore: () => ({
    activeFamilyId: 'family-123',
    activeFamilyName: 'Test Family',
  }),
}));

// ---------------------------------------------------------------------------
// Store imports — after mocks
// ---------------------------------------------------------------------------

import { useAuthStore } from '../authStore';
import {
  SIGN_OUT_TRUSTED_STEPS,
  SIGN_OUT_UNTRUSTED_STEPS,
  SIGN_OUT_CLEAR_STEPS,
} from '@/services/auth/signOutSteps';
import { useSettingsStore } from '../settingsStore';
import { useSyncStore } from '../syncStore';
import { useFamilyStore } from '../familyStore';
import { useAccountsStore } from '../accountsStore';
import { useTransactionsStore } from '../transactionsStore';
import { useAssetsStore } from '../assetsStore';
import { useGoalsStore } from '../goalsStore';
import { useRecurringStore } from '../recurringStore';
import { useMemberFilterStore } from '../memberFilterStore';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Valid 32-byte AES key fixtures (base64). Phase 4's cacheFamilyKey imports the
 * exported key as a real CryptoKey before wrapping, so the fixture must be a
 * genuine key — an arbitrary string would fail the import, not the contract
 * under test. Round-tripping through getCachedFamilyKey re-exports the same bytes.
 */
const keyB64 = (fill: number): string =>
  btoa(String.fromCharCode(...new Uint8Array(32).fill(fill)));
const KEY_A = keyB64(1);
const KEY_B = keyB64(2);

/** Populate every store with realistic sensitive data */
function populateAllStores() {
  const auth = useAuthStore();
  const settings = useSettingsStore();
  const sync = useSyncStore();
  const family = useFamilyStore();
  const accounts = useAccountsStore();
  const transactions = useTransactionsStore();
  const assets = useAssetsStore();
  const goals = useGoalsStore();
  const recurring = useRecurringStore();
  const memberFilter = useMemberFilterStore();

  // Auth — PII + session
  auth.currentUser = {
    memberId: 'member-001',
    email: 'alice@example.com',
    familyId: 'family-123',
    role: 'owner',
  };
  auth.isAuthenticated = true;
  auth.freshSignIn = true;

  // Family — PII + credential hashes
  family.members = [
    {
      id: 'member-001',
      name: 'Alice Bean',
      email: 'alice@example.com',
      gender: 'female',
      ageGroup: 'adult',
      role: 'owner',
      color: '#3b82f6',
      passwordHash: '$argon2id$v=19$m=65536,t=3,p=4$abc123',
      requiresPassword: false,
      createdAt: '2026-01-01',
      updatedAt: '2026-02-01',
    },
    {
      id: 'member-002',
      name: 'Bob Bean',
      email: 'bob@example.com',
      gender: 'male',
      ageGroup: 'adult',
      role: 'member',
      color: '#ef4444',
      passwordHash: '$argon2id$v=19$m=65536,t=3,p=4$def456',
      requiresPassword: false,
      createdAt: '2026-01-02',
      updatedAt: '2026-02-02',
    },
  ] as any;
  family.currentMemberId = 'member-001';

  // Accounts — financial data
  accounts.accounts = [
    {
      id: 'acc-001',
      memberId: 'member-001',
      name: 'Main Checking',
      type: 'checking',
      currency: 'USD',
      balance: 15420.5,
      institution: 'First National Bank',
      isActive: true,
      includeInNetWorth: true,
      createdAt: '2026-01-01',
      updatedAt: '2026-02-01',
    },
    {
      id: 'acc-002',
      memberId: 'member-002',
      name: 'Savings Account',
      type: 'savings',
      currency: 'EUR',
      balance: 87300.0,
      institution: 'Deutsche Bank',
      isActive: true,
      includeInNetWorth: true,
      createdAt: '2026-01-05',
      updatedAt: '2026-02-05',
    },
  ] as any;

  // Transactions — financial data
  transactions.transactions = [
    {
      id: 'txn-001',
      accountId: 'acc-001',
      type: 'expense',
      amount: 250.0,
      currency: 'USD',
      category: 'groceries',
      date: '2026-02-20',
      description: 'Weekly groceries at Whole Foods',
      isReconciled: false,
      createdAt: '2026-02-20',
      updatedAt: '2026-02-20',
    },
    {
      id: 'txn-002',
      accountId: 'acc-001',
      type: 'income',
      amount: 5000.0,
      currency: 'USD',
      category: 'salary',
      date: '2026-02-15',
      description: 'Monthly salary from ACME Corp',
      isReconciled: true,
      createdAt: '2026-02-15',
      updatedAt: '2026-02-15',
    },
  ] as any;

  // Assets — financial data
  assets.assets = [
    {
      id: 'asset-001',
      memberId: 'member-001',
      type: 'real_estate',
      name: '123 Maple Street house',
      purchaseValue: 350000,
      currentValue: 425000,
      currency: 'USD',
      includeInNetWorth: true,
      createdAt: '2026-01-01',
      updatedAt: '2026-02-01',
    },
  ] as any;

  // Goals — financial data
  goals.goals = [
    {
      id: 'goal-001',
      memberId: null,
      name: 'Emergency Fund',
      type: 'savings',
      targetAmount: 30000,
      currentAmount: 12500,
      currency: 'USD',
      deadline: '2026-12-31',
      priority: 'high',
      isCompleted: false,
      createdAt: '2026-01-01',
      updatedAt: '2026-02-01',
    },
  ] as any;

  // Recurring — financial patterns
  recurring.recurringItems = [
    {
      id: 'rec-001',
      accountId: 'acc-001',
      type: 'expense',
      amount: 1500,
      currency: 'USD',
      category: 'housing',
      description: 'Monthly rent payment',
      frequency: 'monthly',
      startDate: '2026-01-01',
      isActive: true,
      createdAt: '2026-01-01',
      updatedAt: '2026-01-01',
    },
  ] as any;

  // Sync — encryption credentials
  sync.pendingEncryptedFile = {
    envelope: {
      version: '4.0',
      familyId: 'family-123',
      familyName: 'Test Family',
      keyId: 'key-1',
      wrappedKeys: {},
      payload: 'encrypted-payload',
      updatedAt: '2026-01-01T00:00:00.000Z',
    } as any,
  };
  // V4: setSessionPassword is a no-op; family key is set via decryptPendingFile
  sync.isConfigured = true;
  (sync as any).fileName = 'family-data.beanpod';

  // Member filter — data access context
  memberFilter.selectedMemberIds = new Set(['member-001', 'member-002']);

  return {
    auth,
    settings,
    sync,
    family,
    accounts,
    transactions,
    assets,
    goals,
    recurring,
    memberFilter,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Sensitive Data Clearing Security', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    savedGlobalSettings = { ...mockGlobalSettings };
    autoOpenState.map.clear();
  });

  // =========================================================================
  // 1. signOutAndClearData() — full destructive sign-out
  // =========================================================================
  describe('signOutAndClearData() — full destructive sign-out', () => {
    it('clears cachedFamilyKeys from global settings', async () => {
      const { auth, settings } = populateAllStores();

      // Trust device and cache a key
      await settings.setTrustedDevice(true);
      await settings.cacheFamilyKey(KEY_A, 'family-123');
      expect(await settings.getCachedFamilyKey('family-123')).toBe(KEY_A);

      await auth.signOutAndClearData();

      expect(await settings.getCachedFamilyKey('family-123')).toBeNull();
    });

    it('resets isTrustedDevice to false', async () => {
      const { auth, settings } = populateAllStores();
      await settings.setTrustedDevice(true);
      expect(settings.isTrustedDevice).toBe(true);

      await auth.signOutAndClearData();

      expect(settings.isTrustedDevice).toBe(false);
    });

    it('clears currentUser (email, memberId, familyId) and isAuthenticated', async () => {
      const { auth } = populateAllStores();
      expect(auth.currentUser).not.toBeNull();
      expect(auth.currentUser!.email).toBe('alice@example.com');
      expect(auth.isAuthenticated).toBe(true);

      await auth.signOutAndClearData();

      expect(auth.currentUser).toBeNull();
      expect(auth.isAuthenticated).toBe(false);
    });

    it('calls deleteFamilyDatabase with the family ID', async () => {
      const { auth } = populateAllStores();

      await auth.signOutAndClearData();

      expect(mockDeleteFamilyDatabase).toHaveBeenCalledWith('family-123');
    });

    it('clears localStorage auth session', async () => {
      const { auth } = populateAllStores();
      const removeItemSpy = vi.spyOn(localStorage, 'removeItem');

      await auth.signOutAndClearData();

      expect(removeItemSpy).toHaveBeenCalledWith('beanies_auth_session');
      removeItemSpy.mockRestore();
    });

    it('ALWAYS deletes when the human explicitly asked to clear, even with unpushed work', async () => {
      // ⚠️ THE GUARD MUST NOT OVERRIDE CONSENT. This tier is reached only
      // through the clear-data flow, behind a screen the user typed into.
      // Keeping their data anyway is wrong twice: it retains what they asked to
      // be rid of, and — seen in the field within minutes of the guard shipping
      // — it makes the one in-app escape from a wedged cache silently do
      // nothing, leaving the user stuck with no exit but DevTools.
      const { docPushedAgainst } = await import('@/services/sync/syncService');
      vi.mocked(docPushedAgainst).mockResolvedValue('dirty');
      const { auth } = populateAllStores();

      await auth.signOutAndClearData();

      expect(mockDeleteFamilyDatabase).toHaveBeenCalledWith('family-123');
    });

    it('force-saves the latest doc before clearing (ADR-032: durable save then delete)', async () => {
      const { auth } = populateAllStores();

      await auth.signOutAndClearData();

      expect(vi.mocked(saveNow)).toHaveBeenCalled();
      // The force-save must run before deleteFamilyDatabase, so the freshest edit
      // reaches Drive before the local cache is deleted.
      const saveOrder = vi.mocked(saveNow).mock.invocationCallOrder[0]!;
      const deleteOrder = mockDeleteFamilyDatabase.mock.invocationCallOrder[0]!;
      expect(saveOrder).toBeLessThan(deleteOrder);
    });
  });

  // =========================================================================
  // 2. signOut() on untrusted device
  // =========================================================================
  describe('signOut() on untrusted device', () => {
    it('KEEPS the local database when the final save did not push everything', async () => {
      // ⚠️ THE DATA-LOSS CASE, and it had no test at all. An ORDINARY sign-out
      // (never the clear-data tier, where consent wins) deletes the
      // family database on the assumption the final force-save pushed
      // everything. Two independent things broke that assumption:
      //   • the guard read a LATCH after a 3s race, while the merge it waits on
      //     is budgeted at 120s — so on a large pod the blocker armed tens of
      //     seconds too late and the guard saw null;
      //   • `doSave` refuses on ANY blocker, while the recoverable classes
      //     (a rotated family key, a torn read) deliberately do NOT latch — so
      //     the save was refused and the guard was blind at the same time.
      // Measuring the DOCUMENT closes both: it does not care why the save did
      // not land, and it cannot be raced.
      const { docPushedAgainst } = await import('@/services/sync/syncService');
      vi.mocked(docPushedAgainst).mockResolvedValue('dirty');
      const { auth } = populateAllStores();

      await auth.signOut();

      expect(mockDeleteFamilyDatabase).not.toHaveBeenCalled();
    });

    it('still deletes when the document is provably level with the remote', async () => {
      // The other direction: an over-cautious guard that never deletes would
      // quietly defeat the untrusted tier's whole purpose.
      const { docPushedAgainst } = await import('@/services/sync/syncService');
      vi.mocked(docPushedAgainst).mockResolvedValue('clean');
      const { auth } = populateAllStores();

      await auth.signOut();

      expect(mockDeleteFamilyDatabase).toHaveBeenCalled();
    });

    it('calls deleteFamilyDatabase when device is NOT trusted', async () => {
      const { auth, settings } = populateAllStores();
      // Ensure untrusted (default)
      expect(settings.isTrustedDevice).toBe(false);

      await auth.signOut();

      expect(mockDeleteFamilyDatabase).toHaveBeenCalledWith('family-123');
    });

    it('clears the CACHED FAMILY KEY, not just the cache it decrypts', async () => {
      // The key is stored unencrypted in the registry DB. Deleting the encrypted
      // family cache while leaving the key behind is the wrong half: on a shared
      // device the next person's auto-decrypt would open the pod with it, having
      // proved nothing at all.
      const { auth, settings } = populateAllStores();
      expect(settings.isTrustedDevice).toBe(false);
      // `{ force: true }` is how the key actually gets here: syncStore caches it on
      // every successful password decrypt regardless of the trusted-device flag, so an
      // untrusted device really does hold one.
      await settings.cacheFamilyKey(KEY_A, 'family-123', { force: true });
      expect(await settings.getCachedFamilyKey('family-123')).toBe(KEY_A);

      await auth.signOut();

      expect(await settings.getCachedFamilyKey('family-123')).toBeNull();
    });

    it('clears auth session state', async () => {
      const { auth } = populateAllStores();

      await auth.signOut();

      expect(auth.currentUser).toBeNull();
      expect(auth.isAuthenticated).toBe(false);
    });

    it('clears localStorage auth session', async () => {
      const { auth } = populateAllStores();
      const removeItemSpy = vi.spyOn(localStorage, 'removeItem');

      await auth.signOut();

      expect(removeItemSpy).toHaveBeenCalledWith('beanies_auth_session');
      removeItemSpy.mockRestore();
    });

    it('force-saves the latest doc before clearing', async () => {
      const { auth } = populateAllStores();

      await auth.signOut();

      expect(vi.mocked(saveNow)).toHaveBeenCalled();
    });

    it('completes sign-out even when the force-save REJECTS (never traps the user)', async () => {
      const { auth } = populateAllStores();
      vi.mocked(saveNow).mockRejectedValueOnce(new Error('Drive 500'));

      await expect(auth.signOut()).resolves.toBeUndefined();

      // Teardown still ran; auth state cleared.
      expect(mockDeleteFamilyDatabase).toHaveBeenCalled();
      expect(auth.currentUser).toBeNull();
    });

    it('completes sign-out when the force-save saves nothing (returns false)', async () => {
      const { auth } = populateAllStores();
      vi.mocked(saveNow).mockResolvedValueOnce(false);

      await expect(auth.signOut()).resolves.toBeUndefined();

      expect(mockDeleteFamilyDatabase).toHaveBeenCalled();
      expect(auth.currentUser).toBeNull();
    });
  });

  // =========================================================================
  // 3. signOut() on trusted device
  // =========================================================================
  describe('signOut() on trusted device', () => {
    it('does NOT delete family database when trusted', async () => {
      const { auth, settings } = populateAllStores();
      await settings.setTrustedDevice(true);

      await auth.signOut();

      expect(mockDeleteFamilyDatabase).not.toHaveBeenCalled();
    });

    it('KEEPS the cached family key when trusted — the point of the setting', async () => {
      // The companion to the untrusted case above. Clearing it here would defeat
      // "this is my own device, keep me signed in fast", so the two tests together
      // pin both halves of the decision rather than just the safe-looking one.
      const { auth, settings } = populateAllStores();
      await settings.setTrustedDevice(true);
      await settings.cacheFamilyKey(KEY_A, 'family-123');

      await auth.signOut();

      expect(await settings.getCachedFamilyKey('family-123')).toBe(KEY_A);
    });

    // Cross-family data-integrity regression (2026-07-06): even though the cache DB
    // is KEPT on a trusted device, the in-memory worker doc + family key MUST be
    // reset — else the next sign-in to a cache-missed family CRDT-merges its remote
    // into this family's resident doc and uploads the mix to the new family's file.
    it('still resets the in-memory worker doc (docClient.reset) even when trusted (cache kept)', async () => {
      const { auth, settings } = populateAllStores();
      await settings.setTrustedDevice(true);

      await auth.signOut();

      expect(docClient.reset).toHaveBeenCalled();
      expect(mockDeleteFamilyDatabase).not.toHaveBeenCalled(); // cache DB still preserved
    });

    it('still clears auth session state', async () => {
      const { auth, settings } = populateAllStores();
      await settings.setTrustedDevice(true);

      await auth.signOut();

      expect(auth.currentUser).toBeNull();
      expect(auth.isAuthenticated).toBe(false);
    });

    it('still clears localStorage auth session', async () => {
      const { auth, settings } = populateAllStores();
      await settings.setTrustedDevice(true);
      const removeItemSpy = vi.spyOn(localStorage, 'removeItem');

      await auth.signOut();

      expect(removeItemSpy).toHaveBeenCalledWith('beanies_auth_session');
      removeItemSpy.mockRestore();
    });

    it('preserves cached encryption password for auto-reconnect', async () => {
      const { auth, settings } = populateAllStores();
      await settings.setTrustedDevice(true);
      await settings.cacheFamilyKey(KEY_B, 'family-123');

      await auth.signOut();

      // Cached key persists — by design for trusted device auto-reconnect
      expect(await settings.getCachedFamilyKey('family-123')).toBe(KEY_B);
    });
  });

  // =========================================================================
  // 4. resetState() — in-memory Pinia state reset
  // =========================================================================
  describe('resetState() — in-memory Pinia state reset', () => {
    it('familyStore.resetState() clears all members and currentMemberId', () => {
      const { family } = populateAllStores();
      expect(family.members.length).toBeGreaterThan(0);
      expect(family.currentMemberId).not.toBeNull();

      family.resetState();

      expect(family.members).toEqual([]);
      expect(family.currentMemberId).toBeNull();
    });

    it('accountsStore.resetState() clears all accounts', () => {
      const { accounts } = populateAllStores();
      expect(accounts.accounts.length).toBeGreaterThan(0);

      accounts.resetState();

      expect(accounts.accounts).toEqual([]);
    });

    it('transactionsStore.resetState() clears all transactions', () => {
      const { transactions } = populateAllStores();
      expect(transactions.transactions.length).toBeGreaterThan(0);

      transactions.resetState();

      expect(transactions.transactions).toEqual([]);
    });

    it('assetsStore.resetState() clears all assets', () => {
      const { assets } = populateAllStores();
      expect(assets.assets.length).toBeGreaterThan(0);

      assets.resetState();

      expect(assets.assets).toEqual([]);
    });

    it('goalsStore.resetState() clears all goals', () => {
      const { goals } = populateAllStores();
      expect(goals.goals.length).toBeGreaterThan(0);

      goals.resetState();

      expect(goals.goals).toEqual([]);
    });

    it('recurringStore.resetState() clears all recurring items', () => {
      const { recurring } = populateAllStores();
      expect(recurring.recurringItems.length).toBeGreaterThan(0);

      recurring.resetState();

      expect(recurring.recurringItems).toEqual([]);
    });

    it('syncStore.resetState() clears family key session', () => {
      const { sync } = populateAllStores();
      // V4: hasSessionPassword checks for familyKey in memory
      expect(sync.hasSessionPassword).toBe(false);

      sync.resetState();

      expect(sync.hasSessionPassword).toBe(false);
    });

    it('syncStore.resetState() clears pending encrypted file', () => {
      const { sync } = populateAllStores();
      expect(sync.pendingEncryptedFile).not.toBeNull();

      sync.resetState();

      expect(sync.pendingEncryptedFile).toBeNull();
    });

    it('syncStore.resetState() resets isConfigured to false', () => {
      const { sync } = populateAllStores();
      expect(sync.isConfigured).toBe(true);

      sync.resetState();

      expect(sync.isConfigured).toBe(false);
    });

    it('syncStore.resetState() clears file name', () => {
      const { sync } = populateAllStores();
      expect(sync.fileName).not.toBeNull();

      sync.resetState();

      expect(sync.fileName).toBeNull();
    });

    it('memberFilterStore.resetState() clears selectedMemberIds', () => {
      const { memberFilter } = populateAllStores();
      expect(memberFilter.selectedMemberIds.size).toBeGreaterThan(0);

      memberFilter.resetState();

      expect(memberFilter.selectedMemberIds.size).toBe(0);
    });

    it('resets ALL stores in a single sweep', () => {
      const stores = populateAllStores();

      // Reset every store
      stores.family.resetState();
      stores.accounts.resetState();
      stores.transactions.resetState();
      stores.assets.resetState();
      stores.goals.resetState();
      stores.recurring.resetState();
      stores.sync.resetState();
      stores.memberFilter.resetState();
      stores.settings.resetState();

      // Verify all sensitive data is gone
      expect(stores.family.members).toEqual([]);
      expect(stores.family.currentMemberId).toBeNull();
      expect(stores.accounts.accounts).toEqual([]);
      expect(stores.transactions.transactions).toEqual([]);
      expect(stores.assets.assets).toEqual([]);
      expect(stores.goals.goals).toEqual([]);
      expect(stores.recurring.recurringItems).toEqual([]);
      expect(stores.sync.hasSessionPassword).toBe(false);
      expect(stores.sync.pendingEncryptedFile).toBeNull();
      expect(stores.sync.isConfigured).toBe(false);
      expect(stores.sync.fileName).toBeNull();
      expect(stores.memberFilter.selectedMemberIds.size).toBe(0);
    });
  });

  // =========================================================================
  // 5. Settings "Clear Data" path
  // =========================================================================
  describe('Settings "Clear Data" path', () => {
    it('clears cachedFamilyKeys before wiping', async () => {
      const { settings } = populateAllStores();
      await settings.setTrustedDevice(true);
      await settings.cacheFamilyKey(KEY_A, 'family-123');
      expect(await settings.getCachedFamilyKey('family-123')).toBe(KEY_A);

      // Simulate the SettingsPage handleClearData flow (clears all families)
      await settings.clearCachedFamilyKey();

      expect(await settings.getCachedFamilyKey('family-123')).toBeNull();
      // The all-families clear also wipes any legacy plaintext remnants.
      expect(savedGlobalSettings.cachedFamilyKeys).toEqual({});
    });

    it('resets isTrustedDevice to false', async () => {
      const { settings } = populateAllStores();
      await settings.setTrustedDevice(true);
      expect(settings.isTrustedDevice).toBe(true);

      // Simulate handleClearData flow
      await settings.clearCachedFamilyKey();
      await settings.setTrustedDevice(false);

      expect(settings.isTrustedDevice).toBe(false);
    });

    it('calls clearAllData() to wipe IndexedDB stores', async () => {
      populateAllStores();
      const settings = useSettingsStore();

      // Simulate handleClearData flow
      await settings.clearCachedFamilyKey();
      await settings.setTrustedDevice(false);
      await mockClearAllData();

      expect(mockClearAllData).toHaveBeenCalled();
    });

    it('executes clearing steps in correct order: password → trust → data', async () => {
      populateAllStores();
      const settings = useSettingsStore();

      const callOrder: string[] = [];
      const origSaveGlobalSettings = vi.mocked(
        (await import('@/services/indexeddb/repositories/globalSettingsRepository'))
          .saveGlobalSettings
      );
      origSaveGlobalSettings.mockImplementation(async (partial: Partial<GlobalSettings>) => {
        if ('cachedFamilyKeys' in partial) callOrder.push('clearPassword');
        if (partial.isTrustedDevice === false) callOrder.push('clearTrust');
        savedGlobalSettings = { ...savedGlobalSettings, ...partial, id: 'global_settings' };
        return { ...savedGlobalSettings };
      });
      mockClearAllData.mockImplementation(async () => {
        callOrder.push('clearData');
      });

      // Simulate handleClearData
      await settings.clearCachedFamilyKey();
      await settings.setTrustedDevice(false);
      await mockClearAllData();

      expect(callOrder).toEqual(['clearPassword', 'clearTrust', 'clearData']);
    });
  });

  // =========================================================================
  // 5b. Wrapped key-cache trio (Phase 4) — wrap on write, wrapped-first read,
  //     lazy legacy migration
  // =========================================================================
  describe('wrapped auto-open key cache (Phase 4)', () => {
    it('cacheFamilyKey stores via the trustedAutoOpen service, never plaintext settings', async () => {
      const { settings } = populateAllStores();
      const autoOpen = await import('@/services/auth/trustedAutoOpen');
      await settings.setTrustedDevice(true);

      await settings.cacheFamilyKey(KEY_A, 'family-123');

      expect(vi.mocked(autoOpen.saveTrustedAutoOpenKey)).toHaveBeenCalledTimes(1);
      expect(vi.mocked(autoOpen.saveTrustedAutoOpenKey).mock.calls[0]![0]).toBe('family-123');
      // No plaintext copy may land in global settings anymore.
      expect(savedGlobalSettings.cachedFamilyKeys ?? {}).toEqual({});
    });

    it('cacheFamilyKey still refuses on an untrusted device without force', async () => {
      const { settings } = populateAllStores();
      expect(settings.isTrustedDevice).toBe(false);

      await settings.cacheFamilyKey(KEY_A, 'family-123');

      expect(await settings.getCachedFamilyKey('family-123')).toBeNull();
    });

    it('getCachedFamilyKey lazily migrates a legacy plaintext entry (wrap + delete plaintext + return value)', async () => {
      const { settings } = populateAllStores();
      const autoOpen = await import('@/services/auth/trustedAutoOpen');
      // A pre-Phase-4 device: plaintext key in global settings, nothing wrapped.
      savedGlobalSettings = {
        ...savedGlobalSettings,
        cachedFamilyKeys: { 'family-123': KEY_A },
      } as GlobalSettings;
      await settings.loadGlobalSettings();

      const value = await settings.getCachedFamilyKey('family-123');

      // The legacy value is returned so the silent open still works this session…
      expect(value).toBe(KEY_A);
      // …the wrapped record now exists…
      expect(vi.mocked(autoOpen.saveTrustedAutoOpenKey)).toHaveBeenCalledWith(
        'family-123',
        expect.anything()
      );
      // …and the plaintext entry is gone.
      expect(savedGlobalSettings.cachedFamilyKeys).toEqual({});
      // Second read is served from the wrapped store (same bytes back).
      expect(await settings.getCachedFamilyKey('family-123')).toBe(KEY_A);
    });

    it('clearCachedFamilyKey(familyId) clears the wrapped store AND the legacy plaintext remnant', async () => {
      const { settings } = populateAllStores();
      await settings.setTrustedDevice(true);
      await settings.cacheFamilyKey(KEY_A, 'family-123');
      // Simulate a lingering legacy remnant alongside the wrapped record.
      savedGlobalSettings = {
        ...savedGlobalSettings,
        cachedFamilyKeys: { 'family-123': KEY_A, 'family-other': KEY_B },
      } as GlobalSettings;
      await settings.loadGlobalSettings();

      await settings.clearCachedFamilyKey('family-123');

      expect(await settings.getCachedFamilyKey('family-123')).toBeNull();
      // Family-scoped: the OTHER family's legacy entry survives.
      expect(savedGlobalSettings.cachedFamilyKeys).toEqual({ 'family-other': KEY_B });
    });
  });

  // =========================================================================
  // 5c. Sign-out tier step lists — the tier contracts as DATA
  // =========================================================================
  describe('sign-out tier step lists (signOutSteps.ts data contracts)', () => {
    it('trusted tier 2 ⊂ untrusted tier 2, except the keep-vs-drop Google-token substitution', () => {
      // The one deliberate substitution: trusted keeps local tokens, untrusted drops them.
      expect(SIGN_OUT_TRUSTED_STEPS).toContain('clearGoogleSessionKeepTokens');
      expect(SIGN_OUT_TRUSTED_STEPS).not.toContain('clearGoogleSessionDropTokens');
      expect(SIGN_OUT_UNTRUSTED_STEPS).toContain('clearGoogleSessionDropTokens');
      expect(SIGN_OUT_UNTRUSTED_STEPS).not.toContain('clearGoogleSessionKeepTokens');
      // Every other trusted step also runs on the untrusted tier.
      for (const step of SIGN_OUT_TRUSTED_STEPS) {
        if (step === 'clearGoogleSessionKeepTokens') continue;
        expect(SIGN_OUT_UNTRUSTED_STEPS).toContain(step);
      }
      // And NO tier revokes at Google — no revoke step name exists at all.
      for (const steps of [
        SIGN_OUT_TRUSTED_STEPS,
        SIGN_OUT_UNTRUSTED_STEPS,
        SIGN_OUT_CLEAR_STEPS,
      ]) {
        expect(steps.some((n) => n.toLowerCase().includes('revoke'))).toBe(false);
      }
    });

    it('tier 3 ⊇ untrusted tier 2 under the family→all scope mapping, with the two documented exceptions', () => {
      const scopeMap: Record<string, string> = {
        clearKeyCacheFamily: 'clearKeyCacheAll',
        removePinWrapsFamily: 'removePinWrapsAll',
        removeRosterFamily: 'removeRosterAll',
      };
      for (const step of SIGN_OUT_UNTRUSTED_STEPS) {
        if (step === 'resetDocClient') {
          // Documented exception 1: tier-2 only — tier 3's deleteFamilyDb path
          // resets the worker doc anyway.
          expect(SIGN_OUT_CLEAR_STEPS).not.toContain('resetDocClient');
          continue;
        }
        if (step === 'reArmTrustPrompt') {
          // Documented exception 2: tier-2-untrusted only — superseded in tier 3
          // by untrustDevice, which sets the trust flag itself.
          expect(SIGN_OUT_CLEAR_STEPS).not.toContain('reArmTrustPrompt');
          expect(SIGN_OUT_CLEAR_STEPS).toContain('untrustDevice');
          continue;
        }
        expect(SIGN_OUT_CLEAR_STEPS).toContain(scopeMap[step] ?? step);
      }
      // reArmTrustPrompt is exclusively the untrusted tier-2's.
      expect(SIGN_OUT_TRUSTED_STEPS).not.toContain('reArmTrustPrompt');
      // Tier 3 additionally drops every family's refresh tokens + reclaims passkeys.
      expect(SIGN_OUT_CLEAR_STEPS).toContain('clearAllRefreshTokens');
      expect(SIGN_OUT_CLEAR_STEPS).toContain('reclaimAllPasskeys');
      expect(SIGN_OUT_UNTRUSTED_STEPS).not.toContain('clearAllRefreshTokens');
      expect(SIGN_OUT_UNTRUSTED_STEPS).not.toContain('reclaimAllPasskeys');
    });
  });

  // =========================================================================
  // 6. Comprehensive field-level verification
  // =========================================================================
  describe('Comprehensive field-level verification', () => {
    it('signOutAndClearData removes all PII from auth state', async () => {
      const { auth } = populateAllStores();

      // Verify PII is present
      expect(auth.currentUser!.email).toBe('alice@example.com');
      expect(auth.currentUser!.memberId).toBe('member-001');
      expect(auth.currentUser!.familyId).toBe('family-123');

      await auth.signOutAndClearData();

      // All PII gone
      expect(auth.currentUser).toBeNull();
    });

    it('family store resetState removes names, emails, and password hashes', () => {
      const { family } = populateAllStores();

      // Verify sensitive data present
      expect(family.members.some((m: any) => m.passwordHash)).toBe(true);
      expect(family.members.some((m: any) => m.email === 'alice@example.com')).toBe(true);

      family.resetState();

      expect(family.members).toEqual([]);
    });

    it('accounts store resetState removes balances and institution names', () => {
      const { accounts } = populateAllStores();

      expect(accounts.accounts.some((a: any) => a.balance > 0)).toBe(true);
      expect(accounts.accounts.some((a: any) => a.institution)).toBe(true);

      accounts.resetState();

      expect(accounts.accounts).toEqual([]);
    });

    it('transactions store resetState removes amounts and descriptions', () => {
      const { transactions } = populateAllStores();

      expect(transactions.transactions.some((t: any) => t.amount > 0)).toBe(true);
      expect(transactions.transactions.some((t: any) => t.description)).toBe(true);

      transactions.resetState();

      expect(transactions.transactions).toEqual([]);
    });

    it('assets store resetState removes asset values and names', () => {
      const { assets } = populateAllStores();

      expect(assets.assets.some((a: any) => a.currentValue > 0)).toBe(true);
      expect(assets.assets.some((a: any) => a.name)).toBe(true);

      assets.resetState();

      expect(assets.assets).toEqual([]);
    });

    it('goals store resetState removes target amounts and deadlines', () => {
      const { goals } = populateAllStores();

      expect(goals.goals.some((g: any) => g.targetAmount > 0)).toBe(true);
      expect(goals.goals.some((g: any) => g.deadline)).toBe(true);

      goals.resetState();

      expect(goals.goals).toEqual([]);
    });

    it('recurring store resetState removes recurring financial patterns', () => {
      const { recurring } = populateAllStores();

      expect(recurring.recurringItems.some((r: any) => r.amount > 0)).toBe(true);
      expect(recurring.recurringItems.some((r: any) => r.description)).toBe(true);

      recurring.resetState();

      expect(recurring.recurringItems).toEqual([]);
    });

    it('sync store resetState clears family key from memory', () => {
      const { sync } = populateAllStores();

      // V4: hasSessionPassword checks for familyKey in memory
      expect(sync.hasSessionPassword).toBe(false);

      sync.resetState();

      expect(sync.hasSessionPassword).toBe(false);
    });
  });

  // =========================================================================
  // 7. Edge cases
  // =========================================================================
  describe('Edge cases', () => {
    it('signOut with a familyId-less session FALLS BACK to the active family (review F14)', async () => {
      // The old behavior — skipping the teardown entirely — was the vulnerability: a
      // legacy session without familyId left the family DB, cached key, PIN wraps and
      // roster on a shared machine. The fallback chain (session → context → registry)
      // must find the active family and clear it.
      const auth = useAuthStore();
      auth.currentUser = { memberId: 'x', email: 'x@x.com' }; // no familyId
      auth.isAuthenticated = true;

      await auth.signOut();

      expect(mockDeleteFamilyDatabase).toHaveBeenCalled();
      expect(auth.currentUser).toBeNull();
      expect(auth.isAuthenticated).toBe(false);
    });

    it('signOutAndClearData with a familyId-less session still clears via the fallback (review F14)', async () => {
      const auth = useAuthStore();
      auth.currentUser = { memberId: 'x', email: 'x@x.com' }; // no familyId
      auth.isAuthenticated = true;

      await auth.signOutAndClearData();

      expect(mockDeleteFamilyDatabase).toHaveBeenCalled();
      expect(auth.currentUser).toBeNull();
      expect(auth.isAuthenticated).toBe(false);
    });

    it('signOutAndClearData handles deleteFamilyDatabase failure gracefully', async () => {
      const { auth } = populateAllStores();
      mockDeleteFamilyDatabase.mockRejectedValueOnce(new Error('DB locked'));

      // Should not throw
      await auth.signOutAndClearData();

      // Auth state still cleared despite DB error
      expect(auth.currentUser).toBeNull();
      expect(auth.isAuthenticated).toBe(false);
    });

    it('double signOut does not throw', async () => {
      const { auth } = populateAllStores();

      await auth.signOut();
      // Second call with null currentUser
      await expect(auth.signOut()).resolves.not.toThrow();
    });

    it('resetState is idempotent — calling twice produces same result', () => {
      const { family, accounts, sync } = populateAllStores();

      family.resetState();
      family.resetState();
      expect(family.members).toEqual([]);

      accounts.resetState();
      accounts.resetState();
      expect(accounts.accounts).toEqual([]);

      sync.resetState();
      sync.resetState();
      expect(sync.hasSessionPassword).toBe(false);
    });
  });
});
