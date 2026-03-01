<script setup lang="ts">
import { ref, computed } from 'vue';
import CurrencyAmount from '@/components/common/CurrencyAmount.vue';
import { BaseButton } from '@/components/ui';
import ActionButtons from '@/components/ui/ActionButtons.vue';
import BeanieAvatar from '@/components/ui/BeanieAvatar.vue';
import BeanieIcon from '@/components/ui/BeanieIcon.vue';
import EmptyStateIllustration from '@/components/ui/EmptyStateIllustration.vue';
import TogglePillGroup from '@/components/ui/TogglePillGroup.vue';
import SummaryStatCard from '@/components/dashboard/SummaryStatCard.vue';
import AccountModal from '@/components/accounts/AccountModal.vue';
import { useSounds } from '@/composables/useSounds';
import { useSyncHighlight } from '@/composables/useSyncHighlight';
import { useTranslation } from '@/composables/useTranslation';
import { useMemberInfo } from '@/composables/useMemberInfo';
import { usePrivacyMode } from '@/composables/usePrivacyMode';
import { formatCurrencyWithCode } from '@/composables/useCurrencyDisplay';
import { getMemberAvatarVariant } from '@/composables/useMemberAvatar';
import { confirm as showConfirm } from '@/composables/useConfirm';
import { convertToBaseCurrency } from '@/utils/currency';
import { useAccountsStore } from '@/stores/accountsStore';
import { useFamilyStore } from '@/stores/familyStore';
import { useSettingsStore } from '@/stores/settingsStore';
import type { Account, AccountType, CreateAccountInput, UpdateAccountInput } from '@/types/models';

const accountsStore = useAccountsStore();
const familyStore = useFamilyStore();
const settingsStore = useSettingsStore();
const { t } = useTranslation();
const { getMemberName, getMemberColor } = useMemberInfo();
const { syncHighlightClass } = useSyncHighlight();
const { playWhoosh } = useSounds();
const { isUnlocked } = usePrivacyMode();

const showAddModal = ref(false);
const showEditModal = ref(false);
const editingAccount = ref<Account | null>(null);
const groupBy = ref<'member' | 'category'>('member');
const addModalDefaults = ref<{ memberId?: string; type?: AccountType } | undefined>();

const groupByOptions = computed(() => [
  { value: 'member', label: t('accounts.groupByMember') },
  { value: 'category', label: t('accounts.groupByCategory') },
]);

const accountTypes = computed(() => [
  { value: 'checking' as AccountType, label: t('accounts.type.checking') },
  { value: 'savings' as AccountType, label: t('accounts.type.savings') },
  { value: 'credit_card' as AccountType, label: t('accounts.type.credit_card') },
  { value: 'investment' as AccountType, label: t('accounts.type.investment') },
  { value: 'crypto' as AccountType, label: t('accounts.type.crypto') },
  { value: 'retirement_401k' as AccountType, label: t('accounts.type.retirement_401k') },
  { value: 'retirement_ira' as AccountType, label: t('accounts.type.retirement_ira') },
  { value: 'retirement_roth_ira' as AccountType, label: t('accounts.type.retirement_roth_ira') },
  { value: 'retirement_bene_ira' as AccountType, label: t('accounts.type.retirement_bene_ira') },
  { value: 'retirement_kids_ira' as AccountType, label: t('accounts.type.retirement_kids_ira') },
  { value: 'retirement' as AccountType, label: t('accounts.type.retirement') },
  { value: 'education_529' as AccountType, label: t('accounts.type.education_529') },
  { value: 'education_savings' as AccountType, label: t('accounts.type.education_savings') },
  { value: 'cash' as AccountType, label: t('accounts.type.cash') },
  { value: 'loan' as AccountType, label: t('accounts.type.loan') },
  { value: 'other' as AccountType, label: t('accounts.type.other') },
]);

const typeOrder: AccountType[] = [
  'checking',
  'savings',
  'investment',
  'crypto',
  'retirement_401k',
  'retirement_ira',
  'retirement_roth_ira',
  'retirement_bene_ira',
  'retirement_kids_ira',
  'retirement',
  'education_529',
  'education_savings',
  'credit_card',
  'loan',
  'cash',
  'other',
];

// Uses filtered data based on global member filter
const accounts = computed(() => accountsStore.filteredAccounts);

// Summary card values
const baseCurrency = computed(() => settingsStore.baseCurrency);
const totalAssets = computed(() => accountsStore.filteredTotalAssets);
const totalLiabilities = computed(() => accountsStore.filteredTotalLiabilities);

// Subtitle counts
const subtitleText = computed(() =>
  t('accounts.subtitleCounts')
    .replace('{members}', String(familyStore.members.length))
    .replace('{accounts}', String(accounts.value.length))
);

// Hero breakdown computeds
const assetBreakdown = computed(() => {
  const eligible = accounts.value.filter(
    (a) => a.isActive && a.includeInNetWorth && a.type !== 'credit_card' && a.type !== 'loan'
  );
  return {
    cash: eligible
      .filter((a) => ['checking', 'savings', 'cash'].includes(a.type))
      .reduce((s, a) => s + convertToBaseCurrency(a.balance, a.currency), 0),
    investments: eligible
      .filter((a) =>
        [
          'investment',
          'crypto',
          'retirement_401k',
          'retirement_ira',
          'retirement_roth_ira',
          'retirement_bene_ira',
          'retirement_kids_ira',
          'retirement',
          'education_529',
          'education_savings',
        ].includes(a.type)
      )
      .reduce((s, a) => s + convertToBaseCurrency(a.balance, a.currency), 0),
  };
});

const liabilityBreakdown = computed(() => {
  const eligible = accounts.value.filter((a) => a.isActive && a.includeInNetWorth);
  return {
    creditCards: eligible
      .filter((a) => a.type === 'credit_card')
      .reduce((s, a) => s + convertToBaseCurrency(a.balance, a.currency), 0),
    loans: eligible
      .filter((a) => a.type === 'loan')
      .reduce((s, a) => s + convertToBaseCurrency(a.balance, a.currency), 0),
  };
});

// Unified sections for both member and category views
interface AccountSection {
  key: string;
  label: string;
  accounts: Account[];
  addDefaults: { memberId?: string; type?: AccountType };
  header: { kind: 'member'; memberId: string } | { kind: 'category'; accountType: AccountType };
}

const sections = computed<AccountSection[]>(() => {
  if (groupBy.value === 'member') {
    return familyStore.members
      .filter((m) => accounts.value.some((a) => a.memberId === m.id))
      .map((m) => ({
        key: m.id,
        label: m.name,
        accounts: accounts.value.filter((a) => a.memberId === m.id),
        addDefaults: { memberId: m.id },
        header: { kind: 'member' as const, memberId: m.id },
      }));
  }
  return typeOrder
    .filter((type) => accounts.value.some((a) => a.type === type))
    .map((type) => ({
      key: type,
      label: getAccountTypeLabel(type),
      accounts: accounts.value.filter((a) => a.type === type),
      addDefaults: { type },
      header: { kind: 'category' as const, accountType: type },
    }));
});

// Helpers
function getAccountTypeLabel(type: AccountType): string {
  return accountTypes.value.find((t) => t.value === type)?.label || type;
}

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
      retirement_401k: {
        bgColor: 'bg-indigo-100',
        iconColor: 'text-indigo-600',
        darkBgColor: 'dark:bg-indigo-900/30',
      },
      retirement_ira: {
        bgColor: 'bg-indigo-100',
        iconColor: 'text-indigo-600',
        darkBgColor: 'dark:bg-indigo-900/30',
      },
      retirement_roth_ira: {
        bgColor: 'bg-indigo-100',
        iconColor: 'text-indigo-600',
        darkBgColor: 'dark:bg-indigo-900/30',
      },
      retirement_bene_ira: {
        bgColor: 'bg-indigo-100',
        iconColor: 'text-indigo-600',
        darkBgColor: 'dark:bg-indigo-900/30',
      },
      retirement_kids_ira: {
        bgColor: 'bg-indigo-100',
        iconColor: 'text-indigo-600',
        darkBgColor: 'dark:bg-indigo-900/30',
      },
      retirement: {
        bgColor: 'bg-indigo-100',
        iconColor: 'text-indigo-600',
        darkBgColor: 'dark:bg-indigo-900/30',
      },
      education_529: {
        bgColor: 'bg-teal-100',
        iconColor: 'text-teal-600',
        darkBgColor: 'dark:bg-teal-900/30',
      },
      education_savings: {
        bgColor: 'bg-teal-100',
        iconColor: 'text-teal-600',
        darkBgColor: 'dark:bg-teal-900/30',
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

function isLiability(type: AccountType): boolean {
  return type === 'credit_card' || type === 'loan';
}

function getMemberForAccount(memberId: string) {
  return familyStore.members.find((m) => m.id === memberId);
}

function sectionMemberTotal(section: AccountSection): number {
  return section.accounts.reduce(
    (s, a) => s + convertToBaseCurrency(a.balance, a.currency) * (isLiability(a.type) ? -1 : 1),
    0
  );
}

// Modal handlers
function openAddWithDefaults(defaults?: { memberId?: string; type?: AccountType }) {
  addModalDefaults.value = defaults;
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
    <!-- Page Header -->
    <div class="flex items-start justify-between">
      <div>
        <h1 class="font-outfit text-secondary-500 text-2xl font-bold dark:text-gray-100">
          {{ t('accounts.pageTitle') }}
        </h1>
        <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
          {{ subtitleText }}
        </p>
      </div>
      <BaseButton @click="openAddWithDefaults()">
        <BeanieIcon name="plus" size="md" class="mr-1.5 -ml-1" />
        {{ t('accounts.addAccount') }}
      </BaseButton>
    </div>

    <!-- Hero Section: 2:1 layout -->
    <div class="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <!-- Total Assets (wide) -->
      <SummaryStatCard
        :label="t('common.totalAssets')"
        :amount="totalAssets"
        :currency="baseCurrency"
        tint="slate"
        dark
        class="lg:col-span-2"
      >
        <template #icon>
          <BeanieIcon name="arrow-up" size="md" class="text-white" />
        </template>
        <!-- Asset breakdown -->
        <div v-if="isUnlocked" class="mt-3 grid grid-cols-2 gap-4 border-t border-white/10 pt-3">
          <div>
            <div class="font-outfit text-xs font-semibold uppercase opacity-40">
              {{ t('accounts.assetClass.cash') }}
            </div>
            <div class="font-outfit mt-0.5 text-sm font-semibold">
              {{ formatCurrencyWithCode(assetBreakdown.cash, baseCurrency) }}
            </div>
          </div>
          <div>
            <div class="font-outfit text-xs font-semibold uppercase opacity-40">
              {{ t('accounts.assetClass.investments') }}
            </div>
            <div class="font-outfit mt-0.5 text-sm font-semibold">
              {{ formatCurrencyWithCode(assetBreakdown.investments, baseCurrency) }}
            </div>
          </div>
        </div>
      </SummaryStatCard>

      <!-- Total Liabilities -->
      <SummaryStatCard
        :label="t('common.totalLiabilities')"
        :amount="totalLiabilities"
        :currency="baseCurrency"
        tint="orange"
      >
        <template #icon>
          <BeanieIcon name="arrow-down" size="md" class="text-primary-500" />
        </template>
        <!-- Liability breakdown -->
        <div
          v-if="isUnlocked"
          class="mt-3 space-y-2 border-t border-gray-100 pt-3 dark:border-slate-700"
        >
          <div class="flex items-center justify-between">
            <span class="text-xs text-gray-500 dark:text-gray-400">
              {{ t('accounts.liabilityClass.creditCards') }}
            </span>
            <span class="font-outfit text-xs font-semibold text-gray-700 dark:text-gray-300">
              {{ formatCurrencyWithCode(liabilityBreakdown.creditCards, baseCurrency) }}
            </span>
          </div>
          <div class="flex items-center justify-between">
            <span class="text-xs text-gray-500 dark:text-gray-400">
              {{ t('accounts.liabilityClass.loans') }}
            </span>
            <span class="font-outfit text-xs font-semibold text-gray-700 dark:text-gray-300">
              {{ formatCurrencyWithCode(liabilityBreakdown.loans, baseCurrency) }}
            </span>
          </div>
        </div>
      </SummaryStatCard>
    </div>

    <!-- Group By Toggle -->
    <div class="flex items-center gap-3">
      <TogglePillGroup v-model="groupBy" :options="groupByOptions" />
    </div>

    <!-- Empty State -->
    <div v-if="accounts.length === 0" class="py-16 text-center">
      <EmptyStateIllustration variant="accounts" class="mb-6" />
      <h3 class="text-lg font-medium text-gray-900 dark:text-gray-100">
        {{ t('accounts.noAccounts') }}
      </h3>
      <p class="mt-1 mb-4 text-gray-500 dark:text-gray-400">{{ t('accounts.getStarted') }}</p>
      <BaseButton @click="openAddWithDefaults()">
        <BeanieIcon name="plus" size="md" class="mr-1.5 -ml-1" />
        {{ t('accounts.addAccount') }}
      </BaseButton>
    </div>

    <!-- Unified Sections Loop -->
    <div v-else class="space-y-8">
      <div v-for="section in sections" :key="section.key">
        <!-- Section Header: Member view -->
        <div v-if="section.header.kind === 'member'" class="mb-4 flex items-center justify-between">
          <div class="flex items-center gap-3">
            <BeanieAvatar
              v-if="getMemberForAccount(section.header.memberId)"
              :variant="getMemberAvatarVariant(getMemberForAccount(section.header.memberId)!)"
              :color="getMemberColor(section.header.memberId)"
              size="sm"
            />
            <h2 class="font-outfit text-secondary-500 text-lg font-semibold dark:text-gray-100">
              {{ section.label }}
            </h2>
            <span class="text-sm text-gray-500 dark:text-gray-400"
              >({{ section.accounts.length }})</span
            >
          </div>
          <span
            v-if="isUnlocked"
            class="font-outfit text-secondary-500 text-sm font-semibold dark:text-gray-300"
          >
            {{ formatCurrencyWithCode(sectionMemberTotal(section), baseCurrency) }}
          </span>
        </div>

        <!-- Section Header: Category view -->
        <div v-else class="mb-4 flex items-center gap-3">
          <div
            class="flex h-8 w-8 items-center justify-center rounded-lg"
            :class="[
              getAccountTypeConfig(section.header.accountType).bgColor,
              getAccountTypeConfig(section.header.accountType).darkBgColor,
            ]"
          >
            <BeanieIcon
              :name="`account-${section.header.accountType}`"
              size="sm"
              :class="getAccountTypeConfig(section.header.accountType).iconColor"
            />
          </div>
          <h2 class="nook-section-label text-secondary-500 dark:text-gray-400">
            {{ section.label }}
          </h2>
          <span class="text-sm text-gray-500 dark:text-gray-400"
            >({{ section.accounts.length }})</span
          >
        </div>

        <!-- Account Cards Grid -->
        <div class="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          <div
            v-for="account in section.accounts"
            :key="account.id"
            data-testid="account-card"
            class="cursor-pointer rounded-[var(--sq)] bg-white p-5 shadow-[var(--card-shadow)] transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:shadow-[var(--card-hover-shadow)] dark:bg-slate-800"
            :class="[
              { 'opacity-60': !account.isActive },
              { 'border-l-primary-500 border-l-4': isLiability(account.type) },
              syncHighlightClass(account.id),
            ]"
            @click="openEditModal(account)"
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
              <ActionButtons
                edit-test-id="edit-account-btn"
                @click.stop
                @edit="openEditModal(account)"
                @delete="deleteAccount(account.id)"
              />
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
                  :type="isLiability(account.type) ? 'expense' : 'income'"
                  size="xl"
                />
              </div>
            </div>

            <!-- Card Footer -->
            <div
              class="flex items-center justify-between border-t border-gray-100 pt-3 dark:border-slate-700"
            >
              <!-- Left: Owner avatar (category view) or type badge (member view) -->
              <div class="flex items-center gap-2">
                <template v-if="groupBy === 'category'">
                  <BeanieAvatar
                    v-if="getMemberForAccount(account.memberId)"
                    :variant="getMemberAvatarVariant(getMemberForAccount(account.memberId)!)"
                    :color="getMemberColor(account.memberId)"
                    size="xs"
                  />
                  <span class="text-sm text-gray-600 dark:text-gray-400">{{
                    getMemberName(account.memberId)
                  }}</span>
                </template>
                <template v-else>
                  <span
                    class="rounded-full px-2 py-0.5 text-xs font-medium"
                    :class="[
                      getAccountTypeConfig(account.type).bgColor,
                      getAccountTypeConfig(account.type).darkBgColor,
                      getAccountTypeConfig(account.type).iconColor,
                    ]"
                  >
                    {{ getAccountTypeLabel(account.type) }}
                  </span>
                </template>
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

          <!-- "+ Add an Account" dashed card -->
          <button
            type="button"
            data-testid="add-account-card"
            class="hover:border-primary-300 hover:text-primary-500 dark:hover:border-primary-500 dark:hover:text-primary-400 flex min-h-[180px] flex-col items-center justify-center gap-2 rounded-[var(--sq)] border-2 border-dashed border-gray-200 bg-transparent p-5 text-gray-400 transition-colors dark:border-slate-600 dark:text-gray-500"
            @click="openAddWithDefaults(section.addDefaults)"
          >
            <BeanieIcon name="plus" size="lg" />
            <span class="font-outfit text-sm font-semibold">
              {{ t('accounts.addAnAccount') }}
            </span>
          </button>
        </div>
      </div>
    </div>

    <!-- Add Account Modal -->
    <AccountModal
      :open="showAddModal"
      :defaults="addModalDefaults"
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
