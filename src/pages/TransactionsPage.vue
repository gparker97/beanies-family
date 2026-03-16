<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import CategoryIcon from '@/components/common/CategoryIcon.vue';
import CurrencyAmount from '@/components/common/CurrencyAmount.vue';
import TransactionModal from '@/components/transactions/TransactionModal.vue';
import TransactionViewEditModal from '@/components/transactions/TransactionViewEditModal.vue';
import { BaseCard } from '@/components/ui';
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
import { chooseScope } from '@/composables/useRecurringEditScope';
import { useProjectedTransactions } from '@/composables/useProjectedTransactions';
import { useMemberInfo } from '@/composables/useMemberInfo';
import { getCategoryById } from '@/constants/categories';
import { formatFrequency, processRecurringItems } from '@/services/recurring/recurringProcessor';
import { useAssetsStore } from '@/stores/assetsStore';
import { useGoalsStore } from '@/stores/goalsStore';
import { useRecurringStore } from '@/stores/recurringStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useTransactionsStore } from '@/stores/transactionsStore';
import type {
  Transaction,
  DisplayTransaction,
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

const route = useRoute();
const router = useRouter();
const transactionsStore = useTransactionsStore();
const assetsStore = useAssetsStore();
const goalsStore = useGoalsStore();
const settingsStore = useSettingsStore();
const recurringStore = useRecurringStore();
const { getMemberNameByAccountId, getMemberColorByAccountId } = useMemberInfo();
const { t } = useTranslation();
const { syncHighlightClass } = useSyncHighlight();
const { playWhoosh } = useSounds();

// ── State ─────────────────────────────────────────────────────────────────
const selectedMonth = ref(new Date());
const { isFutureMonth, projectedTransactions } = useProjectedTransactions(selectedMonth);
const activeFilter = ref<'all' | 'recurring' | 'one-time'>('all');
const searchQuery = ref('');

// Modal state
const showAddModal = ref(false);
const showEditModal = ref(false);
const viewingTransaction = ref<Transaction | null>(null);
const editingTransaction = ref<Transaction | null>(null);
const editingRecurringItem = ref<RecurringItem | null>(null);

// Deferred projected-transaction editing state (scope is asked at save time)
const pendingProjectedTx = ref<DisplayTransaction | null>(null);
const addModalInitialValues = ref<Partial<CreateTransactionInput> | null>(null);

// Open view modal from query param (e.g. navigated from Dashboard)
onMounted(() => {
  const viewId = route.query.view as string | undefined;
  if (viewId) {
    const tx = transactionsStore.transactions.find((t) => t.id === viewId);
    if (tx) viewingTransaction.value = tx;
  }
  const riId = route.query.recurringItem as string | undefined;
  if (riId) {
    const ri = recurringStore.getRecurringItemById(riId);
    if (ri) openEditRecurringModal(ri);
  }
  // Clean up query params so refresh doesn't re-open
  if (viewId || riId) {
    router.replace({ query: {} });
  }
});

// ── Computeds ─────────────────────────────────────────────────────────────
const baseCurrency = computed(() => settingsStore.baseCurrency);

const monthStart = computed(() => toISODateString(getStartOfMonth(selectedMonth.value)));
const monthEnd = computed(() => toISODateString(getEndOfMonth(selectedMonth.value)));

// Filter transactions to selected month, merging projected recurring transactions
const monthTransactions = computed<DisplayTransaction[]>(() => {
  const actual: DisplayTransaction[] = transactionsStore.filteredSortedTransactions.filter((tx) =>
    isDateBetween(tx.date, monthStart.value, monthEnd.value)
  );

  // Build set of existing real transaction keys for dedup
  const existingKeys = new Set(
    actual
      .filter((tx) => tx.recurringItemId)
      .map((tx) => `${tx.recurringItemId}-${toDateInputValue(new Date(tx.date))}`)
  );

  // Only include projections that don't already have a real transaction
  const deduped = projectedTransactions.value.filter(
    (tx) => !existingKeys.has(`${tx.recurringItemId}-${tx.date}`)
  );

  const merged = [...actual, ...deduped];
  // Sort by date ascending (earliest first) so date group headers render chronologically
  merged.sort((a, b) => a.date.localeCompare(b.date));
  return merged;
});

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
  const groups = new Map<string, DisplayTransaction[]>();
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

function formatDateGroupHeader(dateKey: string): string {
  const d = new Date(dateKey + 'T00:00:00');
  const today = toDateInputValue(new Date());
  if (dateKey === today) {
    const dayMonth = new Intl.DateTimeFormat('en', { day: 'numeric', month: 'short' }).format(d);
    return `${t('date.today')} \u2014 ${dayMonth}`;
  }
  return new Intl.DateTimeFormat('en', { day: 'numeric', month: 'long' }).format(d).toUpperCase();
}

function isDateToday(dateKey: string): boolean {
  return dateKey === toDateInputValue(new Date());
}

function getRecurringFrequencyLabel(tx: DisplayTransaction): string {
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
  editingRecurringItem.value = null;
  pendingProjectedTx.value = null;
}

function closeAddModal() {
  showAddModal.value = false;
  addModalInitialValues.value = null;
  pendingProjectedTx.value = null;
}

async function handleTransactionSave(
  data: CreateTransactionInput | { id: string; data: UpdateTransactionInput }
) {
  if ('id' in data) {
    if (!(await transactionsStore.updateTransaction(data.id, data.data))) return;
    closeEditModal();
  } else {
    if (!(await transactionsStore.createTransaction(data))) return;
    closeAddModal();
  }
}

function handleViewActivity(activityId: string) {
  viewingTransaction.value = null;
  router.push({ path: '/planner', query: { activity: activityId } });
}

function handleViewLoan(loanId: string) {
  viewingTransaction.value = null;
  // Loan could be an asset or an account — navigate to the appropriate page
  const asset = assetsStore.assets.find((a) => a.id === loanId);
  if (asset) {
    router.push({ path: '/assets', query: { asset: loanId } });
  } else {
    router.push({ path: '/accounts', query: { account: loanId } });
  }
}

async function handleTransactionDelete(id: string) {
  // Capture recurring item before closing the modal (which clears the ref)
  const wasEditingRecurring = editingRecurringItem.value;
  closeEditModal();

  if (wasEditingRecurring) {
    await deleteRecurringItemById(id);
  } else {
    if (
      await showConfirm({
        title: 'confirm.deleteTransactionTitle',
        message: 'transactions.deleteConfirm',
      })
    ) {
      if (await transactionsStore.deleteTransaction(id)) {
        playWhoosh();
      }
    }
  }
}

async function deleteTransaction(id: string) {
  if (
    await showConfirm({
      title: 'confirm.deleteTransactionTitle',
      message: 'transactions.deleteConfirm',
    })
  ) {
    if (await transactionsStore.deleteTransaction(id)) {
      playWhoosh();
    }
  }
}

// ── Recurring save from TransactionModal ──────────────────────────────────

/** After updating a recurring template, propagate field changes to linked
 *  non-reconciled materialized transactions so the UI reflects the edit. */
async function syncLinkedTransactions(recurringItemId: string, data: CreateRecurringItemInput) {
  const linked = transactionsStore.transactions.filter(
    (tx) => tx.recurringItemId === recurringItemId && !tx.isReconciled
  );
  for (const tx of linked) {
    // Recalculate date: keep the transaction's year/month, use new dayOfMonth
    const txDate = new Date(tx.date + 'T00:00:00');
    const daysInMonth = new Date(txDate.getFullYear(), txDate.getMonth() + 1, 0).getDate();
    const newDay = Math.min(data.dayOfMonth, daysInMonth);
    const yyyy = txDate.getFullYear();
    const mm = String(txDate.getMonth() + 1).padStart(2, '0');
    const dd = String(newDay).padStart(2, '0');

    await transactionsStore.updateTransaction(tx.id, {
      amount: data.amount,
      description: data.description,
      category: data.category,
      type: data.type,
      currency: data.currency,
      accountId: data.accountId,
      date: `${yyyy}-${mm}-${dd}`,
    });
  }
}

async function handleSaveRecurring(data: CreateRecurringItemInput) {
  if (editingRecurringItem.value) {
    const itemId = editingRecurringItem.value.id;

    // Projected transaction edit — show scope modal at save time
    if (pendingProjectedTx.value) {
      const scope = await chooseScope();
      if (!scope) return; // cancelled — keep modal open

      const projectedDate = pendingProjectedTx.value.date;

      if (scope === 'all') {
        if (!(await recurringStore.updateRecurringItem(itemId, data))) return;
        await syncLinkedTransactions(itemId, data);
      } else if (scope === 'this-only') {
        // Materialize a one-off transaction from the edited recurring data
        await transactionsStore.createTransaction({
          accountId: data.accountId,
          type: data.type,
          amount: data.amount,
          currency: data.currency,
          category: data.category,
          date: projectedDate,
          description: data.description,
          isReconciled: false,
          recurringItemId: pendingProjectedTx.value.recurringItemId,
        });
      } else if (scope === 'this-and-future') {
        const newItem = await recurringStore.splitRecurringItem(itemId, projectedDate);
        if (!newItem) return;
        if (!(await recurringStore.updateRecurringItem(newItem.id, data))) return;
        await syncLinkedTransactions(newItem.id, data);
      }

      closeEditModal();
      return;
    }

    // Non-projected recurring item edit — update directly
    if (!(await recurringStore.updateRecurringItem(itemId, data))) return;
    await syncLinkedTransactions(itemId, data);
    closeEditModal();
  } else if (editingTransaction.value) {
    // Converting a one-time transaction to recurring
    const created = await recurringStore.createRecurringItem(data);
    if (!created) return; // creation failed — keep modal open
    await transactionsStore.deleteTransaction(editingTransaction.value.id);
    const result = await processRecurringItems();
    if (result.processed > 0) {
      await Promise.all([transactionsStore.loadTransactions(), goalsStore.loadGoals()]);
    }
    closeEditModal();
  } else {
    // Creating a brand new recurring item
    const created = await recurringStore.createRecurringItem(data);
    if (!created) return; // creation failed — keep modal open
    const result = await processRecurringItems();
    if (result.processed > 0) {
      await Promise.all([transactionsStore.loadTransactions(), goalsStore.loadGoals()]);
    }
    closeAddModal();
  }
}

// ── Recurring CRUD (for editing recurring templates) ──────────────────────
function openEditRecurringModal(item: RecurringItem) {
  editingRecurringItem.value = item;
  editingTransaction.value = null;
  showEditModal.value = true;
}

async function deleteRecurringItemById(id: string) {
  if (
    await showConfirm({
      title: 'confirm.deleteRecurringTitle',
      message: 'recurring.deleteConfirm',
    })
  ) {
    // Delete all transactions generated from this recurring item
    await transactionsStore.deleteTransactionsByRecurringItemId(id);
    // Delete the recurring template itself
    if (await recurringStore.deleteRecurringItem(id)) {
      playWhoosh();
    }
  }
}

// Helper to find the recurring item for a transaction (for edit button)
function getRecurringItem(tx: DisplayTransaction): RecurringItem | undefined {
  if (!tx.recurringItemId) return undefined;
  return recurringStore.recurringItems.find((r) => r.id === tx.recurringItemId);
}

// ── Projected transaction click handler ────────────────────────────────────
// Scope modal is deferred to save time — open the edit modal directly.
function handleProjectedClick(tx: DisplayTransaction) {
  const ri = getRecurringItem(tx);
  if (!ri) return;
  pendingProjectedTx.value = tx;
  openEditRecurringModal(ri);
}

function handleViewOpenEdit(transaction: Transaction) {
  viewingTransaction.value = null;
  openEditModal(transaction);
}

function isRecurringItemInactive(tx: DisplayTransaction): boolean {
  if (!tx.recurringItemId) return false;
  const item = recurringStore.recurringItems.find((r) => r.id === tx.recurringItemId);
  return item ? !item.isActive : false;
}
</script>

<template>
  <div class="space-y-5">
    <!-- Header -->
    <div>
      <p class="text-sm text-[var(--color-text)] opacity-40">{{ subtitle }}</p>
    </div>

    <!-- Secondary toolbar: filters + search + month + add -->
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div class="flex flex-wrap items-center gap-2.5">
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
        <div
          class="flex w-[220px] items-center gap-2 rounded-[14px] bg-[var(--tint-slate-5)] px-4 py-2 dark:bg-slate-700"
        >
          <BeanieIcon
            name="search"
            size="sm"
            class="shrink-0 text-[var(--color-text)] opacity-25"
          />
          <input
            v-model="searchQuery"
            type="text"
            :placeholder="t('transactions.searchPlaceholder')"
            class="w-full border-none bg-transparent text-xs text-[var(--color-text)] outline-none placeholder:text-[var(--color-text)] placeholder:opacity-25 dark:text-gray-100"
          />
        </div>

        <!-- Month navigator -->
        <MonthNavigator v-model="selectedMonth" />
      </div>

      <!-- Add button (gradient pill) -->
      <button
        class="font-outfit cursor-pointer rounded-full bg-gradient-to-r from-[#F15D22] to-[#E67E22] px-5 py-2.5 text-xs font-semibold text-white shadow-[0_4px_16px_rgba(241,93,34,0.2)] transition-all hover:shadow-[0_6px_20px_rgba(241,93,34,0.3)]"
        @click="openAddModal"
      >
        + {{ t('transactions.addTransaction') }}
      </button>
    </div>

    <!-- Summary cards (3 across) -->
    <div class="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
      <SummaryStatCard
        :label="t('transactions.income')"
        :amount="monthIncome"
        :currency="baseCurrency"
        :change-label="isFutureMonth ? t('transactions.projectedLabel') : ''"
        :hint="t('hints.transactionsIncome')"
        :subtitle="formatMonthYear(selectedMonth)"
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
        :change-label="isFutureMonth ? t('transactions.projectedLabel') : ''"
        :hint="t('hints.transactionsExpenses')"
        :subtitle="formatMonthYear(selectedMonth)"
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
        :change-label="isFutureMonth ? t('transactions.projectedLabel') : ''"
        :hint="t('hints.transactionsNet')"
        :subtitle="formatMonthYear(selectedMonth)"
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

    <!-- Transaction list -->
    <BaseCard :padding="false">
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
          class="font-outfit hidden border-b-2 border-[var(--tint-slate-5)] bg-[rgba(44,62,80,0.015)] px-4 py-3 text-xs font-semibold tracking-[0.08em] uppercase opacity-30 md:grid md:grid-cols-[36px_1.6fr_0.8fr_0.7fr_0.8fr_0.6fr] md:items-center md:gap-2.5 dark:border-slate-700 dark:bg-slate-800/50"
        >
          <div></div>
          <div>{{ t('transactions.title') }}</div>
          <div>{{ t('family.title') }}</div>
          <div>{{ t('form.amount') }}</div>
          <div>{{ t('form.type') }}</div>
          <div></div>
        </div>

        <!-- Date-grouped rows -->
        <div v-for="[dateKey, txns] in groupedTransactions" :key="dateKey">
          <!-- Date group header -->
          <div
            class="font-outfit px-4 pt-3 pb-1.5 text-xs font-bold tracking-[0.08em] uppercase"
            :class="
              isDateToday(dateKey)
                ? 'text-primary-500 bg-[rgba(241,93,34,0.02)]'
                : 'text-[var(--color-text)] opacity-30'
            "
          >
            {{ formatDateGroupHeader(dateKey) }}
          </div>

          <!-- Transaction rows -->
          <div
            v-for="tx in txns"
            :key="tx.id"
            data-testid="transaction-item"
            class="group cursor-pointer border-b px-4 py-3.5 transition-opacity md:grid md:grid-cols-[36px_1.6fr_0.8fr_0.7fr_0.8fr_0.6fr] md:items-center md:gap-2.5 dark:border-slate-700"
            :class="[
              syncHighlightClass(tx.id),
              tx.isProjected
                ? 'border-dashed border-[var(--tint-slate-5)] opacity-60 hover:opacity-100'
                : 'border-[var(--tint-slate-5)]',
              isRecurringItemInactive(tx) ? 'opacity-60 hover:opacity-100' : '',
            ]"
            @click="
              () => {
                if (tx.isProjected) {
                  handleProjectedClick(tx);
                } else if (tx.recurringItemId) {
                  const ri = getRecurringItem(tx);
                  if (ri) openEditRecurringModal(ri);
                  else openEditModal(tx);
                } else {
                  viewingTransaction = tx;
                }
              }
            "
          >
            <!-- Icon (desktop) -->
            <div
              class="hidden h-9 w-9 items-center justify-center rounded-[12px] md:flex"
              :class="
                tx.type === 'income'
                  ? 'bg-[rgba(39,174,96,0.1)]'
                  : 'bg-[var(--tint-slate-5)] dark:bg-slate-700'
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
                  tx.type === 'income'
                    ? 'bg-[rgba(39,174,96,0.1)]'
                    : 'bg-[var(--tint-slate-5)] dark:bg-slate-700'
                "
              >
                <CategoryIcon :category="tx.category" size="sm" />
              </div>
              <div>
                <p class="font-outfit text-sm font-semibold text-gray-900 dark:text-gray-100">
                  {{ tx.description }}
                </p>
                <p class="text-xs text-[var(--color-text)] opacity-35">
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
                    :type="tx.type === 'income' ? 'income' : 'neutral'"
                    size="sm"
                  />
                  <span
                    v-if="tx.recurringItemId"
                    class="text-primary-500 dark:bg-primary-900/20 rounded-lg bg-[var(--tint-orange-8)] px-2 py-0.5 text-xs font-semibold"
                  >
                    {{ t('transactions.typeRecurring') }}
                  </span>
                  <span
                    v-if="tx.isProjected"
                    class="rounded-lg bg-sky-100 px-2 py-0.5 text-xs font-semibold text-sky-600 dark:bg-sky-900/30 dark:text-sky-400"
                  >
                    {{ t('transactions.projected') }}
                  </span>
                  <span
                    v-if="isRecurringItemInactive(tx)"
                    class="rounded-lg bg-gray-200 px-2 py-0.5 text-xs font-semibold text-gray-500 dark:bg-slate-600 dark:text-gray-400"
                  >
                    {{ t('recurring.paused') }}
                  </span>
                  <span
                    v-if="!tx.recurringItemId"
                    class="text-secondary-500 rounded-lg bg-[var(--tint-slate-5)] px-2 py-0.5 text-xs font-semibold dark:bg-slate-700 dark:text-gray-400"
                  >
                    {{ t('transactions.typeOneTime') }}
                  </span>
                </div>
              </div>
            </div>

            <!-- Member (desktop) -->
            <div class="hidden items-center gap-1.5 md:flex">
              <div
                class="flex h-5 w-5 items-center justify-center rounded-full text-[9px]"
                :style="{
                  background: `linear-gradient(135deg, ${getMemberColorByAccountId(tx.accountId)}, ${getMemberColorByAccountId(tx.accountId)}88)`,
                }"
              >
                <span class="leading-none text-white">{{
                  getMemberNameByAccountId(tx.accountId).charAt(0)
                }}</span>
              </div>
              <span class="text-xs text-[var(--color-text)] opacity-50">
                {{ getMemberNameByAccountId(tx.accountId) }}
              </span>
            </div>

            <!-- Amount (desktop) -->
            <div class="hidden md:block">
              <span
                class="font-outfit text-sm font-bold"
                :class="
                  tx.type === 'income'
                    ? 'text-[#27AE60]'
                    : 'text-[var(--color-text)] dark:text-gray-100'
                "
              >
                {{ tx.type === 'income' ? '+' : '\u2212' }}
                <CurrencyAmount
                  :amount="tx.amount"
                  :currency="tx.currency"
                  type="neutral"
                  size="sm"
                />
              </span>
            </div>

            <!-- Type pill (desktop) -->
            <div class="hidden md:block">
              <span
                v-if="tx.recurringItemId"
                class="text-primary-500 dark:bg-primary-900/20 inline-block rounded-lg bg-[var(--tint-orange-8)] px-2 py-0.5 text-xs font-semibold"
              >
                {{ getRecurringFrequencyLabel(tx) }}
              </span>
              <span
                v-if="tx.isProjected"
                class="ml-1 inline-block rounded-lg bg-sky-100 px-2 py-0.5 text-xs font-semibold text-sky-600 dark:bg-sky-900/30 dark:text-sky-400"
              >
                {{ t('transactions.projected') }}
              </span>
              <span
                v-if="isRecurringItemInactive(tx)"
                class="ml-1 inline-block rounded-lg bg-gray-200 px-2 py-0.5 text-xs font-semibold text-gray-500 dark:bg-slate-600 dark:text-gray-400"
              >
                {{ t('recurring.paused') }}
              </span>
              <span
                v-if="!tx.recurringItemId"
                class="text-secondary-500 inline-block rounded-lg bg-[var(--tint-slate-5)] px-2 py-0.5 text-xs font-semibold dark:bg-slate-700 dark:text-gray-400"
              >
                {{ t('transactions.typeOneTime') }}
              </span>
            </div>

            <!-- Actions (hidden for projected rows — scope picker handles them) -->
            <div v-if="!tx.isProjected" class="mt-2 flex justify-end md:mt-0">
              <template v-if="tx.recurringItemId">
                <ActionButtons
                  size="sm"
                  @click.stop
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
                  @click.stop
                  @edit="viewingTransaction = tx"
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
      :initial-values="addModalInitialValues"
      @close="closeAddModal"
      @save="handleTransactionSave"
      @save-recurring="handleSaveRecurring"
      @delete="handleTransactionDelete"
    />

    <!-- Edit Transaction / Recurring Modal -->
    <TransactionModal
      :open="showEditModal"
      :transaction="editingTransaction"
      :recurring-item="editingRecurringItem"
      :projected-date="pendingProjectedTx?.date"
      @close="closeEditModal"
      @save="handleTransactionSave"
      @save-recurring="handleSaveRecurring"
      @delete="handleTransactionDelete"
    />

    <!-- View Transaction Modal (non-recurring) -->
    <TransactionViewEditModal
      :transaction="viewingTransaction"
      @close="viewingTransaction = null"
      @open-edit="handleViewOpenEdit"
      @view-activity="handleViewActivity"
      @view-loan="handleViewLoan"
    />
  </div>
</template>
