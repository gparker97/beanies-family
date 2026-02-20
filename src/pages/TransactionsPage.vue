<script setup lang="ts">
import { ref, computed } from 'vue';
import AccountTypeIcon from '@/components/common/AccountTypeIcon.vue';
import CategoryIcon from '@/components/common/CategoryIcon.vue';
import CurrencyAmount from '@/components/common/CurrencyAmount.vue';
import PageHeader from '@/components/common/PageHeader.vue';
import RecurringItemForm from '@/components/recurring/RecurringItemForm.vue';
import { BaseCard, BaseButton, BaseInput, BaseSelect, BaseModal } from '@/components/ui';
import BeanieIcon from '@/components/ui/BeanieIcon.vue';
import EmptyStateIllustration from '@/components/ui/EmptyStateIllustration.vue';
import { useCurrencyDisplay } from '@/composables/useCurrencyDisplay';
import { usePrivacyMode } from '@/composables/usePrivacyMode';
import { useTranslation } from '@/composables/useTranslation';
import { EXPENSE_CATEGORIES, getCategoryById, getCategoriesGrouped } from '@/constants/categories';
import { CURRENCIES } from '@/constants/currencies';
import { formatFrequency, getNextDueDateForItem } from '@/services/recurring/recurringProcessor';
import { useAccountsStore } from '@/stores/accountsStore';
import { useFamilyStore } from '@/stores/familyStore';
import { useRecurringStore } from '@/stores/recurringStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useTransactionsStore } from '@/stores/transactionsStore';
import type {
  Transaction,
  CreateTransactionInput,
  UpdateTransactionInput,
  TransactionType,
  RecurringItem,
  CreateRecurringItemInput,
} from '@/types/models';
import {
  formatDate,
  toISODateString,
  getStartOfMonth,
  getEndOfMonth,
  getLastMonthRange,
  getLastNMonthsRange,
  toDateInputValue,
  isDateBetween,
} from '@/utils/date';

const transactionsStore = useTransactionsStore();
const accountsStore = useAccountsStore();
const settingsStore = useSettingsStore();
const recurringStore = useRecurringStore();
const familyStore = useFamilyStore();
const { formatInDisplayCurrency } = useCurrencyDisplay();
const { formatMasked } = usePrivacyMode();
const { t } = useTranslation();

// Tab state - recurring first by default
const activeTab = ref<'transactions' | 'recurring'>('recurring');

// Date filter state
type DateFilterType = 'current_month' | 'last_month' | 'last_3_months' | 'custom';
const dateFilterType = ref<DateFilterType>('current_month');
const customStartDate = ref<string>('');
const customEndDate = ref<string>('');
const showCustomDatePicker = ref(false);

// Transaction modal state
const showAddModal = ref(false);
const showEditModal = ref(false);
const editingTransaction = ref<Transaction | null>(null);
const isSubmitting = ref(false);

// Recurring modal state
const showRecurringModal = ref(false);
const editingRecurringItem = ref<RecurringItem | undefined>(undefined);
const isSubmittingRecurring = ref(false);

const transactionTypes = computed(() => [
  { value: 'expense' as TransactionType, label: t('transactions.type.expense') },
  { value: 'income' as TransactionType, label: t('transactions.type.income') },
  { value: 'transfer' as TransactionType, label: t('transactions.type.transfer') },
]);

const accountOptions = computed(() =>
  accountsStore.accounts.map((a) => ({ value: a.id, label: a.name }))
);

const categoryOptions = computed(() => {
  const type = newTransaction.value.type === 'income' ? 'income' : 'expense';
  const groups = getCategoriesGrouped(type);
  return groups.map((g) => ({
    label: g.name,
    options: g.categories.map((c) => ({ value: c.id, label: c.name })),
  }));
});

const editCategoryOptions = computed(() => {
  const type = editTransaction.value.type === 'income' ? 'income' : 'expense';
  const groups = getCategoriesGrouped(type);
  return groups.map((g) => ({
    label: g.name,
    options: g.categories.map((c) => ({ value: c.id, label: c.name })),
  }));
});

// Currency options with display currency at the top
const currencyOptions = computed(() => {
  const displayCurrency = settingsStore.displayCurrency;
  const sortedCurrencies = [...CURRENCIES].sort((a, b) => {
    if (a.code === displayCurrency) return -1;
    if (b.code === displayCurrency) return 1;
    return 0;
  });
  return sortedCurrencies.map((c) => ({
    value: c.code,
    label: `${c.code} - ${c.name}`,
  }));
});

const newTransaction = ref<CreateTransactionInput>({
  accountId: '',
  type: 'expense',
  amount: 0,
  currency: settingsStore.baseCurrency,
  category: '',
  date: toISODateString(new Date()),
  description: '',
  isReconciled: false,
});

// Form data for editing - all fields are required with defaults
interface EditTransactionForm {
  id: string;
  accountId: string;
  toAccountId?: string;
  type: TransactionType;
  amount: number;
  currency: string;
  category: string;
  date: string;
  description: string;
  isReconciled: boolean;
}

const editTransaction = ref<EditTransactionForm>({
  id: '',
  accountId: '',
  type: 'expense',
  amount: 0,
  currency: settingsStore.baseCurrency,
  category: '',
  date: toISODateString(new Date()),
  description: '',
  isReconciled: false,
});

// Date range based on filter type
const dateRange = computed(() => {
  const now = new Date();
  let start: Date;
  let end: Date;

  switch (dateFilterType.value) {
    case 'current_month':
      start = getStartOfMonth(now);
      end = getEndOfMonth(now);
      break;
    case 'last_month': {
      const range = getLastMonthRange();
      start = range.start;
      end = range.end;
      break;
    }
    case 'last_3_months': {
      const range = getLastNMonthsRange(3);
      start = range.start;
      end = range.end;
      break;
    }
    case 'custom':
      if (customStartDate.value && customEndDate.value) {
        start = new Date(customStartDate.value);
        end = new Date(customEndDate.value);
        end.setHours(23, 59, 59, 999); // End of day
      } else {
        // Fallback to current month if custom dates not set
        start = getStartOfMonth(now);
        end = getEndOfMonth(now);
      }
      break;
  }

  return {
    start: toISODateString(start),
    end: toISODateString(end),
  };
});

// Display label for active filter
const dateFilterLabel = computed(() => {
  switch (dateFilterType.value) {
    case 'current_month':
      return 'Current Month';
    case 'last_month':
      return 'Last Month';
    case 'last_3_months':
      return 'Last 3 Months';
    case 'custom':
      if (customStartDate.value && customEndDate.value) {
        return `${customStartDate.value} to ${customEndDate.value}`;
      }
      return 'Custom Range';
    default:
      return 'All Time';
  }
});

// Uses filtered data based on global member filter AND date filter
const transactions = computed(() => {
  const filtered = transactionsStore.filteredSortedTransactions.filter((t) =>
    isDateBetween(t.date, dateRange.value.start, dateRange.value.end)
  );
  return filtered;
});

const recurringItems = computed(() => recurringStore.filteredRecurringItems);

// Helper to convert amount to base currency (same as store)
function convertToBaseCurrency(amount: number, fromCurrency: string): number {
  const baseCurrency = settingsStore.baseCurrency;
  if (fromCurrency === baseCurrency) return amount;

  const rates = settingsStore.exchangeRates;
  const directRate = rates.find((r) => r.from === fromCurrency && r.to === baseCurrency);
  if (directRate) return amount * directRate.rate;

  const inverseRate = rates.find((r) => r.from === baseCurrency && r.to === fromCurrency);
  if (inverseRate) return amount / inverseRate.rate;

  return amount; // Fallback if no rate found
}

// Filtered transaction totals for date range (converted to base currency)
const dateFilteredIncome = computed(() =>
  transactions.value
    .filter((t) => t.type === 'income' && !t.recurringItemId)
    .reduce((sum, t) => sum + convertToBaseCurrency(t.amount, t.currency), 0)
);

const dateFilteredExpenses = computed(() =>
  transactions.value
    .filter((t) => t.type === 'expense' && !t.recurringItemId)
    .reduce((sum, t) => sum + convertToBaseCurrency(t.amount, t.currency), 0)
);

// Format totals (which are in base currency) to display currency, masked when privacy mode is on
function formatTotal(amount: number): string {
  return formatMasked(formatInDisplayCurrency(amount, settingsStore.baseCurrency));
}

function getAccountName(accountId: string): string {
  const account = accountsStore.accounts.find((a) => a.id === accountId);
  return account?.name || 'Unknown';
}

function getCategoryName(categoryId: string): string {
  const category = getCategoryById(categoryId);
  return category?.name || categoryId;
}

function getMemberNameByAccountId(accountId: string): string {
  const account = accountsStore.accounts.find((a) => a.id === accountId);
  if (!account) return 'Unknown';
  const member = familyStore.members.find((m) => m.id === account.memberId);
  return member?.name || 'Unknown';
}

function getMemberColorByAccountId(accountId: string): string {
  const account = accountsStore.accounts.find((a) => a.id === accountId);
  if (!account) return '#6b7280';
  const member = familyStore.members.find((m) => m.id === account.memberId);
  return member?.color || '#6b7280';
}

function getAccountTypeByAccountId(accountId: string) {
  const account = accountsStore.accounts.find((a) => a.id === accountId);
  return account?.type || 'other';
}

// Transaction functions
function openAddModal() {
  newTransaction.value = {
    accountId: accountsStore.accounts[0]?.id || '',
    type: 'expense',
    amount: 0,
    currency: settingsStore.baseCurrency,
    category: EXPENSE_CATEGORIES[0]?.id || '',
    date: toISODateString(new Date()),
    description: '',
    isReconciled: false,
  };
  showAddModal.value = true;
}

async function createTransaction() {
  if (!newTransaction.value.description.trim() || !newTransaction.value.accountId) return;

  isSubmitting.value = true;
  try {
    await transactionsStore.createTransaction(newTransaction.value);
    showAddModal.value = false;
  } finally {
    isSubmitting.value = false;
  }
}

function openEditModal(transaction: Transaction) {
  editingTransaction.value = transaction;
  editTransaction.value = {
    id: transaction.id,
    accountId: transaction.accountId,
    toAccountId: transaction.toAccountId,
    type: transaction.type,
    amount: transaction.amount,
    currency: transaction.currency,
    category: transaction.category,
    date: transaction.date.split('T')[0] || transaction.date,
    description: transaction.description,
    isReconciled: transaction.isReconciled,
  };
  showEditModal.value = true;
}

function closeEditModal() {
  showEditModal.value = false;
  editingTransaction.value = null;
}

async function updateTransaction() {
  if (!editTransaction.value.description?.trim() || !editTransaction.value.accountId) return;

  isSubmitting.value = true;
  try {
    const { id, ...input } = editTransaction.value;
    await transactionsStore.updateTransaction(id, input as UpdateTransactionInput);
    closeEditModal();
  } finally {
    isSubmitting.value = false;
  }
}

async function deleteTransaction(id: string) {
  if (confirm('Are you sure you want to delete this transaction?')) {
    await transactionsStore.deleteTransaction(id);
  }
}

// Recurring functions
function openAddRecurringModal() {
  editingRecurringItem.value = undefined;
  showRecurringModal.value = true;
}

function openEditRecurringModal(item: RecurringItem) {
  editingRecurringItem.value = item;
  showRecurringModal.value = true;
}

async function handleRecurringSubmit(input: CreateRecurringItemInput) {
  isSubmittingRecurring.value = true;
  try {
    if (editingRecurringItem.value) {
      await recurringStore.updateRecurringItem(editingRecurringItem.value.id, input);
    } else {
      await recurringStore.createRecurringItem(input);
    }
    showRecurringModal.value = false;
    editingRecurringItem.value = undefined;
  } finally {
    isSubmittingRecurring.value = false;
  }
}

function handleRecurringCancel() {
  showRecurringModal.value = false;
  editingRecurringItem.value = undefined;
}

async function deleteRecurringItem(id: string) {
  if (
    confirm(
      'Are you sure you want to delete this recurring item? Existing transactions will not be affected.'
    )
  ) {
    await recurringStore.deleteRecurringItem(id);
  }
}

async function toggleRecurringActive(id: string) {
  await recurringStore.toggleActive(id);
}

function formatNextDate(item: RecurringItem): string {
  const nextDate = getNextDueDateForItem(item);
  if (!nextDate) return 'N/A';
  return formatDate(nextDate.toISOString());
}

// Date filter functions
function setDateFilter(type: DateFilterType) {
  dateFilterType.value = type;
  if (type === 'custom') {
    showCustomDatePicker.value = true;
    // Initialize custom dates to current month if not set
    if (!customStartDate.value || !customEndDate.value) {
      const now = new Date();
      customStartDate.value = toDateInputValue(getStartOfMonth(now));
      customEndDate.value = toDateInputValue(getEndOfMonth(now));
    }
  } else {
    showCustomDatePicker.value = false;
  }
}

function applyCustomDateRange() {
  if (customStartDate.value && customEndDate.value) {
    dateFilterType.value = 'custom';
  }
}
</script>

<template>
  <div class="space-y-6">
    <!-- Header -->
    <PageHeader
      icon="arrow-right-left"
      :title="t('transactions.title')"
      :subtitle="t('transactions.subtitle')"
    >
      <div class="flex gap-2">
        <BaseButton v-if="activeTab === 'transactions'" @click="openAddModal">
          {{ t('transactions.addTransaction') }}
        </BaseButton>
        <BaseButton v-else @click="openAddRecurringModal">
          {{ t('transactions.addRecurring') }}
        </BaseButton>
      </div>
    </PageHeader>

    <!-- Tab Navigation -->
    <div class="border-b border-gray-200 dark:border-slate-700">
      <nav class="-mb-px flex gap-2">
        <button
          class="rounded-t-lg px-4 py-2.5 text-sm font-medium transition-all"
          :class="
            activeTab === 'recurring'
              ? 'from-primary-500 to-terracotta-400 bg-gradient-to-r text-white shadow-md'
              : 'bg-gradient-to-r from-gray-100 to-gray-50 text-gray-600 hover:from-gray-200 hover:to-gray-100 dark:from-slate-700 dark:to-slate-600 dark:text-gray-300 dark:hover:from-slate-600 dark:hover:to-slate-500'
          "
          @click="activeTab = 'recurring'"
        >
          {{ t('transactions.recurringTransactions') }}
          <span
            v-if="recurringItems.length > 0"
            class="ml-2 rounded-full px-2 py-0.5 text-xs"
            :class="activeTab === 'recurring' ? 'bg-white/20' : 'bg-gray-200 dark:bg-slate-500'"
          >
            {{ recurringItems.length }}
          </span>
        </button>
        <button
          class="rounded-t-lg px-4 py-2.5 text-sm font-medium transition-all"
          :class="
            activeTab === 'transactions'
              ? 'from-primary-500 to-terracotta-400 bg-gradient-to-r text-white shadow-md'
              : 'bg-gradient-to-r from-gray-100 to-gray-50 text-gray-600 hover:from-gray-200 hover:to-gray-100 dark:from-slate-700 dark:to-slate-600 dark:text-gray-300 dark:hover:from-slate-600 dark:hover:to-slate-500'
          "
          @click="activeTab = 'transactions'"
        >
          {{ t('transactions.oneTime') }}
        </button>
      </nav>
    </div>

    <!-- Transactions Tab -->
    <template v-if="activeTab === 'transactions'">
      <!-- Date Filter -->
      <div class="flex items-center justify-between">
        <div class="text-sm text-gray-600 dark:text-gray-400">
          Showing:
          <span class="font-medium text-gray-900 dark:text-gray-100">{{ dateFilterLabel }}</span>
        </div>
        <div class="relative">
          <div class="flex items-center gap-2">
            <!-- Preset Filters -->
            <button
              class="rounded-lg px-3 py-1.5 text-sm transition-all"
              :class="
                dateFilterType === 'current_month'
                  ? 'bg-primary-500 text-white shadow-md'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-slate-700 dark:text-gray-300 dark:hover:bg-slate-600'
              "
              @click="setDateFilter('current_month')"
            >
              Current Month
            </button>
            <button
              class="rounded-lg px-3 py-1.5 text-sm transition-all"
              :class="
                dateFilterType === 'last_month'
                  ? 'bg-primary-500 text-white shadow-md'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-slate-700 dark:text-gray-300 dark:hover:bg-slate-600'
              "
              @click="setDateFilter('last_month')"
            >
              Last Month
            </button>
            <button
              class="rounded-lg px-3 py-1.5 text-sm transition-all"
              :class="
                dateFilterType === 'last_3_months'
                  ? 'bg-primary-500 text-white shadow-md'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-slate-700 dark:text-gray-300 dark:hover:bg-slate-600'
              "
              @click="setDateFilter('last_3_months')"
            >
              Last 3 Months
            </button>
            <button
              class="rounded-lg px-3 py-1.5 text-sm transition-all"
              :class="
                dateFilterType === 'custom'
                  ? 'bg-primary-500 text-white shadow-md'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-slate-700 dark:text-gray-300 dark:hover:bg-slate-600'
              "
              @click="setDateFilter('custom')"
            >
              Custom Range
            </button>
          </div>

          <!-- Custom Date Range Picker -->
          <div
            v-if="showCustomDatePicker"
            class="absolute right-0 z-10 mt-2 rounded-lg border border-gray-200 bg-white p-4 shadow-lg dark:border-slate-700 dark:bg-slate-800"
          >
            <div class="space-y-3">
              <div>
                <label class="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300">
                  Start Date
                </label>
                <input
                  v-model="customStartDate"
                  type="date"
                  class="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 dark:border-slate-600 dark:bg-slate-700 dark:text-gray-100"
                />
              </div>
              <div>
                <label class="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300">
                  End Date
                </label>
                <input
                  v-model="customEndDate"
                  type="date"
                  class="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 dark:border-slate-600 dark:bg-slate-700 dark:text-gray-100"
                />
              </div>
              <div class="flex gap-2">
                <button
                  class="flex-1 rounded-lg bg-gray-100 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-200 dark:bg-slate-700 dark:text-gray-300 dark:hover:bg-slate-600"
                  @click="showCustomDatePicker = false"
                >
                  Cancel
                </button>
                <button
                  class="bg-primary-500 hover:bg-primary-600 flex-1 rounded-lg px-3 py-1.5 text-sm text-white"
                  @click="
                    applyCustomDateRange();
                    showCustomDatePicker = false;
                  "
                >
                  Apply
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Summary Cards with Gradients -->
      <div class="grid grid-cols-1 gap-4 md:grid-cols-3">
        <!-- Period Income -->
        <div
          class="rounded-xl bg-gradient-to-br from-green-500 to-emerald-600 p-5 text-white shadow-lg"
        >
          <div class="flex items-center justify-between">
            <div>
              <p class="text-sm font-medium text-green-100">Income ({{ dateFilterLabel }})</p>
              <p class="mt-1 text-2xl font-bold">
                {{
                  formatTotal(
                    dateFilteredIncome +
                      (dateFilterType === 'current_month'
                        ? recurringStore.filteredTotalMonthlyRecurringIncome
                        : 0)
                  )
                }}
              </p>
            </div>
            <div class="flex h-12 w-12 items-center justify-center rounded-lg bg-white/20">
              <BeanieIcon name="arrow-up" size="lg" />
            </div>
          </div>
        </div>

        <!-- Period Expenses -->
        <div class="rounded-xl bg-gradient-to-br from-red-500 to-rose-600 p-5 text-white shadow-lg">
          <div class="flex items-center justify-between">
            <div>
              <p class="text-sm font-medium text-red-100">Expenses ({{ dateFilterLabel }})</p>
              <p class="mt-1 text-2xl font-bold">
                {{
                  formatTotal(
                    dateFilteredExpenses +
                      (dateFilterType === 'current_month'
                        ? recurringStore.filteredTotalMonthlyRecurringExpenses
                        : 0)
                  )
                }}
              </p>
            </div>
            <div class="flex h-12 w-12 items-center justify-center rounded-lg bg-white/20">
              <BeanieIcon name="arrow-down" size="lg" />
            </div>
          </div>
        </div>

        <!-- Net Cash Flow -->
        <div
          class="rounded-xl p-5 text-white shadow-lg"
          :class="
            dateFilteredIncome +
              (dateFilterType === 'current_month'
                ? recurringStore.filteredTotalMonthlyRecurringIncome
                : 0) -
              dateFilteredExpenses -
              (dateFilterType === 'current_month'
                ? recurringStore.filteredTotalMonthlyRecurringExpenses
                : 0) >=
            0
              ? 'from-secondary-500 to-secondary-700 bg-gradient-to-br'
              : 'bg-gradient-to-br from-orange-500 to-amber-600'
          "
        >
          <div class="flex items-center justify-between">
            <div>
              <p
                class="text-sm font-medium"
                :class="
                  dateFilteredIncome +
                    (dateFilterType === 'current_month'
                      ? recurringStore.filteredTotalMonthlyRecurringIncome
                      : 0) -
                    dateFilteredExpenses -
                    (dateFilterType === 'current_month'
                      ? recurringStore.filteredTotalMonthlyRecurringExpenses
                      : 0) >=
                  0
                    ? 'text-white/80'
                    : 'text-orange-100'
                "
              >
                Net ({{ dateFilterLabel }})
              </p>
              <p class="mt-1 text-2xl font-bold">
                {{
                  formatTotal(
                    dateFilteredIncome +
                      (dateFilterType === 'current_month'
                        ? recurringStore.filteredTotalMonthlyRecurringIncome
                        : 0) -
                      dateFilteredExpenses -
                      (dateFilterType === 'current_month'
                        ? recurringStore.filteredTotalMonthlyRecurringExpenses
                        : 0)
                  )
                }}
              </p>
            </div>
            <div class="flex h-12 w-12 items-center justify-center rounded-lg bg-white/20">
              <BeanieIcon name="bar-chart" size="lg" />
            </div>
          </div>
        </div>
      </div>

      <!-- Transactions List -->
      <BaseCard :title="t('transactions.allTransactions')">
        <div
          v-if="transactions.length === 0"
          class="py-12 text-center text-gray-500 dark:text-gray-400"
        >
          <EmptyStateIllustration variant="transactions" class="mb-4" />
          <p>No transactions found for {{ dateFilterLabel }}</p>
          <p class="mt-2 text-sm">Try selecting a different date range or add a new transaction.</p>
        </div>
        <div v-else class="divide-y divide-gray-200 dark:divide-slate-700">
          <div
            v-for="transaction in transactions"
            :key="transaction.id"
            data-testid="transaction-item"
            class="flex items-center justify-between py-4"
          >
            <div class="flex items-center gap-4">
              <div
                class="flex h-10 w-10 items-center justify-center rounded-lg"
                :class="
                  transaction.type === 'income'
                    ? 'bg-green-100 dark:bg-green-900/30'
                    : 'bg-red-100 dark:bg-red-900/30'
                "
              >
                <!-- Recurring indicator -->
                <BeanieIcon
                  v-if="transaction.recurringItemId"
                  name="repeat"
                  size="md"
                  :class="transaction.type === 'income' ? 'text-green-600' : 'text-red-600'"
                />
                <BeanieIcon
                  v-else
                  :name="transaction.type === 'income' ? 'arrow-up' : 'arrow-down'"
                  size="md"
                  :class="transaction.type === 'income' ? 'text-green-600' : 'text-red-600'"
                />
              </div>
              <div class="space-y-0.5">
                <!-- Transaction Name -->
                <p class="font-medium text-gray-900 dark:text-gray-100">
                  {{ transaction.description }}
                </p>
                <!-- Category -->
                <p class="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400">
                  <CategoryIcon :category="transaction.category" size="sm" />
                  {{ getCategoryName(transaction.category) }}
                </p>
                <!-- Family Member -->
                <p class="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400">
                  <BeanieIcon
                    name="user-filled"
                    size="xs"
                    :style="{ color: getMemberColorByAccountId(transaction.accountId) }"
                  />
                  {{ getMemberNameByAccountId(transaction.accountId) }}
                </p>
                <!-- Account -->
                <p class="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400">
                  <AccountTypeIcon
                    :type="getAccountTypeByAccountId(transaction.accountId)"
                    size="sm"
                  />
                  {{ getAccountName(transaction.accountId) }}
                </p>
                <!-- Date -->
                <p class="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400">
                  <BeanieIcon name="calendar" size="xs" class="text-gray-400" />
                  {{ formatDate(transaction.date) }}
                  <span
                    v-if="transaction.recurringItemId"
                    class="bg-sky-silk-100 text-secondary-500 dark:bg-primary-900/30 dark:text-primary-400 ml-1 rounded px-1.5 py-0.5 text-xs"
                  >
                    {{ t('status.recurring') }}
                  </span>
                </p>
              </div>
            </div>
            <div class="flex items-center gap-4">
              <CurrencyAmount
                :amount="transaction.amount"
                :currency="transaction.currency"
                :type="transaction.type === 'income' ? 'income' : 'expense'"
                size="lg"
              />
              <div class="flex gap-1">
                <button
                  class="hover:text-primary-600 rounded-lg p-2 text-gray-400 hover:bg-gray-100 dark:hover:bg-slate-700"
                  title="Edit"
                  @click="openEditModal(transaction)"
                >
                  <BeanieIcon name="edit" size="md" />
                </button>
                <button
                  class="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-red-600 dark:hover:bg-slate-700"
                  title="Delete"
                  @click="deleteTransaction(transaction.id)"
                >
                  <BeanieIcon name="trash" size="md" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </BaseCard>
    </template>

    <!-- Recurring Tab -->
    <template v-else>
      <!-- Recurring Summary with Gradients -->
      <div class="grid grid-cols-1 gap-4 md:grid-cols-3">
        <!-- Monthly Recurring Income -->
        <div
          class="rounded-xl bg-gradient-to-br from-green-500 to-emerald-600 p-5 text-white shadow-lg"
        >
          <div class="flex items-center justify-between">
            <div>
              <p class="text-sm font-medium text-green-100">{{ t('recurring.monthlyIncome') }}</p>
              <p class="mt-1 text-2xl font-bold">
                {{ formatTotal(recurringStore.filteredTotalMonthlyRecurringIncome) }}
              </p>
            </div>
            <div class="flex h-12 w-12 items-center justify-center rounded-lg bg-white/20">
              <BeanieIcon name="repeat" size="lg" />
            </div>
          </div>
        </div>

        <!-- Monthly Recurring Expenses -->
        <div class="rounded-xl bg-gradient-to-br from-red-500 to-rose-600 p-5 text-white shadow-lg">
          <div class="flex items-center justify-between">
            <div>
              <p class="text-sm font-medium text-red-100">{{ t('recurring.monthlyExpenses') }}</p>
              <p class="mt-1 text-2xl font-bold">
                {{ formatTotal(recurringStore.filteredTotalMonthlyRecurringExpenses) }}
              </p>
            </div>
            <div class="flex h-12 w-12 items-center justify-center rounded-lg bg-white/20">
              <BeanieIcon name="repeat" size="lg" />
            </div>
          </div>
        </div>

        <!-- Net Monthly Recurring -->
        <div
          class="rounded-xl p-5 text-white shadow-lg"
          :class="
            recurringStore.filteredNetMonthlyRecurring >= 0
              ? 'from-secondary-500 to-secondary-700 bg-gradient-to-br'
              : 'bg-gradient-to-br from-orange-500 to-amber-600'
          "
        >
          <div class="flex items-center justify-between">
            <div>
              <p
                class="text-sm font-medium"
                :class="
                  recurringStore.filteredNetMonthlyRecurring >= 0
                    ? 'text-white/80'
                    : 'text-orange-100'
                "
              >
                {{ t('recurring.netMonthly') }}
              </p>
              <p class="mt-1 text-2xl font-bold">
                {{ formatTotal(recurringStore.filteredNetMonthlyRecurring) }}
              </p>
            </div>
            <div class="flex h-12 w-12 items-center justify-center rounded-lg bg-white/20">
              <BeanieIcon name="bar-chart" size="lg" />
            </div>
          </div>
        </div>
      </div>

      <!-- Recurring Items List -->
      <BaseCard :title="t('recurring.items')">
        <div
          v-if="recurringItems.length === 0"
          class="py-12 text-center text-gray-500 dark:text-gray-400"
        >
          <EmptyStateIllustration variant="recurring" class="mb-4" />
          <p>{{ t('recurring.noItems') }}</p>
          <p class="mt-2">{{ t('recurring.getStarted') }}</p>
        </div>
        <div v-else class="divide-y divide-gray-200 dark:divide-slate-700">
          <div
            v-for="item in recurringItems"
            :key="item.id"
            class="py-4"
            :class="{ 'opacity-50': !item.isActive }"
          >
            <div class="flex items-center justify-between">
              <div class="flex items-center gap-4">
                <div
                  class="flex h-10 w-10 items-center justify-center rounded-lg"
                  :class="
                    item.type === 'income'
                      ? 'bg-green-100 dark:bg-green-900/30'
                      : 'bg-red-100 dark:bg-red-900/30'
                  "
                >
                  <BeanieIcon
                    name="repeat"
                    size="md"
                    :class="item.type === 'income' ? 'text-green-600' : 'text-red-600'"
                  />
                </div>
                <div class="space-y-0.5">
                  <!-- Transaction Name -->
                  <p class="font-medium text-gray-900 dark:text-gray-100">
                    {{ item.description }}
                    <span
                      v-if="!item.isActive"
                      class="ml-1 rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-500 dark:bg-slate-700"
                    >
                      {{ t('status.paused') }}
                    </span>
                  </p>
                  <!-- Category -->
                  <p class="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400">
                    <CategoryIcon :category="item.category" size="sm" />
                    {{ getCategoryName(item.category) }}
                  </p>
                  <!-- Family Member -->
                  <p class="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400">
                    <BeanieIcon
                      name="user-filled"
                      size="xs"
                      :style="{ color: getMemberColorByAccountId(item.accountId) }"
                    />
                    {{ getMemberNameByAccountId(item.accountId) }}
                  </p>
                  <!-- Account -->
                  <p class="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400">
                    <AccountTypeIcon :type="getAccountTypeByAccountId(item.accountId)" size="sm" />
                    {{ getAccountName(item.accountId) }}
                  </p>
                  <!-- Recurring Schedule -->
                  <p class="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400">
                    <BeanieIcon name="calendar" size="xs" class="text-gray-400" />
                    {{ formatFrequency(item) }} - Next: {{ formatNextDate(item) }}
                  </p>
                </div>
              </div>
              <div class="flex items-center gap-4">
                <CurrencyAmount
                  :amount="item.amount"
                  :currency="item.currency"
                  :type="item.type === 'income' ? 'income' : 'expense'"
                  size="lg"
                />
                <div class="flex gap-1">
                  <button
                    class="hover:text-primary-600 rounded-lg p-2 text-gray-400 hover:bg-gray-100 dark:hover:bg-slate-700"
                    :title="item.isActive ? t('action.pause') : t('action.resume')"
                    @click="toggleRecurringActive(item.id)"
                  >
                    <BeanieIcon v-if="item.isActive" name="pause-circle" size="md" />
                    <BeanieIcon v-else name="play-circle" size="md" />
                  </button>
                  <button
                    class="hover:text-primary-600 rounded-lg p-2 text-gray-400 hover:bg-gray-100 dark:hover:bg-slate-700"
                    title="Edit"
                    @click="openEditRecurringModal(item)"
                  >
                    <BeanieIcon name="edit" size="md" />
                  </button>
                  <button
                    class="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-red-600 dark:hover:bg-slate-700"
                    title="Delete"
                    @click="deleteRecurringItem(item.id)"
                  >
                    <BeanieIcon name="trash" size="md" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </BaseCard>
    </template>

    <!-- Add Transaction Modal -->
    <BaseModal
      :open="showAddModal"
      :title="t('transactions.addTransaction')"
      @close="showAddModal = false"
    >
      <form class="space-y-4" @submit.prevent="createTransaction">
        <BaseSelect
          v-model="newTransaction.type"
          :options="transactionTypes"
          :label="t('form.type')"
        />

        <BaseSelect
          v-model="newTransaction.accountId"
          :options="accountOptions"
          :label="t('form.account')"
          :placeholder="t('form.selectAccount')"
        />

        <BaseInput
          v-model="newTransaction.description"
          :label="t('form.description')"
          placeholder="e.g., Grocery shopping"
          required
        />

        <BaseSelect
          v-model="newTransaction.category"
          :grouped-options="categoryOptions"
          :label="t('form.category')"
        />

        <div class="grid grid-cols-2 gap-4">
          <BaseInput
            v-model="newTransaction.amount"
            type="number"
            :label="t('form.amount')"
            placeholder="0.00"
          />

          <BaseSelect
            v-model="newTransaction.currency"
            :options="currencyOptions"
            :label="t('form.currency')"
          />
        </div>

        <BaseInput v-model="newTransaction.date" type="date" :label="t('form.date')" />
      </form>

      <template #footer>
        <div class="flex justify-end gap-3">
          <BaseButton variant="secondary" @click="showAddModal = false">
            {{ t('action.cancel') }}
          </BaseButton>
          <BaseButton :loading="isSubmitting" @click="createTransaction">
            {{ t('transactions.addTransaction') }}
          </BaseButton>
        </div>
      </template>
    </BaseModal>

    <!-- Edit Transaction Modal -->
    <BaseModal
      :open="showEditModal"
      :title="t('transactions.editTransaction')"
      @close="closeEditModal"
    >
      <form class="space-y-4" @submit.prevent="updateTransaction">
        <BaseSelect
          v-model="editTransaction.type"
          :options="transactionTypes"
          :label="t('form.type')"
        />

        <BaseSelect
          v-model="editTransaction.accountId"
          :options="accountOptions"
          :label="t('form.account')"
          :placeholder="t('form.selectAccount')"
        />

        <BaseInput
          v-model="editTransaction.description"
          :label="t('form.description')"
          placeholder="e.g., Grocery shopping"
          required
        />

        <BaseSelect
          v-model="editTransaction.category"
          :grouped-options="editCategoryOptions"
          :label="t('form.category')"
        />

        <div class="grid grid-cols-2 gap-4">
          <BaseInput
            v-model="editTransaction.amount"
            type="number"
            :label="t('form.amount')"
            placeholder="0.00"
          />

          <BaseSelect
            v-model="editTransaction.currency"
            :options="currencyOptions"
            :label="t('form.currency')"
          />
        </div>

        <BaseInput v-model="editTransaction.date" type="date" :label="t('form.date')" />
      </form>

      <template #footer>
        <div class="flex justify-end gap-3">
          <BaseButton variant="secondary" @click="closeEditModal">
            {{ t('action.cancel') }}
          </BaseButton>
          <BaseButton :loading="isSubmitting" @click="updateTransaction">
            {{ t('action.saveChanges') }}
          </BaseButton>
        </div>
      </template>
    </BaseModal>

    <!-- Add/Edit Recurring Modal -->
    <BaseModal
      :open="showRecurringModal"
      :title="editingRecurringItem ? t('recurring.editItem') : t('recurring.addItem')"
      size="lg"
      @close="handleRecurringCancel"
    >
      <RecurringItemForm
        :item="editingRecurringItem"
        @submit="handleRecurringSubmit"
        @cancel="handleRecurringCancel"
      />
    </BaseModal>
  </div>
</template>
