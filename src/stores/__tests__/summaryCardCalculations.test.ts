import { setActivePinia, createPinia } from 'pinia';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Account, Asset, AssetLoan } from '@/types/models';

// Mock repositories
vi.mock('@/services/automerge/repositories/accountRepository', () => ({
  getAllAccounts: vi.fn().mockResolvedValue([]),
  createAccount: vi.fn((input) =>
    Promise.resolve({
      ...input,
      id: `acc-${Date.now()}`,
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    })
  ),
  updateAccount: vi.fn((id, input) =>
    Promise.resolve({
      id,
      ...input,
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    })
  ),
  deleteAccount: vi.fn().mockResolvedValue(true),
}));

vi.mock('@/services/automerge/repositories/assetRepository', () => ({
  getAllAssets: vi.fn().mockResolvedValue([]),
  createAsset: vi.fn((input) =>
    Promise.resolve({
      ...input,
      id: `asset-${Date.now()}`,
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    })
  ),
  updateAsset: vi.fn((id, input) =>
    Promise.resolve({
      id,
      ...input,
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    })
  ),
  deleteAsset: vi.fn().mockResolvedValue(true),
}));

vi.mock('@/services/automerge/repositories/settingsRepository', () => ({
  getDefaultSettings: vi.fn(() => ({
    id: 'app_settings',
    baseCurrency: 'USD',
    displayCurrency: 'USD',
    exchangeRates: [],
    exchangeRateAutoUpdate: true,
    exchangeRateLastFetch: null,
    theme: 'system',
    language: 'en',
    syncEnabled: false,
    autoSyncEnabled: true,
    encryptionEnabled: false,
    aiProvider: 'none',
    aiApiKeys: {},
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
  })),
  getSettings: vi.fn().mockResolvedValue(null),
  saveSettings: vi.fn().mockResolvedValue(undefined),
}));

import { useAccountsStore } from '../accountsStore';
import { useAssetsStore } from '../assetsStore';
import { useSettingsStore } from '../settingsStore';

function mockAccount(overrides: Partial<Account> = {}): Account {
  return {
    id: 'acc-1',
    memberId: 'member-1',
    name: 'Test Account',
    type: 'checking',
    currency: 'USD',
    balance: 0,
    isActive: true,
    includeInNetWorth: true,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function mockAsset(overrides: Partial<Asset> = {}): Asset {
  return {
    id: 'asset-1',
    memberId: 'member-1',
    name: 'House',
    type: 'real_estate',
    purchaseValue: 300000,
    currentValue: 350000,
    currency: 'USD',
    includeInNetWorth: true,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function mockLoan(overrides: Partial<AssetLoan> = {}): AssetLoan {
  return {
    hasLoan: true,
    loanAmount: 250000,
    outstandingBalance: 200000,
    interestRate: 4.5,
    monthlyPayment: 1500,
    loanTermMonths: 360,
    lender: 'Test Bank',
    ...overrides,
  };
}

describe('Summary Card Calculations', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();

    const settingsStore = useSettingsStore();
    settingsStore.settings.baseCurrency = 'USD';
    settingsStore.globalSettings.exchangeRates = [];
  });

  describe('accountsStore.totalAssets', () => {
    it('should exclude credit cards and loans', () => {
      const store = useAccountsStore();
      store.accounts.push(
        mockAccount({ id: 'a1', type: 'checking', balance: 10000 }),
        mockAccount({ id: 'a2', type: 'savings', balance: 20000 }),
        mockAccount({ id: 'a3', type: 'credit_card', balance: 5000 }),
        mockAccount({ id: 'a4', type: 'loan', balance: 100000 })
      );
      // Only checking + savings
      expect(store.totalAssets).toBe(30000);
    });

    it('should exclude inactive accounts', () => {
      const store = useAccountsStore();
      store.accounts.push(
        mockAccount({ id: 'a1', type: 'checking', balance: 10000, isActive: true }),
        mockAccount({ id: 'a2', type: 'savings', balance: 5000, isActive: false })
      );
      expect(store.totalAssets).toBe(10000);
    });
  });

  describe('accountsStore.totalLiabilities', () => {
    it('should include credit cards and loan accounts', () => {
      const store = useAccountsStore();
      store.accounts.push(
        mockAccount({ id: 'a1', type: 'credit_card', balance: 3000 }),
        mockAccount({ id: 'a2', type: 'loan', balance: 150000 }),
        mockAccount({ id: 'a3', type: 'checking', balance: 10000 })
      );
      // Only credit card + loan
      expect(store.totalLiabilities).toBe(153000);
    });

    it('should include asset-linked loan accounts', () => {
      const store = useAccountsStore();
      store.accounts.push(
        mockAccount({ id: 'a1', type: 'credit_card', balance: 2000 }),
        mockAccount({ id: 'a2', type: 'loan', balance: 200000, linkedAssetId: 'asset-1' })
      );
      expect(store.totalLiabilities).toBe(202000);
    });
  });

  describe('accountsStore.combinedNetWorth', () => {
    it('should equal totalAssets - totalLiabilities + assetValues', () => {
      const accountsStore = useAccountsStore();
      const assetsStore = useAssetsStore();

      accountsStore.accounts.push(
        mockAccount({ id: 'a1', type: 'checking', balance: 50000 }),
        mockAccount({ id: 'a2', type: 'credit_card', balance: 5000 }),
        mockAccount({ id: 'a3', type: 'loan', balance: 200000, linkedAssetId: 'asset-1' })
      );

      assetsStore.assets.push(
        mockAsset({
          id: 'asset-1',
          currentValue: 400000,
          loan: mockLoan({ outstandingBalance: 200000 }),
        })
      );

      // totalBalance: 50000 - 5000 - 200000 = -155000
      // totalAssetValue: 400000
      // combinedNetWorth: -155000 + 400000 = 245000
      expect(accountsStore.totalBalance).toBe(-155000);
      expect(assetsStore.totalAssetValue).toBe(400000);
      expect(accountsStore.combinedNetWorth).toBe(245000);

      // Verify identity: totalAssets - totalLiabilities + assetValues = combinedNetWorth
      const identity =
        accountsStore.totalAssets - accountsStore.totalLiabilities + assetsStore.totalAssetValue;
      expect(identity).toBe(accountsStore.combinedNetWorth);
    });
  });

  describe('assetsStore calculations', () => {
    it('totalAssetValue — sums current values of includeInNetWorth assets', () => {
      const store = useAssetsStore();
      store.assets.push(
        mockAsset({ id: 'a1', currentValue: 300000 }),
        mockAsset({ id: 'a2', currentValue: 50000 }),
        mockAsset({ id: 'a3', currentValue: 100000, includeInNetWorth: false })
      );
      expect(store.totalAssetValue).toBe(350000);
    });

    it('totalLoanValue — sums outstanding balances', () => {
      const store = useAssetsStore();
      store.assets.push(
        mockAsset({ id: 'a1', loan: mockLoan({ outstandingBalance: 200000 }) }),
        mockAsset({ id: 'a2', loan: mockLoan({ outstandingBalance: 30000 }) }),
        mockAsset({ id: 'a3' }) // no loan
      );
      expect(store.totalLoanValue).toBe(230000);
    });

    it('netAssetValue — totalAssetValue minus totalLoanValue', () => {
      const store = useAssetsStore();
      store.assets.push(
        mockAsset({
          id: 'a1',
          currentValue: 400000,
          loan: mockLoan({ outstandingBalance: 200000 }),
        })
      );
      expect(store.netAssetValue).toBe(200000);
    });

    it('totalAppreciation — difference between current and purchase values', () => {
      const store = useAssetsStore();
      store.assets.push(
        mockAsset({ id: 'a1', purchaseValue: 300000, currentValue: 350000 }),
        mockAsset({ id: 'a2', purchaseValue: 40000, currentValue: 35000 })
      );
      // (350000-300000) + (35000-40000) = 50000 + (-5000) = 45000
      expect(store.totalAppreciation).toBe(45000);
    });
  });

  describe('Linked loan account lifecycle', () => {
    it('should create linked loan account when creating asset with loan', async () => {
      const assetsStore = useAssetsStore();
      const accountsStore = useAccountsStore();

      const asset = await assetsStore.createAsset({
        memberId: 'member-1',
        name: 'Car',
        type: 'vehicle',
        purchaseValue: 40000,
        currentValue: 35000,
        currency: 'USD',
        includeInNetWorth: true,
        loan: mockLoan({ outstandingBalance: 25000, lender: 'Auto Bank' }),
      });

      expect(asset).not.toBeNull();
      const linkedAccount = accountsStore.accounts.find((a) => a.linkedAssetId === asset!.id);
      expect(linkedAccount).toBeDefined();
      expect(linkedAccount!.type).toBe('loan');
      expect(linkedAccount!.balance).toBe(25000);
      expect(linkedAccount!.name).toBe('Car Loan');
      expect(linkedAccount!.institution).toBe('Auto Bank');
    });

    it('should not create linked loan account for asset without loan', async () => {
      const assetsStore = useAssetsStore();
      const accountsStore = useAccountsStore();

      await assetsStore.createAsset({
        memberId: 'member-1',
        name: 'Art Piece',
        type: 'art',
        purchaseValue: 5000,
        currentValue: 7000,
        currency: 'USD',
        includeInNetWorth: true,
      });

      const linkedAccounts = accountsStore.accounts.filter((a) => a.linkedAssetId);
      expect(linkedAccounts).toHaveLength(0);
    });

    it('should delete linked loan account when asset is deleted', async () => {
      const assetsStore = useAssetsStore();
      const accountsStore = useAccountsStore();

      const asset = await assetsStore.createAsset({
        memberId: 'member-1',
        name: 'Boat',
        type: 'boat',
        purchaseValue: 60000,
        currentValue: 50000,
        currency: 'USD',
        includeInNetWorth: true,
        loan: mockLoan({ outstandingBalance: 40000 }),
      });

      expect(accountsStore.accounts.filter((a) => a.linkedAssetId)).toHaveLength(1);

      await assetsStore.deleteAsset(asset!.id);

      expect(accountsStore.accounts.filter((a) => a.linkedAssetId)).toHaveLength(0);
    });

    it('should delete linked loan account when loan is removed from asset', async () => {
      const assetsStore = useAssetsStore();
      const accountsStore = useAccountsStore();

      const asset = await assetsStore.createAsset({
        memberId: 'member-1',
        name: 'Car',
        type: 'vehicle',
        purchaseValue: 40000,
        currentValue: 35000,
        currency: 'USD',
        includeInNetWorth: true,
        loan: mockLoan({ outstandingBalance: 20000 }),
      });

      expect(accountsStore.accounts.filter((a) => a.linkedAssetId)).toHaveLength(1);

      // Update asset to remove loan
      await assetsStore.updateAsset(asset!.id, {
        loan: { hasLoan: false },
      });

      expect(accountsStore.accounts.filter((a) => a.linkedAssetId)).toHaveLength(0);
    });
  });

  describe('No double-counting', () => {
    it('net worth should be consistent whether calculated from accounts or combined', () => {
      const accountsStore = useAccountsStore();
      const assetsStore = useAssetsStore();

      // Set up scenario: house worth 400k with 200k loan, 50k in checking, 3k on credit card
      accountsStore.accounts.push(
        mockAccount({ id: 'a1', type: 'checking', balance: 50000 }),
        mockAccount({ id: 'a2', type: 'credit_card', balance: 3000 }),
        mockAccount({ id: 'a3', type: 'loan', balance: 200000, linkedAssetId: 'asset-1' })
      );
      assetsStore.assets.push(
        mockAsset({
          id: 'asset-1',
          currentValue: 400000,
          loan: mockLoan({ outstandingBalance: 200000 }),
        })
      );

      // Expected net worth: 50000 - 3000 - 200000 + 400000 = 247000
      expect(accountsStore.combinedNetWorth).toBe(247000);

      // Verify: accounts only net + asset value = combined
      expect(accountsStore.totalBalance + assetsStore.totalAssetValue).toBe(
        accountsStore.combinedNetWorth
      );
    });
  });
});
