import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { createMemberFiltered } from '@/composables/useMemberFiltered';
import { wrapAsync } from '@/composables/useStoreActions';
import { convertToBaseCurrency } from '@/utils/currency';
import * as assetRepo from '@/services/automerge/repositories/assetRepository';
import { useAccountsStore } from './accountsStore';
import type { Asset, CreateAssetInput, UpdateAssetInput, AccountType } from '@/types/models';

export const useAssetsStore = defineStore('assets', () => {
  // State
  const assets = ref<Asset[]>([]);
  const isLoading = ref(false);
  const error = ref<string | null>(null);

  // Getters
  // Total value of all assets (included in net worth), converted to base currency
  const totalAssetValue = computed(() =>
    assets.value
      .filter((a) => a.includeInNetWorth)
      .reduce((sum, a) => sum + convertToBaseCurrency(a.currentValue, a.currency), 0)
  );

  // Total purchase value of all assets, converted to base currency
  const totalPurchaseValue = computed(() =>
    assets.value.reduce((sum, a) => sum + convertToBaseCurrency(a.purchaseValue, a.currency), 0)
  );

  // Total outstanding loan balance for assets with loans (included in net worth)
  const totalLoanValue = computed(() =>
    assets.value
      .filter((a) => a.includeInNetWorth && a.loan?.hasLoan && a.loan?.outstandingBalance)
      .reduce((sum, a) => sum + convertToBaseCurrency(a.loan!.outstandingBalance!, a.currency), 0)
  );

  // Net asset value = total asset value - outstanding loans
  const netAssetValue = computed(() => totalAssetValue.value - totalLoanValue.value);

  // Total appreciation (current value - purchase value)
  const totalAppreciation = computed(() => {
    return assets.value.reduce((sum, a) => {
      const currentConverted = convertToBaseCurrency(a.currentValue, a.currency);
      const purchaseConverted = convertToBaseCurrency(a.purchaseValue, a.currency);
      return sum + (currentConverted - purchaseConverted);
    }, 0);
  });

  const assetsByType = computed(() => {
    const grouped = new Map<string, Asset[]>();
    for (const asset of assets.value) {
      const typeAssets = grouped.get(asset.type) || [];
      typeAssets.push(asset);
      grouped.set(asset.type, typeAssets);
    }
    return grouped;
  });

  const assetsByMember = computed(() => {
    const grouped = new Map<string, Asset[]>();
    for (const asset of assets.value) {
      const memberAssets = grouped.get(asset.memberId) || [];
      memberAssets.push(asset);
      grouped.set(asset.memberId, memberAssets);
    }
    return grouped;
  });

  // ========== FILTERED GETTERS (by global member filter) ==========

  // Assets filtered by global member filter
  const filteredAssets = createMemberFiltered(assets, (a) => a.memberId);

  // Filtered total asset value
  const filteredTotalAssetValue = computed(() =>
    filteredAssets.value
      .filter((a) => a.includeInNetWorth)
      .reduce((sum, a) => sum + convertToBaseCurrency(a.currentValue, a.currency), 0)
  );

  // Filtered total loan value
  const filteredTotalLoanValue = computed(() =>
    filteredAssets.value
      .filter((a) => a.includeInNetWorth && a.loan?.hasLoan && a.loan?.outstandingBalance)
      .reduce((sum, a) => sum + convertToBaseCurrency(a.loan!.outstandingBalance!, a.currency), 0)
  );

  // Filtered net asset value
  const filteredNetAssetValue = computed(
    () => filteredTotalAssetValue.value - filteredTotalLoanValue.value
  );

  // ── Linked loan account sync ──────────────────────────────────────────────
  async function syncLinkedLoanAccount(asset: Asset) {
    const accountsStore = useAccountsStore();
    const existing = accountsStore.accounts.find((a) => a.linkedAssetId === asset.id);

    if (asset.loan?.hasLoan && asset.loan.outstandingBalance) {
      const loanData = {
        name: `${asset.name} Loan`,
        type: 'loan' as AccountType,
        memberId: asset.memberId,
        currency: asset.currency,
        balance: asset.loan.outstandingBalance,
        institution: asset.loan.lender || '',
        isActive: true,
        includeInNetWorth: true,
        linkedAssetId: asset.id,
      };
      if (existing) {
        await accountsStore.updateAccount(existing.id, loanData);
      } else {
        await accountsStore.createAccount(loanData);
      }
    } else if (existing) {
      await accountsStore.deleteAccount(existing.id);
    }
  }

  async function deleteLinkedLoanAccount(assetId: string) {
    const accountsStore = useAccountsStore();
    const existing = accountsStore.accounts.find((a) => a.linkedAssetId === assetId);
    if (existing) {
      await accountsStore.deleteAccount(existing.id);
    }
  }

  // One-time migration: create linked accounts for existing assets with loans
  async function migrateLinkedLoanAccounts() {
    const accountsStore = useAccountsStore();
    for (const asset of assets.value) {
      if (asset.loan?.hasLoan && asset.loan.outstandingBalance) {
        const hasLinked = accountsStore.accounts.some((a) => a.linkedAssetId === asset.id);
        if (!hasLinked) {
          await syncLinkedLoanAccount(asset);
        }
      }
    }
  }

  // Actions
  async function loadAssets() {
    await wrapAsync(isLoading, error, async () => {
      assets.value = await assetRepo.getAllAssets();
    });
    // Run migration after loading (creates linked loan accounts for existing assets)
    await migrateLinkedLoanAccounts();
  }

  async function createAsset(input: CreateAssetInput): Promise<Asset | null> {
    const result = await wrapAsync(isLoading, error, async () => {
      const asset = await assetRepo.createAsset(input);
      // Immutable update: assign a new array so downstream computeds re-evaluate
      assets.value = [...assets.value, asset];
      return asset;
    });
    if (result) await syncLinkedLoanAccount(result);
    return result ?? null;
  }

  async function updateAsset(id: string, input: UpdateAssetInput): Promise<Asset | null> {
    const result = await wrapAsync(isLoading, error, async () => {
      const updated = await assetRepo.updateAsset(id, input);
      if (updated) {
        // Immutable update: assign a new array so downstream computeds re-evaluate
        assets.value = assets.value.map((a) => (a.id === id ? updated : a));
      }
      return updated;
    });
    if (result) await syncLinkedLoanAccount(result);
    return result ?? null;
  }

  async function deleteAsset(id: string): Promise<boolean> {
    await deleteLinkedLoanAccount(id);
    const result = await wrapAsync(isLoading, error, async () => {
      const success = await assetRepo.deleteAsset(id);
      if (success) {
        assets.value = assets.value.filter((a) => a.id !== id);
      }
      return success;
    });
    return result ?? false;
  }

  function getAssetById(id: string): Asset | undefined {
    return assets.value.find((a) => a.id === id);
  }

  function getAssetsByMemberId(memberId: string): Asset[] {
    return assets.value.filter((a) => a.memberId === memberId);
  }

  function resetState() {
    assets.value = [];
    isLoading.value = false;
    error.value = null;
  }

  return {
    // State
    assets,
    isLoading,
    error,
    // Getters
    totalAssetValue,
    totalPurchaseValue,
    totalLoanValue,
    netAssetValue,
    totalAppreciation,
    assetsByType,
    assetsByMember,
    // Filtered getters (by global member filter)
    filteredAssets,
    filteredTotalAssetValue,
    filteredTotalLoanValue,
    filteredNetAssetValue,
    // Actions
    loadAssets,
    createAsset,
    updateAsset,
    deleteAsset,
    getAssetById,
    getAssetsByMemberId,
    resetState,
  };
});
