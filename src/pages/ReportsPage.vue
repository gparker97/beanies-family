<script setup lang="ts">
import { ref, computed } from 'vue';
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
import {
  addMonths,
  getStartOfMonth,
  getEndOfMonth,
  toISODateString,
  isDateBetween,
} from '@/utils/date';
import { useTranslation } from '@/composables/useTranslation';
import type {
  CurrencyCode,
  ExchangeRate,
  Transaction,
  RecurringItem,
  Account,
  Asset,
} from '@/types/models';

const { t } = useTranslation();

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

// Date range filter - extended to 20 years
const dateRangeOptions = [
  { value: '3m', label: 'Next 3 Months' },
  { value: '6m', label: 'Next 6 Months' },
  { value: '1y', label: 'Next 1 Year' },
  { value: '2y', label: 'Next 2 Years' },
  { value: '5y', label: 'Next 5 Years' },
  { value: '10y', label: 'Next 10 Years' },
  { value: '15y', label: 'Next 15 Years' },
  { value: '20y', label: 'Next 20 Years' },
];
const selectedDateRange = ref('1y');

// Family member filter
const familyMemberOptions = computed(() => [
  { value: 'all', label: 'All Family Members' },
  ...familyStore.members.map((m) => ({ value: m.id, label: m.name })),
]);
const selectedMember = ref('all');

// Income vs Expenses time range - added current and previous month
const incomeExpenseRangeOptions = [
  { value: 'current', label: 'Current Month' },
  { value: 'previous', label: 'Previous Month' },
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

// Calculate monthly recurring income and expenses separately
function calculateMonthlyRecurring(): { income: number; expenses: number } {
  const items = getFilteredRecurringItems();

  let income = 0;
  let expenses = 0;

  for (const item of items) {
    let monthlyAmount = item.amount;
    if (item.frequency === 'daily') monthlyAmount = item.amount * 30;
    if (item.frequency === 'yearly') monthlyAmount = item.amount / 12;

    const converted = convertToBaseCurrency(monthlyAmount, item.currency);
    if (item.type === 'income') {
      income += converted;
    } else {
      expenses += converted;
    }
  }

  return { income, expenses };
}

// Store monthly breakdown for tooltips
interface MonthlyBreakdown {
  netWorth: number;
  monthlyIncome: number;
  monthlyExpenses: number;
}

// Generate net worth projection data (includes breakdowns for tooltips)
const netWorthProjection = computed(() => {
  const now = new Date();
  const currentNetWorth = calculateCurrentNetWorth();
  const { income: monthlyIncome, expenses: monthlyExpenses } = calculateMonthlyRecurring();
  const monthlyNet = monthlyIncome - monthlyExpenses;

  // Determine number of months to project
  let months = 12;
  switch (selectedDateRange.value) {
    case '3m':
      months = 3;
      break;
    case '6m':
      months = 6;
      break;
    case '1y':
      months = 12;
      break;
    case '2y':
      months = 24;
      break;
    case '5y':
      months = 60;
      break;
    case '10y':
      months = 120;
      break;
    case '15y':
      months = 180;
      break;
    case '20y':
      months = 240;
      break;
  }

  const labels: string[] = [];
  const data: number[] = [];
  const breakdowns: MonthlyBreakdown[] = [];

  // For longer periods, show fewer data points (yearly for 10y+)
  const step = months > 60 ? 12 : months > 24 ? 3 : 1;

  for (let i = 0; i <= months; i += step) {
    const date = addMonths(now, i);
    const showYear = i === 0 || date.getMonth() === 0 || step >= 12;
    labels.push(
      date.toLocaleDateString('en-US', {
        month: step >= 12 ? undefined : 'short',
        year: showYear ? 'numeric' : undefined,
      })
    );

    const netWorth = currentNetWorth + monthlyNet * i;
    data.push(netWorth);
    breakdowns.push({
      netWorth,
      monthlyIncome,
      monthlyExpenses,
    });
  }

  return {
    chartData: {
      labels,
      datasets: [
        {
          label: 'Projected Net Worth',
          data,
          borderColor: 'rgb(59, 130, 246)',
          backgroundColor: 'rgba(59, 130, 246, 0.1)',
          fill: true,
          tension: 0.3,
          pointRadius: months > 60 ? 3 : 4,
          pointHoverRadius: 6,
        },
      ],
    },
    breakdowns,
  };
});

const netWorthChartData = computed(() => netWorthProjection.value.chartData);
const netWorthBreakdownData = computed(() => netWorthProjection.value.breakdowns);

const netWorthChartOptions = computed(() => ({
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: {
      display: false,
    },
    tooltip: {
      callbacks: {
        title: (context: any[]) => {
          return context[0]?.label || '';
        },
        label: (context: any) => {
          const breakdown = netWorthBreakdownData.value[context.dataIndex];
          if (!breakdown) {
            return formatInDisplayCurrency(context.parsed.y, settingsStore.baseCurrency);
          }
          return `Net Worth: ${formatInDisplayCurrency(breakdown.netWorth, settingsStore.baseCurrency)}`;
        },
        afterLabel: (context: any) => {
          const breakdown = netWorthBreakdownData.value[context.dataIndex];
          if (!breakdown) return [];
          return [
            `Monthly Income: +${formatInDisplayCurrency(breakdown.monthlyIncome, settingsStore.baseCurrency)}`,
            `Monthly Expenses: -${formatInDisplayCurrency(breakdown.monthlyExpenses, settingsStore.baseCurrency)}`,
            `Monthly Net: ${formatInDisplayCurrency(breakdown.monthlyIncome - breakdown.monthlyExpenses, settingsStore.baseCurrency)}`,
          ];
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

// Get transactions for selected member (without category filter for stacked view)
function getFilteredTransactionsForChart(): Transaction[] {
  const memberAccountIds = new Set(
    selectedMember.value === 'all'
      ? accountsStore.accounts.map((a) => a.id)
      : accountsStore.accounts.filter((a) => a.memberId === selectedMember.value).map((a) => a.id)
  );

  return transactionsStore.transactions.filter((t) => memberAccountIds.has(t.accountId));
}

// Color palette for categories
const incomeColors = [
  'rgba(34, 197, 94, 0.85)', // green
  'rgba(20, 184, 166, 0.85)', // teal
  'rgba(6, 182, 212, 0.85)', // cyan
  'rgba(59, 130, 246, 0.85)', // blue
  'rgba(99, 102, 241, 0.85)', // indigo
  'rgba(139, 92, 246, 0.85)', // violet
  'rgba(168, 85, 247, 0.85)', // purple
  'rgba(236, 72, 153, 0.85)', // pink
];

const expenseColors = [
  'rgba(239, 68, 68, 0.85)', // red
  'rgba(249, 115, 22, 0.85)', // orange
  'rgba(234, 179, 8, 0.85)', // yellow
  'rgba(132, 204, 22, 0.85)', // lime
  'rgba(16, 185, 129, 0.85)', // emerald
  'rgba(8, 145, 178, 0.85)', // cyan-dark
  'rgba(79, 70, 229, 0.85)', // indigo-dark
  'rgba(219, 39, 119, 0.85)', // pink-dark
  'rgba(190, 18, 60, 0.85)', // rose
  'rgba(124, 58, 237, 0.85)', // violet-dark
];

// Generate income vs expenses chart data with category breakdown
const incomeExpenseChartData = computed(() => {
  const now = new Date();

  // Determine number of months to look back
  let months = 12;
  let startOffset = 0;
  switch (selectedIncomeExpenseRange.value) {
    case 'current':
      months = 1;
      startOffset = 0;
      break;
    case 'previous':
      months = 1;
      startOffset = 1;
      break;
    case '6m':
      months = 6;
      break;
    case '1y':
      months = 12;
      break;
    case '2y':
      months = 24;
      break;
  }

  const transactions = getFilteredTransactionsForChart();
  const recurringItems = getFilteredRecurringItems();

  const labels: string[] = [];

  // Track amounts by category for each month
  // Structure: { categoryId: number[] } where array index is month index
  const incomeByCategoryByMonth: Map<string, number[]> = new Map();
  const expenseByCategoryByMonth: Map<string, number[]> = new Map();

  for (let i = months - 1 + startOffset; i >= startOffset; i--) {
    const monthDate = addMonths(now, -i);
    const monthStart = toISODateString(getStartOfMonth(monthDate));
    const monthEnd = toISODateString(getEndOfMonth(monthDate));
    const monthIndex = months - 1 - i + startOffset;

    if (months === 1) {
      labels.push(monthDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }));
    } else {
      labels.push(
        monthDate.toLocaleDateString('en-US', {
          month: 'short',
          year:
            monthDate.getMonth() === 0 || i === months - 1 + startOffset ? 'numeric' : undefined,
        })
      );
    }

    // Get transactions for this month
    const monthTransactions = transactions.filter((t) =>
      isDateBetween(t.date, monthStart, monthEnd)
    );

    // Process transactions by category
    for (const t of monthTransactions) {
      // Apply category filter if selected
      if (selectedCategory.value !== 'all' && t.category !== selectedCategory.value) continue;

      const amount = convertToBaseCurrency(t.amount, t.currency);
      const categoryMap = t.type === 'income' ? incomeByCategoryByMonth : expenseByCategoryByMonth;

      if (!categoryMap.has(t.category)) {
        categoryMap.set(t.category, new Array(months).fill(0));
      }
      const catData = categoryMap.get(t.category)!;
      catData[monthIndex] = (catData[monthIndex] ?? 0) + amount;
    }

    // Add recurring items contribution (if not already counted via recurringItemId)
    const transactionRecurringIds = new Set(
      monthTransactions.filter((t) => t.recurringItemId).map((t) => t.recurringItemId)
    );

    for (const item of recurringItems) {
      // Skip if this recurring item was already processed as a transaction
      if (transactionRecurringIds.has(item.id)) continue;

      // Apply category filter if selected
      if (selectedCategory.value !== 'all' && item.category !== selectedCategory.value) continue;

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
        const categoryMap =
          item.type === 'income' ? incomeByCategoryByMonth : expenseByCategoryByMonth;

        if (!categoryMap.has(item.category)) {
          categoryMap.set(item.category, new Array(months).fill(0));
        }
        const catData = categoryMap.get(item.category)!;
        catData[monthIndex] = (catData[monthIndex] ?? 0) + converted;
      }
    }
  }

  // Create datasets for each category
  const datasets: {
    label: string;
    data: number[];
    backgroundColor: string;
    borderColor: string;
    borderWidth: number;
    borderRadius: number;
    stack: string;
  }[] = [];

  // Add income category datasets
  let incomeColorIndex = 0;
  for (const [categoryId, monthlyAmounts] of incomeByCategoryByMonth.entries()) {
    const category = getCategoryById(categoryId);
    const color =
      category?.color ??
      incomeColors[incomeColorIndex % incomeColors.length] ??
      'rgba(34, 197, 94, 0.85)';
    datasets.push({
      label: category?.name ?? categoryId,
      data: monthlyAmounts,
      backgroundColor: color,
      borderColor: color,
      borderWidth: 1,
      borderRadius: 2,
      stack: 'income',
    });
    incomeColorIndex++;
  }

  // Add expense category datasets
  let expenseColorIndex = 0;
  for (const [categoryId, monthlyAmounts] of expenseByCategoryByMonth.entries()) {
    const category = getCategoryById(categoryId);
    const color =
      category?.color ??
      expenseColors[expenseColorIndex % expenseColors.length] ??
      'rgba(239, 68, 68, 0.85)';
    datasets.push({
      label: category?.name ?? categoryId,
      data: monthlyAmounts,
      backgroundColor: color,
      borderColor: color,
      borderWidth: 1,
      borderRadius: 2,
      stack: 'expenses',
    });
    expenseColorIndex++;
  }

  // If no data, add empty datasets to maintain structure
  if (datasets.length === 0) {
    datasets.push({
      label: 'Income',
      data: new Array(months).fill(0),
      backgroundColor: 'rgba(34, 197, 94, 0.8)',
      borderColor: 'rgb(34, 197, 94)',
      borderWidth: 1,
      borderRadius: 4,
      stack: 'income',
    });
    datasets.push({
      label: 'Expenses',
      data: new Array(months).fill(0),
      backgroundColor: 'rgba(239, 68, 68, 0.8)',
      borderColor: 'rgb(239, 68, 68)',
      borderWidth: 1,
      borderRadius: 4,
      stack: 'expenses',
    });
  }

  return {
    labels,
    datasets,
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
        padding: 15,
        boxWidth: 12,
        font: {
          size: 11,
        },
      },
    },
    tooltip: {
      mode: 'index' as const,
      intersect: false,
      callbacks: {
        label: (context: any) => {
          if (context.parsed.y === 0) return '';
          const prefix = context.dataset.stack === 'income' ? '+' : '-';
          return `${context.dataset.label}: ${prefix}${formatInDisplayCurrency(context.parsed.y, settingsStore.baseCurrency)}`;
        },
        footer: (tooltipItems: any[]) => {
          let totalIncome = 0;
          let totalExpenses = 0;

          for (const item of tooltipItems) {
            if (item.dataset.stack === 'income') {
              totalIncome += item.parsed.y;
            } else {
              totalExpenses += item.parsed.y;
            }
          }

          const net = totalIncome - totalExpenses;
          return [
            '',
            `Total Income: +${formatInDisplayCurrency(totalIncome, settingsStore.baseCurrency)}`,
            `Total Expenses: -${formatInDisplayCurrency(totalExpenses, settingsStore.baseCurrency)}`,
            `Net: ${net >= 0 ? '+' : ''}${formatInDisplayCurrency(net, settingsStore.baseCurrency)}`,
          ];
        },
      },
    },
  },
  scales: {
    y: {
      beginAtZero: true,
      stacked: true,
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
      stacked: true,
      grid: {
        display: false,
      },
    },
  },
}));

// ============ SUMMARY STATS ============

const totalProjectedNetWorth = computed(() => {
  const dataset = netWorthChartData.value.datasets[0];
  if (!dataset) return 0;
  const data = dataset.data;
  return data[data.length - 1] ?? 0;
});

const netWorthChange = computed(() => {
  const dataset = netWorthChartData.value.datasets[0];
  if (!dataset) return 0;
  const data = dataset.data;
  if (data.length < 2) return 0;
  return (data[data.length - 1] ?? 0) - (data[0] ?? 0);
});

const totalIncome = computed(() => {
  const datasets = incomeExpenseChartData.value.datasets.filter((d) => d.stack === 'income');
  return datasets.reduce((total, dataset) => {
    return total + dataset.data.reduce((sum, val) => sum + val, 0);
  }, 0);
});

const totalExpenses = computed(() => {
  const datasets = incomeExpenseChartData.value.datasets.filter((d) => d.stack === 'expenses');
  return datasets.reduce((total, dataset) => {
    return total + dataset.data.reduce((sum, val) => sum + val, 0);
  }, 0);
});

const netCashFlow = computed(() => totalIncome.value - totalExpenses.value);
</script>

<template>
  <div class="space-y-6">
    <!-- Header -->
    <div>
      <h1 class="text-2xl font-bold text-gray-900 dark:text-gray-100">{{ t('reports.title') }}</h1>
      <p class="text-gray-500 dark:text-gray-400">{{ t('reports.subtitle') }}</p>
    </div>

    <!-- Global Family Member Filter -->
    <div class="flex flex-wrap gap-4">
      <div class="w-64">
        <BaseSelect
          v-model="selectedMember"
          :options="familyMemberOptions"
          :label="t('reports.familyMember')"
        />
      </div>
    </div>

    <!-- Net Worth Over Time -->
    <BaseCard>
      <template #header>
        <div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 class="text-lg font-semibold text-gray-900 dark:text-gray-100">
              {{ t('reports.netWorthOverTime') }}
            </h2>
            <p class="text-sm text-gray-500 dark:text-gray-400">
              {{ t('reports.netWorthDescription') }}
            </p>
          </div>
          <div class="w-48">
            <BaseSelect v-model="selectedDateRange" :options="dateRangeOptions" />
          </div>
        </div>
      </template>

      <!-- Summary Stats -->
      <div class="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div class="rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 p-4 text-white">
          <p class="text-sm text-blue-100">{{ t('reports.currentNetWorth') }}</p>
          <p class="mt-1 text-xl font-bold">
            {{ formatInDisplayCurrency(calculateCurrentNetWorth(), settingsStore.baseCurrency) }}
          </p>
        </div>
        <div class="rounded-xl bg-gradient-to-br from-purple-500 to-violet-600 p-4 text-white">
          <p class="text-sm text-purple-100">{{ t('reports.projectedNetWorth') }}</p>
          <p class="mt-1 text-xl font-bold">
            {{ formatInDisplayCurrency(totalProjectedNetWorth, settingsStore.baseCurrency) }}
          </p>
        </div>
        <div
          class="rounded-xl p-4 text-white"
          :class="
            netWorthChange >= 0
              ? 'bg-gradient-to-br from-green-500 to-emerald-600'
              : 'bg-gradient-to-br from-red-500 to-rose-600'
          "
        >
          <p :class="netWorthChange >= 0 ? 'text-green-100' : 'text-red-100'" class="text-sm">
            {{ t('reports.projectedChange') }}
          </p>
          <p class="mt-1 text-xl font-bold">
            {{ netWorthChange >= 0 ? '+' : ''
            }}{{ formatInDisplayCurrency(netWorthChange, settingsStore.baseCurrency) }}
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
        <div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 class="text-lg font-semibold text-gray-900 dark:text-gray-100">
              {{ t('reports.incomeVsExpenses') }}
            </h2>
            <p class="text-sm text-gray-500 dark:text-gray-400">
              {{ t('reports.incomeVsExpensesDescription') }}
            </p>
          </div>
          <div class="flex gap-3">
            <div class="w-40">
              <BaseSelect
                v-model="selectedIncomeExpenseRange"
                :options="incomeExpenseRangeOptions"
              />
            </div>
            <div class="w-48">
              <BaseSelect v-model="selectedCategory" :options="categoryOptions" />
            </div>
          </div>
        </div>
      </template>

      <!-- Summary Stats -->
      <div class="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div class="rounded-xl bg-gradient-to-br from-green-500 to-emerald-600 p-4 text-white">
          <p class="text-sm text-green-100">{{ t('reports.totalIncome') }}</p>
          <p class="mt-1 text-xl font-bold">
            {{ formatInDisplayCurrency(totalIncome, settingsStore.baseCurrency) }}
          </p>
        </div>
        <div class="rounded-xl bg-gradient-to-br from-red-500 to-rose-600 p-4 text-white">
          <p class="text-sm text-red-100">{{ t('reports.totalExpenses') }}</p>
          <p class="mt-1 text-xl font-bold">
            {{ formatInDisplayCurrency(totalExpenses, settingsStore.baseCurrency) }}
          </p>
        </div>
        <div
          class="rounded-xl p-4 text-white"
          :class="
            netCashFlow >= 0
              ? 'bg-gradient-to-br from-blue-500 to-indigo-600'
              : 'bg-gradient-to-br from-orange-500 to-amber-600'
          "
        >
          <p :class="netCashFlow >= 0 ? 'text-blue-100' : 'text-orange-100'" class="text-sm">
            {{ t('reports.netCashFlow') }}
          </p>
          <p class="mt-1 text-xl font-bold">
            {{ netCashFlow >= 0 ? '+' : ''
            }}{{ formatInDisplayCurrency(netCashFlow, settingsStore.baseCurrency) }}
          </p>
        </div>
      </div>

      <!-- Chart -->
      <div class="h-96">
        <Bar :data="incomeExpenseChartData" :options="incomeExpenseChartOptions" />
      </div>
    </BaseCard>
  </div>
</template>
