<script setup lang="ts">
import { ref, computed, toRaw } from 'vue';
import CurrencyAmount from '@/components/common/CurrencyAmount.vue';
import { BaseButton, BaseInput, BaseSelect, BaseModal } from '@/components/ui';
import { useCurrencyDisplay } from '@/composables/useCurrencyDisplay';
import { usePrivacyMode } from '@/composables/usePrivacyMode';
import { useTranslation } from '@/composables/useTranslation';
import { CURRENCIES } from '@/constants/currencies';
import { useAssetsStore } from '@/stores/assetsStore';
import { useFamilyStore } from '@/stores/familyStore';
import { useSettingsStore } from '@/stores/settingsStore';
import type {
  Asset,
  AssetType,
  CreateAssetInput,
  UpdateAssetInput,
  AssetLoan,
} from '@/types/models';

const assetsStore = useAssetsStore();
const familyStore = useFamilyStore();
const settingsStore = useSettingsStore();
const { formatInDisplayCurrency } = useCurrencyDisplay();
const { formatMasked, isUnlocked } = usePrivacyMode();
const { t } = useTranslation();

const showAddModal = ref(false);
const showEditModal = ref(false);
const isSubmitting = ref(false);

// Asset type options
const assetTypes = computed(() => [
  { value: 'real_estate' as AssetType, label: t('assets.type.real_estate') },
  { value: 'vehicle' as AssetType, label: t('assets.type.vehicle') },
  { value: 'boat' as AssetType, label: t('assets.type.boat') },
  { value: 'jewelry' as AssetType, label: t('assets.type.jewelry') },
  { value: 'electronics' as AssetType, label: t('assets.type.electronics') },
  { value: 'equipment' as AssetType, label: t('assets.type.equipment') },
  { value: 'art' as AssetType, label: t('assets.type.art') },
  { value: 'collectible' as AssetType, label: t('assets.type.collectible') },
  { value: 'other' as AssetType, label: t('assets.type.other') },
]);

const currencyOptions = CURRENCIES.map((c) => ({
  value: c.code,
  label: `${c.code} - ${c.name}`,
}));

const memberOptions = computed(() =>
  familyStore.members.map((m) => ({
    value: m.id,
    label: m.name,
  }))
);

// Default loan state
function getDefaultLoan(): AssetLoan {
  return {
    hasLoan: false,
    loanAmount: undefined,
    outstandingBalance: undefined,
    interestRate: undefined,
    monthlyPayment: undefined,
    loanTermMonths: undefined,
    lender: undefined,
    loanStartDate: undefined,
  };
}

// New asset form state
const newAsset = ref<CreateAssetInput>({
  memberId: familyStore.currentMemberId || '',
  name: '',
  type: 'real_estate',
  purchaseValue: 0,
  currentValue: 0,
  purchaseDate: undefined,
  currency: settingsStore.baseCurrency,
  notes: '',
  includeInNetWorth: true,
  loan: getDefaultLoan(),
});

// Edit asset form state
const editingAssetId = ref<string | null>(null);
const editingAsset = ref<
  UpdateAssetInput & {
    name: string;
    memberId: string;
    type: AssetType;
    purchaseValue: number;
    currentValue: number;
    currency: string;
  }
>({
  name: '',
  memberId: '',
  type: 'real_estate',
  purchaseValue: 0,
  currentValue: 0,
  purchaseDate: undefined,
  currency: 'USD',
  notes: '',
  includeInNetWorth: true,
  loan: getDefaultLoan(),
});

// Uses filtered data based on global member filter
const assets = computed(() => assetsStore.filteredAssets);

// Group assets by type
const assetsByType = computed(() => {
  const groups = new Map<AssetType, Asset[]>();
  const typeOrder: AssetType[] = [
    'real_estate',
    'vehicle',
    'boat',
    'jewelry',
    'electronics',
    'equipment',
    'art',
    'collectible',
    'other',
  ];

  for (const asset of assets.value) {
    const existing = groups.get(asset.type) || [];
    existing.push(asset);
    groups.set(asset.type, existing);
  }

  return typeOrder
    .filter((type) => groups.has(type))
    .map((type) => ({
      type,
      label: getAssetTypeLabel(type),
      assets: groups.get(type) || [],
    }));
});

function formatTotal(amount: number): string {
  return formatMasked(formatInDisplayCurrency(amount, settingsStore.baseCurrency));
}

function getAssetTypeLabel(type: AssetType): string {
  return assetTypes.value.find((t) => t.value === type)?.label || type;
}

function getMemberName(memberId: string): string {
  const member = familyStore.members.find((m) => m.id === memberId);
  return member?.name || 'Unknown';
}

function getMemberColor(memberId: string): string {
  const member = familyStore.members.find((m) => m.id === memberId);
  return member?.color || '#6b7280';
}

// Get icon and color config for each asset type
function getAssetTypeConfig(type: AssetType): {
  bgColor: string;
  iconColor: string;
  darkBgColor: string;
} {
  const configs: Record<AssetType, { bgColor: string; iconColor: string; darkBgColor: string }> = {
    real_estate: {
      bgColor: 'bg-blue-100',
      iconColor: 'text-blue-600',
      darkBgColor: 'dark:bg-blue-900/30',
    },
    vehicle: {
      bgColor: 'bg-purple-100',
      iconColor: 'text-purple-600',
      darkBgColor: 'dark:bg-purple-900/30',
    },
    boat: {
      bgColor: 'bg-cyan-100',
      iconColor: 'text-cyan-600',
      darkBgColor: 'dark:bg-cyan-900/30',
    },
    jewelry: {
      bgColor: 'bg-amber-100',
      iconColor: 'text-amber-600',
      darkBgColor: 'dark:bg-amber-900/30',
    },
    electronics: {
      bgColor: 'bg-slate-100',
      iconColor: 'text-slate-600',
      darkBgColor: 'dark:bg-slate-700',
    },
    equipment: {
      bgColor: 'bg-orange-100',
      iconColor: 'text-orange-600',
      darkBgColor: 'dark:bg-orange-900/30',
    },
    art: { bgColor: 'bg-pink-100', iconColor: 'text-pink-600', darkBgColor: 'dark:bg-pink-900/30' },
    collectible: {
      bgColor: 'bg-indigo-100',
      iconColor: 'text-indigo-600',
      darkBgColor: 'dark:bg-indigo-900/30',
    },
    other: { bgColor: 'bg-gray-100', iconColor: 'text-gray-600', darkBgColor: 'dark:bg-gray-700' },
  };
  return configs[type] || configs.other;
}

function formatDate(isoString: string | undefined): string {
  if (!isoString) return '';
  return new Date(isoString).toLocaleDateString();
}

function openAddModal() {
  newAsset.value = {
    memberId: familyStore.currentMemberId || familyStore.members[0]?.id || '',
    name: '',
    type: 'real_estate',
    purchaseValue: 0,
    currentValue: 0,
    purchaseDate: undefined,
    currency: settingsStore.baseCurrency,
    notes: '',
    includeInNetWorth: true,
    loan: getDefaultLoan(),
  };
  showAddModal.value = true;
}

function openEditModal(asset: Asset) {
  editingAssetId.value = asset.id;
  editingAsset.value = {
    name: asset.name,
    memberId: asset.memberId,
    type: asset.type,
    purchaseValue: asset.purchaseValue,
    currentValue: asset.currentValue,
    purchaseDate: asset.purchaseDate,
    currency: asset.currency,
    notes: asset.notes || '',
    includeInNetWorth: asset.includeInNetWorth,
    loan: asset.loan ? { ...asset.loan } : getDefaultLoan(),
  };
  showEditModal.value = true;
}

function closeEditModal() {
  showEditModal.value = false;
  editingAssetId.value = null;
}

async function createAsset() {
  if (!newAsset.value.name.trim()) return;

  isSubmitting.value = true;
  try {
    // Convert reactive proxy to plain object for IndexedDB storage
    const rawData = toRaw(newAsset.value);
    const assetData: CreateAssetInput = {
      ...rawData,
      loan: rawData.loan ? { ...toRaw(rawData.loan) } : { hasLoan: false },
    };
    // Clean up loan data if no loan
    if (!assetData.loan?.hasLoan) {
      assetData.loan = { hasLoan: false };
    }
    await assetsStore.createAsset(assetData);
    showAddModal.value = false;
  } finally {
    isSubmitting.value = false;
  }
}

async function saveEdit() {
  if (!editingAssetId.value || !editingAsset.value.name.trim()) return;

  isSubmitting.value = true;
  try {
    // Convert reactive proxy to plain object for IndexedDB storage
    const rawData = toRaw(editingAsset.value);
    const assetData: UpdateAssetInput = {
      ...rawData,
      loan: rawData.loan ? { ...toRaw(rawData.loan) } : { hasLoan: false },
    };
    // Clean up loan data if no loan
    if (!assetData.loan?.hasLoan) {
      assetData.loan = { hasLoan: false };
    }
    await assetsStore.updateAsset(editingAssetId.value, assetData);
    closeEditModal();
  } finally {
    isSubmitting.value = false;
  }
}

async function deleteAsset(id: string) {
  if (confirm('Are you sure you want to delete this asset?')) {
    await assetsStore.deleteAsset(id);
  }
}

// Compute appreciation for an asset
function getAppreciation(asset: Asset): number {
  return asset.currentValue - asset.purchaseValue;
}

function getAppreciationPercent(asset: Asset): number {
  if (asset.purchaseValue === 0) return 0;
  return ((asset.currentValue - asset.purchaseValue) / asset.purchaseValue) * 100;
}
</script>

<template>
  <div class="space-y-6">
    <!-- Header -->
    <div class="flex items-center justify-between">
      <div>
        <h1 class="text-2xl font-bold text-gray-900 dark:text-gray-100">{{ t('assets.title') }}</h1>
        <p class="text-gray-500 dark:text-gray-400">{{ t('assets.subtitle') }}</p>
      </div>
      <BaseButton @click="openAddModal">
        <svg class="mr-1.5 -ml-1 h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M12 4v16m8-8H4"
          />
        </svg>
        {{ t('assets.addAsset') }}
      </BaseButton>
    </div>

    <!-- Summary Cards -->
    <div class="grid grid-cols-1 gap-4 md:grid-cols-4">
      <!-- Total Asset Value -->
      <div
        class="rounded-xl bg-gradient-to-br from-green-500 to-emerald-600 p-5 text-white shadow-lg"
      >
        <div class="flex items-center justify-between">
          <div>
            <p class="text-sm font-medium text-green-100">{{ t('common.totalValue') }}</p>
            <p class="mt-1 text-2xl font-bold">
              {{ formatTotal(assetsStore.filteredTotalAssetValue) }}
            </p>
          </div>
          <div class="flex h-12 w-12 items-center justify-center rounded-lg bg-white/20">
            <svg class="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"
              />
            </svg>
          </div>
        </div>
      </div>

      <!-- Total Loans -->
      <div class="rounded-xl bg-gradient-to-br from-red-500 to-rose-600 p-5 text-white shadow-lg">
        <div class="flex items-center justify-between">
          <div>
            <p class="text-sm font-medium text-red-100">{{ t('common.assetLoans') }}</p>
            <p class="mt-1 text-2xl font-bold">
              {{ formatTotal(assetsStore.filteredTotalLoanValue) }}
            </p>
          </div>
          <div class="flex h-12 w-12 items-center justify-center rounded-lg bg-white/20">
            <svg class="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z"
              />
            </svg>
          </div>
        </div>
      </div>

      <!-- Net Asset Value -->
      <div
        class="rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 p-5 text-white shadow-lg"
      >
        <div class="flex items-center justify-between">
          <div>
            <p class="text-sm font-medium text-blue-100">{{ t('common.netAssetValue') }}</p>
            <p class="mt-1 text-2xl font-bold">
              {{ formatTotal(assetsStore.filteredNetAssetValue) }}
            </p>
          </div>
          <div class="flex h-12 w-12 items-center justify-center rounded-lg bg-white/20">
            <svg class="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
          </div>
        </div>
      </div>

      <!-- Total Appreciation -->
      <div
        class="rounded-xl p-5 text-white shadow-lg"
        :class="
          assetsStore.totalAppreciation >= 0
            ? 'bg-gradient-to-br from-teal-500 to-cyan-600'
            : 'bg-gradient-to-br from-orange-500 to-amber-600'
        "
      >
        <div class="flex items-center justify-between">
          <div>
            <p
              class="text-sm font-medium"
              :class="assetsStore.totalAppreciation >= 0 ? 'text-teal-100' : 'text-orange-100'"
            >
              {{
                assetsStore.totalAppreciation >= 0
                  ? t('common.appreciation')
                  : t('common.depreciation')
              }}
            </p>
            <p class="mt-1 text-2xl font-bold">
              {{ formatTotal(Math.abs(assetsStore.totalAppreciation)) }}
            </p>
          </div>
          <div class="flex h-12 w-12 items-center justify-center rounded-lg bg-white/20">
            <svg
              v-if="assetsStore.totalAppreciation >= 0"
              class="h-6 w-6"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6"
              />
            </svg>
            <svg v-else class="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M13 17h8m0 0V9m0 8l-8-8-4 4-6-6"
              />
            </svg>
          </div>
        </div>
      </div>
    </div>

    <!-- Empty State -->
    <div v-if="assets.length === 0" class="py-16 text-center">
      <div
        class="mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-full bg-gray-100 dark:bg-slate-800"
      >
        <svg
          class="h-10 w-10 text-gray-400 dark:text-gray-500"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="1.5"
            d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"
          />
        </svg>
      </div>
      <h3 class="text-lg font-medium text-gray-900 dark:text-gray-100">
        {{ t('assets.noAssets') }}
      </h3>
      <p class="mt-1 mb-4 text-gray-500 dark:text-gray-400">{{ t('assets.getStarted') }}</p>
      <BaseButton @click="openAddModal">
        <svg class="mr-1.5 -ml-1 h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M12 4v16m8-8H4"
          />
        </svg>
        {{ t('assets.addAsset') }}
      </BaseButton>
    </div>

    <!-- Assets Grid by Type -->
    <div v-else class="space-y-8">
      <div v-for="group in assetsByType" :key="group.type">
        <!-- Section Header -->
        <div class="mb-4 flex items-center gap-3">
          <div
            class="flex h-8 w-8 items-center justify-center rounded-lg"
            :class="[
              getAssetTypeConfig(group.type).bgColor,
              getAssetTypeConfig(group.type).darkBgColor,
            ]"
          >
            <!-- Real Estate Icon -->
            <svg
              v-if="group.type === 'real_estate'"
              :class="['h-4 w-4', getAssetTypeConfig(group.type).iconColor]"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"
              />
            </svg>
            <!-- Vehicle Icon -->
            <svg
              v-else-if="group.type === 'vehicle'"
              :class="['h-4 w-4', getAssetTypeConfig(group.type).iconColor]"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M9 17a2 2 0 11-4 0 2 2 0 014 0zM19 17a2 2 0 11-4 0 2 2 0 014 0z"
              />
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M13 16V6a1 1 0 00-1-1H4a1 1 0 00-1 1v10a1 1 0 001 1h1m8-1a1 1 0 01-1 1H9m4-1V8a1 1 0 011-1h2.586a1 1 0 01.707.293l3.414 3.414a1 1 0 01.293.707V16a1 1 0 01-1 1h-1m-6-1a1 1 0 001 1h1M5 17a2 2 0 104 0m-4 0a2 2 0 114 0m6 0a2 2 0 104 0m-4 0a2 2 0 114 0"
              />
            </svg>
            <!-- Boat Icon -->
            <svg
              v-else-if="group.type === 'boat'"
              :class="['h-4 w-4', getAssetTypeConfig(group.type).iconColor]"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M3 21l3-3m0 0l3-3m-3 3l3 3M3 14l3-3m4 0l8-8m-4 4l4-4m-8 8l-4 4m12-4a4 4 0 11-8 0 4 4 0 018 0z"
              />
            </svg>
            <!-- Jewelry Icon -->
            <svg
              v-else-if="group.type === 'jewelry'"
              :class="['h-4 w-4', getAssetTypeConfig(group.type).iconColor]"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z"
              />
            </svg>
            <!-- Electronics Icon -->
            <svg
              v-else-if="group.type === 'electronics'"
              :class="['h-4 w-4', getAssetTypeConfig(group.type).iconColor]"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
              />
            </svg>
            <!-- Equipment Icon -->
            <svg
              v-else-if="group.type === 'equipment'"
              :class="['h-4 w-4', getAssetTypeConfig(group.type).iconColor]"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
              />
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
              />
            </svg>
            <!-- Art Icon -->
            <svg
              v-else-if="group.type === 'art'"
              :class="['h-4 w-4', getAssetTypeConfig(group.type).iconColor]"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
              />
            </svg>
            <!-- Collectible Icon -->
            <svg
              v-else-if="group.type === 'collectible'"
              :class="['h-4 w-4', getAssetTypeConfig(group.type).iconColor]"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"
              />
            </svg>
            <!-- Other Icon -->
            <svg
              v-else
              :class="['h-4 w-4', getAssetTypeConfig(group.type).iconColor]"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"
              />
            </svg>
          </div>
          <h2 class="text-lg font-semibold text-gray-900 dark:text-gray-100">{{ group.label }}</h2>
          <span class="text-sm text-gray-500 dark:text-gray-400">({{ group.assets.length }})</span>
        </div>

        <!-- Asset Cards Grid -->
        <div class="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          <div
            v-for="asset in group.assets"
            :key="asset.id"
            class="rounded-xl border border-gray-200 bg-white p-5 transition-shadow duration-200 hover:shadow-lg dark:border-slate-700 dark:bg-slate-800"
          >
            <!-- Card Header -->
            <div class="mb-4 flex items-start justify-between">
              <div class="flex items-center gap-3">
                <!-- Asset Type Icon -->
                <div
                  class="flex h-12 w-12 items-center justify-center rounded-xl"
                  :class="[
                    getAssetTypeConfig(asset.type).bgColor,
                    getAssetTypeConfig(asset.type).darkBgColor,
                  ]"
                >
                  <!-- Real Estate Icon -->
                  <svg
                    v-if="asset.type === 'real_estate'"
                    :class="['h-6 w-6', getAssetTypeConfig(asset.type).iconColor]"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      stroke-width="2"
                      d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"
                    />
                  </svg>
                  <!-- Vehicle Icon -->
                  <svg
                    v-else-if="asset.type === 'vehicle'"
                    :class="['h-6 w-6', getAssetTypeConfig(asset.type).iconColor]"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      stroke-width="2"
                      d="M9 17a2 2 0 11-4 0 2 2 0 014 0zM19 17a2 2 0 11-4 0 2 2 0 014 0z"
                    />
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      stroke-width="2"
                      d="M13 16V6a1 1 0 00-1-1H4a1 1 0 00-1 1v10a1 1 0 001 1h1m8-1a1 1 0 01-1 1H9m4-1V8a1 1 0 011-1h2.586a1 1 0 01.707.293l3.414 3.414a1 1 0 01.293.707V16a1 1 0 01-1 1h-1m-6-1a1 1 0 001 1h1M5 17a2 2 0 104 0m-4 0a2 2 0 114 0m6 0a2 2 0 104 0m-4 0a2 2 0 114 0"
                    />
                  </svg>
                  <!-- Boat Icon -->
                  <svg
                    v-else-if="asset.type === 'boat'"
                    :class="['h-6 w-6', getAssetTypeConfig(asset.type).iconColor]"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      stroke-width="2"
                      d="M3 21l3-3m0 0l3-3m-3 3l3 3M3 14l3-3m4 0l8-8m-4 4l4-4m-8 8l-4 4m12-4a4 4 0 11-8 0 4 4 0 018 0z"
                    />
                  </svg>
                  <!-- Jewelry Icon -->
                  <svg
                    v-else-if="asset.type === 'jewelry'"
                    :class="['h-6 w-6', getAssetTypeConfig(asset.type).iconColor]"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      stroke-width="2"
                      d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z"
                    />
                  </svg>
                  <!-- Electronics Icon -->
                  <svg
                    v-else-if="asset.type === 'electronics'"
                    :class="['h-6 w-6', getAssetTypeConfig(asset.type).iconColor]"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      stroke-width="2"
                      d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
                    />
                  </svg>
                  <!-- Equipment Icon -->
                  <svg
                    v-else-if="asset.type === 'equipment'"
                    :class="['h-6 w-6', getAssetTypeConfig(asset.type).iconColor]"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      stroke-width="2"
                      d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
                    />
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      stroke-width="2"
                      d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                    />
                  </svg>
                  <!-- Art Icon -->
                  <svg
                    v-else-if="asset.type === 'art'"
                    :class="['h-6 w-6', getAssetTypeConfig(asset.type).iconColor]"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      stroke-width="2"
                      d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
                    />
                  </svg>
                  <!-- Collectible Icon -->
                  <svg
                    v-else-if="asset.type === 'collectible'"
                    :class="['h-6 w-6', getAssetTypeConfig(asset.type).iconColor]"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      stroke-width="2"
                      d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"
                    />
                  </svg>
                  <!-- Other Icon -->
                  <svg
                    v-else
                    :class="['h-6 w-6', getAssetTypeConfig(asset.type).iconColor]"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      stroke-width="2"
                      d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"
                    />
                  </svg>
                </div>
                <div>
                  <h3 class="font-semibold text-gray-900 dark:text-gray-100">{{ asset.name }}</h3>
                  <p v-if="asset.purchaseDate" class="text-sm text-gray-500 dark:text-gray-400">
                    {{ t('common.purchased') }} {{ formatDate(asset.purchaseDate) }}
                  </p>
                </div>
              </div>

              <!-- Action Menu -->
              <div class="flex gap-1">
                <button
                  class="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-blue-600 dark:hover:bg-slate-700"
                  title="Edit asset"
                  @click="openEditModal(asset)"
                >
                  <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      stroke-width="2"
                      d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
                    />
                  </svg>
                </button>
                <button
                  class="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-red-600 dark:hover:bg-slate-700"
                  title="Delete asset"
                  @click="deleteAsset(asset.id)"
                >
                  <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      stroke-width="2"
                      d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                    />
                  </svg>
                </button>
              </div>
            </div>

            <!-- Value Display -->
            <div class="mb-4 grid grid-cols-2 gap-4">
              <div>
                <p class="mb-1 text-xs tracking-wide text-gray-500 uppercase dark:text-gray-400">
                  {{ t('common.currentValue') }}
                </p>
                <div class="text-xl font-bold">
                  <CurrencyAmount
                    :amount="asset.currentValue"
                    :currency="asset.currency"
                    type="income"
                    size="lg"
                  />
                </div>
              </div>
              <div>
                <p class="mb-1 text-xs tracking-wide text-gray-500 uppercase dark:text-gray-400">
                  {{ t('common.purchaseValue') }}
                </p>
                <div class="text-lg text-gray-600 dark:text-gray-400">
                  <CurrencyAmount
                    :amount="asset.purchaseValue"
                    :currency="asset.currency"
                    type="neutral"
                    size="md"
                  />
                </div>
              </div>
            </div>

            <!-- Appreciation/Depreciation Badge -->
            <div class="mb-4">
              <div
                class="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-sm font-medium"
                :class="
                  getAppreciation(asset) >= 0
                    ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                    : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                "
              >
                <svg
                  v-if="getAppreciation(asset) >= 0"
                  class="h-4 w-4"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M5 10l7-7m0 0l7 7m-7-7v18"
                  />
                </svg>
                <svg v-else class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M19 14l-7 7m0 0l-7-7m7 7V3"
                  />
                </svg>
                <CurrencyAmount
                  :amount="Math.abs(getAppreciation(asset))"
                  :currency="asset.currency"
                  type="neutral"
                  size="sm"
                />
                <span v-if="isUnlocked">({{ getAppreciationPercent(asset).toFixed(1) }}%)</span>
              </div>
            </div>

            <!-- Loan Info (if applicable) -->
            <div
              v-if="asset.loan?.hasLoan && asset.loan.outstandingBalance"
              class="mb-4 rounded-lg border border-red-100 bg-red-50 p-3 dark:border-red-900/30 dark:bg-red-900/20"
            >
              <div class="mb-2 flex items-center gap-2">
                <svg
                  class="h-4 w-4 text-red-500"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z"
                  />
                </svg>
                <span class="text-sm font-medium text-red-700 dark:text-red-400">{{
                  t('common.loanOutstanding')
                }}</span>
              </div>
              <div class="text-lg font-bold text-red-600 dark:text-red-400">
                <CurrencyAmount
                  :amount="asset.loan.outstandingBalance"
                  :currency="asset.currency"
                  type="expense"
                  size="lg"
                />
              </div>
              <div
                v-if="asset.loan.monthlyPayment"
                class="mt-1 text-sm text-red-600 dark:text-red-400"
              >
                <CurrencyAmount
                  :amount="asset.loan.monthlyPayment"
                  :currency="asset.currency"
                  type="neutral"
                  size="sm"
                />/month
                <span v-if="asset.loan.interestRate">
                  @ {{ formatMasked(asset.loan.interestRate + '%') }}</span
                >
              </div>
              <div v-if="asset.loan.lender" class="mt-1 text-xs text-red-500 dark:text-red-500">
                {{ asset.loan.lender }}
              </div>
            </div>

            <!-- Notes (if any) -->
            <div v-if="asset.notes" class="mb-4 text-sm text-gray-600 italic dark:text-gray-400">
              "{{ asset.notes }}"
            </div>

            <!-- Card Footer -->
            <div
              class="flex items-center justify-between border-t border-gray-100 pt-3 dark:border-slate-700"
            >
              <!-- Owner Badge -->
              <div class="flex items-center gap-2">
                <div
                  class="flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium text-white"
                  :style="{ backgroundColor: getMemberColor(asset.memberId) }"
                >
                  <svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      stroke-width="2"
                      d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
                    />
                  </svg>
                </div>
                <span class="text-sm text-gray-600 dark:text-gray-400">{{
                  getMemberName(asset.memberId)
                }}</span>
              </div>

              <!-- Status Indicators -->
              <div class="flex items-center gap-2">
                <span
                  v-if="!asset.includeInNetWorth"
                  class="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-600 dark:bg-amber-900/30 dark:text-amber-400"
                  :title="t('status.excluded')"
                >
                  {{ t('status.excluded') }}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Add Asset Modal -->
    <BaseModal
      :open="showAddModal"
      :title="t('assets.addAsset')"
      size="lg"
      @close="showAddModal = false"
    >
      <form class="space-y-4" @submit.prevent="createAsset">
        <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
          <BaseInput
            v-model="newAsset.name"
            :label="t('assets.assetName')"
            placeholder="e.g., Family Home, Toyota Camry"
            required
          />

          <BaseSelect
            v-model="newAsset.type"
            :options="assetTypes"
            :label="t('assets.assetType')"
          />
        </div>

        <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
          <BaseSelect
            v-model="newAsset.memberId"
            :options="memberOptions"
            :label="t('form.owner')"
          />

          <BaseSelect
            v-model="newAsset.currency"
            :options="currencyOptions"
            :label="t('form.currency')"
          />
        </div>

        <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
          <BaseInput
            v-model="newAsset.purchaseValue"
            type="number"
            :label="t('common.purchaseValue')"
            placeholder="0.00"
            step="0.01"
          />

          <BaseInput
            v-model="newAsset.currentValue"
            type="number"
            :label="t('common.currentValue')"
            placeholder="0.00"
            step="0.01"
          />
        </div>

        <BaseInput v-model="newAsset.purchaseDate" type="date" :label="t('assets.purchaseDate')" />

        <BaseInput
          v-model="newAsset.notes"
          :label="t('form.notes')"
          placeholder="Additional details about this asset..."
        />

        <!-- Loan Toggle -->
        <div class="border-t border-gray-200 pt-4 dark:border-slate-700">
          <label class="flex cursor-pointer items-center gap-3">
            <input
              v-model="newAsset.loan!.hasLoan"
              type="checkbox"
              class="h-5 w-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500 dark:border-slate-600"
            />
            <div>
              <span class="font-medium text-gray-900 dark:text-gray-100">{{
                t('assets.hasLoan')
              }}</span>
              <p class="text-sm text-gray-500 dark:text-gray-400">{{ t('assets.hasLoanDesc') }}</p>
            </div>
          </label>
        </div>

        <!-- Loan Details (shown when hasLoan is true) -->
        <div
          v-if="newAsset.loan?.hasLoan"
          class="space-y-4 rounded-lg border border-gray-200 bg-gray-50 p-4 dark:border-slate-700 dark:bg-slate-900"
        >
          <h4 class="font-medium text-gray-900 dark:text-gray-100">
            {{ t('assets.loanDetails') }}
          </h4>

          <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
            <BaseInput
              v-model="newAsset.loan.loanAmount"
              type="number"
              :label="t('assets.originalLoanAmount')"
              placeholder="0.00"
              step="0.01"
            />

            <BaseInput
              v-model="newAsset.loan.outstandingBalance"
              type="number"
              :label="t('assets.outstandingBalance')"
              placeholder="0.00"
              step="0.01"
            />
          </div>

          <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
            <BaseInput
              v-model="newAsset.loan.interestRate"
              type="number"
              :label="t('assets.interestRate')"
              placeholder="5.0"
              step="0.01"
            />

            <BaseInput
              v-model="newAsset.loan.monthlyPayment"
              type="number"
              :label="t('assets.monthlyPayment')"
              placeholder="0.00"
              step="0.01"
            />
          </div>

          <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
            <BaseInput
              v-model="newAsset.loan.loanTermMonths"
              type="number"
              :label="t('assets.loanTerm')"
              placeholder="360"
            />

            <BaseInput
              v-model="newAsset.loan.lender"
              :label="t('assets.lender')"
              placeholder="e.g., Bank of America"
            />
          </div>

          <BaseInput
            v-model="newAsset.loan.loanStartDate"
            type="date"
            :label="t('assets.loanStartDate')"
          />
        </div>

        <div class="flex items-center gap-4">
          <label class="flex cursor-pointer items-center gap-2">
            <input
              v-model="newAsset.includeInNetWorth"
              type="checkbox"
              class="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 dark:border-slate-600"
            />
            <span class="text-sm text-gray-700 dark:text-gray-300">{{
              t('form.includeInNetWorth')
            }}</span>
          </label>
        </div>
      </form>

      <template #footer>
        <div class="flex justify-end gap-3">
          <BaseButton variant="secondary" @click="showAddModal = false">
            {{ t('action.cancel') }}
          </BaseButton>
          <BaseButton :loading="isSubmitting" @click="createAsset">
            {{ t('assets.addAsset') }}
          </BaseButton>
        </div>
      </template>
    </BaseModal>

    <!-- Edit Asset Modal -->
    <BaseModal
      :open="showEditModal"
      :title="t('assets.editAsset')"
      size="lg"
      @close="closeEditModal"
    >
      <form class="space-y-4" @submit.prevent="saveEdit">
        <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
          <BaseInput
            v-model="editingAsset.name"
            :label="t('assets.assetName')"
            placeholder="e.g., Family Home, Toyota Camry"
            required
          />

          <BaseSelect
            v-model="editingAsset.type"
            :options="assetTypes"
            :label="t('assets.assetType')"
          />
        </div>

        <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
          <BaseSelect
            v-model="editingAsset.memberId"
            :options="memberOptions"
            :label="t('form.owner')"
          />

          <BaseSelect
            v-model="editingAsset.currency"
            :options="currencyOptions"
            :label="t('form.currency')"
          />
        </div>

        <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
          <BaseInput
            v-model="editingAsset.purchaseValue"
            type="number"
            :label="t('common.purchaseValue')"
            placeholder="0.00"
            step="0.01"
          />

          <BaseInput
            v-model="editingAsset.currentValue"
            type="number"
            :label="t('common.currentValue')"
            placeholder="0.00"
            step="0.01"
          />
        </div>

        <BaseInput
          v-model="editingAsset.purchaseDate"
          type="date"
          :label="t('assets.purchaseDate')"
        />

        <BaseInput
          v-model="editingAsset.notes"
          :label="t('form.notes')"
          placeholder="Additional details about this asset..."
        />

        <!-- Loan Toggle -->
        <div class="border-t border-gray-200 pt-4 dark:border-slate-700">
          <label class="flex cursor-pointer items-center gap-3">
            <input
              v-model="editingAsset.loan!.hasLoan"
              type="checkbox"
              class="h-5 w-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500 dark:border-slate-600"
            />
            <div>
              <span class="font-medium text-gray-900 dark:text-gray-100">{{
                t('assets.hasLoan')
              }}</span>
              <p class="text-sm text-gray-500 dark:text-gray-400">{{ t('assets.hasLoanDesc') }}</p>
            </div>
          </label>
        </div>

        <!-- Loan Details (shown when hasLoan is true) -->
        <div
          v-if="editingAsset.loan?.hasLoan"
          class="space-y-4 rounded-lg border border-gray-200 bg-gray-50 p-4 dark:border-slate-700 dark:bg-slate-900"
        >
          <h4 class="font-medium text-gray-900 dark:text-gray-100">
            {{ t('assets.loanDetails') }}
          </h4>

          <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
            <BaseInput
              v-model="editingAsset.loan.loanAmount"
              type="number"
              :label="t('assets.originalLoanAmount')"
              placeholder="0.00"
              step="0.01"
            />

            <BaseInput
              v-model="editingAsset.loan.outstandingBalance"
              type="number"
              :label="t('assets.outstandingBalance')"
              placeholder="0.00"
              step="0.01"
            />
          </div>

          <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
            <BaseInput
              v-model="editingAsset.loan.interestRate"
              type="number"
              :label="t('assets.interestRate')"
              placeholder="5.0"
              step="0.01"
            />

            <BaseInput
              v-model="editingAsset.loan.monthlyPayment"
              type="number"
              :label="t('assets.monthlyPayment')"
              placeholder="0.00"
              step="0.01"
            />
          </div>

          <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
            <BaseInput
              v-model="editingAsset.loan.loanTermMonths"
              type="number"
              :label="t('assets.loanTerm')"
              placeholder="360"
            />

            <BaseInput
              v-model="editingAsset.loan.lender"
              :label="t('assets.lender')"
              placeholder="e.g., Bank of America"
            />
          </div>

          <BaseInput
            v-model="editingAsset.loan.loanStartDate"
            type="date"
            :label="t('assets.loanStartDate')"
          />
        </div>

        <div class="flex items-center gap-4">
          <label class="flex cursor-pointer items-center gap-2">
            <input
              v-model="editingAsset.includeInNetWorth"
              type="checkbox"
              class="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 dark:border-slate-600"
            />
            <span class="text-sm text-gray-700 dark:text-gray-300">{{
              t('form.includeInNetWorth')
            }}</span>
          </label>
        </div>
      </form>

      <template #footer>
        <div class="flex justify-end gap-3">
          <BaseButton variant="secondary" @click="closeEditModal">
            {{ t('action.cancel') }}
          </BaseButton>
          <BaseButton :loading="isSubmitting" @click="saveEdit">
            {{ t('action.saveChanges') }}
          </BaseButton>
        </div>
      </template>
    </BaseModal>
  </div>
</template>
