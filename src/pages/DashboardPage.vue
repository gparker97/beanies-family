<script setup lang="ts">
import { computed } from 'vue';
import { useAccountsStore } from '@/stores/accountsStore';
import { useTransactionsStore } from '@/stores/transactionsStore';
import { useGoalsStore } from '@/stores/goalsStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { BaseCard } from '@/components/ui';
import RecurringSummaryWidget from '@/components/dashboard/RecurringSummaryWidget.vue';
import CurrencyAmount from '@/components/common/CurrencyAmount.vue';
import { useCurrencyDisplay } from '@/composables/useCurrencyDisplay';

const accountsStore = useAccountsStore();
const transactionsStore = useTransactionsStore();
const goalsStore = useGoalsStore();
const settingsStore = useSettingsStore();
const { formatInDisplayCurrency } = useCurrencyDisplay();

const netWorth = computed(() => accountsStore.totalBalance);
const totalAssets = computed(() => accountsStore.totalAssets);
const totalLiabilities = computed(() => accountsStore.totalLiabilities);
const monthlyIncome = computed(() => transactionsStore.thisMonthIncome);
const monthlyExpenses = computed(() => transactionsStore.thisMonthExpenses);
const netCashFlow = computed(() => transactionsStore.thisMonthNetCashFlow);
const activeGoals = computed(() => goalsStore.activeGoals.slice(0, 3));
const recentTransactions = computed(() => transactionsStore.recentTransactions);

// Format totals (which are in base currency) to display currency
function formatTotal(amount: number): string {
  return formatInDisplayCurrency(amount, settingsStore.baseCurrency);
}
</script>

<template>
  <div class="space-y-6">
    <!-- Summary Cards -->
    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
      <!-- Net Worth -->
      <BaseCard>
        <div class="flex items-center justify-between">
          <div>
            <p class="text-sm text-gray-500 dark:text-gray-400">Net Worth</p>
            <p class="text-2xl font-bold text-gray-900 dark:text-gray-100 mt-1">
              {{ formatTotal(netWorth) }}
            </p>
          </div>
          <div class="w-12 h-12 bg-blue-100 dark:bg-blue-900/30 rounded-lg flex items-center justify-center">
            <svg class="w-6 h-6 text-blue-600 dark:text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
        </div>
        <div class="mt-4 flex gap-4 text-sm">
          <span class="text-green-600 dark:text-green-400">
            Assets: {{ formatTotal(totalAssets) }}
          </span>
          <span class="text-red-600 dark:text-red-400">
            Liabilities: {{ formatTotal(totalLiabilities) }}
          </span>
        </div>
      </BaseCard>

      <!-- Monthly Income -->
      <BaseCard>
        <div class="flex items-center justify-between">
          <div>
            <p class="text-sm text-gray-500 dark:text-gray-400">Monthly Income</p>
            <p class="text-2xl font-bold text-green-600 dark:text-green-400 mt-1">
              {{ formatTotal(monthlyIncome) }}
            </p>
          </div>
          <div class="w-12 h-12 bg-green-100 dark:bg-green-900/30 rounded-lg flex items-center justify-center">
            <svg class="w-6 h-6 text-green-600 dark:text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 11l5-5m0 0l5 5m-5-5v12" />
            </svg>
          </div>
        </div>
      </BaseCard>

      <!-- Monthly Expenses -->
      <BaseCard>
        <div class="flex items-center justify-between">
          <div>
            <p class="text-sm text-gray-500 dark:text-gray-400">Monthly Expenses</p>
            <p class="text-2xl font-bold text-red-600 dark:text-red-400 mt-1">
              {{ formatTotal(monthlyExpenses) }}
            </p>
          </div>
          <div class="w-12 h-12 bg-red-100 dark:bg-red-900/30 rounded-lg flex items-center justify-center">
            <svg class="w-6 h-6 text-red-600 dark:text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 13l-5 5m0 0l-5-5m5 5V6" />
            </svg>
          </div>
        </div>
      </BaseCard>

      <!-- Net Cash Flow -->
      <BaseCard>
        <div class="flex items-center justify-between">
          <div>
            <p class="text-sm text-gray-500 dark:text-gray-400">Net Cash Flow</p>
            <p
              class="text-2xl font-bold mt-1"
              :class="netCashFlow >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'"
            >
              {{ formatTotal(netCashFlow) }}
            </p>
          </div>
          <div
            class="w-12 h-12 rounded-lg flex items-center justify-center"
            :class="netCashFlow >= 0 ? 'bg-green-100 dark:bg-green-900/30' : 'bg-red-100 dark:bg-red-900/30'"
          >
            <svg
              class="w-6 h-6"
              :class="netCashFlow >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
          </div>
        </div>
      </BaseCard>
    </div>

    <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <!-- Recent Transactions -->
      <BaseCard title="Recent Transactions">
        <div v-if="recentTransactions.length === 0" class="text-center py-8 text-gray-500 dark:text-gray-400">
          No transactions yet. Add your first transaction to get started.
        </div>
        <div v-else class="space-y-3">
          <div
            v-for="transaction in recentTransactions"
            :key="transaction.id"
            class="flex items-center justify-between py-2 border-b border-gray-100 dark:border-slate-700 last:border-0"
          >
            <div class="flex items-center gap-3">
              <div
                class="w-10 h-10 rounded-lg flex items-center justify-center"
                :class="transaction.type === 'income' ? 'bg-green-100 dark:bg-green-900/30' : 'bg-red-100 dark:bg-red-900/30'"
              >
                <svg
                  class="w-5 h-5"
                  :class="transaction.type === 'income' ? 'text-green-600' : 'text-red-600'"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    v-if="transaction.type === 'income'"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M7 11l5-5m0 0l5 5m-5-5v12"
                  />
                  <path
                    v-else
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M17 13l-5 5m0 0l-5-5m5 5V6"
                  />
                </svg>
              </div>
              <div>
                <p class="font-medium text-gray-900 dark:text-gray-100">
                  {{ transaction.description }}
                </p>
                <p class="text-sm text-gray-500 dark:text-gray-400">
                  {{ transaction.category }}
                </p>
              </div>
            </div>
            <CurrencyAmount
              :amount="transaction.amount"
              :currency="transaction.currency"
              :type="transaction.type === 'income' ? 'income' : 'expense'"
              size="md"
            />
          </div>
        </div>
      </BaseCard>

      <!-- Active Goals -->
      <BaseCard title="Active Goals">
        <div v-if="activeGoals.length === 0" class="text-center py-8 text-gray-500 dark:text-gray-400">
          No active goals. Set a financial goal to track your progress.
        </div>
        <div v-else class="space-y-4">
          <div
            v-for="goal in activeGoals"
            :key="goal.id"
            class="space-y-2"
          >
            <div class="flex items-center justify-between">
              <span class="font-medium text-gray-900 dark:text-gray-100">
                {{ goal.name }}
              </span>
              <span class="text-sm text-gray-500 dark:text-gray-400">
                <CurrencyAmount :amount="goal.currentAmount" :currency="goal.currency" size="sm" />
                <span class="mx-1">/</span>
                <CurrencyAmount :amount="goal.targetAmount" :currency="goal.currency" size="sm" />
              </span>
            </div>
            <div class="w-full bg-gray-200 dark:bg-slate-700 rounded-full h-2">
              <div
                class="bg-blue-600 h-2 rounded-full transition-all"
                :style="{ width: `${Math.min(100, (goal.currentAmount / goal.targetAmount) * 100)}%` }"
              />
            </div>
          </div>
        </div>
      </BaseCard>

      <!-- Recurring Summary -->
      <RecurringSummaryWidget />
    </div>
  </div>
</template>
