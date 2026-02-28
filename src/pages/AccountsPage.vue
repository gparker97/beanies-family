<script setup lang="ts">
import { ref, computed } from 'vue';
import CurrencyAmount from '@/components/common/CurrencyAmount.vue';

import { BaseButton } from '@/components/ui';
import BeanieIcon from '@/components/ui/BeanieIcon.vue';
import EmptyStateIllustration from '@/components/ui/EmptyStateIllustration.vue';
import SummaryStatCard from '@/components/dashboard/SummaryStatCard.vue';
import AccountModal from '@/components/accounts/AccountModal.vue';
import { useSounds } from '@/composables/useSounds';
import { useSyncHighlight } from '@/composables/useSyncHighlight';
import { useTranslation } from '@/composables/useTranslation';
import { useMemberInfo } from '@/composables/useMemberInfo';
import { confirm as showConfirm } from '@/composables/useConfirm';
import { useAccountsStore } from '@/stores/accountsStore';
import { useSettingsStore } from '@/stores/settingsStore';
import type { Account, AccountType, CreateAccountInput, UpdateAccountInput } from '@/types/models';

const accountsStore = useAccountsStore();
const settingsStore = useSettingsStore();
const { t } = useTranslation();
const { getMemberName, getMemberColor } = useMemberInfo();
const { syncHighlightClass } = useSyncHighlight();
const { playWhoosh } = useSounds();

const showAddModal = ref(false);
const showEditModal = ref(false);
const editingAccount = ref<Account | null>(null);

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

// Summary card values
const baseCurrency = computed(() => settingsStore.baseCurrency);
const totalAssets = computed(() => accountsStore.filteredTotalAssets);
const totalLiabilities = computed(() => accountsStore.filteredTotalLiabilities);
const totalBalance = computed(() => accountsStore.filteredTotalBalance);

function getAccountTypeLabel(type: AccountType): string {
  return accountTypes.value.find((t) => t.value === type)?.label || type;
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
  editingAccount.value = null;
  showAddModal.value = true;
}

function openEditModal(account: Account) {
  editingAccount.value = account;
  showEditModal.value = true;
}

function closeEditModal() {
  showEditModal.value = false;
  editingAccount.value = null;
}

async function handleAccountSave(
  data: CreateAccountInput | { id: string; data: UpdateAccountInput }
) {
  if ('id' in data) {
    await accountsStore.updateAccount(data.id, data.data);
    closeEditModal();
  } else {
    await accountsStore.createAccount(data);
    showAddModal.value = false;
  }
}

async function handleAccountDelete(id: string) {
  closeEditModal();
  if (
    await showConfirm({ title: 'confirm.deleteAccountTitle', message: 'accounts.deleteConfirm' })
  ) {
    await accountsStore.deleteAccount(id);
    playWhoosh();
  }
}

async function deleteAccount(id: string) {
  if (
    await showConfirm({ title: 'confirm.deleteAccountTitle', message: 'accounts.deleteConfirm' })
  ) {
    await accountsStore.deleteAccount(id);
    playWhoosh();
  }
}
</script>

<template>
  <div class="space-y-6">
    <!-- Action bar -->
    <div class="flex justify-end">
      <BaseButton @click="openAddModal">
        <BeanieIcon name="plus" size="md" class="mr-1.5 -ml-1" />
        {{ t('accounts.addAccount') }}
      </BaseButton>
    </div>

    <!-- Summary Cards -->
    <div class="grid grid-cols-1 gap-4 md:grid-cols-3">
      <SummaryStatCard
        :label="t('common.totalAssets')"
        :amount="totalAssets"
        :currency="baseCurrency"
        tint="green"
      >
        <template #icon>
          <BeanieIcon name="arrow-up" size="md" class="text-[#27AE60]" />
        </template>
      </SummaryStatCard>

      <SummaryStatCard
        :label="t('common.totalLiabilities')"
        :amount="totalLiabilities"
        :currency="baseCurrency"
        tint="orange"
      >
        <template #icon>
          <BeanieIcon name="arrow-down" size="md" class="text-primary-500" />
        </template>
      </SummaryStatCard>

      <SummaryStatCard
        :label="t('dashboard.netWorth')"
        :amount="totalBalance"
        :currency="baseCurrency"
        tint="slate"
        dark
      >
        <template #icon>
          <BeanieIcon name="dollar-circle" size="md" class="text-white" />
        </template>
      </SummaryStatCard>
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
          <h2 class="nook-section-label text-secondary-500 dark:text-gray-400">
            {{ group.label }}
          </h2>
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
            class="rounded-[var(--sq)] bg-white p-5 shadow-[var(--card-shadow)] transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:shadow-[var(--card-hover-shadow)] dark:bg-slate-800"
            :class="[{ 'opacity-60': !account.isActive }, syncHighlightClass(account.id)]"
          >
            <!-- Card Header -->
            <div class="mb-4 flex items-start justify-between">
              <div class="flex items-center gap-3">
                <!-- Account Type Icon -->
                <div
                  class="flex h-[42px] w-[42px] items-center justify-center rounded-[14px]"
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
                    {{ account.institution
                    }}<span v-if="account.institutionCountry">
                      &middot; {{ account.institutionCountry }}</span
                    >
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
              <div class="font-outfit text-2xl font-extrabold">
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
    <AccountModal
      :open="showAddModal"
      @close="showAddModal = false"
      @save="handleAccountSave"
      @delete="handleAccountDelete"
    />

    <!-- Edit Account Modal -->
    <AccountModal
      :open="showEditModal"
      :account="editingAccount"
      @close="closeEditModal"
      @save="handleAccountSave"
      @delete="handleAccountDelete"
    />
  </div>
</template>
