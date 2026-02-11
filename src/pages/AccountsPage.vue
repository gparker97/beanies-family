<script setup lang="ts">
import { ref, computed } from 'vue';
import CurrencyAmount from '@/components/common/CurrencyAmount.vue';
import { BaseButton, BaseInput, BaseSelect, BaseModal } from '@/components/ui';
import { useCurrencyDisplay } from '@/composables/useCurrencyDisplay';
import { useTranslation } from '@/composables/useTranslation';
import { CURRENCIES } from '@/constants/currencies';
import { useAccountsStore } from '@/stores/accountsStore';
import { useFamilyStore } from '@/stores/familyStore';
import { useSettingsStore } from '@/stores/settingsStore';
import type { Account, AccountType, CreateAccountInput, UpdateAccountInput } from '@/types/models';

const accountsStore = useAccountsStore();
const familyStore = useFamilyStore();
const settingsStore = useSettingsStore();
const { formatInDisplayCurrency } = useCurrencyDisplay();
const { t } = useTranslation();

const showAddModal = ref(false);
const showEditModal = ref(false);
const isSubmitting = ref(false);

// Editing state
const editingAccountId = ref<string | null>(null);
const editingAccount = ref<
  UpdateAccountInput & {
    name: string;
    balance: number;
    memberId: string;
    type: AccountType;
    currency: string;
  }
>({
  name: '',
  balance: 0,
  memberId: '',
  type: 'checking',
  currency: 'USD',
  institution: '',
  isActive: true,
  includeInNetWorth: true,
});

const accountTypes = computed(() => [
  { value: 'checking' as AccountType, label: t('accounts.type.checking') },
  { value: 'savings' as AccountType, label: t('accounts.type.savings') },
  { value: 'credit_card' as AccountType, label: t('accounts.type.credit_card') },
  { value: 'investment' as AccountType, label: t('accounts.type.investment') },
  { value: 'crypto' as AccountType, label: t('accounts.type.crypto') },
  { value: 'cash' as AccountType, label: t('accounts.type.cash') },
  { value: 'loan' as AccountType, label: t('accounts.type.loan') },
  { value: 'other' as AccountType, label: t('accounts.type.other') },
]);

const currencyOptions = CURRENCIES.map((c) => ({
  value: c.code,
  label: `${c.code} - ${c.name}`,
}));

// Family member options for the owner selector
const memberOptions = computed(() =>
  familyStore.members.map((m) => ({
    value: m.id,
    label: m.name,
  }))
);

const newAccount = ref<CreateAccountInput>({
  memberId: familyStore.currentMemberId || '',
  name: '',
  type: 'checking',
  currency: settingsStore.baseCurrency,
  balance: 0,
  institution: '',
  isActive: true,
  includeInNetWorth: true,
});

// Uses filtered data based on global member filter
const accounts = computed(() => accountsStore.filteredAccounts);

// Group accounts by type for organized display
const accountsByType = computed(() => {
  const groups = new Map<AccountType, Account[]>();
  const typeOrder: AccountType[] = [
    'checking',
    'savings',
    'investment',
    'crypto',
    'credit_card',
    'loan',
    'cash',
    'other',
  ];

  for (const account of accounts.value) {
    const existing = groups.get(account.type) || [];
    existing.push(account);
    groups.set(account.type, existing);
  }

  // Return in defined order, only types that have accounts
  return typeOrder
    .filter((type) => groups.has(type))
    .map((type) => ({
      type,
      label: getAccountTypeLabel(type),
      accounts: groups.get(type) || [],
    }));
});

// Format totals (which are in base currency) to display currency
function formatTotal(amount: number): string {
  return formatInDisplayCurrency(amount, settingsStore.baseCurrency);
}

function getAccountTypeLabel(type: AccountType): string {
  return accountTypes.value.find((t) => t.value === type)?.label || type;
}

function getMemberName(memberId: string): string {
  const member = familyStore.members.find((m) => m.id === memberId);
  return member?.name || 'Unknown';
}

function getMemberColor(memberId: string): string {
  const member = familyStore.members.find((m) => m.id === memberId);
  return member?.color || '#6b7280';
}

// Get icon and color config for each account type
function getAccountTypeConfig(type: AccountType): {
  bgColor: string;
  iconColor: string;
  darkBgColor: string;
} {
  const configs: Record<AccountType, { bgColor: string; iconColor: string; darkBgColor: string }> =
    {
      checking: {
        bgColor: 'bg-blue-100',
        iconColor: 'text-blue-600',
        darkBgColor: 'dark:bg-blue-900/30',
      },
      savings: {
        bgColor: 'bg-green-100',
        iconColor: 'text-green-600',
        darkBgColor: 'dark:bg-green-900/30',
      },
      credit_card: {
        bgColor: 'bg-orange-100',
        iconColor: 'text-orange-600',
        darkBgColor: 'dark:bg-orange-900/30',
      },
      investment: {
        bgColor: 'bg-purple-100',
        iconColor: 'text-purple-600',
        darkBgColor: 'dark:bg-purple-900/30',
      },
      crypto: {
        bgColor: 'bg-amber-100',
        iconColor: 'text-amber-600',
        darkBgColor: 'dark:bg-amber-900/30',
      },
      cash: {
        bgColor: 'bg-emerald-100',
        iconColor: 'text-emerald-600',
        darkBgColor: 'dark:bg-emerald-900/30',
      },
      loan: { bgColor: 'bg-red-100', iconColor: 'text-red-600', darkBgColor: 'dark:bg-red-900/30' },
      other: {
        bgColor: 'bg-gray-100',
        iconColor: 'text-gray-600',
        darkBgColor: 'dark:bg-gray-700',
      },
    };
  return configs[type] || configs.other;
}

function openAddModal() {
  newAccount.value = {
    memberId: familyStore.currentMemberId || '',
    name: '',
    type: 'checking',
    currency: settingsStore.baseCurrency,
    balance: 0,
    institution: '',
    isActive: true,
    includeInNetWorth: true,
  };
  showAddModal.value = true;
}

function openEditModal(account: Account) {
  editingAccountId.value = account.id;
  editingAccount.value = {
    name: account.name,
    balance: account.balance,
    memberId: account.memberId,
    type: account.type,
    currency: account.currency,
    institution: account.institution || '',
    isActive: account.isActive,
    includeInNetWorth: account.includeInNetWorth,
  };
  showEditModal.value = true;
}

function closeEditModal() {
  showEditModal.value = false;
  editingAccountId.value = null;
}

async function createAccount() {
  if (!newAccount.value.name.trim()) return;

  isSubmitting.value = true;
  try {
    await accountsStore.createAccount(newAccount.value);
    showAddModal.value = false;
  } finally {
    isSubmitting.value = false;
  }
}

async function saveEdit() {
  if (!editingAccountId.value || !editingAccount.value.name.trim()) return;

  isSubmitting.value = true;
  try {
    await accountsStore.updateAccount(editingAccountId.value, editingAccount.value);
    closeEditModal();
  } finally {
    isSubmitting.value = false;
  }
}

async function deleteAccount(id: string) {
  if (confirm('Are you sure you want to delete this account?')) {
    await accountsStore.deleteAccount(id);
  }
}
</script>

<template>
  <div class="space-y-6">
    <!-- Header -->
    <div class="flex items-center justify-between">
      <div>
        <h1 class="text-2xl font-bold text-gray-900 dark:text-gray-100">
          {{ t('accounts.title') }}
        </h1>
        <p class="text-gray-500 dark:text-gray-400">{{ t('accounts.subtitle') }}</p>
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
        {{ t('accounts.addAccount') }}
      </BaseButton>
    </div>

    <!-- Summary Cards -->
    <div class="grid grid-cols-1 gap-4 md:grid-cols-3">
      <!-- Total Assets -->
      <div
        class="rounded-xl bg-gradient-to-br from-green-500 to-emerald-600 p-5 text-white shadow-lg"
      >
        <div class="flex items-center justify-between">
          <div>
            <p class="text-sm font-medium text-green-100">{{ t('common.totalAssets') }}</p>
            <p class="mt-1 text-2xl font-bold">
              {{ formatTotal(accountsStore.filteredTotalAssets) }}
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

      <!-- Total Liabilities -->
      <div class="rounded-xl bg-gradient-to-br from-red-500 to-rose-600 p-5 text-white shadow-lg">
        <div class="flex items-center justify-between">
          <div>
            <p class="text-sm font-medium text-red-100">{{ t('common.totalLiabilities') }}</p>
            <p class="mt-1 text-2xl font-bold">
              {{ formatTotal(accountsStore.filteredTotalLiabilities) }}
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

      <!-- Net Worth -->
      <div
        class="rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 p-5 text-white shadow-lg"
      >
        <div class="flex items-center justify-between">
          <div>
            <p class="text-sm font-medium text-blue-100">{{ t('dashboard.netWorth') }}</p>
            <p class="mt-1 text-2xl font-bold">
              {{ formatTotal(accountsStore.filteredTotalBalance) }}
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
    </div>

    <!-- Empty State -->
    <div v-if="accounts.length === 0" class="py-16 text-center">
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
            d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z"
          />
        </svg>
      </div>
      <h3 class="text-lg font-medium text-gray-900 dark:text-gray-100">
        {{ t('accounts.noAccounts') }}
      </h3>
      <p class="mt-1 mb-4 text-gray-500 dark:text-gray-400">{{ t('accounts.getStarted') }}</p>
      <BaseButton @click="openAddModal">
        <svg class="mr-1.5 -ml-1 h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M12 4v16m8-8H4"
          />
        </svg>
        {{ t('accounts.addAccount') }}
      </BaseButton>
    </div>

    <!-- Accounts Grid by Type -->
    <div v-else class="space-y-8">
      <div v-for="group in accountsByType" :key="group.type">
        <!-- Section Header -->
        <div class="mb-4 flex items-center gap-3">
          <div
            class="flex h-8 w-8 items-center justify-center rounded-lg"
            :class="[
              getAccountTypeConfig(group.type).bgColor,
              getAccountTypeConfig(group.type).darkBgColor,
            ]"
          >
            <!-- Checking Icon -->
            <svg
              v-if="group.type === 'checking'"
              :class="['h-4 w-4', getAccountTypeConfig(group.type).iconColor]"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z"
              />
            </svg>
            <!-- Savings Icon (Piggy Bank) -->
            <svg
              v-else-if="group.type === 'savings'"
              :class="['h-4 w-4', getAccountTypeConfig(group.type).iconColor]"
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
            <!-- Credit Card Icon -->
            <svg
              v-else-if="group.type === 'credit_card'"
              :class="['h-4 w-4', getAccountTypeConfig(group.type).iconColor]"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z"
              />
            </svg>
            <!-- Investment Icon (Chart) -->
            <svg
              v-else-if="group.type === 'investment'"
              :class="['h-4 w-4', getAccountTypeConfig(group.type).iconColor]"
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
            <!-- Crypto Icon (Bitcoin-like) -->
            <svg
              v-else-if="group.type === 'crypto'"
              :class="['h-4 w-4', getAccountTypeConfig(group.type).iconColor]"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8V6m0 8v2m-6-4h.01M18 12h.01M7 8h.01M17 8h.01M7 16h.01M17 16h.01"
              />
            </svg>
            <!-- Cash Icon -->
            <svg
              v-else-if="group.type === 'cash'"
              :class="['h-4 w-4', getAccountTypeConfig(group.type).iconColor]"
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
            <!-- Loan Icon -->
            <svg
              v-else-if="group.type === 'loan'"
              :class="['h-4 w-4', getAccountTypeConfig(group.type).iconColor]"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M12 8v13m0-13V6a2 2 0 112 2h-2zm0 0V5.5A2.5 2.5 0 109.5 8H12zm-7 4h14M5 12a2 2 0 110-4h14a2 2 0 110 4M5 12v7a2 2 0 002 2h10a2 2 0 002-2v-7"
              />
            </svg>
            <!-- Other Icon -->
            <svg
              v-else
              :class="['h-4 w-4', getAccountTypeConfig(group.type).iconColor]"
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
          </div>
          <h2 class="text-lg font-semibold text-gray-900 dark:text-gray-100">{{ group.label }}</h2>
          <span class="text-sm text-gray-500 dark:text-gray-400"
            >({{ group.accounts.length }})</span
          >
        </div>

        <!-- Account Cards Grid -->
        <div class="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          <div
            v-for="account in group.accounts"
            :key="account.id"
            class="rounded-xl border border-gray-200 bg-white p-5 transition-shadow duration-200 hover:shadow-lg dark:border-slate-700 dark:bg-slate-800"
            :class="{ 'opacity-60': !account.isActive }"
          >
            <!-- Card Header -->
            <div class="mb-4 flex items-start justify-between">
              <div class="flex items-center gap-3">
                <!-- Account Type Icon -->
                <div
                  class="flex h-12 w-12 items-center justify-center rounded-xl"
                  :class="[
                    getAccountTypeConfig(account.type).bgColor,
                    getAccountTypeConfig(account.type).darkBgColor,
                  ]"
                >
                  <!-- Checking Icon -->
                  <svg
                    v-if="account.type === 'checking'"
                    :class="['h-6 w-6', getAccountTypeConfig(account.type).iconColor]"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      stroke-width="2"
                      d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z"
                    />
                  </svg>
                  <!-- Savings Icon -->
                  <svg
                    v-else-if="account.type === 'savings'"
                    :class="['h-6 w-6', getAccountTypeConfig(account.type).iconColor]"
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
                  <!-- Credit Card Icon -->
                  <svg
                    v-else-if="account.type === 'credit_card'"
                    :class="['h-6 w-6', getAccountTypeConfig(account.type).iconColor]"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      stroke-width="2"
                      d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z"
                    />
                  </svg>
                  <!-- Investment Icon -->
                  <svg
                    v-else-if="account.type === 'investment'"
                    :class="['h-6 w-6', getAccountTypeConfig(account.type).iconColor]"
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
                  <!-- Crypto Icon -->
                  <svg
                    v-else-if="account.type === 'crypto'"
                    :class="['h-6 w-6', getAccountTypeConfig(account.type).iconColor]"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      stroke-width="2"
                      d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8V6m0 8v2m-6-4h.01M18 12h.01M7 8h.01M17 8h.01M7 16h.01M17 16h.01"
                    />
                  </svg>
                  <!-- Cash Icon -->
                  <svg
                    v-else-if="account.type === 'cash'"
                    :class="['h-6 w-6', getAccountTypeConfig(account.type).iconColor]"
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
                  <!-- Loan Icon -->
                  <svg
                    v-else-if="account.type === 'loan'"
                    :class="['h-6 w-6', getAccountTypeConfig(account.type).iconColor]"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      stroke-width="2"
                      d="M12 8v13m0-13V6a2 2 0 112 2h-2zm0 0V5.5A2.5 2.5 0 109.5 8H12zm-7 4h14M5 12a2 2 0 110-4h14a2 2 0 110 4M5 12v7a2 2 0 002 2h10a2 2 0 002-2v-7"
                    />
                  </svg>
                  <!-- Other Icon -->
                  <svg
                    v-else
                    :class="['h-6 w-6', getAccountTypeConfig(account.type).iconColor]"
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
                </div>
                <div>
                  <h3 class="font-semibold text-gray-900 dark:text-gray-100">{{ account.name }}</h3>
                  <p v-if="account.institution" class="text-sm text-gray-500 dark:text-gray-400">
                    {{ account.institution }}
                  </p>
                </div>
              </div>

              <!-- Action Menu -->
              <div class="flex gap-1">
                <button
                  data-testid="edit-account-btn"
                  class="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-blue-600 dark:hover:bg-slate-700"
                  title="Edit account"
                  @click="openEditModal(account)"
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
                  title="Delete account"
                  @click="deleteAccount(account.id)"
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

            <!-- Balance Display -->
            <div class="mb-4">
              <p class="mb-1 text-xs tracking-wide text-gray-500 uppercase dark:text-gray-400">
                {{ t('form.balance') }}
              </p>
              <div class="text-2xl font-bold">
                <CurrencyAmount
                  :amount="account.balance"
                  :currency="account.currency"
                  :type="
                    account.type === 'credit_card' || account.type === 'loan' ? 'expense' : 'income'
                  "
                  size="xl"
                />
              </div>
            </div>

            <!-- Card Footer -->
            <div
              class="flex items-center justify-between border-t border-gray-100 pt-3 dark:border-slate-700"
            >
              <!-- Owner Badge -->
              <div class="flex items-center gap-2">
                <div
                  class="flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium text-white"
                  :style="{ backgroundColor: getMemberColor(account.memberId) }"
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
                  getMemberName(account.memberId)
                }}</span>
              </div>

              <!-- Status Indicators -->
              <div class="flex items-center gap-2">
                <span
                  v-if="!account.isActive"
                  class="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500 dark:bg-slate-700 dark:text-gray-400"
                >
                  {{ t('status.inactive') }}
                </span>
                <span
                  v-if="!account.includeInNetWorth"
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

    <!-- Add Account Modal -->
    <BaseModal :open="showAddModal" :title="t('accounts.addAccount')" @close="showAddModal = false">
      <form class="space-y-4" @submit.prevent="createAccount">
        <BaseInput
          v-model="newAccount.name"
          :label="t('accounts.accountName')"
          placeholder="e.g., Main Checking"
          required
        />

        <BaseSelect
          v-model="newAccount.type"
          :options="accountTypes"
          :label="t('accounts.accountType')"
        />

        <BaseSelect
          v-model="newAccount.memberId"
          :options="memberOptions"
          :label="t('form.owner')"
        />

        <BaseInput
          v-model="newAccount.institution"
          :label="t('form.institution')"
          placeholder="e.g., Bank of America"
        />

        <BaseSelect
          v-model="newAccount.currency"
          :options="currencyOptions"
          :label="t('form.currency')"
        />

        <BaseInput
          v-model="newAccount.balance"
          type="number"
          :label="t('accounts.currentBalance')"
          placeholder="0.00"
        />
      </form>

      <template #footer>
        <div class="flex justify-end gap-3">
          <BaseButton variant="secondary" @click="showAddModal = false">
            {{ t('action.cancel') }}
          </BaseButton>
          <BaseButton :loading="isSubmitting" @click="createAccount">
            {{ t('accounts.addAccount') }}
          </BaseButton>
        </div>
      </template>
    </BaseModal>

    <!-- Edit Account Modal -->
    <BaseModal :open="showEditModal" :title="t('accounts.editAccount')" @close="closeEditModal">
      <form class="space-y-4" @submit.prevent="saveEdit">
        <BaseInput
          v-model="editingAccount.name"
          :label="t('accounts.accountName')"
          placeholder="e.g., Main Checking"
          required
        />

        <BaseSelect
          v-model="editingAccount.type"
          :options="accountTypes"
          :label="t('accounts.accountType')"
        />

        <BaseSelect
          v-model="editingAccount.memberId"
          :options="memberOptions"
          :label="t('form.owner')"
        />

        <BaseInput
          v-model="editingAccount.institution"
          :label="t('form.institution')"
          placeholder="e.g., Bank of America"
        />

        <BaseSelect
          v-model="editingAccount.currency"
          :options="currencyOptions"
          :label="t('form.currency')"
        />

        <BaseInput
          v-model="editingAccount.balance"
          type="number"
          :label="t('accounts.currentBalance')"
          placeholder="0.00"
          step="0.01"
        />

        <div class="flex items-center gap-4">
          <label class="flex cursor-pointer items-center gap-2">
            <input
              v-model="editingAccount.isActive"
              type="checkbox"
              class="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 dark:border-slate-600"
            />
            <span class="text-sm text-gray-700 dark:text-gray-300">{{ t('form.isActive') }}</span>
          </label>
          <label class="flex cursor-pointer items-center gap-2">
            <input
              v-model="editingAccount.includeInNetWorth"
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
          <BaseButton data-testid="save-edit-btn" :loading="isSubmitting" @click="saveEdit">
            {{ t('action.saveChanges') }}
          </BaseButton>
        </div>
      </template>
    </BaseModal>
  </div>
</template>
