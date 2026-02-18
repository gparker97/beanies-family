<script setup lang="ts">
import { computed } from 'vue';
import CategoryIcon from '@/components/common/CategoryIcon.vue';
import CurrencyAmount from '@/components/common/CurrencyAmount.vue';
import RecurringSummaryWidget from '@/components/dashboard/RecurringSummaryWidget.vue';
import { BaseCard } from '@/components/ui';
import { useCurrencyDisplay } from '@/composables/useCurrencyDisplay';
import { usePrivacyMode } from '@/composables/usePrivacyMode';
import { useTranslation } from '@/composables/useTranslation';
import { getNextDueDateForItem } from '@/services/recurring/recurringProcessor';
import { useAccountsStore } from '@/stores/accountsStore';
import { useAssetsStore } from '@/stores/assetsStore';
import { useGoalsStore } from '@/stores/goalsStore';
import { useRecurringStore } from '@/stores/recurringStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useTransactionsStore } from '@/stores/transactionsStore';
import type { AssetType } from '@/types/models';
import { formatDateShort } from '@/utils/date';

const accountsStore = useAccountsStore();
const assetsStore = useAssetsStore();
const transactionsStore = useTransactionsStore();
const recurringStore = useRecurringStore();
const goalsStore = useGoalsStore();
const settingsStore = useSettingsStore();
const { formatInDisplayCurrency } = useCurrencyDisplay();
const { isUnlocked, formatMasked } = usePrivacyMode();
const { t } = useTranslation();

// Combined net worth: accounts + physical assets - all liabilities (including asset loans)
// Uses filtered data based on global member filter
const netWorth = computed(() => accountsStore.filteredCombinedNetWorth);
// Total assets: accounts + physical assets
const totalAssets = computed(
  () => accountsStore.filteredTotalAssets + assetsStore.filteredTotalAssetValue
);
// Total liabilities: account liabilities + asset loans
const totalLiabilities = computed(() => accountsStore.filteredTotalLiabilities);

// Monthly income: one-time transactions + expected recurring income
// Uses filtered data based on global member filter
const monthlyIncome = computed(
  () =>
    transactionsStore.filteredThisMonthOneTimeIncome +
    recurringStore.filteredTotalMonthlyRecurringIncome
);

// Monthly expenses: one-time transactions + expected recurring expenses
// Uses filtered data based on global member filter
const monthlyExpenses = computed(
  () =>
    transactionsStore.filteredThisMonthOneTimeExpenses +
    recurringStore.filteredTotalMonthlyRecurringExpenses
);

// Net cash flow: monthly income minus monthly expenses
const netCashFlow = computed(() => monthlyIncome.value - monthlyExpenses.value);

// Uses filtered data based on global member filter
const activeGoals = computed(() => goalsStore.filteredActiveGoals.slice(0, 3));
const recentTransactions = computed(() => transactionsStore.filteredRecentTransactions.slice(0, 5));

// Upcoming recurring transactions (next 30 days)
const upcomingTransactions = computed(() => {
  const now = new Date();
  const thirtyDaysFromNow = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

  const upcoming = recurringStore.filteredActiveItems
    .map((item) => {
      const nextDate = getNextDueDateForItem(item);
      return { item, nextDate };
    })
    .filter(({ nextDate }) => {
      if (!nextDate) return false;
      return nextDate >= now && nextDate <= thirtyDaysFromNow;
    })
    .sort((a, b) => a.nextDate!.getTime() - b.nextDate!.getTime())
    .slice(0, 5);

  return upcoming;
});

// Assets summary
const assetsSummary = computed(() => {
  const assets = assetsStore.filteredAssets;
  if (assets.length === 0) return [];

  return assets
    .filter((a) => a.includeInNetWorth)
    .map((asset) => {
      const appreciation = asset.currentValue - asset.purchaseValue;
      const appreciationPercent =
        asset.purchaseValue > 0 ? (appreciation / asset.purchaseValue) * 100 : 0;
      return {
        ...asset,
        appreciation,
        appreciationPercent,
      };
    })
    .slice(0, 4);
});

// Asset type icons mapping
const assetTypeIcons: Record<AssetType, string> = {
  real_estate:
    'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6',
  vehicle:
    'M8 17h8M8 17a2 2 0 11-4 0 2 2 0 014 0zm8 0a2 2 0 104 0 2 2 0 00-4 0zM4 11l2-6h12l2 6M4 11h16M4 11v6h16v-6',
  boat: 'M3 17h18M5 17l2-8h10l2 8M9 9V6a3 3 0 016 0v3',
  jewelry: 'M12 8l-3 3 3 3 3-3-3-3zm0-6l6 6-6 6-6-6 6-6z',
  electronics:
    'M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z',
  equipment:
    'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0z',
  art: 'M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z',
  collectible:
    'M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z',
  other: 'M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4',
};

const assetTypeColors: Record<AssetType, string> = {
  real_estate: '#3b82f6',
  vehicle: '#f59e0b',
  boat: '#06b6d4',
  jewelry: '#ec4899',
  electronics: '#8b5cf6',
  equipment: '#6b7280',
  art: '#f43f5e',
  collectible: '#10b981',
  other: '#64748b',
};

// Format totals (which are in base currency) to display currency, masked when privacy mode is on
function formatTotal(amount: number): string {
  return formatMasked(formatInDisplayCurrency(amount, settingsStore.baseCurrency));
}

function formatDate(dateString: string): string {
  return formatDateShort(dateString);
}

function getDaysUntil(date: Date): string {
  const now = new Date();
  const diffTime = date.getTime() - now.getTime();
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Tomorrow';
  if (diffDays <= 7) return `${diffDays} days`;
  return formatDateShort(date.toISOString());
}
</script>

<template>
  <div class="space-y-6">
    <!-- Summary Cards with Gradients -->
    <div class="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
      <!-- Net Worth -->
      <div
        class="rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 p-5 text-white shadow-lg"
      >
        <div class="flex items-center justify-between">
          <div>
            <p class="text-sm font-medium text-blue-100">{{ t('dashboard.netWorth') }}</p>
            <p class="mt-1 text-2xl font-bold">
              {{ formatTotal(netWorth) }}
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
        <div class="mt-4 flex gap-4 text-sm">
          <span class="text-green-200">
            {{ t('dashboard.assets') }}: {{ formatTotal(totalAssets) }}
          </span>
          <span class="text-red-200">
            {{ t('dashboard.liabilities') }}: {{ formatTotal(totalLiabilities) }}
          </span>
        </div>
      </div>

      <!-- Monthly Income -->
      <div
        class="rounded-xl bg-gradient-to-br from-green-500 to-emerald-600 p-5 text-white shadow-lg"
      >
        <div class="flex items-center justify-between">
          <div>
            <p class="text-sm font-medium text-green-100">{{ t('dashboard.monthlyIncome') }}</p>
            <p class="mt-1 text-2xl font-bold">
              {{ formatTotal(monthlyIncome) }}
            </p>
          </div>
          <div class="flex h-12 w-12 items-center justify-center rounded-lg bg-white/20">
            <svg class="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M7 11l5-5m0 0l5 5m-5-5v12"
              />
            </svg>
          </div>
        </div>
      </div>

      <!-- Monthly Expenses -->
      <div class="rounded-xl bg-gradient-to-br from-red-500 to-rose-600 p-5 text-white shadow-lg">
        <div class="flex items-center justify-between">
          <div>
            <p class="text-sm font-medium text-red-100">{{ t('dashboard.monthlyExpenses') }}</p>
            <p class="mt-1 text-2xl font-bold">
              {{ formatTotal(monthlyExpenses) }}
            </p>
          </div>
          <div class="flex h-12 w-12 items-center justify-center rounded-lg bg-white/20">
            <svg class="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M17 13l-5 5m0 0l-5-5m5 5V6"
              />
            </svg>
          </div>
        </div>
      </div>

      <!-- Net Cash Flow -->
      <div
        class="rounded-xl p-5 text-white shadow-lg"
        :class="
          netCashFlow >= 0
            ? 'bg-gradient-to-br from-purple-500 to-violet-600'
            : 'bg-gradient-to-br from-orange-500 to-amber-600'
        "
      >
        <div class="flex items-center justify-between">
          <div>
            <p
              class="text-sm font-medium"
              :class="netCashFlow >= 0 ? 'text-purple-100' : 'text-orange-100'"
            >
              {{ t('dashboard.netCashFlow') }}
            </p>
            <p class="mt-1 text-2xl font-bold">
              {{ formatTotal(netCashFlow) }}
            </p>
          </div>
          <div class="flex h-12 w-12 items-center justify-center rounded-lg bg-white/20">
            <svg class="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
              />
            </svg>
          </div>
        </div>
      </div>
    </div>

    <!-- Main Content Grid -->
    <div class="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <!-- Recent Transactions -->
      <BaseCard :title="t('dashboard.recentTransactions')">
        <div
          v-if="recentTransactions.length === 0"
          class="py-8 text-center text-gray-500 dark:text-gray-400"
        >
          {{ t('dashboard.noTransactions') }}
        </div>
        <div v-else class="space-y-2">
          <div
            v-for="transaction in recentTransactions"
            :key="transaction.id"
            class="flex items-center justify-between rounded-lg px-3 py-2.5 transition-colors hover:bg-gray-50 dark:hover:bg-slate-700/50"
          >
            <div class="flex min-w-0 items-center gap-3">
              <CategoryIcon :category="transaction.category" size="md" />
              <div class="min-w-0">
                <p class="truncate font-medium text-gray-900 dark:text-gray-100">
                  {{ transaction.description }}
                </p>
                <p class="text-xs text-gray-500 dark:text-gray-400">
                  {{ formatDate(transaction.date) }} · {{ transaction.category }}
                </p>
              </div>
            </div>
            <CurrencyAmount
              :amount="transaction.amount"
              :currency="transaction.currency"
              :type="transaction.type === 'income' ? 'income' : 'expense'"
              size="md"
              class="ml-2 flex-shrink-0"
            />
          </div>
        </div>
      </BaseCard>

      <!-- Upcoming Transactions -->
      <BaseCard :title="t('dashboard.upcomingTransactions')">
        <div
          v-if="upcomingTransactions.length === 0"
          class="py-8 text-center text-gray-500 dark:text-gray-400"
        >
          {{ t('dashboard.noUpcoming') }}
        </div>
        <div v-else class="space-y-2">
          <div
            v-for="{ item, nextDate } in upcomingTransactions"
            :key="item.id"
            class="flex items-center justify-between rounded-lg px-3 py-2.5 transition-colors hover:bg-gray-50 dark:hover:bg-slate-700/50"
          >
            <div class="flex min-w-0 items-center gap-3">
              <CategoryIcon :category="item.category" size="md" />
              <div class="min-w-0">
                <p class="truncate font-medium text-gray-900 dark:text-gray-100">
                  {{ item.description }}
                </p>
                <p class="text-xs text-gray-500 dark:text-gray-400">
                  <span
                    class="mr-1 inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium"
                    :class="
                      item.type === 'income'
                        ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                        : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                    "
                  >
                    {{ getDaysUntil(nextDate!) }}
                  </span>
                  · {{ item.category }}
                </p>
              </div>
            </div>
            <CurrencyAmount
              :amount="item.amount"
              :currency="item.currency"
              :type="item.type === 'income' ? 'income' : 'expense'"
              size="md"
              class="ml-2 flex-shrink-0"
            />
          </div>
        </div>
      </BaseCard>
    </div>

    <!-- Second Row -->
    <div class="grid grid-cols-1 gap-6 lg:grid-cols-3">
      <!-- Assets Summary -->
      <BaseCard :title="t('dashboard.assetsSummary')" class="lg:col-span-2">
        <div
          v-if="assetsSummary.length === 0"
          class="py-8 text-center text-gray-500 dark:text-gray-400"
        >
          {{ t('dashboard.noAssets') }}
        </div>
        <div v-else class="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div
            v-for="asset in assetsSummary"
            :key="asset.id"
            class="rounded-xl border border-gray-200 p-4 transition-colors hover:border-gray-300 dark:border-slate-700 dark:hover:border-slate-600"
          >
            <div class="flex items-start gap-3">
              <!-- Asset Type Icon -->
              <div
                class="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg"
                :style="{ backgroundColor: `${assetTypeColors[asset.type]}20` }"
              >
                <svg
                  class="h-5 w-5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  :style="{ color: assetTypeColors[asset.type] }"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    :d="assetTypeIcons[asset.type]"
                  />
                </svg>
              </div>
              <div class="min-w-0 flex-1">
                <p class="truncate font-medium text-gray-900 dark:text-gray-100">
                  {{ asset.name }}
                </p>
                <p class="text-xs text-gray-500 capitalize dark:text-gray-400">
                  {{ asset.type.replace('_', ' ') }}
                </p>
              </div>
            </div>

            <div class="mt-3 space-y-1.5">
              <!-- Current Value -->
              <div class="flex items-center justify-between">
                <span class="text-xs text-gray-500 dark:text-gray-400">{{
                  t('common.currentValue')
                }}</span>
                <CurrencyAmount :amount="asset.currentValue" :currency="asset.currency" size="sm" />
              </div>
              <!-- Purchase Value -->
              <div class="flex items-center justify-between">
                <span class="text-xs text-gray-500 dark:text-gray-400">{{
                  t('common.purchaseValue')
                }}</span>
                <span class="text-xs text-gray-600 dark:text-gray-300">
                  {{ formatMasked(formatInDisplayCurrency(asset.purchaseValue, asset.currency)) }}
                </span>
              </div>
              <!-- Appreciation/Depreciation -->
              <div class="flex items-center justify-between">
                <span class="text-xs text-gray-500 dark:text-gray-400">
                  {{
                    asset.appreciation >= 0 ? t('common.appreciation') : t('common.depreciation')
                  }}
                </span>
                <span
                  class="text-xs font-medium"
                  :class="
                    asset.appreciation >= 0
                      ? 'text-green-600 dark:text-green-400'
                      : 'text-red-600 dark:text-red-400'
                  "
                >
                  {{
                    formatMasked(
                      (asset.appreciation >= 0 ? '+' : '') +
                        formatInDisplayCurrency(asset.appreciation, asset.currency)
                    )
                  }}
                  <span v-if="isUnlocked" class="text-[10px] opacity-75"
                    >({{ asset.appreciationPercent.toFixed(1) }}%)</span
                  >
                </span>
              </div>
              <!-- Loan if exists -->
              <div
                v-if="asset.loan?.hasLoan && asset.loan?.outstandingBalance"
                class="flex items-center justify-between border-t border-gray-100 pt-1 dark:border-slate-700"
              >
                <span class="text-xs text-gray-500 dark:text-gray-400">{{
                  t('common.loanOutstanding')
                }}</span>
                <span class="text-xs font-medium text-red-600 dark:text-red-400">
                  {{
                    formatMasked(
                      '-' + formatInDisplayCurrency(asset.loan.outstandingBalance, asset.currency)
                    )
                  }}
                </span>
              </div>
            </div>
          </div>
        </div>
      </BaseCard>

      <!-- Active Goals -->
      <BaseCard :title="t('dashboard.activeGoals')">
        <div
          v-if="activeGoals.length === 0"
          class="py-8 text-center text-gray-500 dark:text-gray-400"
        >
          {{ t('dashboard.noGoals') }}
        </div>
        <div v-else class="space-y-4">
          <div v-for="goal in activeGoals" :key="goal.id" class="space-y-2">
            <div class="flex items-center justify-between">
              <span class="font-medium text-gray-900 dark:text-gray-100">
                {{ goal.name }}
              </span>
              <span class="text-sm text-gray-500 dark:text-gray-400">
                {{ formatMasked(Math.round((goal.currentAmount / goal.targetAmount) * 100) + '%') }}
              </span>
            </div>
            <div
              class="h-2 w-full rounded-full bg-gray-200 transition-all dark:bg-slate-700"
              :class="{ 'blur-sm': !isUnlocked }"
            >
              <div
                class="h-2 rounded-full bg-blue-600 transition-all"
                :style="{
                  width: `${Math.min(100, (goal.currentAmount / goal.targetAmount) * 100)}%`,
                }"
              />
            </div>
            <div class="flex justify-between text-xs text-gray-500 dark:text-gray-400">
              <CurrencyAmount :amount="goal.currentAmount" :currency="goal.currency" size="sm" />
              <CurrencyAmount :amount="goal.targetAmount" :currency="goal.currency" size="sm" />
            </div>
          </div>
        </div>
      </BaseCard>
    </div>

    <!-- Recurring Summary -->
    <div class="grid grid-cols-1 gap-6 lg:grid-cols-3">
      <RecurringSummaryWidget class="lg:col-span-1" />
    </div>
  </div>
</template>
