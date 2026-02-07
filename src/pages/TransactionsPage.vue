<script setup lang="ts">
import { ref, computed } from 'vue';
import { useTransactionsStore } from '@/stores/transactionsStore';
import { useAccountsStore } from '@/stores/accountsStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useRecurringStore } from '@/stores/recurringStore';
import { useFamilyStore } from '@/stores/familyStore';
import { BaseCard, BaseButton, BaseInput, BaseSelect, BaseModal } from '@/components/ui';
import RecurringItemForm from '@/components/recurring/RecurringItemForm.vue';
import CurrencyAmount from '@/components/common/CurrencyAmount.vue';
import CategoryIcon from '@/components/common/CategoryIcon.vue';
import AccountTypeIcon from '@/components/common/AccountTypeIcon.vue';
import { useCurrencyDisplay } from '@/composables/useCurrencyDisplay';
import { EXPENSE_CATEGORIES, INCOME_CATEGORIES, getCategoryById, getCategoriesGrouped } from '@/constants/categories';
import { CURRENCIES } from '@/constants/currencies';
import { formatDate, toISODateString } from '@/utils/date';
import { formatFrequency, getNextDueDateForItem } from '@/services/recurring/recurringProcessor';
import type { Transaction, CreateTransactionInput, UpdateTransactionInput, TransactionType, RecurringItem, CreateRecurringItemInput } from '@/types/models';

const transactionsStore = useTransactionsStore();
const accountsStore = useAccountsStore();
const settingsStore = useSettingsStore();
const recurringStore = useRecurringStore();
const familyStore = useFamilyStore();
const { formatInDisplayCurrency } = useCurrencyDisplay();

// Tab state - recurring first by default
const activeTab = ref<'transactions' | 'recurring'>('recurring');

// Transaction modal state
const showAddModal = ref(false);
const showEditModal = ref(false);
const editingTransaction = ref<Transaction | null>(null);
const isSubmitting = ref(false);

// Recurring modal state
const showRecurringModal = ref(false);
const editingRecurringItem = ref<RecurringItem | undefined>(undefined);
const isSubmittingRecurring = ref(false);

const transactionTypes: { value: TransactionType; label: string }[] = [
  { value: 'expense', label: 'Expense' },
  { value: 'income', label: 'Income' },
  { value: 'transfer', label: 'Transfer' },
];

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

const transactions = computed(() => transactionsStore.sortedTransactions);
const recurringItems = computed(() => recurringStore.recurringItems);

// Format totals (which are in base currency) to display currency
function formatTotal(amount: number): string {
  return formatInDisplayCurrency(amount, settingsStore.baseCurrency);
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
  if (confirm('Are you sure you want to delete this recurring item? Existing transactions will not be affected.')) {
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
</script>

<template>
  <div class="space-y-6">
    <!-- Header -->
    <div class="flex items-center justify-between">
      <div>
        <h1 class="text-2xl font-bold text-gray-900 dark:text-gray-100">Transactions</h1>
        <p class="text-gray-500 dark:text-gray-400">Track your income and expenses</p>
      </div>
      <div class="flex gap-2">
        <BaseButton v-if="activeTab === 'transactions'" @click="openAddModal">
          Add Transaction
        </BaseButton>
        <BaseButton v-else @click="openAddRecurringModal">
          Add Recurring
        </BaseButton>
      </div>
    </div>

    <!-- Tab Navigation -->
    <div class="border-b border-gray-200 dark:border-slate-700">
      <nav class="-mb-px flex gap-2">
        <button
          class="py-2.5 px-4 rounded-t-lg font-medium text-sm transition-all"
          :class="
            activeTab === 'recurring'
              ? 'bg-gradient-to-r from-blue-500 to-indigo-500 text-white shadow-md'
              : 'bg-gradient-to-r from-gray-100 to-gray-50 dark:from-slate-700 dark:to-slate-600 text-gray-600 dark:text-gray-300 hover:from-gray-200 hover:to-gray-100 dark:hover:from-slate-600 dark:hover:to-slate-500'
          "
          @click="activeTab = 'recurring'"
        >
          Recurring Transactions
          <span
            v-if="recurringItems.length > 0"
            class="ml-2 px-2 py-0.5 text-xs rounded-full"
            :class="activeTab === 'recurring' ? 'bg-white/20' : 'bg-gray-200 dark:bg-slate-500'"
          >
            {{ recurringItems.length }}
          </span>
        </button>
        <button
          class="py-2.5 px-4 rounded-t-lg font-medium text-sm transition-all"
          :class="
            activeTab === 'transactions'
              ? 'bg-gradient-to-r from-blue-500 to-indigo-500 text-white shadow-md'
              : 'bg-gradient-to-r from-gray-100 to-gray-50 dark:from-slate-700 dark:to-slate-600 text-gray-600 dark:text-gray-300 hover:from-gray-200 hover:to-gray-100 dark:hover:from-slate-600 dark:hover:to-slate-500'
          "
          @click="activeTab = 'transactions'"
        >
          One Time Transactions
        </button>
      </nav>
    </div>

    <!-- Transactions Tab -->
    <template v-if="activeTab === 'transactions'">
      <!-- Summary Cards with Gradients -->
      <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
        <!-- This Month Income -->
        <div class="bg-gradient-to-br from-green-500 to-emerald-600 rounded-xl p-5 text-white shadow-lg">
          <div class="flex items-center justify-between">
            <div>
              <p class="text-green-100 text-sm font-medium">This Month Income</p>
              <p class="text-2xl font-bold mt-1">{{ formatTotal(transactionsStore.thisMonthIncome) }}</p>
            </div>
            <div class="w-12 h-12 bg-white/20 rounded-lg flex items-center justify-center">
              <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 11l5-5m0 0l5 5m-5-5v12" />
              </svg>
            </div>
          </div>
        </div>

        <!-- This Month Expenses -->
        <div class="bg-gradient-to-br from-red-500 to-rose-600 rounded-xl p-5 text-white shadow-lg">
          <div class="flex items-center justify-between">
            <div>
              <p class="text-red-100 text-sm font-medium">This Month Expenses</p>
              <p class="text-2xl font-bold mt-1">{{ formatTotal(transactionsStore.thisMonthExpenses) }}</p>
            </div>
            <div class="w-12 h-12 bg-white/20 rounded-lg flex items-center justify-center">
              <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 13l-5 5m0 0l-5-5m5 5V6" />
              </svg>
            </div>
          </div>
        </div>

        <!-- Net Cash Flow -->
        <div
          class="rounded-xl p-5 text-white shadow-lg"
          :class="transactionsStore.thisMonthNetCashFlow >= 0
            ? 'bg-gradient-to-br from-blue-500 to-indigo-600'
            : 'bg-gradient-to-br from-orange-500 to-amber-600'"
        >
          <div class="flex items-center justify-between">
            <div>
              <p class="text-sm font-medium" :class="transactionsStore.thisMonthNetCashFlow >= 0 ? 'text-blue-100' : 'text-orange-100'">Net Cash Flow</p>
              <p class="text-2xl font-bold mt-1">{{ formatTotal(transactionsStore.thisMonthNetCashFlow) }}</p>
            </div>
            <div class="w-12 h-12 bg-white/20 rounded-lg flex items-center justify-center">
              <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
            </div>
          </div>
        </div>
      </div>

      <!-- Transactions List -->
      <BaseCard title="All Transactions">
        <div v-if="transactions.length === 0" class="text-center py-12 text-gray-500 dark:text-gray-400">
          <p>No transactions recorded yet.</p>
          <p class="mt-2">Click "Add Transaction" to get started.</p>
        </div>
        <div v-else class="divide-y divide-gray-200 dark:divide-slate-700">
          <div
            v-for="transaction in transactions"
            :key="transaction.id"
            class="py-4 flex items-center justify-between"
          >
            <div class="flex items-center gap-4">
              <div
                class="w-10 h-10 rounded-lg flex items-center justify-center"
                :class="transaction.type === 'income' ? 'bg-green-100 dark:bg-green-900/30' : 'bg-red-100 dark:bg-red-900/30'"
              >
                <!-- Recurring indicator -->
                <svg
                  v-if="transaction.recurringItemId"
                  class="w-5 h-5"
                  :class="transaction.type === 'income' ? 'text-green-600' : 'text-red-600'"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                  />
                </svg>
                <svg
                  v-else
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
              <div class="space-y-0.5">
                <!-- Transaction Name -->
                <p class="font-medium text-gray-900 dark:text-gray-100">
                  {{ transaction.description }}
                </p>
                <!-- Category -->
                <p class="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1">
                  <CategoryIcon :category-id="transaction.category" size="sm" />
                  {{ getCategoryName(transaction.category) }}
                </p>
                <!-- Family Member -->
                <p class="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1">
                  <svg class="w-3.5 h-3.5" :style="{ color: getMemberColorByAccountId(transaction.accountId) }" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" />
                  </svg>
                  {{ getMemberNameByAccountId(transaction.accountId) }}
                </p>
                <!-- Account -->
                <p class="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1">
                  <AccountTypeIcon :type="getAccountTypeByAccountId(transaction.accountId)" size="sm" />
                  {{ getAccountName(transaction.accountId) }}
                </p>
                <!-- Date -->
                <p class="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1">
                  <svg class="w-3.5 h-3.5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                  {{ formatDate(transaction.date) }}
                  <span
                    v-if="transaction.recurringItemId"
                    class="ml-1 text-xs px-1.5 py-0.5 bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 rounded"
                  >
                    Recurring
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
                  class="p-2 text-gray-400 hover:text-blue-600 rounded-lg hover:bg-gray-100 dark:hover:bg-slate-700"
                  title="Edit"
                  @click="openEditModal(transaction)"
                >
                  <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                  </svg>
                </button>
                <button
                  class="p-2 text-gray-400 hover:text-red-600 rounded-lg hover:bg-gray-100 dark:hover:bg-slate-700"
                  title="Delete"
                  @click="deleteTransaction(transaction.id)"
                >
                  <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
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
      <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
        <!-- Monthly Recurring Income -->
        <div class="bg-gradient-to-br from-green-500 to-emerald-600 rounded-xl p-5 text-white shadow-lg">
          <div class="flex items-center justify-between">
            <div>
              <p class="text-green-100 text-sm font-medium">Monthly Recurring Income</p>
              <p class="text-2xl font-bold mt-1">{{ formatTotal(recurringStore.totalMonthlyRecurringIncome) }}</p>
            </div>
            <div class="w-12 h-12 bg-white/20 rounded-lg flex items-center justify-center">
              <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            </div>
          </div>
        </div>

        <!-- Monthly Recurring Expenses -->
        <div class="bg-gradient-to-br from-red-500 to-rose-600 rounded-xl p-5 text-white shadow-lg">
          <div class="flex items-center justify-between">
            <div>
              <p class="text-red-100 text-sm font-medium">Monthly Recurring Expenses</p>
              <p class="text-2xl font-bold mt-1">{{ formatTotal(recurringStore.totalMonthlyRecurringExpenses) }}</p>
            </div>
            <div class="w-12 h-12 bg-white/20 rounded-lg flex items-center justify-center">
              <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            </div>
          </div>
        </div>

        <!-- Net Monthly Recurring -->
        <div
          class="rounded-xl p-5 text-white shadow-lg"
          :class="recurringStore.netMonthlyRecurring >= 0
            ? 'bg-gradient-to-br from-blue-500 to-indigo-600'
            : 'bg-gradient-to-br from-orange-500 to-amber-600'"
        >
          <div class="flex items-center justify-between">
            <div>
              <p class="text-sm font-medium" :class="recurringStore.netMonthlyRecurring >= 0 ? 'text-blue-100' : 'text-orange-100'">Net Monthly Recurring</p>
              <p class="text-2xl font-bold mt-1">{{ formatTotal(recurringStore.netMonthlyRecurring) }}</p>
            </div>
            <div class="w-12 h-12 bg-white/20 rounded-lg flex items-center justify-center">
              <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
            </div>
          </div>
        </div>
      </div>

      <!-- Recurring Items List -->
      <BaseCard title="Recurring Items">
        <div v-if="recurringItems.length === 0" class="text-center py-12 text-gray-500 dark:text-gray-400">
          <svg
            class="w-12 h-12 mx-auto mb-4 text-gray-300 dark:text-gray-600"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
            />
          </svg>
          <p>No recurring items yet.</p>
          <p class="mt-2">Click "Add Recurring" to set up automatic transactions.</p>
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
                  class="w-10 h-10 rounded-lg flex items-center justify-center"
                  :class="item.type === 'income' ? 'bg-green-100 dark:bg-green-900/30' : 'bg-red-100 dark:bg-red-900/30'"
                >
                  <svg
                    class="w-5 h-5"
                    :class="item.type === 'income' ? 'text-green-600' : 'text-red-600'"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      stroke-width="2"
                      d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                    />
                  </svg>
                </div>
                <div class="space-y-0.5">
                  <!-- Transaction Name -->
                  <p class="font-medium text-gray-900 dark:text-gray-100">
                    {{ item.description }}
                    <span
                      v-if="!item.isActive"
                      class="ml-1 text-xs px-1.5 py-0.5 bg-gray-100 dark:bg-slate-700 text-gray-500 rounded"
                    >
                      Paused
                    </span>
                  </p>
                  <!-- Category -->
                  <p class="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1">
                    <CategoryIcon :category-id="item.category" size="sm" />
                    {{ getCategoryName(item.category) }}
                  </p>
                  <!-- Family Member -->
                  <p class="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1">
                    <svg class="w-3.5 h-3.5" :style="{ color: getMemberColorByAccountId(item.accountId) }" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" />
                    </svg>
                    {{ getMemberNameByAccountId(item.accountId) }}
                  </p>
                  <!-- Account -->
                  <p class="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1">
                    <AccountTypeIcon :type="getAccountTypeByAccountId(item.accountId)" size="sm" />
                    {{ getAccountName(item.accountId) }}
                  </p>
                  <!-- Recurring Schedule -->
                  <p class="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1">
                    <svg class="w-3.5 h-3.5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
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
                    class="p-2 text-gray-400 hover:text-blue-600 rounded-lg hover:bg-gray-100 dark:hover:bg-slate-700"
                    :title="item.isActive ? 'Pause' : 'Resume'"
                    @click="toggleRecurringActive(item.id)"
                  >
                    <svg v-if="item.isActive" class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <svg v-else class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </button>
                  <button
                    class="p-2 text-gray-400 hover:text-blue-600 rounded-lg hover:bg-gray-100 dark:hover:bg-slate-700"
                    title="Edit"
                    @click="openEditRecurringModal(item)"
                  >
                    <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                    </svg>
                  </button>
                  <button
                    class="p-2 text-gray-400 hover:text-red-600 rounded-lg hover:bg-gray-100 dark:hover:bg-slate-700"
                    title="Delete"
                    @click="deleteRecurringItem(item.id)"
                  >
                    <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
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
      title="Add Transaction"
      @close="showAddModal = false"
    >
      <form class="space-y-4" @submit.prevent="createTransaction">
        <BaseSelect
          v-model="newTransaction.type"
          :options="transactionTypes"
          label="Type"
        />

        <BaseSelect
          v-model="newTransaction.accountId"
          :options="accountOptions"
          label="Account"
          placeholder="Select an account"
        />

        <BaseInput
          v-model="newTransaction.description"
          label="Description"
          placeholder="e.g., Grocery shopping"
          required
        />

        <BaseSelect
          v-model="newTransaction.category"
          :grouped-options="categoryOptions"
          label="Category"
        />

        <div class="grid grid-cols-2 gap-4">
          <BaseInput
            v-model="newTransaction.amount"
            type="number"
            label="Amount"
            placeholder="0.00"
          />

          <BaseSelect
            v-model="newTransaction.currency"
            :options="currencyOptions"
            label="Currency"
          />
        </div>

        <BaseInput
          v-model="newTransaction.date"
          type="date"
          label="Date"
        />
      </form>

      <template #footer>
        <div class="flex justify-end gap-3">
          <BaseButton variant="secondary" @click="showAddModal = false">
            Cancel
          </BaseButton>
          <BaseButton :loading="isSubmitting" @click="createTransaction">
            Add Transaction
          </BaseButton>
        </div>
      </template>
    </BaseModal>

    <!-- Edit Transaction Modal -->
    <BaseModal
      :open="showEditModal"
      title="Edit Transaction"
      @close="closeEditModal"
    >
      <form class="space-y-4" @submit.prevent="updateTransaction">
        <BaseSelect
          v-model="editTransaction.type"
          :options="transactionTypes"
          label="Type"
        />

        <BaseSelect
          v-model="editTransaction.accountId"
          :options="accountOptions"
          label="Account"
          placeholder="Select an account"
        />

        <BaseInput
          v-model="editTransaction.description"
          label="Description"
          placeholder="e.g., Grocery shopping"
          required
        />

        <BaseSelect
          v-model="editTransaction.category"
          :grouped-options="editCategoryOptions"
          label="Category"
        />

        <div class="grid grid-cols-2 gap-4">
          <BaseInput
            v-model="editTransaction.amount"
            type="number"
            label="Amount"
            placeholder="0.00"
          />

          <BaseSelect
            v-model="editTransaction.currency"
            :options="currencyOptions"
            label="Currency"
          />
        </div>

        <BaseInput
          v-model="editTransaction.date"
          type="date"
          label="Date"
        />
      </form>

      <template #footer>
        <div class="flex justify-end gap-3">
          <BaseButton variant="secondary" @click="closeEditModal">
            Cancel
          </BaseButton>
          <BaseButton :loading="isSubmitting" @click="updateTransaction">
            Save Changes
          </BaseButton>
        </div>
      </template>
    </BaseModal>

    <!-- Add/Edit Recurring Modal -->
    <BaseModal
      :open="showRecurringModal"
      :title="editingRecurringItem ? 'Edit Recurring Item' : 'Add Recurring Item'"
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
