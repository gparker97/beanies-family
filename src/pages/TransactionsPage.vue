<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import CategoryIcon from '@/components/common/CategoryIcon.vue';
import CurrencyAmount from '@/components/common/CurrencyAmount.vue';
import TransactionModal from '@/components/transactions/TransactionModal.vue';
import TransactionViewEditModal from '@/components/transactions/TransactionViewEditModal.vue';
import { BaseCard } from '@/components/ui';
import CreatedConfirmModal from '@/components/ui/CreatedConfirmModal.vue';
import type { ConfirmDetail } from '@/components/ui/CreatedConfirmModal.vue';
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
import { getCurrencyInfo } from '@/constants/currencies';
import {
  formatFrequency,
  getDueDatesInRange,
  processRecurringItems,
} from '@/services/recurring/recurringProcessor';
import { useAccountsStore } from '@/stores/accountsStore';
import { useActivityStore } from '@/stores/activityStore';
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
  formatDateFull,
  formatDateWithDay,
  toISODateString,
  getStartOfMonth,
  getEndOfMonth,
  isDateBetween,
  toDateInputValue,
  formatDateShort,
} from '@/utils/date';

const route = useRoute();
const router = useRouter();
const transactionsStore = useTransactionsStore();
const accountsStore = useAccountsStore();
const activityStore = useActivityStore();
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
const directionFilter = ref<'all' | 'income' | 'expense'>('all');
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

// Transaction created confirmation modal
const createdConfirm = ref<{
  open: boolean;
  title: string;
  message: string;
  details: ConfirmDetail[];
}>({ open: false, title: '', message: '', details: [] });

// Open view modal from query param (e.g. navigated from Dashboard or global search)
function handleTransactionQueryParam() {
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
  const direction = route.query.direction as string | undefined;
  if (direction === 'income' || direction === 'expense') {
    directionFilter.value = direction;
  }
  if (viewId || riId || direction) {
    router.replace({ query: {} });
  }
}

function toggleDirection(direction: 'income' | 'expense') {
  directionFilter.value = directionFilter.value === direction ? 'all' : direction;
}
watch(
  () => route.query.view,
  (val) => {
    if (val) handleTransactionQueryParam();
  }
);
onMounted(() => {
  handleTransactionQueryParam();
});

// ── Computeds ─────────────────────────────────────────────────────────────
const baseCurrency = computed(() => settingsStore.baseCurrency);

const monthStart = computed(() => toISODateString(getStartOfMonth(selectedMonth.value)));
const monthEnd = computed(() => toISODateString(getEndOfMonth(selectedMonth.value)));

// Filter transactions to selected month, merging projected recurring transactions
const monthTransactions = computed<DisplayTransaction[]>(() => {
  let actual: DisplayTransaction[] = transactionsStore.filteredSortedTransactions.filter((tx) =>
    isDateBetween(tx.date, monthStart.value, monthEnd.value)
  );

  // Dedup real recurring transactions: CRDT merges can create duplicate transactions
  // for the same recurringItemId + date (different UUIDs from different actors/sessions).
  // Keep only the earliest-created transaction per recurringItemId + date group.
  const seen = new Map<string, DisplayTransaction>();
  const duplicateIds = new Set<string>();
  for (const tx of actual) {
    if (!tx.recurringItemId) continue;
    const key = `${tx.recurringItemId}|${toDateInputValue(new Date(tx.date))}`;
    const existing = seen.get(key);
    if (existing) {
      // Keep the earlier-created one, mark the other as duplicate
      if (tx.createdAt < existing.createdAt) {
        duplicateIds.add(existing.id);
        seen.set(key, tx);
      } else {
        duplicateIds.add(tx.id);
      }
    } else {
      seen.set(key, tx);
    }
  }
  if (duplicateIds.size > 0) {
    actual = actual.filter((tx) => !duplicateIds.has(tx.id));
  }

  // Build set of recurring item IDs that already have a real transaction this month.
  // Dedup by recurringItemId alone (not date) — if a real transaction exists for a
  // recurring item in this month, suppress its projection regardless of exact date.
  // This prevents "ghost" projections when a transaction's date is moved within the month.
  const existingRecurringIds = new Set(
    actual.filter((tx) => tx.recurringItemId).map((tx) => tx.recurringItemId!)
  );

  // Only include projections whose recurring item has no real transaction this month
  const deduped = projectedTransactions.value.filter(
    (tx) => !existingRecurringIds.has(tx.recurringItemId!)
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

// Apply direction filter (income / expense)
const filteredByDirection = computed(() => {
  if (directionFilter.value === 'all') return filteredByType.value;
  return filteredByType.value.filter((tx) => tx.type === directionFilter.value);
});

// Apply search
const displayTransactions = computed(() => {
  const q = searchQuery.value.toLowerCase().trim();
  if (!q) return filteredByDirection.value;
  return filteredByDirection.value.filter(
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

// Next month's projected recurring transactions (preview of what's coming)
const nextMonthProjected = computed<DisplayTransaction[]>(() => {
  // Only show when viewing current month (not past or future months)
  const now = new Date();
  const viewingYear = selectedMonth.value.getFullYear();
  const viewingMonth = selectedMonth.value.getMonth();
  if (viewingYear !== now.getFullYear() || viewingMonth !== now.getMonth()) return [];

  const nextMonth = new Date(viewingYear, viewingMonth + 1, 1);
  const nextStart = getStartOfMonth(nextMonth);
  const nextEnd = getEndOfMonth(nextMonth);
  const projected: DisplayTransaction[] = [];

  for (const item of recurringStore.filteredActiveItems) {
    for (const date of getDueDatesInRange(item, nextStart, nextEnd)) {
      projected.push({
        id: `next-projected-${item.id}-${toDateInputValue(date)}`,
        accountId: item.accountId,
        type: item.type,
        amount: item.amount,
        currency: item.currency,
        category: item.category,
        date: toDateInputValue(date),
        description: item.description,
        recurringItemId: item.id,
        isReconciled: false,
        isProjected: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    }
  }

  projected.sort((a, b) => a.date.localeCompare(b.date));
  return projected;
});

const nextMonthLabel = computed(() => {
  const next = new Date(selectedMonth.value.getFullYear(), selectedMonth.value.getMonth() + 1, 1);
  return formatMonthYear(next);
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
  const today = toDateInputValue(new Date());
  if (dateKey === today) {
    return `${t('date.today')} \u2014 ${formatDateShort(dateKey)}`;
  }
  return formatDateWithDay(dateKey).toUpperCase();
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
    showCreatedConfirmation({
      description: data.description,
      amount: data.amount,
      currency: data.currency,
      date: data.date,
      type: data.type,
      category: data.category,
    });
  }
}

function formatAmountWithCurrency(amount: number, currency: string): string {
  const info = getCurrencyInfo(currency as any);
  if (!info) return `${currency} ${amount.toFixed(2)}`;
  const formatted = amount.toFixed(info.decimals);
  return info.symbolPosition === 'before'
    ? `${info.symbol}${formatted}`
    : `${formatted} ${info.symbol}`;
}

function showCreatedConfirmation(opts: {
  description: string;
  amount: number;
  currency: string;
  date: string;
  type: string;
  category: string;
  recurring?: string | null;
}) {
  const dateStr = formatDateFull(opts.date);
  const details: ConfirmDetail[] = [
    { label: t('transactions.title'), value: opts.description },
    {
      label: t('form.amount'),
      value: formatAmountWithCurrency(opts.amount, opts.currency),
      highlight: opts.type === 'income',
    },
    { label: t('form.type'), value: t(`transactions.type.${opts.type}` as any) },
    { label: t('form.category'), value: getCategoryName(opts.category) },
    { label: opts.recurring ? t('form.startDate') : t('form.date'), value: dateStr },
  ];
  if (opts.recurring) {
    details.push({ label: t('transactions.filterRecurring'), value: opts.recurring });
  }
  createdConfirm.value = {
    open: true,
    title: t('transactions.createdTitle'),
    message: t('transactions.createdMessage'),
    details,
  };
}

function handleViewActivity(activityId: string) {
  viewingTransaction.value = null;
  router.push({ path: '/activities', query: { activity: activityId } });
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
  // Capture state before closing the modal (which clears refs)
  const wasEditingRecurring = editingRecurringItem.value;
  const wasPendingTx = pendingProjectedTx.value;
  closeEditModal();

  if (wasEditingRecurring && wasPendingTx) {
    // Materialized or projected recurring — use scope picker
    await handleScopedRecurringDelete(wasEditingRecurring.id, wasPendingTx);
  } else if (wasEditingRecurring) {
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
        const existingTx = pendingProjectedTx.value.isProjected
          ? null
          : transactionsStore.transactions.find((t) => t.id === pendingProjectedTx.value!.id);

        if (existingTx) {
          // Materialized transaction — update the existing record in place
          await transactionsStore.updateTransaction(existingTx.id, {
            accountId: data.accountId,
            type: data.type,
            amount: data.amount,
            currency: data.currency,
            category: data.category,
            description: data.description,
          });
        } else {
          // Projected transaction — materialize a one-off transaction
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
        }
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
    showCreatedConfirmation({
      description: data.description,
      amount: data.amount,
      currency: data.currency,
      date: data.startDate,
      type: data.type,
      category: data.category,
      recurring: formatFrequency({
        ...data,
        id: '',
        createdAt: '',
        updatedAt: '',
      } as RecurringItem),
    });
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
    // Clear linkedRecurringItemId on the parent entity before deleting
    // Search by linkedRecurringItemId directly (more reliable than ri.activityId/loanId
    // which may not be set on older items)
    const parentActivity = activityStore.activities.find((a) => a.linkedRecurringItemId === id);
    if (parentActivity) {
      await activityStore.updateActivity(parentActivity.id, {
        linkedRecurringItemId: '' as any,
        payFromAccountId: '' as any,
      });
    }
    const parentAsset = assetsStore.assets.find((a) => a.loan?.linkedRecurringItemId === id);
    if (parentAsset?.loan) {
      await assetsStore.updateAsset(parentAsset.id, {
        loan: {
          ...parentAsset.loan,
          linkedRecurringItemId: undefined,
          payFromAccountId: undefined,
        },
      });
    }
    const parentAccount = accountsStore.accounts.find((a) => a.linkedRecurringItemId === id);
    if (parentAccount) {
      await accountsStore.updateAccount(parentAccount.id, {
        linkedRecurringItemId: '' as any,
        payFromAccountId: '' as any,
      });
    }
    // Delete all transactions generated from this recurring item
    await transactionsStore.deleteTransactionsByRecurringItemId(id);
    // Delete the recurring template itself
    if (await recurringStore.deleteRecurringItem(id)) {
      playWhoosh();
    }
  }
}

/** Scope-aware delete for materialized/projected recurring transactions */
async function handleScopedRecurringDelete(recurringItemId: string, tx: DisplayTransaction) {
  const scope = await chooseScope();
  if (!scope) return;

  if (scope === 'all') {
    await deleteRecurringItemById(recurringItemId);
  } else if (scope === 'this-only') {
    if (!tx.isProjected) {
      // Materialized — delete just this transaction
      if (await transactionsStore.deleteTransaction(tx.id)) {
        playWhoosh();
      }
    }
    // Projected transactions don't exist in DB — nothing to delete for "this only"
  } else if (scope === 'this-and-future') {
    // Set the recurring item's end date to the day before this occurrence
    const endDate = new Date(tx.date + 'T00:00:00');
    endDate.setDate(endDate.getDate() - 1);
    const item = recurringStore.recurringItems.find((r) => r.id === recurringItemId);
    if (item) {
      await recurringStore.updateRecurringItem(recurringItemId, {
        ...item,
        recurrenceEndDate: toDateInputValue(endDate),
      } as any);
    }
    // Delete materialized transactions on or after this date
    const futureTxs = transactionsStore.transactions.filter(
      (t) => t.recurringItemId === recurringItemId && t.date >= tx.date
    );
    for (const ftx of futureTxs) {
      await transactionsStore.deleteTransaction(ftx.id);
    }
    playWhoosh();
  }
}

/** Delete a recurring transaction from the action buttons (scope-aware) */
async function handleRecurringDelete(tx: DisplayTransaction) {
  if (!tx.recurringItemId) return;
  await handleScopedRecurringDelete(tx.recurringItemId, tx);
}

// Helper to find the recurring item for a transaction (for edit button)
function getRecurringItem(tx: DisplayTransaction): RecurringItem | undefined {
  if (!tx.recurringItemId) return undefined;
  return recurringStore.recurringItems.find((r) => r.id === tx.recurringItemId);
}

// ── Recurring transaction click handlers ───────────────────────────────────
// Scope modal is deferred to save time — open the edit modal directly.
function handleProjectedClick(tx: DisplayTransaction) {
  const ri = getRecurringItem(tx);
  if (!ri) return;
  pendingProjectedTx.value = tx;
  openEditRecurringModal(ri);
}

/** Materialized recurring transaction — also needs scope picker on save */
function handleMaterializedRecurringClick(tx: DisplayTransaction) {
  const ri = getRecurringItem(tx);
  if (!ri) {
    openEditModal(tx as Transaction);
    return;
  }
  pendingProjectedTx.value = tx;
  openEditRecurringModal(ri);
}

function handleViewOpenEdit(transaction: Transaction) {
  viewingTransaction.value = null;
  const tx = transaction as DisplayTransaction;
  if (tx.isProjected) {
    handleProjectedClick(tx);
  } else if (tx.recurringItemId) {
    handleMaterializedRecurringClick(tx);
  } else {
    openEditModal(transaction);
  }
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
    <div class="flex items-center justify-between">
      <p class="text-sm text-[var(--color-text)] opacity-40">{{ subtitle }}</p>
      <button
        type="button"
        class="font-outfit from-primary-500 to-terracotta-400 inline-flex cursor-pointer items-center gap-2 rounded-2xl bg-gradient-to-r px-5 py-2.5 text-sm font-semibold text-white shadow-[0_4px_12px_rgba(241,93,34,0.2)] transition-all hover:shadow-[0_6px_16px_rgba(241,93,34,0.3)]"
        @click="openAddModal"
      >
        {{ t('transactions.addTransaction') }}
      </button>
    </div>

    <!-- Secondary toolbar: filters + search + month -->
    <div class="flex flex-wrap items-center gap-3">
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
        clickable
        :active="directionFilter === 'income'"
        @click="toggleDirection('income')"
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
        clickable
        :active="directionFilter === 'expense'"
        @click="toggleDirection('expense')"
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
        clickable
        :active="false"
        @click="directionFilter = 'all'"
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

    <!-- Direction filter chip -->
    <div v-if="directionFilter !== 'all'" class="flex items-center gap-2">
      <button
        type="button"
        class="font-outfit inline-flex cursor-pointer items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors"
        :class="
          directionFilter === 'income'
            ? 'bg-[rgba(39,174,96,0.12)] text-[#27AE60] dark:bg-[rgba(39,174,96,0.2)]'
            : 'text-primary-500 dark:bg-primary-900/20 bg-[var(--tint-orange-8)]'
        "
        @click="directionFilter = 'all'"
      >
        {{
          directionFilter === 'income'
            ? t('transactions.showingIncome')
            : t('transactions.showingExpenses')
        }}
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2.5"
          stroke-linecap="round"
        >
          <path d="M18 6L6 18M6 6l12 12" />
        </svg>
      </button>
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
            @click="viewingTransaction = tx"
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
                  @edit="() => handleMaterializedRecurringClick(tx)"
                  @delete="() => handleRecurringDelete(tx)"
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

    <!-- Next month preview -->
    <div v-if="nextMonthProjected.length > 0" class="space-y-2.5">
      <div class="flex items-center gap-2">
        <h3 class="font-outfit text-sm font-bold tracking-wide text-[var(--color-text)] opacity-40">
          {{ t('transactions.nextMonthPreview') }}
        </h3>
        <span
          class="font-outfit rounded-full bg-[var(--tint-slate-5)] px-2 py-0.5 text-xs font-semibold text-[var(--color-text)] opacity-30 dark:bg-slate-700"
        >
          {{ nextMonthLabel }}
        </span>
      </div>

      <BaseCard :padding="false">
        <div
          v-for="tx in nextMonthProjected"
          :key="tx.id"
          class="flex cursor-pointer items-center gap-3 border-b border-dashed border-[var(--tint-slate-5)] px-4 py-3 opacity-50 transition-opacity hover:opacity-80 dark:border-slate-700"
          @click="handleProjectedClick(tx)"
        >
          <CategoryIcon :category="tx.category" size="sm" />
          <div class="min-w-0 flex-1">
            <p
              class="font-outfit truncate text-sm font-semibold text-[var(--color-text)] dark:text-gray-100"
            >
              {{ tx.description }}
            </p>
            <p class="text-xs text-[var(--color-text)] opacity-40">
              {{ formatDateWithDay(tx.date) }}
              <span v-if="tx.recurringItemId" class="ml-1">
                &middot; {{ getRecurringFrequencyLabel(tx) }}
              </span>
            </p>
          </div>
          <span
            class="font-outfit text-sm font-semibold"
            :class="tx.type === 'income' ? 'text-[#27ae60]' : 'text-[var(--color-text)]'"
          >
            {{ tx.type === 'income' ? '+' : '-'
            }}{{ formatAmountWithCurrency(tx.amount, tx.currency) }}
          </span>
        </div>
      </BaseCard>
    </div>

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

    <!-- Transaction Created Confirmation -->
    <CreatedConfirmModal
      :open="createdConfirm.open"
      :title="createdConfirm.title"
      :message="createdConfirm.message"
      :details="createdConfirm.details"
      @close="createdConfirm.open = false"
    />
  </div>
</template>
