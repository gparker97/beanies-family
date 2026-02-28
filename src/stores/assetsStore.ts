import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { useMemberFilterStore } from './memberFilterStore';
import { useTombstoneStore } from './tombstoneStore';
import { convertToBaseCurrency } from '@/utils/currency';
import * as assetRepo from '@/services/indexeddb/repositories/assetRepository';
import type { Asset, CreateAssetInput, UpdateAssetInput } from '@/types/models';

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
  const filteredAssets = computed(() => {
    const memberFilter = useMemberFilterStore();
    if (!memberFilter.isInitialized || memberFilter.isAllSelected) {
      return assets.value;
    }
    return assets.value.filter((a) => memberFilter.isMemberSelected(a.memberId));
  });

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

  // Actions
  async function loadAssets() {
    isLoading.value = true;
    error.value = null;
    try {
      assets.value = await assetRepo.getAllAssets();
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to load assets';
    } finally {
      isLoading.value = false;
    }
  }

  async function createAsset(input: CreateAssetInput): Promise<Asset | null> {
    isLoading.value = true;
    error.value = null;
    try {
      const asset = await assetRepo.createAsset(input);
      assets.value.push(asset);
      return asset;
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to create asset';
      return null;
    } finally {
      isLoading.value = false;
    }
  }

  async function updateAsset(id: string, input: UpdateAssetInput): Promise<Asset | null> {
    isLoading.value = true;
    error.value = null;
    try {
      const updated = await assetRepo.updateAsset(id, input);
      if (updated) {
        const index = assets.value.findIndex((a) => a.id === id);
        if (index !== -1) {
          assets.value[index] = updated;
        }
      }
      return updated ?? null;
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to update asset';
      return null;
    } finally {
      isLoading.value = false;
    }
  }

  async function deleteAsset(id: string): Promise<boolean> {
    isLoading.value = true;
    error.value = null;
    try {
      const success = await assetRepo.deleteAsset(id);
      if (success) {
        useTombstoneStore().recordDeletion('asset', id);
        assets.value = assets.value.filter((a) => a.id !== id);
      }
      return success;
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to delete asset';
      return false;
    } finally {
      isLoading.value = false;
    }
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
