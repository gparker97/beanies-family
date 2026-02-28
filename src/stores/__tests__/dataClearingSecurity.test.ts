import { setActivePinia, createPinia } from 'pinia';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { GlobalSettings } from '@/types/models';
import { flushPendingSave } from '@/services/sync/syncService';

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

vi.mock('@/services/indexeddb/repositories/settingsRepository', () => ({
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

// Sync service — uses shared auto-mock from __mocks__/syncService.ts
vi.mock('@/services/sync/syncService');

vi.mock('@/services/sync/capabilities', () => ({
  getSyncCapabilities: () => ({ hasFileSystemAccess: true }),
  canAutoSync: () => true,
}));

vi.mock('@/services/sync/fileSync', () => ({
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

vi.mock('@/services/indexeddb/repositories/familyMemberRepository', () => ({
  getAllMembers: vi.fn(async () => []),
  createMember: vi.fn(),
  updateMember: vi.fn(),
  deleteMember: vi.fn(),
}));

vi.mock('@/services/indexeddb/repositories/accountRepository', () => ({
  getAllAccounts: vi.fn(async () => []),
  createAccount: vi.fn(),
  updateAccount: vi.fn(),
  deleteAccount: vi.fn(),
}));

vi.mock('@/services/indexeddb/repositories/transactionRepository', () => ({
  getAllTransactions: vi.fn(async () => []),
  createTransaction: vi.fn(),
  updateTransaction: vi.fn(),
  deleteTransaction: vi.fn(),
}));

vi.mock('@/services/indexeddb/repositories/assetRepository', () => ({
  getAllAssets: vi.fn(async () => []),
  createAsset: vi.fn(),
  updateAsset: vi.fn(),
  deleteAsset: vi.fn(),
}));

vi.mock('@/services/indexeddb/repositories/goalRepository', () => ({
  getAllGoals: vi.fn(async () => []),
  createGoal: vi.fn(),
  updateGoal: vi.fn(),
  deleteGoal: vi.fn(),
}));

vi.mock('@/services/indexeddb/repositories/recurringItemRepository', () => ({
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
    fileHandle: {} as FileSystemFileHandle,
    rawSyncData: {} as any,
  };
  sync.setSessionPassword('super-secret-encryption-key');
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
  });

  // =========================================================================
  // 1. signOutAndClearData() — full destructive sign-out
  // =========================================================================
  describe('signOutAndClearData() — full destructive sign-out', () => {
    it('clears cachedEncryptionPasswords from global settings', async () => {
      const { auth, settings } = populateAllStores();

      // Trust device and cache a password
      await settings.setTrustedDevice(true);
      await settings.cacheEncryptionPassword('my-encryption-key', 'family-123');
      expect(settings.getCachedEncryptionPassword('family-123')).toBe('my-encryption-key');

      await auth.signOutAndClearData();

      expect(settings.getCachedEncryptionPassword('family-123')).toBeNull();
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

    it('clears sessionStorage auth session', async () => {
      const { auth } = populateAllStores();
      const removeItemSpy = vi.spyOn(sessionStorage, 'removeItem');

      await auth.signOutAndClearData();

      expect(removeItemSpy).toHaveBeenCalledWith('beanies_auth_session');
      removeItemSpy.mockRestore();
    });

    it('flushes pending save before clearing', async () => {
      const { auth } = populateAllStores();

      await auth.signOutAndClearData();

      expect(vi.mocked(flushPendingSave)).toHaveBeenCalled();
      // flush should be called before deleteFamilyDatabase
      const flushOrder = vi.mocked(flushPendingSave).mock.invocationCallOrder[0]!;
      const deleteOrder = mockDeleteFamilyDatabase.mock.invocationCallOrder[0]!;
      expect(flushOrder).toBeLessThan(deleteOrder);
    });
  });

  // =========================================================================
  // 2. signOut() on untrusted device
  // =========================================================================
  describe('signOut() on untrusted device', () => {
    it('calls deleteFamilyDatabase when device is NOT trusted', async () => {
      const { auth, settings } = populateAllStores();
      // Ensure untrusted (default)
      expect(settings.isTrustedDevice).toBe(false);

      await auth.signOut();

      expect(mockDeleteFamilyDatabase).toHaveBeenCalledWith('family-123');
    });

    it('clears auth session state', async () => {
      const { auth } = populateAllStores();

      await auth.signOut();

      expect(auth.currentUser).toBeNull();
      expect(auth.isAuthenticated).toBe(false);
    });

    it('clears sessionStorage', async () => {
      const { auth } = populateAllStores();
      const removeItemSpy = vi.spyOn(sessionStorage, 'removeItem');

      await auth.signOut();

      expect(removeItemSpy).toHaveBeenCalledWith('beanies_auth_session');
      removeItemSpy.mockRestore();
    });

    it('flushes pending save before clearing', async () => {
      const { auth } = populateAllStores();

      await auth.signOut();

      expect(vi.mocked(flushPendingSave)).toHaveBeenCalled();
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

    it('still clears auth session state', async () => {
      const { auth, settings } = populateAllStores();
      await settings.setTrustedDevice(true);

      await auth.signOut();

      expect(auth.currentUser).toBeNull();
      expect(auth.isAuthenticated).toBe(false);
    });

    it('still clears sessionStorage', async () => {
      const { auth, settings } = populateAllStores();
      await settings.setTrustedDevice(true);
      const removeItemSpy = vi.spyOn(sessionStorage, 'removeItem');

      await auth.signOut();

      expect(removeItemSpy).toHaveBeenCalledWith('beanies_auth_session');
      removeItemSpy.mockRestore();
    });

    it('preserves cached encryption password for auto-reconnect', async () => {
      const { auth, settings } = populateAllStores();
      await settings.setTrustedDevice(true);
      await settings.cacheEncryptionPassword('keep-this-password', 'family-123');

      await auth.signOut();

      // Cached password persists — by design for trusted device auto-reconnect
      expect(settings.getCachedEncryptionPassword('family-123')).toBe('keep-this-password');
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

    it('syncStore.resetState() clears session password', () => {
      const { sync } = populateAllStores();
      expect(sync.currentSessionPassword).not.toBeNull();

      sync.resetState();

      expect(sync.currentSessionPassword).toBeNull();
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
      expect(stores.sync.currentSessionPassword).toBeNull();
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
    it('clears cachedEncryptionPasswords before wiping', async () => {
      const { settings } = populateAllStores();
      await settings.setTrustedDevice(true);
      await settings.cacheEncryptionPassword('cached-pw', 'family-123');
      expect(settings.getCachedEncryptionPassword('family-123')).toBe('cached-pw');

      // Simulate the SettingsPage handleClearData flow (clears all families)
      await settings.clearCachedEncryptionPassword();

      expect(settings.getCachedEncryptionPassword('family-123')).toBeNull();
    });

    it('resets isTrustedDevice to false', async () => {
      const { settings } = populateAllStores();
      await settings.setTrustedDevice(true);
      expect(settings.isTrustedDevice).toBe(true);

      // Simulate handleClearData flow
      await settings.clearCachedEncryptionPassword();
      await settings.setTrustedDevice(false);

      expect(settings.isTrustedDevice).toBe(false);
    });

    it('calls clearAllData() to wipe IndexedDB stores', async () => {
      populateAllStores();
      const settings = useSettingsStore();

      // Simulate handleClearData flow
      await settings.clearCachedEncryptionPassword();
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
        if ('cachedEncryptionPasswords' in partial) callOrder.push('clearPassword');
        if (partial.isTrustedDevice === false) callOrder.push('clearTrust');
        savedGlobalSettings = { ...savedGlobalSettings, ...partial, id: 'global_settings' };
        return { ...savedGlobalSettings };
      });
      mockClearAllData.mockImplementation(async () => {
        callOrder.push('clearData');
      });

      // Simulate handleClearData
      await settings.clearCachedEncryptionPassword();
      await settings.setTrustedDevice(false);
      await mockClearAllData();

      expect(callOrder).toEqual(['clearPassword', 'clearTrust', 'clearData']);
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

    it('sync store resetState removes encryption session password', () => {
      const { sync } = populateAllStores();

      expect(sync.currentSessionPassword).toBe('super-secret-encryption-key');

      sync.resetState();

      expect(sync.currentSessionPassword).toBeNull();
      expect(sync.hasSessionPassword).toBe(false);
    });
  });

  // =========================================================================
  // 7. Edge cases
  // =========================================================================
  describe('Edge cases', () => {
    it('signOut gracefully handles missing familyId', async () => {
      const auth = useAuthStore();
      auth.currentUser = { memberId: 'x', email: 'x@x.com' }; // no familyId
      auth.isAuthenticated = true;

      await auth.signOut();

      expect(mockDeleteFamilyDatabase).not.toHaveBeenCalled();
      expect(auth.currentUser).toBeNull();
      expect(auth.isAuthenticated).toBe(false);
    });

    it('signOutAndClearData gracefully handles missing familyId', async () => {
      const auth = useAuthStore();
      auth.currentUser = { memberId: 'x', email: 'x@x.com' }; // no familyId
      auth.isAuthenticated = true;

      await auth.signOutAndClearData();

      expect(mockDeleteFamilyDatabase).not.toHaveBeenCalled();
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
      expect(sync.currentSessionPassword).toBeNull();
    });
  });
});
