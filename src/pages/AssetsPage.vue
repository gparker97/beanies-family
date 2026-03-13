<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import CurrencyAmount from '@/components/common/CurrencyAmount.vue';
import SummaryStatCard from '@/components/dashboard/SummaryStatCard.vue';

import { BaseButton } from '@/components/ui';
import BeanieIcon from '@/components/ui/BeanieIcon.vue';
import EmptyStateIllustration from '@/components/ui/EmptyStateIllustration.vue';
import AssetModal from '@/components/assets/AssetModal.vue';
import { usePrivacyMode } from '@/composables/usePrivacyMode';
import { useSounds } from '@/composables/useSounds';
import { useSyncHighlight } from '@/composables/useSyncHighlight';
import { useTranslation } from '@/composables/useTranslation';
import { confirm as showConfirm } from '@/composables/useConfirm';
import { useMemberInfo } from '@/composables/useMemberInfo';
import { getAssetTypeIcon } from '@/constants/icons';
import { useAssetsStore } from '@/stores/assetsStore';
import { useSettingsStore } from '@/stores/settingsStore';
import type { Asset, AssetType, CreateAssetInput, UpdateAssetInput } from '@/types/models';

const route = useRoute();
const assetsStore = useAssetsStore();
const settingsStore = useSettingsStore();
const { formatMasked, isUnlocked } = usePrivacyMode();
const { t } = useTranslation();
const { getMemberName, getMemberColor } = useMemberInfo();
const { syncHighlightClass } = useSyncHighlight();
const { playWhoosh } = useSounds();

const baseCurrency = computed(() => settingsStore.baseCurrency);
const totalAssetValue = computed(() => assetsStore.filteredTotalAssetValue);
const totalLoanValue = computed(() => assetsStore.filteredTotalLoanValue);
const netAssetValue = computed(() => assetsStore.filteredNetAssetValue);
const totalAppreciation = computed(() => assetsStore.totalAppreciation);

// Dual modal pattern
const showAddModal = ref(false);
const showEditModal = ref(false);
const editingAsset = ref<Asset | null>(null);
const addModalDefaults = ref<{ memberId?: string; type?: AssetType } | undefined>();

// Open edit modal from query param (e.g. navigated from Dashboard)
onMounted(() => {
  const viewId = route.query.view as string | undefined;
  if (viewId) {
    const asset = assetsStore.assets.find((a) => a.id === viewId);
    if (asset) openEditModal(asset);
  }
});

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

// Uses filtered data based on global member filter
const assets = computed(() => assetsStore.filteredAssets);

// Group assets by type
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

const assetsByType = computed(() => {
  const groups = new Map<AssetType, Asset[]>();

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

function getAssetTypeLabel(type: AssetType): string {
  return assetTypes.value.find((t) => t.value === type)?.label || type;
}

// Get icon and color config for each asset type
function getAssetTypeConfig(type: AssetType): {
  bgColor: string;
  iconColor: string;
  darkBgColor: string;
} {
  const configs: Record<AssetType, { bgColor: string; iconColor: string; darkBgColor: string }> = {
    real_estate: {
      bgColor: 'bg-sky-silk-100',
      iconColor: 'text-primary-600',
      darkBgColor: 'dark:bg-primary-900/30',
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
      bgColor: 'bg-sky-silk-100',
      iconColor: 'text-secondary-400',
      darkBgColor: 'dark:bg-secondary-400/30',
    },
    other: { bgColor: 'bg-gray-100', iconColor: 'text-gray-600', darkBgColor: 'dark:bg-gray-700' },
  };
  return configs[type] || configs.other;
}

function formatPurchaseDate(isoString: string | undefined): string {
  if (!isoString) return '';
  return new Date(isoString).toLocaleDateString();
}

// Modal handlers
function openAddWithDefaults(defaults?: { memberId?: string; type?: AssetType }) {
  addModalDefaults.value = defaults;
  editingAsset.value = null;
  showAddModal.value = true;
}

function openEditModal(asset: Asset) {
  editingAsset.value = asset;
  showEditModal.value = true;
}

function closeEditModal() {
  showEditModal.value = false;
  editingAsset.value = null;
}

async function handleAssetSave(data: CreateAssetInput | { id: string; data: UpdateAssetInput }) {
  if ('id' in data) {
    await assetsStore.updateAsset(data.id, data.data);
    closeEditModal();
  } else {
    await assetsStore.createAsset(data);
    showAddModal.value = false;
  }
}

async function handleAssetDelete(id: string) {
  closeEditModal();
  if (await showConfirm({ title: 'confirm.deleteAssetTitle', message: 'assets.deleteConfirm' })) {
    await assetsStore.deleteAsset(id);
    playWhoosh();
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
    <!-- Action bar -->
    <div class="flex justify-end">
      <BaseButton @click="openAddWithDefaults()">
        <BeanieIcon name="plus" size="md" class="mr-1.5 -ml-1" />
        {{ t('assets.addAsset') }}
      </BaseButton>
    </div>

    <!-- Summary Cards -->
    <div class="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
      <SummaryStatCard
        :label="t('common.totalValue')"
        :amount="totalAssetValue"
        :currency="baseCurrency"
        :hint="t('hints.assetsTotalValue')"
        tint="green"
      >
        <template #icon>
          <BeanieIcon name="building" size="md" class="text-[#27AE60]" />
        </template>
      </SummaryStatCard>

      <SummaryStatCard
        :label="t('common.assetLoans')"
        :amount="totalLoanValue"
        :currency="baseCurrency"
        :hint="t('hints.assetsLoans')"
        tint="orange"
      >
        <template #icon>
          <BeanieIcon name="wallet" size="md" class="text-primary-500" />
        </template>
      </SummaryStatCard>

      <SummaryStatCard
        :label="t('common.netAssetValue')"
        :amount="netAssetValue"
        :currency="baseCurrency"
        :hint="t('hints.assetsNetValue')"
        tint="slate"
        dark
      >
        <template #icon>
          <BeanieIcon name="dollar-circle" size="md" class="text-white" />
        </template>
      </SummaryStatCard>

      <SummaryStatCard
        :label="totalAppreciation >= 0 ? t('common.appreciation') : t('common.depreciation')"
        :amount="Math.abs(totalAppreciation)"
        :currency="baseCurrency"
        :hint="t('hints.assetsAppreciation')"
        :tint="totalAppreciation >= 0 ? 'green' : 'orange'"
      >
        <template #icon>
          <BeanieIcon
            :name="totalAppreciation >= 0 ? 'trending-up' : 'trending-down'"
            size="md"
            :class="totalAppreciation >= 0 ? 'text-[#27AE60]' : 'text-primary-500'"
          />
        </template>
      </SummaryStatCard>
    </div>

    <!-- Empty State -->
    <div v-if="assets.length === 0" class="py-16 text-center">
      <EmptyStateIllustration variant="assets" class="mb-6" />
      <h3 class="text-lg font-medium text-gray-900 dark:text-gray-100">
        {{ t('assets.noAssets') }}
      </h3>
      <p class="mt-1 mb-4 text-gray-500 dark:text-gray-400">{{ t('assets.getStarted') }}</p>
      <BaseButton @click="openAddWithDefaults()">
        <BeanieIcon name="plus" size="md" class="mr-1.5 -ml-1" />
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
            <BeanieIcon
              :name="`asset-${group.type}`"
              size="sm"
              :style="{ color: getAssetTypeIcon(group.type)?.color }"
            />
          </div>
          <h2 class="nook-section-label text-secondary-500 dark:text-gray-400">
            {{ group.label }}
          </h2>
          <span class="text-sm text-gray-500 dark:text-gray-400">({{ group.assets.length }})</span>
        </div>

        <!-- Asset Cards Grid -->
        <div class="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          <div
            v-for="asset in group.assets"
            :key="asset.id"
            data-testid="asset-card"
            class="cursor-pointer rounded-[var(--sq)] bg-white p-5 shadow-[var(--card-shadow)] transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:shadow-[var(--card-hover-shadow)] dark:bg-slate-800"
            :class="syncHighlightClass(asset.id)"
            @click="openEditModal(asset)"
          >
            <!-- Card Header -->
            <div class="mb-4 flex items-start justify-between">
              <div class="flex items-center gap-3">
                <!-- Asset Type Icon -->
                <div
                  class="flex h-[42px] w-[42px] items-center justify-center rounded-[14px]"
                  :class="[
                    getAssetTypeConfig(asset.type).bgColor,
                    getAssetTypeConfig(asset.type).darkBgColor,
                  ]"
                >
                  <BeanieIcon
                    :name="`asset-${asset.type}`"
                    size="xl"
                    :style="{ color: getAssetTypeIcon(asset.type)?.color }"
                  />
                </div>
                <div>
                  <h3 class="font-semibold text-gray-900 dark:text-gray-100">{{ asset.name }}</h3>
                  <p v-if="asset.purchaseDate" class="text-sm text-gray-500 dark:text-gray-400">
                    {{ t('common.purchased') }} {{ formatPurchaseDate(asset.purchaseDate) }}
                  </p>
                </div>
              </div>

              <!-- Action dots -->
              <button
                class="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-[var(--tint-slate-5)]"
                @click.stop="openEditModal(asset)"
              >
                ⋯
              </button>
            </div>

            <!-- Value Display -->
            <div class="mb-4 grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <p class="mb-1 text-xs tracking-wide text-gray-500 uppercase dark:text-gray-400">
                  {{ t('common.currentValue') }}
                </p>
                <div class="font-outfit text-xl font-extrabold">
                  <CurrencyAmount
                    :amount="asset.currentValue"
                    :currency="asset.currency"
                    type="income"
                    size="xl"
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
                class="font-outfit inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-semibold"
                :class="
                  getAppreciation(asset) >= 0
                    ? 'bg-[var(--tint-success-10)] text-[#27AE60]'
                    : 'text-primary-500 bg-[var(--tint-orange-8)]'
                "
              >
                <span>{{ getAppreciation(asset) >= 0 ? '↑' : '↓' }}</span>
                <CurrencyAmount
                  :amount="Math.abs(getAppreciation(asset))"
                  :currency="asset.currency"
                  type="neutral"
                  size="sm"
                />
                <span v-if="isUnlocked">({{ getAppreciationPercent(asset).toFixed(1) }}%)</span>
              </div>
            </div>

            <!-- Loan Info (Heritage Orange — not red) -->
            <div
              v-if="asset.loan?.hasLoan && asset.loan.outstandingBalance"
              class="border-primary-100 dark:border-primary-900/30 dark:bg-primary-900/20 mb-4 rounded-xl border bg-[var(--tint-orange-8)] p-3"
            >
              <div class="mb-2 flex items-center gap-2">
                <span>💰</span>
                <span class="font-outfit text-primary-500 text-xs font-semibold">{{
                  t('common.loanOutstanding')
                }}</span>
              </div>
              <div class="font-outfit text-primary-500 text-lg font-extrabold">
                <CurrencyAmount
                  :amount="asset.loan.outstandingBalance"
                  :currency="asset.currency"
                  type="expense"
                  size="xl"
                />
              </div>
              <div v-if="asset.loan.monthlyPayment" class="text-primary-500/80 mt-1 text-xs">
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
              <div v-if="asset.loan.lender" class="text-primary-500/70 mt-0.5 text-xs">
                {{ asset.loan.lender
                }}<span v-if="asset.loan.lenderCountry">
                  &middot; {{ asset.loan.lenderCountry }}</span
                >
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
                  <BeanieIcon name="user" size="xs" />
                </div>
                <span class="text-sm text-gray-600 dark:text-gray-400">{{
                  getMemberName(asset.memberId)
                }}</span>
              </div>

              <!-- Status Indicators -->
              <div class="flex items-center gap-2">
                <span
                  v-if="!asset.includeInNetWorth"
                  class="font-outfit rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-600 dark:bg-amber-900/30 dark:text-amber-400"
                  :title="t('status.excluded')"
                >
                  {{ t('status.excluded') }}
                </span>
              </div>
            </div>
          </div>

          <!-- Dashed Add Card -->
          <button
            type="button"
            data-testid="add-asset-card"
            class="hover:border-primary-300 hover:text-primary-500 dark:hover:border-primary-500 dark:hover:text-primary-400 flex min-h-[280px] flex-col items-center justify-center gap-2 rounded-[var(--sq)] border-2 border-dashed border-gray-200 bg-transparent p-5 text-gray-400 transition-colors dark:border-slate-600 dark:text-gray-500"
            @click="openAddWithDefaults({ type: group.type })"
          >
            <BeanieIcon name="plus" size="lg" />
            <span class="font-outfit text-sm font-semibold">
              {{ t('assets.addAnAsset') }}
            </span>
          </button>
        </div>
      </div>
    </div>

    <!-- Add Asset Modal -->
    <AssetModal
      :open="showAddModal"
      :defaults="addModalDefaults"
      @close="showAddModal = false"
      @save="handleAssetSave"
      @delete="handleAssetDelete"
    />

    <!-- Edit Asset Modal -->
    <AssetModal
      :open="showEditModal"
      :asset="editingAsset"
      @close="closeEditModal"
      @save="handleAssetSave"
      @delete="handleAssetDelete"
    />
  </div>
</template>
