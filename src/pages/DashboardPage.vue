<script setup lang="ts">
import { computed } from 'vue';
import { useRouter } from 'vue-router';
import CategoryIcon from '@/components/common/CategoryIcon.vue';
import CurrencyAmount from '@/components/common/CurrencyAmount.vue';
import ActivityItem from '@/components/dashboard/ActivityItem.vue';
import FamilyBeanRow from '@/components/dashboard/FamilyBeanRow.vue';
import GoalProgressItem from '@/components/dashboard/GoalProgressItem.vue';
import NetWorthHeroCard from '@/components/dashboard/NetWorthHeroCard.vue';
import RecurringSummaryWidget from '@/components/dashboard/RecurringSummaryWidget.vue';
import SummaryStatCard from '@/components/dashboard/SummaryStatCard.vue';
import EmptyStateIllustration from '@/components/ui/EmptyStateIllustration.vue';
import { useNetWorthHistory } from '@/composables/useNetWorthHistory';
import { usePrivacyMode } from '@/composables/usePrivacyMode';
import { useTranslation } from '@/composables/useTranslation';
import { getNextDueDateForItem } from '@/services/recurring/recurringProcessor';
import { useAccountsStore } from '@/stores/accountsStore';

import { useGoalsStore } from '@/stores/goalsStore';
import { useRecurringStore } from '@/stores/recurringStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useTransactionsStore } from '@/stores/transactionsStore';
import { formatDateShort } from '@/utils/date';

const router = useRouter();
const accountsStore = useAccountsStore();
const transactionsStore = useTransactionsStore();
const recurringStore = useRecurringStore();
const goalsStore = useGoalsStore();
const settingsStore = useSettingsStore();
const { isUnlocked } = usePrivacyMode();
const { t } = useTranslation();

// ── Net worth history ───────────────────────────────────────────────────────
const { selectedPeriod, chartData, periodComparison, incomeChange, expenseChange, cashFlowChange } =
  useNetWorthHistory();

// ── Financial data ──────────────────────────────────────────────────────────
// Combined net worth: accounts + physical assets - all liabilities
const netWorth = computed(() => accountsStore.filteredCombinedNetWorth);

// Monthly income: one-time transactions + expected recurring income
const monthlyIncome = computed(
  () =>
    transactionsStore.filteredThisMonthOneTimeIncome +
    recurringStore.filteredTotalMonthlyRecurringIncome
);

// Monthly expenses: one-time transactions + expected recurring expenses
const monthlyExpenses = computed(
  () =>
    transactionsStore.filteredThisMonthOneTimeExpenses +
    recurringStore.filteredTotalMonthlyRecurringExpenses
);

// Net cash flow
const netCashFlow = computed(() => monthlyIncome.value - monthlyExpenses.value);

// Savings rate
const savingsRate = computed(() => {
  if (monthlyIncome.value <= 0) return 0;
  return Math.round((netCashFlow.value / monthlyIncome.value) * 100);
});

// ── Goals ───────────────────────────────────────────────────────────────────
const activeGoals = computed(() => goalsStore.filteredActiveGoals.slice(0, 3));

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

// ── Helpers ─────────────────────────────────────────────────────────────────
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

function getIconTint(type: string): 'orange' | 'silk' | 'green' | 'slate' {
  if (type === 'income') return 'green';
  return 'orange';
}

function getGoalTint(index: number): 'orange' | 'silk' | 'slate' {
  const tints: ('orange' | 'silk' | 'slate')[] = ['orange', 'silk', 'slate'];
  return tints[index % tints.length] ?? 'orange';
}

function getGoalIcon(type: string): string {
  switch (type) {
    case 'savings':
      return '🏠';
    case 'debt_payoff':
      return '💳';
    case 'investment':
      return '📈';
    case 'purchase':
      return '🛒';
    default:
      return '🎯';
  }
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
      @update:selected-period="selectedPeriod = $event"
    />

    <!-- ── Summary Stat Cards (3-column) ───────────────────────────────── -->
    <div class="grid grid-cols-1 gap-4 md:grid-cols-3">
      <SummaryStatCard
        :label="t('dashboard.monthlyIncome')"
        :amount="monthlyIncome"
        :currency="settingsStore.baseCurrency"
        :change-amount="incomeChange"
        tint="green"
        test-id="stat-monthly-income"
      />
      <SummaryStatCard
        :label="t('dashboard.monthlyExpenses')"
        :amount="monthlyExpenses"
        :currency="settingsStore.baseCurrency"
        :change-amount="expenseChange"
        tint="orange"
        test-id="stat-monthly-expenses"
      />
      <SummaryStatCard
        :label="t('dashboard.netCashFlow')"
        :amount="netCashFlow"
        :currency="settingsStore.baseCurrency"
        :change-amount="cashFlowChange"
        tint="slate"
        :dark="true"
        test-id="stat-net-cash-flow"
      >
        <div v-if="isUnlocked && netCashFlow > 0" class="mt-1 flex items-center gap-1">
          <span class="font-outfit text-[0.65rem] font-semibold text-emerald-300">
            Healthy 🌱
          </span>
          <span class="text-[0.6rem] opacity-35">{{ savingsRate }}% savings rate</span>
        </div>
      </SummaryStatCard>
    </div>

    <!-- ── Your Beans (Family Row) ─────────────────────────────────────── -->
    <FamilyBeanRow @add-member="router.push('/family')" @select-member="router.push('/family')" />

    <!-- ── Two-column: Goals + Upcoming Transactions ───────────────────── -->
    <div class="grid grid-cols-1 gap-5 lg:grid-cols-2">
      <!-- Savings Goals -->
      <div class="rounded-[var(--sq)] bg-white p-6 shadow-[var(--card-shadow)] dark:bg-slate-800">
        <div class="mb-4 flex items-center justify-between">
          <div
            class="font-outfit text-secondary-500/45 text-[0.75rem] font-semibold tracking-[0.08em] uppercase dark:text-gray-400"
          >
            Savings Goals
          </div>
          <router-link
            to="/goals"
            class="text-primary-500 hover:text-primary-600 text-[0.75rem] font-medium"
          >
            See All →
          </router-link>
        </div>

        <div v-if="activeGoals.length === 0" class="py-8 text-center">
          <EmptyStateIllustration variant="goals" class="mb-4" />
          <p class="text-sm text-gray-500 dark:text-gray-400">{{ t('dashboard.noGoals') }}</p>
        </div>
        <div v-else>
          <GoalProgressItem
            v-for="(goal, idx) in activeGoals"
            :key="goal.id"
            :icon="getGoalIcon(goal.type)"
            :icon-tint="getGoalTint(idx)"
            :name="goal.name"
            :current-amount="goal.currentAmount"
            :target-amount="goal.targetAmount"
            :currency="goal.currency"
            :silk-bar="idx === 1"
          />
        </div>
      </div>

      <!-- Upcoming Transactions -->
      <div class="rounded-[var(--sq)] bg-white p-6 shadow-[var(--card-shadow)] dark:bg-slate-800">
        <div class="mb-4 flex items-center justify-between">
          <div
            class="font-outfit text-secondary-500/45 text-[0.75rem] font-semibold tracking-[0.08em] uppercase dark:text-gray-400"
          >
            {{ t('dashboard.upcomingTransactions') }}
          </div>
          <router-link
            to="/transactions"
            class="text-primary-500 hover:text-primary-600 text-[0.75rem] font-medium"
          >
            See All →
          </router-link>
        </div>

        <div v-if="upcomingTransactions.length === 0" class="py-8 text-center">
          <EmptyStateIllustration variant="recurring" class="mb-4" />
          <p class="text-sm text-gray-500 dark:text-gray-400">{{ t('dashboard.noUpcoming') }}</p>
        </div>
        <div v-else>
          <ActivityItem
            v-for="{ item, nextDate } in upcomingTransactions"
            :key="item.id"
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

    <!-- ── Recent Transactions + Recurring Summary ─────────────────────── -->
    <div class="grid grid-cols-1 gap-5 lg:grid-cols-2">
      <!-- Recent Transactions -->
      <div class="rounded-[var(--sq)] bg-white p-6 shadow-[var(--card-shadow)] dark:bg-slate-800">
        <div class="mb-4 flex items-center justify-between">
          <div
            class="font-outfit text-secondary-500/45 text-[0.75rem] font-semibold tracking-[0.08em] uppercase dark:text-gray-400"
          >
            {{ t('dashboard.recentTransactions') }}
          </div>
          <router-link
            to="/transactions"
            class="text-primary-500 hover:text-primary-600 text-[0.75rem] font-medium"
          >
            See All →
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
            class="flex items-center gap-3 rounded-xl px-2 py-2.5 transition-colors hover:bg-gray-50 dark:hover:bg-slate-700/50"
          >
            <div class="flex-shrink-0">
              <CategoryIcon :category="transaction.category" size="md" />
            </div>
            <div class="min-w-0 flex-1">
              <p class="text-secondary-500 truncate text-[0.8rem] font-semibold dark:text-gray-100">
                {{ transaction.description }}
              </p>
              <p class="text-secondary-500/35 text-[0.65rem] dark:text-gray-500">
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

      <!-- Recurring Summary -->
      <RecurringSummaryWidget />
    </div>
  </div>
</template>
