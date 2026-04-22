<script setup lang="ts">
import { computed } from 'vue';
import { useRouter } from 'vue-router';
import CategoryIcon from '@/components/common/CategoryIcon.vue';
import CurrencyAmount from '@/components/common/CurrencyAmount.vue';
import ActivityItem from '@/components/dashboard/ActivityItem.vue';
import BudgetSummaryCard from '@/components/dashboard/BudgetSummaryCard.vue';
import BeanListStrip from '@/components/common/BeanListStrip.vue';
import NetWorthBreakdownCard from '@/components/dashboard/NetWorthBreakdownCard.vue';
import NetWorthHeroCard from '@/components/dashboard/NetWorthHeroCard.vue';
import SummaryStatCard from '@/components/dashboard/SummaryStatCard.vue';
import BeanieIcon from '@/components/ui/BeanieIcon.vue';
import EmptyStateIllustration from '@/components/ui/EmptyStateIllustration.vue';
import { useNetWorthHistory } from '@/composables/useNetWorthHistory';
import { useMonthOverMonthCashFlow } from '@/composables/useMonthOverMonthCashFlow';
import { usePrivacyMode } from '@/composables/usePrivacyMode';
import { useSyncHighlight } from '@/composables/useSyncHighlight';
import { useTranslation } from '@/composables/useTranslation';
import { getAccountTypeIcon, getAssetTypeIcon } from '@/constants/icons';
import { getNextDueDateForItem } from '@/services/recurring/recurringProcessor';
import { useAccountsStore } from '@/stores/accountsStore';
import { useAssetsStore } from '@/stores/assetsStore';
import { useRecurringStore } from '@/stores/recurringStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useTransactionsStore } from '@/stores/transactionsStore';
import { convertToBaseCurrency } from '@/utils/currency';
import { formatDateShort } from '@/utils/date';
import { isLiabilityType } from '@/utils/finance';

const router = useRouter();
const accountsStore = useAccountsStore();
const assetsStore = useAssetsStore();
const transactionsStore = useTransactionsStore();
const recurringStore = useRecurringStore();
const settingsStore = useSettingsStore();
const { isUnlocked } = usePrivacyMode();
const { t } = useTranslation();
const { syncHighlightClass } = useSyncHighlight();

// ── Net worth history ───────────────────────────────────────────────────────
const { selectedPeriod, chartData, chartError, periodComparison } = useNetWorthHistory();
const { incomeChange, expenseChange, cashFlowChange } = useMonthOverMonthCashFlow();

// ── Financial data ──────────────────────────────────────────────────────────
const netWorth = computed(() => accountsStore.filteredCombinedNetWorth);

const monthlyIncome = computed(
  () =>
    transactionsStore.filteredThisMonthOneTimeIncome +
    recurringStore.filteredTotalMonthlyRecurringIncome
);

const monthlyExpenses = computed(
  () =>
    transactionsStore.filteredThisMonthOneTimeExpenses +
    recurringStore.filteredTotalMonthlyRecurringExpenses
);

const netCashFlow = computed(() => monthlyIncome.value - monthlyExpenses.value);

const savingsRate = computed(() => {
  if (monthlyIncome.value <= 0) return 0;
  return Math.round((netCashFlow.value / monthlyIncome.value) * 100);
});

// ── Recent + Upcoming Transactions ──────────────────────────────────────────
const recentTransactions = computed(() => transactionsStore.filteredRecentTransactions.slice(0, 5));

const upcomingTransactions = computed(() => {
  const now = new Date();
  const thirtyDaysFromNow = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

  return recurringStore.filteredActiveItems
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
});

// ── Assets + Accounts ───────────────────────────────────────────────────────
const topAssets = computed(() =>
  [...assetsStore.filteredAssets]
    .sort(
      (a, b) =>
        convertToBaseCurrency(b.currentValue, b.currency) -
        convertToBaseCurrency(a.currentValue, a.currency)
    )
    .slice(0, 5)
);

const topAccounts = computed(() =>
  [...accountsStore.filteredActiveAccounts]
    .sort(
      (a, b) =>
        Math.abs(convertToBaseCurrency(b.balance, b.currency)) -
        Math.abs(convertToBaseCurrency(a.balance, a.currency))
    )
    .slice(0, 5)
);

// ── Helpers ─────────────────────────────────────────────────────────────────
function formatDate(dateString: string): string {
  return formatDateShort(dateString);
}

function getDaysUntil(date: Date): string {
  const now = new Date();
  const diffTime = date.getTime() - now.getTime();
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return t('date.today');
  if (diffDays === 1) return t('date.tomorrow');
  if (diffDays <= 7) return `${diffDays} ${t('date.days')}`;
  return formatDateShort(date.toISOString());
}

function getIconTint(type: string): 'orange' | 'silk' | 'green' | 'slate' {
  if (type === 'income') return 'green';
  return 'orange';
}
</script>

<template>
  <div class="space-y-6">
    <!-- ── Net Worth Hero Card ─────────────────────────────────────────── -->
    <NetWorthHeroCard
      :amount="netWorth"
      :currency="settingsStore.baseCurrency"
      :label="t('dashboard.netWorth')"
      :change-amount="periodComparison.changeAmount"
      :change-percent="periodComparison.changePercent"
      :selected-period="selectedPeriod"
      :history-data="chartData"
      :chart-error="chartError"
      :hint="t('hints.dashboardNetWorth')"
      @update:selected-period="selectedPeriod = $event"
    />

    <!-- ── Net Worth Breakdown ──────────────────────────────────────────── -->
    <NetWorthBreakdownCard />

    <!-- ── Summary Stat Cards (3-column) ───────────────────────────────── -->
    <div class="grid grid-cols-1 gap-4 md:grid-cols-3">
      <SummaryStatCard
        :label="t('dashboard.monthlyIncome')"
        :amount="monthlyIncome"
        :currency="settingsStore.baseCurrency"
        :change-amount="incomeChange"
        :hint="t('hints.dashboardIncome')"
        tint="green"
        test-id="stat-monthly-income"
        clickable
        @click="router.push({ path: '/transactions', query: { direction: 'income' } })"
      />
      <SummaryStatCard
        :label="t('dashboard.monthlyExpenses')"
        :amount="monthlyExpenses"
        :currency="settingsStore.baseCurrency"
        :change-amount="expenseChange"
        :hint="t('hints.dashboardExpenses')"
        tint="orange"
        test-id="stat-monthly-expenses"
        clickable
        @click="router.push({ path: '/transactions', query: { direction: 'expense' } })"
      />
      <SummaryStatCard
        :label="t('dashboard.netCashFlow')"
        :amount="netCashFlow"
        :currency="settingsStore.baseCurrency"
        :change-amount="cashFlowChange"
        :hint="t('hints.dashboardCashFlow')"
        tint="slate"
        :dark="true"
        test-id="stat-net-cash-flow"
      >
        <div v-if="isUnlocked && netCashFlow > 0" class="mt-1 flex items-center gap-1">
          <span class="font-outfit text-xs font-semibold text-emerald-300">
            {{ t('dashboard.healthy') }} 🌱
          </span>
          <span class="text-xs opacity-35"
            >{{ savingsRate }}% {{ t('dashboard.savingsRate') }}</span
          >
        </div>
      </SummaryStatCard>
    </div>

    <!-- ── Your Beans (Family Row) ─────────────────────────────────────── -->
    <BeanListStrip
      label-key="dashboard.yourBeans"
      add-label-key="dashboard.addBean"
      density="sm"
      @add-member="router.push('/family')"
      @select-member="router.push('/family')"
    />

    <!-- ── Row 1: Recent Transactions + Coming Up ────────────────────── -->
    <div class="grid grid-cols-1 gap-5 lg:grid-cols-2">
      <!-- Recent Transactions -->
      <div class="rounded-[var(--sq)] bg-white p-6 shadow-[var(--card-shadow)] dark:bg-slate-800">
        <div class="mb-4 flex items-center justify-between">
          <div class="nook-section-label text-secondary-500 dark:text-gray-400">
            {{ t('dashboard.recentTransactions') }}
          </div>
          <router-link
            to="/transactions"
            class="text-primary-500 hover:text-primary-600 text-xs font-medium"
          >
            {{ t('dashboard.seeAll') }}
          </router-link>
        </div>

        <div v-if="recentTransactions.length === 0" class="py-8 text-center">
          <EmptyStateIllustration variant="transactions" class="mb-4" />
          <p class="text-sm text-gray-500 dark:text-gray-400">
            {{ t('dashboard.noTransactions') }}
          </p>
        </div>
        <div v-else class="space-y-1">
          <div
            v-for="transaction in recentTransactions"
            :key="transaction.id"
            class="flex cursor-pointer items-center gap-3 rounded-xl px-2 py-2.5 transition-colors hover:bg-gray-50 dark:hover:bg-slate-700/50"
            :class="syncHighlightClass(transaction.id)"
            @click="router.push({ path: '/transactions', query: { view: transaction.id } })"
          >
            <div class="flex-shrink-0">
              <CategoryIcon :category="transaction.category" size="md" />
            </div>
            <div class="min-w-0 flex-1">
              <p class="text-secondary-500 truncate text-sm font-semibold dark:text-gray-100">
                {{ transaction.description }}
              </p>
              <p class="text-secondary-500/35 text-xs dark:text-gray-500">
                {{ formatDate(transaction.date) }} · {{ transaction.category }}
              </p>
            </div>
            <CurrencyAmount
              :amount="transaction.amount"
              :currency="transaction.currency"
              :type="transaction.type === 'income' ? 'income' : 'expense'"
              size="sm"
              class="flex-shrink-0"
            />
          </div>
        </div>
      </div>

      <!-- Coming Up -->
      <div class="rounded-[var(--sq)] bg-white p-6 shadow-[var(--card-shadow)] dark:bg-slate-800">
        <div class="mb-4 flex items-center justify-between">
          <div class="nook-section-label text-secondary-500 dark:text-gray-400">
            {{ t('dashboard.comingUp') }}
          </div>
          <router-link
            to="/transactions"
            class="text-primary-500 hover:text-primary-600 text-xs font-medium"
          >
            {{ t('dashboard.seeAll') }}
          </router-link>
        </div>

        <div v-if="upcomingTransactions.length === 0" class="py-8 text-center">
          <EmptyStateIllustration variant="recurring" class="mb-4" />
          <p class="text-sm text-gray-500 dark:text-gray-400">{{ t('dashboard.noUpcoming') }}</p>
        </div>
        <div v-else>
          <div
            v-for="{ item, nextDate } in upcomingTransactions"
            :key="item.id"
            class="cursor-pointer"
            :class="syncHighlightClass(item.id)"
            @click="router.push('/transactions')"
          >
            <ActivityItem
              :name="item.description"
              :subtitle="`${getDaysUntil(nextDate!)}, ${item.frequency}`"
              :amount="item.amount"
              :currency="item.currency"
              :type="item.type === 'income' ? 'income' : 'expense'"
              :icon-tint="getIconTint(item.type)"
            />
          </div>
        </div>
      </div>
    </div>

    <!-- ── Row 2: Your Assets + Your Accounts ────────────────────────── -->
    <div class="grid grid-cols-1 gap-5 lg:grid-cols-2">
      <!-- Your Assets -->
      <div class="rounded-[var(--sq)] bg-white p-6 shadow-[var(--card-shadow)] dark:bg-slate-800">
        <div class="mb-4 flex items-center justify-between">
          <div class="nook-section-label text-secondary-500 dark:text-gray-400">
            {{ t('dashboard.yourAssets') }}
          </div>
          <router-link
            to="/assets"
            class="text-primary-500 hover:text-primary-600 text-xs font-medium"
          >
            {{ t('dashboard.seeAll') }}
          </router-link>
        </div>

        <div v-if="topAssets.length === 0" class="py-8 text-center">
          <EmptyStateIllustration variant="assets" class="mb-4" />
          <p class="text-sm text-gray-500 dark:text-gray-400">{{ t('dashboard.noAssets') }}</p>
        </div>
        <div v-else class="space-y-1">
          <div
            v-for="asset in topAssets"
            :key="asset.id"
            class="flex cursor-pointer items-center gap-3 rounded-xl px-2 py-2.5 transition-colors hover:bg-gray-50 dark:hover:bg-slate-700/50"
            :class="syncHighlightClass(asset.id)"
            @click="router.push({ path: '/assets', query: { view: asset.id } })"
          >
            <div
              class="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl"
              :style="{
                backgroundColor: (getAssetTypeIcon(asset.type)?.color ?? '#64748b') + '18',
              }"
            >
              <BeanieIcon
                :name="`asset-${asset.type}`"
                size="sm"
                :style="{ color: getAssetTypeIcon(asset.type)?.color ?? '#64748b' }"
              />
            </div>
            <div class="min-w-0 flex-1">
              <p class="text-secondary-500 truncate text-sm font-semibold dark:text-gray-100">
                {{ asset.name }}
              </p>
              <p class="text-secondary-500/35 text-xs dark:text-gray-500">
                {{ t(`assets.type.${asset.type}`) }}
              </p>
            </div>
            <CurrencyAmount
              :amount="asset.currentValue"
              :currency="asset.currency"
              size="sm"
              class="flex-shrink-0"
            />
          </div>
        </div>
      </div>

      <!-- Your Accounts -->
      <div class="rounded-[var(--sq)] bg-white p-6 shadow-[var(--card-shadow)] dark:bg-slate-800">
        <div class="mb-4 flex items-center justify-between">
          <div class="nook-section-label text-secondary-500 dark:text-gray-400">
            {{ t('dashboard.yourAccounts') }}
          </div>
          <router-link
            to="/accounts"
            class="text-primary-500 hover:text-primary-600 text-xs font-medium"
          >
            {{ t('dashboard.seeAll') }}
          </router-link>
        </div>

        <div v-if="topAccounts.length === 0" class="py-8 text-center">
          <EmptyStateIllustration variant="accounts" class="mb-4" />
          <p class="text-sm text-gray-500 dark:text-gray-400">{{ t('dashboard.noAccounts') }}</p>
        </div>
        <div v-else class="space-y-1">
          <div
            v-for="account in topAccounts"
            :key="account.id"
            class="flex cursor-pointer items-center gap-3 rounded-xl px-2 py-2.5 transition-colors hover:bg-gray-50 dark:hover:bg-slate-700/50"
            :class="syncHighlightClass(account.id)"
            @click="router.push({ path: '/accounts', query: { view: account.id } })"
          >
            <div
              class="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl"
              :style="{
                backgroundColor: (getAccountTypeIcon(account.type)?.color ?? '#6b7280') + '18',
              }"
            >
              <template v-if="account.icon">
                <span class="text-sm">{{ account.icon }}</span>
              </template>
              <BeanieIcon
                v-else
                :name="`account-${account.type}`"
                size="sm"
                :style="{ color: getAccountTypeIcon(account.type)?.color ?? '#6b7280' }"
              />
            </div>
            <div class="min-w-0 flex-1">
              <p class="text-secondary-500 truncate text-sm font-semibold dark:text-gray-100">
                {{ account.name }}
              </p>
              <p class="text-secondary-500/35 text-xs dark:text-gray-500">
                {{ account.institution || getAccountTypeIcon(account.type)?.label || account.type }}
              </p>
            </div>
            <CurrencyAmount
              :amount="account.balance"
              :currency="account.currency"
              :type="isLiabilityType(account.type) ? 'expense' : 'neutral'"
              size="sm"
              class="flex-shrink-0"
            />
          </div>
        </div>
      </div>
    </div>

    <!-- ── Row 3: Budget Summary (full width) ────────────────────────── -->
    <BudgetSummaryCard />
  </div>
</template>
