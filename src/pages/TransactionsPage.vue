<script setup lang="ts">
import { ref, computed } from 'vue';
import CategoryIcon from '@/components/common/CategoryIcon.vue';
import CurrencyAmount from '@/components/common/CurrencyAmount.vue';
import RecurringItemForm from '@/components/recurring/RecurringItemForm.vue';
import TransactionModal from '@/components/transactions/TransactionModal.vue';
import { BaseCard, BaseButton, BaseModal } from '@/components/ui';
import ActionButtons from '@/components/ui/ActionButtons.vue';
import BeanieIcon from '@/components/ui/BeanieIcon.vue';
import EmptyStateIllustration from '@/components/ui/EmptyStateIllustration.vue';
import MonthNavigator from '@/components/ui/MonthNavigator.vue';
import SummaryStatCard from '@/components/dashboard/SummaryStatCard.vue';
import TogglePillGroup from '@/components/ui/TogglePillGroup.vue';
import { useSounds } from '@/composables/useSounds';
import { useSyncHighlight } from '@/composables/useSyncHighlight';
import { useTranslation } from '@/composables/useTranslation';
import { confirm as showConfirm } from '@/composables/useConfirm';
import { useMemberInfo } from '@/composables/useMemberInfo';
import { getCategoryById } from '@/constants/categories';
import { formatFrequency, processRecurringItems } from '@/services/recurring/recurringProcessor';
import { useAccountsStore } from '@/stores/accountsStore';
import { useRecurringStore } from '@/stores/recurringStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useTransactionsStore } from '@/stores/transactionsStore';
import type {
  Transaction,
  CreateTransactionInput,
  UpdateTransactionInput,
  RecurringItem,
  CreateRecurringItemInput,
} from '@/types/models';
import {
  formatMonthYear,
  toISODateString,
  getStartOfMonth,
  getEndOfMonth,
  isDateBetween,
  toDateInputValue,
} from '@/utils/date';

const transactionsStore = useTransactionsStore();
const accountsStore = useAccountsStore();
const settingsStore = useSettingsStore();
const recurringStore = useRecurringStore();
const { getMemberNameByAccountId, getMemberColorByAccountId } = useMemberInfo();
const { t } = useTranslation();
const { syncHighlightClass } = useSyncHighlight();
const { playWhoosh } = useSounds();

// ── State ─────────────────────────────────────────────────────────────────
const selectedMonth = ref(new Date());
const activeFilter = ref<'all' | 'recurring' | 'one-time'>('all');
const searchQuery = ref('');

// Modal state
const showAddModal = ref(false);
const showEditModal = ref(false);
const editingTransaction = ref<Transaction | null>(null);
const showRecurringModal = ref(false);
const editingRecurringItem = ref<RecurringItem | undefined>(undefined);
const isSubmittingRecurring = ref(false);

// ── Computeds ─────────────────────────────────────────────────────────────
const baseCurrency = computed(() => settingsStore.baseCurrency);

const monthStart = computed(() => toISODateString(getStartOfMonth(selectedMonth.value)));
const monthEnd = computed(() => toISODateString(getEndOfMonth(selectedMonth.value)));

// Filter transactions to selected month
const monthTransactions = computed(() =>
  transactionsStore.filteredSortedTransactions.filter((tx) =>
    isDateBetween(tx.date, monthStart.value, monthEnd.value)
  )
);

// Apply type filter
const filteredByType = computed(() => {
  if (activeFilter.value === 'recurring') {
    return monthTransactions.value.filter((tx) => tx.recurringItemId);
  }
  if (activeFilter.value === 'one-time') {
    return monthTransactions.value.filter((tx) => !tx.recurringItemId);
  }
  return monthTransactions.value;
});

// Apply search
const displayTransactions = computed(() => {
  const q = searchQuery.value.toLowerCase().trim();
  if (!q) return filteredByType.value;
  return filteredByType.value.filter(
    (tx) =>
      tx.description.toLowerCase().includes(q) ||
      getCategoryName(tx.category).toLowerCase().includes(q) ||
      getMemberNameByAccountId(tx.accountId).toLowerCase().includes(q)
  );
});

// Group by date
const groupedTransactions = computed(() => {
  const groups = new Map<string, Transaction[]>();
  for (const tx of displayTransactions.value) {
    const key = toDateInputValue(new Date(tx.date));
    const group = groups.get(key);
    if (group) {
      group.push(tx);
    } else {
      groups.set(key, [tx]);
    }
  }
  return groups;
});

// Summary computeds
function convertToBaseCurrency(amount: number, fromCurrency: string): number {
  const base = settingsStore.baseCurrency;
  if (fromCurrency === base) return amount;
  const rates = settingsStore.exchangeRates;
  const directRate = rates.find((r) => r.from === fromCurrency && r.to === base);
  if (directRate) return amount * directRate.rate;
  const inverseRate = rates.find((r) => r.from === base && r.to === fromCurrency);
  if (inverseRate) return amount / inverseRate.rate;
  return amount;
}

const monthIncome = computed(() =>
  monthTransactions.value
    .filter((tx) => tx.type === 'income')
    .reduce((sum, tx) => sum + convertToBaseCurrency(tx.amount, tx.currency), 0)
);

const monthExpenses = computed(() =>
  monthTransactions.value
    .filter((tx) => tx.type === 'expense')
    .reduce((sum, tx) => sum + convertToBaseCurrency(tx.amount, tx.currency), 0)
);

const monthNet = computed(() => monthIncome.value - monthExpenses.value);

const recurringCount = computed(
  () => monthTransactions.value.filter((tx) => tx.recurringItemId).length
);

const oneTimeCount = computed(
  () => monthTransactions.value.filter((tx) => !tx.recurringItemId).length
);

const totalCount = computed(() => monthTransactions.value.length);

// Page subtitle
const subtitle = computed(
  () =>
    `${formatMonthYear(selectedMonth.value)} \u00B7 ${totalCount.value} ${t('transactions.transactionCount')}`
);

// ── Helpers ───────────────────────────────────────────────────────────────
function getCategoryName(categoryId: string): string {
  const category = getCategoryById(categoryId);
  return category?.name || categoryId;
}

function getAccountName(accountId: string): string {
  const account = accountsStore.accounts.find((a) => a.id === accountId);
  return account?.name || 'Unknown';
}

function formatDateGroupHeader(dateKey: string): string {
  const d = new Date(dateKey + 'T00:00:00');
  return new Intl.DateTimeFormat('en', { day: 'numeric', month: 'long' }).format(d).toUpperCase();
}

function getRecurringFrequencyLabel(tx: Transaction): string {
  if (!tx.recurringItemId) return '';
  const item = recurringStore.recurringItems.find((r) => r.id === tx.recurringItemId);
  if (!item) return t('transactions.typeRecurring');
  return `${t('transactions.typeRecurring')} \u00B7 ${formatFrequency(item).toLowerCase()}`;
}

// ── Transaction CRUD ──────────────────────────────────────────────────────
function openAddModal() {
  editingTransaction.value = null;
  showAddModal.value = true;
}

function openEditModal(transaction: Transaction) {
  editingTransaction.value = transaction;
  showEditModal.value = true;
}

function closeEditModal() {
  showEditModal.value = false;
  editingTransaction.value = null;
}

async function handleTransactionSave(
  data: CreateTransactionInput | { id: string; data: UpdateTransactionInput }
) {
  if ('id' in data) {
    await transactionsStore.updateTransaction(data.id, data.data);
    closeEditModal();
  } else {
    await transactionsStore.createTransaction(data);
    showAddModal.value = false;
  }
}

async function handleTransactionDelete(id: string) {
  closeEditModal();
  if (
    await showConfirm({
      title: 'confirm.deleteTransactionTitle',
      message: 'transactions.deleteConfirm',
    })
  ) {
    await transactionsStore.deleteTransaction(id);
    playWhoosh();
  }
}

async function deleteTransaction(id: string) {
  if (
    await showConfirm({
      title: 'confirm.deleteTransactionTitle',
      message: 'transactions.deleteConfirm',
    })
  ) {
    await transactionsStore.deleteTransaction(id);
    playWhoosh();
  }
}

// ── Recurring save from TransactionModal ──────────────────────────────────
async function handleSaveRecurring(data: CreateRecurringItemInput) {
  await recurringStore.createRecurringItem(data);
  // Process the new recurring item to generate due transactions immediately
  const result = await processRecurringItems();
  if (result.processed > 0) {
    await transactionsStore.loadTransactions();
  }
  showAddModal.value = false;
}

// ── Recurring CRUD (for editing recurring templates) ──────────────────────
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

async function deleteRecurringItemById(id: string) {
  if (
    await showConfirm({
      title: 'confirm.deleteRecurringTitle',
      message: 'recurring.deleteConfirm',
    })
  ) {
    await recurringStore.deleteRecurringItem(id);
    playWhoosh();
  }
}

// Helper to find the recurring item for a transaction (for edit button)
function getRecurringItem(tx: Transaction): RecurringItem | undefined {
  if (!tx.recurringItemId) return undefined;
  return recurringStore.recurringItems.find((r) => r.id === tx.recurringItemId);
}
</script>

<template>
  <div class="space-y-6">
    <!-- Header -->
    <div>
      <h1 class="font-outfit text-2xl font-bold text-[var(--color-text)]">
        {{ t('transactions.pageTitle') }}
      </h1>
      <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">{{ subtitle }}</p>
    </div>

    <!-- Toolbar -->
    <div class="flex flex-wrap items-center gap-3">
      <!-- Filter pills -->
      <TogglePillGroup
        :model-value="activeFilter"
        :options="[
          { value: 'all', label: t('transactions.filterAll') },
          { value: 'recurring', label: t('transactions.filterRecurring') },
          { value: 'one-time', label: t('transactions.filterOneTime') },
        ]"
        @update:model-value="activeFilter = $event as 'all' | 'recurring' | 'one-time'"
      />

      <!-- Search -->
      <div class="relative max-w-[320px] min-w-[180px] flex-1">
        <BeanieIcon
          name="search"
          size="sm"
          class="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-gray-400"
        />
        <input
          v-model="searchQuery"
          type="text"
          :placeholder="t('transactions.searchPlaceholder')"
          class="focus:border-primary-300 focus:ring-primary-100 dark:focus:border-primary-500 dark:focus:ring-primary-900/30 w-full rounded-[14px] border border-gray-200 bg-white py-2 pr-3 pl-9 text-sm text-[var(--color-text)] placeholder:text-gray-400 focus:ring-2 focus:outline-none dark:border-slate-600 dark:bg-slate-800 dark:placeholder:text-gray-500"
        />
      </div>

      <!-- Month navigator -->
      <MonthNavigator v-model="selectedMonth" />

      <!-- Add button -->
      <BaseButton class="ml-auto" @click="openAddModal">
        {{ t('transactions.addTransaction') }}
      </BaseButton>
    </div>

    <!-- Summary row -->
    <div class="flex flex-wrap items-start gap-4">
      <!-- Income / Expenses / Net cards -->
      <div class="grid flex-1 grid-cols-1 gap-4 sm:grid-cols-3">
        <SummaryStatCard
          :label="t('transactions.income')"
          :amount="monthIncome"
          :currency="baseCurrency"
          tint="green"
        >
          <template #icon>
            <BeanieIcon name="arrow-up" size="md" class="text-[#27AE60]" />
          </template>
        </SummaryStatCard>

        <SummaryStatCard
          :label="t('transactions.expenses')"
          :amount="monthExpenses"
          :currency="baseCurrency"
          tint="orange"
        >
          <template #icon>
            <BeanieIcon name="arrow-down" size="md" class="text-primary-500" />
          </template>
        </SummaryStatCard>

        <SummaryStatCard
          :label="t('transactions.net')"
          :amount="monthNet"
          :currency="baseCurrency"
          tint="slate"
          :dark="monthNet >= 0"
        >
          <template #icon>
            <BeanieIcon
              name="bar-chart"
              size="md"
              :class="monthNet >= 0 ? 'text-white' : 'text-primary-500'"
            />
          </template>
        </SummaryStatCard>
      </div>

      <!-- Count pills -->
      <div class="flex gap-3 pt-1">
        <div
          class="dark:bg-primary-900/20 flex items-center gap-1.5 rounded-[10px] bg-[var(--tint-orange-8)] px-3 py-2"
        >
          <BeanieIcon name="repeat" size="xs" class="text-primary-500" />
          <span class="font-outfit text-primary-500 text-sm font-semibold">{{
            recurringCount
          }}</span>
          <span class="text-xs text-gray-500 dark:text-gray-400">{{
            t('transactions.recurringCount')
          }}</span>
        </div>
        <div
          class="flex items-center gap-1.5 rounded-[10px] bg-[var(--tint-slate-5)] px-3 py-2 dark:bg-slate-700"
        >
          <BeanieIcon name="arrow-right-left" size="xs" class="text-secondary-500" />
          <span class="font-outfit text-secondary-500 text-sm font-semibold">{{
            oneTimeCount
          }}</span>
          <span class="text-xs text-gray-500 dark:text-gray-400">{{
            t('transactions.oneTimeCount')
          }}</span>
        </div>
      </div>
    </div>

    <!-- Transaction list -->
    <BaseCard>
      <div
        v-if="displayTransactions.length === 0"
        class="py-12 text-center text-gray-500 dark:text-gray-400"
      >
        <EmptyStateIllustration variant="transactions" class="mb-4" />
        <p>{{ t('transactions.noTransactionsForPeriod') }}</p>
        <p class="mt-2 text-sm">{{ t('transactions.tryDifferentRange') }}</p>
      </div>

      <template v-else>
        <!-- Grid header (desktop) -->
        <div
          class="hidden border-b border-gray-100 pb-2 text-xs font-medium tracking-wider text-gray-400 uppercase md:grid md:grid-cols-[36px_1.6fr_0.8fr_0.7fr_0.8fr_0.6fr] md:items-center md:gap-3 dark:border-slate-700 dark:text-gray-500"
        >
          <div></div>
          <div>{{ t('transactions.title') }}</div>
          <div>{{ t('family.title') }}</div>
          <div class="text-right">{{ t('form.amount') }}</div>
          <div>{{ t('form.type') }}</div>
          <div></div>
        </div>

        <!-- Date-grouped rows -->
        <div v-for="[dateKey, txns] in groupedTransactions" :key="dateKey">
          <!-- Date group header -->
          <div class="flex items-center gap-3 pt-5 pb-2">
            <span class="text-xs font-semibold tracking-wider text-gray-400 dark:text-gray-500">
              {{ formatDateGroupHeader(dateKey) }}
            </span>
            <div class="h-px flex-1 bg-gray-100 dark:bg-slate-700"></div>
          </div>

          <!-- Transaction rows -->
          <div
            v-for="tx in txns"
            :key="tx.id"
            data-testid="transaction-item"
            class="group py-3 md:grid md:grid-cols-[36px_1.6fr_0.8fr_0.7fr_0.8fr_0.6fr] md:items-center md:gap-3"
            :class="syncHighlightClass(tx.id)"
          >
            <!-- Icon -->
            <div
              class="hidden h-9 w-9 items-center justify-center rounded-[12px] md:flex"
              :class="
                tx.type === 'income' ? 'bg-[var(--tint-success-10)]' : 'bg-[var(--tint-orange-8)]'
              "
            >
              <CategoryIcon :category="tx.category" size="sm" />
            </div>

            <!-- Description + category (mobile-friendly) -->
            <div class="flex items-center gap-3 md:block">
              <!-- Mobile icon -->
              <div
                class="flex h-9 w-9 shrink-0 items-center justify-center rounded-[12px] md:hidden"
                :class="
                  tx.type === 'income' ? 'bg-[var(--tint-success-10)]' : 'bg-[var(--tint-orange-8)]'
                "
              >
                <CategoryIcon :category="tx.category" size="sm" />
              </div>
              <div>
                <p class="text-sm font-medium text-gray-900 dark:text-gray-100">
                  {{ tx.description }}
                </p>
                <p class="text-xs text-gray-500 dark:text-gray-400">
                  {{ getCategoryName(tx.category) }}
                  <span class="md:hidden">
                    &middot; {{ getMemberNameByAccountId(tx.accountId) }}
                  </span>
                </p>
                <!-- Mobile: amount + type -->
                <div class="mt-1 flex items-center gap-2 md:hidden">
                  <CurrencyAmount
                    :amount="tx.amount"
                    :currency="tx.currency"
                    :type="tx.type === 'income' ? 'income' : 'expense'"
                    size="sm"
                  />
                  <span
                    v-if="tx.recurringItemId"
                    class="text-primary-500 dark:bg-primary-900/20 rounded-full bg-[var(--tint-orange-8)] px-2 py-0.5 text-[10px] font-medium"
                  >
                    {{ t('transactions.typeRecurring') }}
                  </span>
                  <span
                    v-else
                    class="rounded-full bg-[var(--tint-slate-5)] px-2 py-0.5 text-[10px] font-medium text-gray-500 dark:bg-slate-700 dark:text-gray-400"
                  >
                    {{ t('transactions.typeOneTime') }}
                  </span>
                </div>
              </div>
            </div>

            <!-- Member (desktop) -->
            <div class="hidden md:block">
              <div class="flex items-center gap-1.5">
                <BeanieIcon
                  name="user-filled"
                  size="xs"
                  :style="{ color: getMemberColorByAccountId(tx.accountId) }"
                />
                <span class="text-sm text-gray-700 dark:text-gray-300">
                  {{ getMemberNameByAccountId(tx.accountId) }}
                </span>
              </div>
              <p class="text-xs text-gray-400 dark:text-gray-500">
                {{ getAccountName(tx.accountId) }}
              </p>
            </div>

            <!-- Amount (desktop) -->
            <div class="hidden text-right md:block">
              <CurrencyAmount
                :amount="tx.amount"
                :currency="tx.currency"
                :type="tx.type === 'income' ? 'income' : 'expense'"
                size="md"
              />
            </div>

            <!-- Type pill (desktop) -->
            <div class="hidden md:block">
              <span
                v-if="tx.recurringItemId"
                class="text-primary-500 dark:bg-primary-900/20 inline-block rounded-full bg-[var(--tint-orange-8)] px-2.5 py-1 text-xs font-medium"
              >
                {{ getRecurringFrequencyLabel(tx) }}
              </span>
              <span
                v-else
                class="inline-block rounded-full bg-[var(--tint-slate-5)] px-2.5 py-1 text-xs font-medium text-gray-500 dark:bg-slate-700 dark:text-gray-400"
              >
                {{ t('transactions.typeOneTime') }}
              </span>
            </div>

            <!-- Actions -->
            <div class="mt-2 flex justify-end md:mt-0">
              <template v-if="tx.recurringItemId">
                <ActionButtons
                  size="sm"
                  @edit="
                    () => {
                      const ri = getRecurringItem(tx);
                      if (ri) openEditRecurringModal(ri);
                      else openEditModal(tx);
                    }
                  "
                  @delete="deleteRecurringItemById(tx.recurringItemId!)"
                />
              </template>
              <template v-else>
                <ActionButtons
                  size="sm"
                  @edit="openEditModal(tx)"
                  @delete="deleteTransaction(tx.id)"
                />
              </template>
            </div>
          </div>
        </div>
      </template>
    </BaseCard>

    <!-- Add Transaction Modal -->
    <TransactionModal
      :open="showAddModal"
      @close="showAddModal = false"
      @save="handleTransactionSave"
      @save-recurring="handleSaveRecurring"
      @delete="handleTransactionDelete"
    />

    <!-- Edit Transaction Modal -->
    <TransactionModal
      :open="showEditModal"
      :transaction="editingTransaction"
      @close="closeEditModal"
      @save="handleTransactionSave"
      @save-recurring="handleSaveRecurring"
      @delete="handleTransactionDelete"
    />

    <!-- Edit Recurring Modal -->
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
