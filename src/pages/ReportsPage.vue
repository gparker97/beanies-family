<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { Line, Bar } from 'vue-chartjs';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Title,
  Tooltip,
  Legend,
  Filler,
} from 'chart.js';
import { BaseCard, BaseSelect } from '@/components/ui';
import { useAccountsStore } from '@/stores/accountsStore';
import { useAssetsStore } from '@/stores/assetsStore';
import { useTransactionsStore } from '@/stores/transactionsStore';
import { useRecurringStore } from '@/stores/recurringStore';
import { useFamilyStore } from '@/stores/familyStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useCurrencyDisplay } from '@/composables/useCurrencyDisplay';
import { ALL_CATEGORIES, getCategoryById } from '@/constants/categories';
import { addMonths, getStartOfMonth, getEndOfMonth, toISODateString, isDateBetween } from '@/utils/date';
import type { CurrencyCode, ExchangeRate, Transaction, RecurringItem, Account, Asset } from '@/types/models';

// Register Chart.js components
ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Title,
  Tooltip,
  Legend,
  Filler
);

const accountsStore = useAccountsStore();
const assetsStore = useAssetsStore();
const transactionsStore = useTransactionsStore();
const recurringStore = useRecurringStore();
const familyStore = useFamilyStore();
const settingsStore = useSettingsStore();
const { formatInDisplayCurrency } = useCurrencyDisplay();

// Helper to get exchange rate
function getRate(rates: ExchangeRate[], from: CurrencyCode, to: CurrencyCode): number {
  if (from === to) return 1;
  const direct = rates.find((r) => r.from === from && r.to === to);
  if (direct) return direct.rate;
  const inverse = rates.find((r) => r.from === to && r.to === from);
  if (inverse) return 1 / inverse.rate;
  return 1;
}

function convertToBaseCurrency(amount: number, fromCurrency: CurrencyCode): number {
  const baseCurrency = settingsStore.baseCurrency;
  if (fromCurrency === baseCurrency) return amount;
  const rate = getRate(settingsStore.exchangeRates, fromCurrency, baseCurrency);
  return amount * rate;
}

// ============ FILTERS ============

// Date range filter
const dateRangeOptions = [
  { value: '3m', label: 'Next 3 Months' },
  { value: '6m', label: 'Next 6 Months' },
  { value: '1y', label: 'Next 1 Year' },
  { value: '2y', label: 'Next 2 Years' },
  { value: '5y', label: 'Next 5 Years' },
];
const selectedDateRange = ref('1y');

// Family member filter
const familyMemberOptions = computed(() => [
  { value: 'all', label: 'All Family Members' },
  ...familyStore.members.map((m) => ({ value: m.id, label: m.name })),
]);
const selectedMember = ref('all');

// Income vs Expenses time range
const incomeExpenseRangeOptions = [
  { value: '6m', label: 'Last 6 Months' },
  { value: '1y', label: 'Last 12 Months' },
  { value: '2y', label: 'Last 2 Years' },
];
const selectedIncomeExpenseRange = ref('1y');

// Category filter for income/expenses
const categoryOptions = computed(() => [
  { value: 'all', label: 'All Categories' },
  ...ALL_CATEGORIES.map((c) => ({ value: c.id, label: c.name })),
]);
const selectedCategory = ref('all');

// ============ NET WORTH CALCULATION ============

// Get accounts for selected member
function getFilteredAccounts(): Account[] {
  if (selectedMember.value === 'all') {
    return accountsStore.accounts.filter((a) => a.isActive && a.includeInNetWorth);
  }
  return accountsStore.accounts.filter(
    (a) => a.isActive && a.includeInNetWorth && a.memberId === selectedMember.value
  );
}

// Get assets for selected member
function getFilteredAssets(): Asset[] {
  if (selectedMember.value === 'all') {
    return assetsStore.assets.filter((a) => a.includeInNetWorth);
  }
  return assetsStore.assets.filter(
    (a) => a.includeInNetWorth && a.memberId === selectedMember.value
  );
}

// Get recurring items for selected member (via account)
function getFilteredRecurringItems(): RecurringItem[] {
  const memberAccountIds = new Set(
    selectedMember.value === 'all'
      ? accountsStore.accounts.map((a) => a.id)
      : accountsStore.accounts.filter((a) => a.memberId === selectedMember.value).map((a) => a.id)
  );
  return recurringStore.recurringItems.filter(
    (item) => item.isActive && memberAccountIds.has(item.accountId)
  );
}

// Calculate current net worth
function calculateCurrentNetWorth(): number {
  const accounts = getFilteredAccounts();
  const assets = getFilteredAssets();

  // Account balances (liabilities are negative)
  const accountBalance = accounts.reduce((sum, account) => {
    const converted = convertToBaseCurrency(account.balance, account.currency);
    const multiplier = account.type === 'credit_card' || account.type === 'loan' ? -1 : 1;
    return sum + converted * multiplier;
  }, 0);

  // Asset values
  const assetValue = assets.reduce((sum, asset) => {
    return sum + convertToBaseCurrency(asset.currentValue, asset.currency);
  }, 0);

  return accountBalance + assetValue;
}

// Calculate monthly recurring net (income - expenses)
function calculateMonthlyRecurringNet(): number {
  const items = getFilteredRecurringItems();

  return items.reduce((sum, item) => {
    let monthlyAmount = item.amount;
    if (item.frequency === 'daily') monthlyAmount = item.amount * 30;
    if (item.frequency === 'yearly') monthlyAmount = item.amount / 12;

    const converted = convertToBaseCurrency(monthlyAmount, item.currency);
    return sum + (item.type === 'income' ? converted : -converted);
  }, 0);
}

// Generate net worth projection data
const netWorthChartData = computed(() => {
  const now = new Date();
  const currentNetWorth = calculateCurrentNetWorth();
  const monthlyNet = calculateMonthlyRecurringNet();

  // Determine number of months to project
  let months = 12;
  switch (selectedDateRange.value) {
    case '3m': months = 3; break;
    case '6m': months = 6; break;
    case '1y': months = 12; break;
    case '2y': months = 24; break;
    case '5y': months = 60; break;
  }

  const labels: string[] = [];
  const data: number[] = [];

  for (let i = 0; i <= months; i++) {
    const date = addMonths(now, i);
    labels.push(date.toLocaleDateString('en-US', { month: 'short', year: i === 0 || date.getMonth() === 0 ? 'numeric' : undefined }));
    data.push(currentNetWorth + monthlyNet * i);
  }

  return {
    labels,
    datasets: [
      {
        label: 'Projected Net Worth',
        data,
        borderColor: 'rgb(59, 130, 246)',
        backgroundColor: 'rgba(59, 130, 246, 0.1)',
        fill: true,
        tension: 0.3,
        pointRadius: 4,
        pointHoverRadius: 6,
      },
    ],
  };
});

const netWorthChartOptions = computed(() => ({
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: {
      display: false,
    },
    tooltip: {
      callbacks: {
        label: (context: { parsed: { y: number } }) => {
          return formatInDisplayCurrency(context.parsed.y, settingsStore.baseCurrency);
        },
      },
    },
  },
  scales: {
    y: {
      beginAtZero: false,
      ticks: {
        callback: (value: number | string) => {
          if (typeof value === 'number') {
            if (Math.abs(value) >= 1000000) return `${(value / 1000000).toFixed(1)}M`;
            if (Math.abs(value) >= 1000) return `${(value / 1000).toFixed(0)}K`;
            return value.toFixed(0);
          }
          return value;
        },
      },
      grid: {
        color: 'rgba(0, 0, 0, 0.05)',
      },
    },
    x: {
      grid: {
        display: false,
      },
    },
  },
}));

// ============ INCOME VS EXPENSES CALCULATION ============

// Get transactions for selected member
function getFilteredTransactions(): Transaction[] {
  const memberAccountIds = new Set(
    selectedMember.value === 'all'
      ? accountsStore.accounts.map((a) => a.id)
      : accountsStore.accounts.filter((a) => a.memberId === selectedMember.value).map((a) => a.id)
  );

  let transactions = transactionsStore.transactions.filter((t) =>
    memberAccountIds.has(t.accountId)
  );

  // Filter by category if selected
  if (selectedCategory.value !== 'all') {
    transactions = transactions.filter((t) => t.category === selectedCategory.value);
  }

  return transactions;
}

// Generate income vs expenses chart data
const incomeExpenseChartData = computed(() => {
  const now = new Date();

  // Determine number of months to look back
  let months = 12;
  switch (selectedIncomeExpenseRange.value) {
    case '6m': months = 6; break;
    case '1y': months = 12; break;
    case '2y': months = 24; break;
  }

  const transactions = getFilteredTransactions();
  const recurringItems = getFilteredRecurringItems();

  const labels: string[] = [];
  const incomeData: number[] = [];
  const expenseData: number[] = [];

  for (let i = months - 1; i >= 0; i--) {
    const monthDate = addMonths(now, -i);
    const monthStart = toISODateString(getStartOfMonth(monthDate));
    const monthEnd = toISODateString(getEndOfMonth(monthDate));

    labels.push(monthDate.toLocaleDateString('en-US', { month: 'short', year: monthDate.getMonth() === 0 || i === months - 1 ? 'numeric' : undefined }));

    // Get transactions for this month
    const monthTransactions = transactions.filter((t) => isDateBetween(t.date, monthStart, monthEnd));

    // Calculate income from transactions
    let monthIncome = monthTransactions
      .filter((t) => t.type === 'income')
      .reduce((sum, t) => sum + convertToBaseCurrency(t.amount, t.currency), 0);

    // Calculate expenses from transactions
    let monthExpense = monthTransactions
      .filter((t) => t.type === 'expense')
      .reduce((sum, t) => sum + convertToBaseCurrency(t.amount, t.currency), 0);

    // Add recurring items contribution (if not already counted via recurringItemId)
    const transactionRecurringIds = new Set(monthTransactions.filter((t) => t.recurringItemId).map((t) => t.recurringItemId));

    for (const item of recurringItems) {
      // Skip if this recurring item was already processed as a transaction
      if (transactionRecurringIds.has(item.id)) continue;

      // Check if this recurring item would have an occurrence in this month
      const startDate = new Date(item.startDate);
      const endDate = item.endDate ? new Date(item.endDate) : null;
      const monthDateObj = new Date(monthStart);

      if (startDate <= monthDateObj && (!endDate || endDate >= monthDateObj)) {
        let amount = item.amount;
        // Normalize to monthly
        if (item.frequency === 'daily') amount *= 30;
        if (item.frequency === 'yearly') amount /= 12;

        const converted = convertToBaseCurrency(amount, item.currency);

        // Only add if category matches filter
        if (selectedCategory.value === 'all' || item.category === selectedCategory.value) {
          if (item.type === 'income') {
            monthIncome += converted;
          } else {
            monthExpense += converted;
          }
        }
      }
    }

    incomeData.push(monthIncome);
    expenseData.push(monthExpense);
  }

  return {
    labels,
    datasets: [
      {
        label: 'Income',
        data: incomeData,
        backgroundColor: 'rgba(34, 197, 94, 0.8)',
        borderColor: 'rgb(34, 197, 94)',
        borderWidth: 1,
        borderRadius: 4,
      },
      {
        label: 'Expenses',
        data: expenseData,
        backgroundColor: 'rgba(239, 68, 68, 0.8)',
        borderColor: 'rgb(239, 68, 68)',
        borderWidth: 1,
        borderRadius: 4,
      },
    ],
  };
});

const incomeExpenseChartOptions = computed(() => ({
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: {
      position: 'top' as const,
      labels: {
        usePointStyle: true,
        padding: 20,
      },
    },
    tooltip: {
      callbacks: {
        label: (context: { dataset: { label: string }; parsed: { y: number } }) => {
          return `${context.dataset.label}: ${formatInDisplayCurrency(context.parsed.y, settingsStore.baseCurrency)}`;
        },
      },
    },
  },
  scales: {
    y: {
      beginAtZero: true,
      ticks: {
        callback: (value: number | string) => {
          if (typeof value === 'number') {
            if (Math.abs(value) >= 1000000) return `${(value / 1000000).toFixed(1)}M`;
            if (Math.abs(value) >= 1000) return `${(value / 1000).toFixed(0)}K`;
            return value.toFixed(0);
          }
          return value;
        },
      },
      grid: {
        color: 'rgba(0, 0, 0, 0.05)',
      },
    },
    x: {
      grid: {
        display: false,
      },
    },
  },
}));

// ============ SUMMARY STATS ============

const totalProjectedNetWorth = computed(() => {
  const data = netWorthChartData.value.datasets[0].data;
  return data[data.length - 1] || 0;
});

const netWorthChange = computed(() => {
  const data = netWorthChartData.value.datasets[0].data;
  if (data.length < 2) return 0;
  return data[data.length - 1] - data[0];
});

const totalIncome = computed(() => {
  const data = incomeExpenseChartData.value.datasets[0].data;
  return data.reduce((sum, val) => sum + val, 0);
});

const totalExpenses = computed(() => {
  const data = incomeExpenseChartData.value.datasets[1].data;
  return data.reduce((sum, val) => sum + val, 0);
});

const netCashFlow = computed(() => totalIncome.value - totalExpenses.value);
</script>

<template>
  <div class="space-y-6">
    <!-- Header -->
    <div>
      <h1 class="text-2xl font-bold text-gray-900 dark:text-gray-100">Reports</h1>
      <p class="text-gray-500 dark:text-gray-400">Visualize your financial data with charts and reports</p>
    </div>

    <!-- Global Family Member Filter -->
    <div class="flex flex-wrap gap-4">
      <div class="w-64">
        <BaseSelect
          v-model="selectedMember"
          :options="familyMemberOptions"
          label="Family Member"
        />
      </div>
    </div>

    <!-- Net Worth Over Time -->
    <BaseCard>
      <template #header>
        <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h2 class="text-lg font-semibold text-gray-900 dark:text-gray-100">Net Worth Over Time</h2>
            <p class="text-sm text-gray-500 dark:text-gray-400">Projected net worth based on current assets and recurring transactions</p>
          </div>
          <div class="w-48">
            <BaseSelect
              v-model="selectedDateRange"
              :options="dateRangeOptions"
            />
          </div>
        </div>
      </template>

      <!-- Summary Stats -->
      <div class="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <div class="bg-gradient-to-br from-blue-500 to-indigo-600 rounded-xl p-4 text-white">
          <p class="text-blue-100 text-sm">Current Net Worth</p>
          <p class="text-xl font-bold mt-1">{{ formatInDisplayCurrency(calculateCurrentNetWorth(), settingsStore.baseCurrency) }}</p>
        </div>
        <div class="bg-gradient-to-br from-purple-500 to-violet-600 rounded-xl p-4 text-white">
          <p class="text-purple-100 text-sm">Projected Net Worth</p>
          <p class="text-xl font-bold mt-1">{{ formatInDisplayCurrency(totalProjectedNetWorth, settingsStore.baseCurrency) }}</p>
        </div>
        <div
          class="rounded-xl p-4 text-white"
          :class="netWorthChange >= 0 ? 'bg-gradient-to-br from-green-500 to-emerald-600' : 'bg-gradient-to-br from-red-500 to-rose-600'"
        >
          <p :class="netWorthChange >= 0 ? 'text-green-100' : 'text-red-100'" class="text-sm">Projected Change</p>
          <p class="text-xl font-bold mt-1">
            {{ netWorthChange >= 0 ? '+' : '' }}{{ formatInDisplayCurrency(netWorthChange, settingsStore.baseCurrency) }}
          </p>
        </div>
      </div>

      <!-- Chart -->
      <div class="h-80">
        <Line :data="netWorthChartData" :options="netWorthChartOptions" />
      </div>
    </BaseCard>

    <!-- Income vs Expenses -->
    <BaseCard>
      <template #header>
        <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h2 class="text-lg font-semibold text-gray-900 dark:text-gray-100">Income vs Expenses</h2>
            <p class="text-sm text-gray-500 dark:text-gray-400">Monthly breakdown of income and expenses</p>
          </div>
          <div class="flex gap-3">
            <div class="w-40">
              <BaseSelect
                v-model="selectedIncomeExpenseRange"
                :options="incomeExpenseRangeOptions"
              />
            </div>
            <div class="w-48">
              <BaseSelect
                v-model="selectedCategory"
                :options="categoryOptions"
              />
            </div>
          </div>
        </div>
      </template>

      <!-- Summary Stats -->
      <div class="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <div class="bg-gradient-to-br from-green-500 to-emerald-600 rounded-xl p-4 text-white">
          <p class="text-green-100 text-sm">Total Income</p>
          <p class="text-xl font-bold mt-1">{{ formatInDisplayCurrency(totalIncome, settingsStore.baseCurrency) }}</p>
        </div>
        <div class="bg-gradient-to-br from-red-500 to-rose-600 rounded-xl p-4 text-white">
          <p class="text-red-100 text-sm">Total Expenses</p>
          <p class="text-xl font-bold mt-1">{{ formatInDisplayCurrency(totalExpenses, settingsStore.baseCurrency) }}</p>
        </div>
        <div
          class="rounded-xl p-4 text-white"
          :class="netCashFlow >= 0 ? 'bg-gradient-to-br from-blue-500 to-indigo-600' : 'bg-gradient-to-br from-orange-500 to-amber-600'"
        >
          <p :class="netCashFlow >= 0 ? 'text-blue-100' : 'text-orange-100'" class="text-sm">Net Cash Flow</p>
          <p class="text-xl font-bold mt-1">
            {{ netCashFlow >= 0 ? '+' : '' }}{{ formatInDisplayCurrency(netCashFlow, settingsStore.baseCurrency) }}
          </p>
        </div>
      </div>

      <!-- Chart -->
      <div class="h-80">
        <Bar :data="incomeExpenseChartData" :options="incomeExpenseChartOptions" />
      </div>
    </BaseCard>
  </div>
</template>
