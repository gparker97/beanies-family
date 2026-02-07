import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { useAssetsStore } from './assetsStore';
import { useSettingsStore } from './settingsStore';
import type { Asset, AssetLoan } from '@/types/models';

// Mock the asset repository
vi.mock('@/services/indexeddb/repositories/assetRepository', () => ({
  getAllAssets: vi.fn(),
  getAssetById: vi.fn(),
  createAsset: vi.fn(),
  updateAsset: vi.fn(),
  deleteAsset: vi.fn(),
}));

// Mock the settings repository to prevent actual DB calls
vi.mock('@/services/indexeddb/repositories/settingsRepository', () => ({
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

import * as assetRepo from '@/services/indexeddb/repositories/assetRepository';

// Helper to create a mock asset
function createMockAsset(overrides: Partial<Asset> = {}): Asset {
  return {
    id: 'test-asset-1',
    memberId: 'member-1',
    name: 'Test House',
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

// Helper to create a mock loan
function createMockLoan(overrides: Partial<AssetLoan> = {}): AssetLoan {
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

describe('assetsStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();

    // Setup settings store with default base currency
    const settingsStore = useSettingsStore();
    settingsStore.settings.baseCurrency = 'USD';
    settingsStore.settings.exchangeRates = [];
  });

  describe('CRUD Operations', () => {
    describe('loadAssets', () => {
      it('should load assets from repository', async () => {
        const store = useAssetsStore();
        const mockAssets = [createMockAsset({ id: 'asset-1' }), createMockAsset({ id: 'asset-2' })];

        vi.mocked(assetRepo.getAllAssets).mockResolvedValue(mockAssets);

        await store.loadAssets();

        expect(store.assets).toHaveLength(2);
        expect(assetRepo.getAllAssets).toHaveBeenCalled();
      });

      it('should handle errors gracefully', async () => {
        const store = useAssetsStore();

        vi.mocked(assetRepo.getAllAssets).mockRejectedValue(new Error('Database error'));

        await store.loadAssets();

        expect(store.error).toBe('Database error');
        expect(store.assets).toHaveLength(0);
      });
    });

    describe('createAsset', () => {
      it('should create asset and add to store', async () => {
        const store = useAssetsStore();
        const newAsset = createMockAsset();

        vi.mocked(assetRepo.createAsset).mockResolvedValue(newAsset);

        const result = await store.createAsset({
          memberId: 'member-1',
          name: 'Test House',
          type: 'real_estate',
          purchaseValue: 300000,
          currentValue: 350000,
          currency: 'USD',
          includeInNetWorth: true,
        });

        expect(result).not.toBeNull();
        expect(result?.name).toBe('Test House');
        expect(store.assets).toHaveLength(1);
      });

      it('should create asset with loan details', async () => {
        const store = useAssetsStore();
        const assetWithLoan = createMockAsset({
          loan: createMockLoan(),
        });

        vi.mocked(assetRepo.createAsset).mockResolvedValue(assetWithLoan);

        const result = await store.createAsset({
          memberId: 'member-1',
          name: 'Test House',
          type: 'real_estate',
          purchaseValue: 300000,
          currentValue: 350000,
          currency: 'USD',
          includeInNetWorth: true,
          loan: createMockLoan(),
        });

        expect(result).not.toBeNull();
        expect(result?.loan?.hasLoan).toBe(true);
        expect(result?.loan?.outstandingBalance).toBe(200000);
      });

      it('should handle creation errors', async () => {
        const store = useAssetsStore();

        vi.mocked(assetRepo.createAsset).mockRejectedValue(new Error('Creation failed'));

        const result = await store.createAsset({
          memberId: 'member-1',
          name: 'Test House',
          type: 'real_estate',
          purchaseValue: 300000,
          currentValue: 350000,
          currency: 'USD',
          includeInNetWorth: true,
        });

        expect(result).toBeNull();
        expect(store.error).toBe('Creation failed');
      });
    });

    describe('updateAsset', () => {
      it('should update asset and reflect changes in store', async () => {
        const store = useAssetsStore();
        const originalAsset = createMockAsset();
        store.assets.push(originalAsset);

        const updatedAsset = { ...originalAsset, currentValue: 400000 };
        vi.mocked(assetRepo.updateAsset).mockResolvedValue(updatedAsset);

        const result = await store.updateAsset('test-asset-1', { currentValue: 400000 });

        expect(result).not.toBeNull();
        expect(result?.currentValue).toBe(400000);
        expect(store.assets[0]?.currentValue).toBe(400000);
      });

      it('should update loan details on existing asset', async () => {
        const store = useAssetsStore();
        const originalAsset = createMockAsset({ loan: { hasLoan: false } });
        store.assets.push(originalAsset);

        const updatedAsset = {
          ...originalAsset,
          loan: createMockLoan({ outstandingBalance: 180000 }),
        };
        vi.mocked(assetRepo.updateAsset).mockResolvedValue(updatedAsset);

        const result = await store.updateAsset('test-asset-1', {
          loan: createMockLoan({ outstandingBalance: 180000 }),
        });

        expect(result?.loan?.hasLoan).toBe(true);
        expect(result?.loan?.outstandingBalance).toBe(180000);
      });

      it('should return null when asset not found', async () => {
        const store = useAssetsStore();

        vi.mocked(assetRepo.updateAsset).mockResolvedValue(undefined);

        const result = await store.updateAsset('non-existent', { currentValue: 500000 });

        expect(result).toBeNull();
      });
    });

    describe('deleteAsset', () => {
      it('should delete asset and remove from store', async () => {
        const store = useAssetsStore();
        store.assets.push(createMockAsset());

        vi.mocked(assetRepo.deleteAsset).mockResolvedValue(true);

        const result = await store.deleteAsset('test-asset-1');

        expect(result).toBe(true);
        expect(store.assets).toHaveLength(0);
      });

      it('should return false when deletion fails', async () => {
        const store = useAssetsStore();

        vi.mocked(assetRepo.deleteAsset).mockResolvedValue(false);

        const result = await store.deleteAsset('non-existent');

        expect(result).toBe(false);
      });
    });

    describe('getAssetById', () => {
      it('should return asset by id', () => {
        const store = useAssetsStore();
        store.assets.push(createMockAsset({ id: 'asset-1', name: 'House' }));
        store.assets.push(createMockAsset({ id: 'asset-2', name: 'Car' }));

        const result = store.getAssetById('asset-2');

        expect(result).toBeDefined();
        expect(result?.name).toBe('Car');
      });

      it('should return undefined for non-existent id', () => {
        const store = useAssetsStore();

        const result = store.getAssetById('non-existent');

        expect(result).toBeUndefined();
      });
    });

    describe('getAssetsByMemberId', () => {
      it('should return assets for a specific member', () => {
        const store = useAssetsStore();
        store.assets.push(
          createMockAsset({ id: 'asset-1', memberId: 'member-1' }),
          createMockAsset({ id: 'asset-2', memberId: 'member-1' }),
          createMockAsset({ id: 'asset-3', memberId: 'member-2' })
        );

        const result = store.getAssetsByMemberId('member-1');

        expect(result).toHaveLength(2);
        expect(result.every((a) => a.memberId === 'member-1')).toBe(true);
      });
    });
  });

  describe('Summary Card Calculations - Asset Values', () => {
    describe('totalAssetValue', () => {
      it('should sum current values of all assets included in net worth', () => {
        const store = useAssetsStore();

        store.assets.push(
          createMockAsset({ id: 'asset-1', currentValue: 350000 }),
          createMockAsset({ id: 'asset-2', currentValue: 50000 }),
          createMockAsset({ id: 'asset-3', currentValue: 25000 })
        );

        // Total: 350000 + 50000 + 25000 = 425000
        expect(store.totalAssetValue).toBe(425000);
      });

      it('should exclude assets not included in net worth', () => {
        const store = useAssetsStore();

        store.assets.push(
          createMockAsset({ id: 'asset-1', currentValue: 350000, includeInNetWorth: true }),
          createMockAsset({ id: 'asset-2', currentValue: 50000, includeInNetWorth: false }),
          createMockAsset({ id: 'asset-3', currentValue: 25000, includeInNetWorth: true })
        );

        // Only included: 350000 + 25000 = 375000
        expect(store.totalAssetValue).toBe(375000);
      });

      it('should return 0 when no assets exist', () => {
        const store = useAssetsStore();

        expect(store.totalAssetValue).toBe(0);
      });
    });

    describe('totalPurchaseValue', () => {
      it('should sum purchase values of all assets', () => {
        const store = useAssetsStore();

        store.assets.push(
          createMockAsset({ id: 'asset-1', purchaseValue: 300000 }),
          createMockAsset({ id: 'asset-2', purchaseValue: 40000 }),
          createMockAsset({ id: 'asset-3', purchaseValue: 20000 })
        );

        // Total: 300000 + 40000 + 20000 = 360000
        expect(store.totalPurchaseValue).toBe(360000);
      });

      it('should include all assets regardless of includeInNetWorth flag', () => {
        const store = useAssetsStore();

        store.assets.push(
          createMockAsset({ id: 'asset-1', purchaseValue: 300000, includeInNetWorth: true }),
          createMockAsset({ id: 'asset-2', purchaseValue: 40000, includeInNetWorth: false })
        );

        // All assets: 300000 + 40000 = 340000
        expect(store.totalPurchaseValue).toBe(340000);
      });
    });

    describe('totalAppreciation', () => {
      it('should calculate total appreciation (current - purchase)', () => {
        const store = useAssetsStore();

        store.assets.push(
          createMockAsset({ id: 'asset-1', purchaseValue: 300000, currentValue: 350000 }), // +50000
          createMockAsset({ id: 'asset-2', purchaseValue: 40000, currentValue: 35000 }) // -5000
        );

        // Total appreciation: 50000 + (-5000) = 45000
        expect(store.totalAppreciation).toBe(45000);
      });

      it('should return negative value when assets depreciate', () => {
        const store = useAssetsStore();

        store.assets.push(
          createMockAsset({ id: 'asset-1', purchaseValue: 50000, currentValue: 40000 }), // -10000
          createMockAsset({ id: 'asset-2', purchaseValue: 30000, currentValue: 25000 }) // -5000
        );

        // Total depreciation: -10000 + (-5000) = -15000
        expect(store.totalAppreciation).toBe(-15000);
      });

      it('should return 0 when no change in value', () => {
        const store = useAssetsStore();

        store.assets.push(createMockAsset({ id: 'asset-1', purchaseValue: 100000, currentValue: 100000 }));

        expect(store.totalAppreciation).toBe(0);
      });
    });
  });

  describe('Summary Card Calculations - Loan Values', () => {
    describe('totalLoanValue', () => {
      it('should sum outstanding loan balances for assets with loans', () => {
        const store = useAssetsStore();

        store.assets.push(
          createMockAsset({
            id: 'asset-1',
            loan: createMockLoan({ outstandingBalance: 200000 }),
          }),
          createMockAsset({
            id: 'asset-2',
            loan: createMockLoan({ outstandingBalance: 15000 }),
          })
        );

        // Total loans: 200000 + 15000 = 215000
        expect(store.totalLoanValue).toBe(215000);
      });

      it('should exclude assets without loans', () => {
        const store = useAssetsStore();

        store.assets.push(
          createMockAsset({
            id: 'asset-1',
            loan: createMockLoan({ outstandingBalance: 200000 }),
          }),
          createMockAsset({ id: 'asset-2' }), // No loan
          createMockAsset({ id: 'asset-3', loan: { hasLoan: false } }) // hasLoan is false
        );

        // Only asset-1 has a loan
        expect(store.totalLoanValue).toBe(200000);
      });

      it('should exclude assets not included in net worth', () => {
        const store = useAssetsStore();

        store.assets.push(
          createMockAsset({
            id: 'asset-1',
            includeInNetWorth: true,
            loan: createMockLoan({ outstandingBalance: 200000 }),
          }),
          createMockAsset({
            id: 'asset-2',
            includeInNetWorth: false,
            loan: createMockLoan({ outstandingBalance: 50000 }),
          })
        );

        // Only asset-1 is included in net worth
        expect(store.totalLoanValue).toBe(200000);
      });

      it('should handle assets with hasLoan true but no outstandingBalance', () => {
        const store = useAssetsStore();

        store.assets.push(
          createMockAsset({
            id: 'asset-1',
            loan: { hasLoan: true }, // No outstandingBalance
          })
        );

        expect(store.totalLoanValue).toBe(0);
      });

      it('should return 0 when no assets have loans', () => {
        const store = useAssetsStore();

        store.assets.push(
          createMockAsset({ id: 'asset-1' }),
          createMockAsset({ id: 'asset-2' })
        );

        expect(store.totalLoanValue).toBe(0);
      });
    });

    describe('netAssetValue', () => {
      it('should calculate net asset value (totalAssetValue - totalLoanValue)', () => {
        const store = useAssetsStore();

        store.assets.push(
          createMockAsset({
            id: 'asset-1',
            currentValue: 350000,
            loan: createMockLoan({ outstandingBalance: 200000 }),
          }),
          createMockAsset({
            id: 'asset-2',
            currentValue: 50000,
            loan: createMockLoan({ outstandingBalance: 15000 }),
          })
        );

        // Total asset value: 350000 + 50000 = 400000
        // Total loan value: 200000 + 15000 = 215000
        // Net asset value: 400000 - 215000 = 185000
        expect(store.netAssetValue).toBe(185000);
      });

      it('should return negative when loans exceed asset values', () => {
        const store = useAssetsStore();

        store.assets.push(
          createMockAsset({
            id: 'asset-1',
            currentValue: 100000,
            loan: createMockLoan({ outstandingBalance: 150000 }),
          })
        );

        // Net: 100000 - 150000 = -50000
        expect(store.netAssetValue).toBe(-50000);
      });

      it('should equal totalAssetValue when no loans exist', () => {
        const store = useAssetsStore();

        store.assets.push(
          createMockAsset({ id: 'asset-1', currentValue: 350000 }),
          createMockAsset({ id: 'asset-2', currentValue: 50000 })
        );

        expect(store.netAssetValue).toBe(store.totalAssetValue);
        expect(store.netAssetValue).toBe(400000);
      });
    });
  });

  describe('Grouping Computed Properties', () => {
    describe('assetsByType', () => {
      it('should group assets by type', () => {
        const store = useAssetsStore();

        store.assets.push(
          createMockAsset({ id: 'asset-1', type: 'real_estate' }),
          createMockAsset({ id: 'asset-2', type: 'real_estate' }),
          createMockAsset({ id: 'asset-3', type: 'vehicle' }),
          createMockAsset({ id: 'asset-4', type: 'jewelry' })
        );

        const byType = store.assetsByType;

        expect(byType.get('real_estate')).toHaveLength(2);
        expect(byType.get('vehicle')).toHaveLength(1);
        expect(byType.get('jewelry')).toHaveLength(1);
        expect(byType.get('boat')).toBeUndefined();
      });
    });

    describe('assetsByMember', () => {
      it('should group assets by member', () => {
        const store = useAssetsStore();

        store.assets.push(
          createMockAsset({ id: 'asset-1', memberId: 'member-1' }),
          createMockAsset({ id: 'asset-2', memberId: 'member-1' }),
          createMockAsset({ id: 'asset-3', memberId: 'member-2' })
        );

        const byMember = store.assetsByMember;

        expect(byMember.get('member-1')).toHaveLength(2);
        expect(byMember.get('member-2')).toHaveLength(1);
      });
    });
  });

  describe('Multi-Currency Support', () => {
    beforeEach(() => {
      const settingsStore = useSettingsStore();
      settingsStore.settings.baseCurrency = 'USD';
      settingsStore.settings.exchangeRates = [
        { from: 'EUR', to: 'USD', rate: 1.1 },
        { from: 'GBP', to: 'USD', rate: 1.25 },
      ];
    });

    it('should convert asset values to base currency', () => {
      const store = useAssetsStore();

      store.assets.push(
        createMockAsset({ id: 'asset-1', currentValue: 100000, currency: 'USD' }), // 100000 USD
        createMockAsset({ id: 'asset-2', currentValue: 100000, currency: 'EUR' }) // 100000 * 1.1 = 110000 USD
      );

      // Total: 100000 + 110000 = 210000 USD
      expect(store.totalAssetValue).toBe(210000);
    });

    it('should convert loan values to base currency', () => {
      const store = useAssetsStore();

      store.assets.push(
        createMockAsset({
          id: 'asset-1',
          currency: 'EUR',
          loan: createMockLoan({ outstandingBalance: 100000 }),
        })
      );

      // 100000 EUR * 1.1 = 110000 USD
      expect(store.totalLoanValue).toBeCloseTo(110000, 2);
    });

    it('should calculate net asset value correctly with multiple currencies', () => {
      const store = useAssetsStore();

      store.assets.push(
        createMockAsset({
          id: 'asset-1',
          currentValue: 200000,
          currency: 'EUR', // 200000 * 1.1 = 220000 USD
          loan: createMockLoan({ outstandingBalance: 100000 }), // 100000 * 1.1 = 110000 USD
        }),
        createMockAsset({
          id: 'asset-2',
          currentValue: 50000,
          currency: 'GBP', // 50000 * 1.25 = 62500 USD
        })
      );

      // Total asset value: 220000 + 62500 = 282500 USD
      // Total loan value: 110000 USD
      // Net: 282500 - 110000 = 172500 USD
      expect(store.totalAssetValue).toBeCloseTo(282500, 2);
      expect(store.totalLoanValue).toBeCloseTo(110000, 2);
      expect(store.netAssetValue).toBeCloseTo(172500, 2);
    });

    it('should use inverse rate when direct rate not available', () => {
      const settingsStore = useSettingsStore();
      settingsStore.settings.exchangeRates = [
        { from: 'USD', to: 'EUR', rate: 0.9 }, // Inverse: EUR to USD = 1/0.9 ≈ 1.111
      ];

      const store = useAssetsStore();

      store.assets.push(createMockAsset({ id: 'asset-1', currentValue: 90000, currency: 'EUR' }));

      // 90000 EUR * (1/0.9) = 100000 USD
      expect(store.totalAssetValue).toBe(100000);
    });
  });
});

describe('assetsStore Integration with accountsStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();

    // Setup settings store with default base currency
    const settingsStore = useSettingsStore();
    settingsStore.settings.baseCurrency = 'USD';
    settingsStore.settings.exchangeRates = [];
  });

  // Import accountsStore after pinia is set up
  it('should contribute to combinedNetWorth in accountsStore', async () => {
    const { useAccountsStore } = await import('./accountsStore');
    const accountsStore = useAccountsStore();
    const assetsStore = useAssetsStore();

    // Add account assets and liabilities
    accountsStore.accounts.push(
      {
        id: 'acc-1',
        memberId: 'member-1',
        name: 'Checking',
        type: 'checking',
        currency: 'USD',
        balance: 10000,
        isActive: true,
        includeInNetWorth: true,
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      },
      {
        id: 'acc-2',
        memberId: 'member-1',
        name: 'Credit Card',
        type: 'credit_card',
        currency: 'USD',
        balance: 2000,
        isActive: true,
        includeInNetWorth: true,
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      }
    );

    // Add physical assets with a loan
    assetsStore.assets.push(
      createMockAsset({
        id: 'asset-1',
        currentValue: 350000,
        loan: createMockLoan({ outstandingBalance: 200000 }),
      })
    );

    // Account net worth: 10000 - 2000 = 8000
    // Asset net worth: 350000 - 200000 = 150000
    // Combined: 8000 + 150000 = 158000
    expect(accountsStore.totalBalance).toBe(8000);
    expect(assetsStore.netAssetValue).toBe(150000);
    expect(accountsStore.combinedNetWorth).toBe(158000);
  });

  it('should include asset loans in totalLiabilities', async () => {
    const { useAccountsStore } = await import('./accountsStore');
    const accountsStore = useAccountsStore();
    const assetsStore = useAssetsStore();

    // Add account liability
    accountsStore.accounts.push({
      id: 'acc-1',
      memberId: 'member-1',
      name: 'Credit Card',
      type: 'credit_card',
      currency: 'USD',
      balance: 5000,
      isActive: true,
      includeInNetWorth: true,
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    });

    // Add asset with loan
    assetsStore.assets.push(
      createMockAsset({
        id: 'asset-1',
        loan: createMockLoan({ outstandingBalance: 200000 }),
      })
    );

    // Account liabilities: 5000
    // Asset loans: 200000
    // Total: 205000
    expect(accountsStore.accountLiabilities).toBe(5000);
    expect(assetsStore.totalLoanValue).toBe(200000);
    expect(accountsStore.totalLiabilities).toBe(205000);
  });
});

describe('Asset Types', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();

    const settingsStore = useSettingsStore();
    settingsStore.settings.baseCurrency = 'USD';
    settingsStore.settings.exchangeRates = [];
  });

  it('should support all defined asset types', () => {
    const store = useAssetsStore();

    const assetTypes = [
      'real_estate',
      'vehicle',
      'boat',
      'jewelry',
      'electronics',
      'equipment',
      'art',
      'collectible',
      'other',
    ] as const;

    assetTypes.forEach((type, index) => {
      store.assets.push(
        createMockAsset({
          id: `asset-${index}`,
          type,
          name: `Test ${type}`,
        })
      );
    });

    expect(store.assets).toHaveLength(9);

    const byType = store.assetsByType;
    assetTypes.forEach((type) => {
      expect(byType.get(type)).toHaveLength(1);
    });
  });
});

describe('Edge Cases', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();

    const settingsStore = useSettingsStore();
    settingsStore.settings.baseCurrency = 'USD';
    settingsStore.settings.exchangeRates = [];
  });

  it('should handle zero-value assets', () => {
    const store = useAssetsStore();

    store.assets.push(
      createMockAsset({ id: 'asset-1', currentValue: 0, purchaseValue: 0 })
    );

    expect(store.totalAssetValue).toBe(0);
    expect(store.totalPurchaseValue).toBe(0);
    expect(store.totalAppreciation).toBe(0);
  });

  it('should handle assets with zero loan balance', () => {
    const store = useAssetsStore();

    store.assets.push(
      createMockAsset({
        id: 'asset-1',
        currentValue: 350000,
        loan: createMockLoan({ outstandingBalance: 0 }),
      })
    );

    // outstandingBalance is 0, which is falsy, so it won't be counted
    expect(store.totalLoanValue).toBe(0);
    expect(store.netAssetValue).toBe(350000);
  });

  it('should handle very large values', () => {
    const store = useAssetsStore();

    store.assets.push(
      createMockAsset({
        id: 'asset-1',
        currentValue: 10000000000, // 10 billion
        purchaseValue: 5000000000,
        loan: createMockLoan({ outstandingBalance: 8000000000 }),
      })
    );

    expect(store.totalAssetValue).toBe(10000000000);
    expect(store.totalLoanValue).toBe(8000000000);
    expect(store.netAssetValue).toBe(2000000000);
    expect(store.totalAppreciation).toBe(5000000000);
  });

  it('should handle decimal precision', () => {
    const store = useAssetsStore();

    store.assets.push(
      createMockAsset({
        id: 'asset-1',
        currentValue: 123456.78,
        purchaseValue: 100000.50,
      }),
      createMockAsset({
        id: 'asset-2',
        currentValue: 234567.89,
        purchaseValue: 200000.25,
      })
    );

    expect(store.totalAssetValue).toBeCloseTo(358024.67, 2);
    expect(store.totalPurchaseValue).toBeCloseTo(300000.75, 2);
    expect(store.totalAppreciation).toBeCloseTo(58023.92, 2);
  });
});
