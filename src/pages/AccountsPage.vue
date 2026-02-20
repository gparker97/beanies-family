<script setup lang="ts">
import { ref, computed } from 'vue';
import CurrencyAmount from '@/components/common/CurrencyAmount.vue';
import PageHeader from '@/components/common/PageHeader.vue';
import { BaseButton, BaseInput, BaseSelect, BaseModal } from '@/components/ui';
import BeanieIcon from '@/components/ui/BeanieIcon.vue';
import EmptyStateIllustration from '@/components/ui/EmptyStateIllustration.vue';
import { useCurrencyDisplay } from '@/composables/useCurrencyDisplay';
import { usePrivacyMode } from '@/composables/usePrivacyMode';
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
const { formatMasked } = usePrivacyMode();
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

// Format totals (which are in base currency) to display currency, masked when privacy mode is on
function formatTotal(amount: number): string {
  return formatMasked(formatInDisplayCurrency(amount, settingsStore.baseCurrency));
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
        bgColor: 'bg-sky-silk-100',
        iconColor: 'text-primary-600',
        darkBgColor: 'dark:bg-primary-900/30',
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
    <PageHeader icon="credit-card" :title="t('accounts.title')" :subtitle="t('accounts.subtitle')">
      <BaseButton @click="openAddModal">
        <BeanieIcon name="plus" size="md" class="mr-1.5 -ml-1" />
        {{ t('accounts.addAccount') }}
      </BaseButton>
    </PageHeader>

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
            <BeanieIcon name="arrow-up" size="lg" />
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
            <BeanieIcon name="arrow-down" size="lg" />
          </div>
        </div>
      </div>

      <!-- Net Worth -->
      <div
        class="from-secondary-500 to-secondary-700 rounded-xl bg-gradient-to-br p-5 text-white shadow-lg"
      >
        <div class="flex items-center justify-between">
          <div>
            <p class="text-sm font-medium text-white/80">{{ t('dashboard.netWorth') }}</p>
            <p class="mt-1 text-2xl font-bold">
              {{ formatTotal(accountsStore.filteredTotalBalance) }}
            </p>
          </div>
          <div class="flex h-12 w-12 items-center justify-center rounded-lg bg-white/20">
            <BeanieIcon name="dollar-circle" size="lg" />
          </div>
        </div>
      </div>
    </div>

    <!-- Empty State -->
    <div v-if="accounts.length === 0" class="py-16 text-center">
      <EmptyStateIllustration variant="accounts" class="mb-6" />
      <h3 class="text-lg font-medium text-gray-900 dark:text-gray-100">
        {{ t('accounts.noAccounts') }}
      </h3>
      <p class="mt-1 mb-4 text-gray-500 dark:text-gray-400">{{ t('accounts.getStarted') }}</p>
      <BaseButton @click="openAddModal">
        <BeanieIcon name="plus" size="md" class="mr-1.5 -ml-1" />
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
            <BeanieIcon
              :name="`account-${group.type}`"
              size="sm"
              :class="getAccountTypeConfig(group.type).iconColor"
            />
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
            data-testid="account-card"
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
                  <BeanieIcon
                    :name="`account-${account.type}`"
                    size="lg"
                    :class="getAccountTypeConfig(account.type).iconColor"
                  />
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
                  class="hover:text-primary-600 rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 dark:hover:bg-slate-700"
                  title="Edit account"
                  @click="openEditModal(account)"
                >
                  <BeanieIcon name="edit" size="sm" />
                </button>
                <button
                  class="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-red-600 dark:hover:bg-slate-700"
                  title="Delete account"
                  @click="deleteAccount(account.id)"
                >
                  <BeanieIcon name="trash" size="sm" />
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
                  <BeanieIcon name="user" size="xs" />
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
              class="text-primary-600 focus:ring-primary-500 h-4 w-4 rounded border-gray-300 dark:border-slate-600"
            />
            <span class="text-sm text-gray-700 dark:text-gray-300">{{ t('form.isActive') }}</span>
          </label>
          <label class="flex cursor-pointer items-center gap-2">
            <input
              v-model="editingAccount.includeInNetWorth"
              type="checkbox"
              class="text-primary-600 focus:ring-primary-500 h-4 w-4 rounded border-gray-300 dark:border-slate-600"
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
