import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { celebrate } from '@/composables/useCelebration';
import { recurringInstanceKey } from '@/utils/recurringInstance';
import * as transactionRepo from '@/services/automerge/repositories/transactionRepository';
import { useAccountsStore } from '@/stores/accountsStore';
import { useAssetsStore } from '@/stores/assetsStore';
import { useGoalsStore } from '@/stores/goalsStore';
import { useMemberFilterStore } from '@/stores/memberFilterStore';
import { wrapAsync } from '@/composables/useStoreActions';
import { convertToBaseCurrency, getRate } from '@/utils/currency';
import { reportError } from '@/utils/errorReporter';
import { useSettingsStore } from '@/stores/settingsStore';
import type { TransactionCascadeResult } from '@/services/automerge/repositories/transactionRepository';
import type {
  Transaction,
  CreateTransactionInput,
  UpdateTransactionInput,
  ISODateString,
  CurrencyCode,
} from '@/types/models';
import { getStartOfMonth, getEndOfMonth, toDateInputValue, isDateBetween } from '@/utils/date';
import { normalizeCategoryId } from '@/constants/categories';
import { trackFeature } from '@/services/analytics/plausible';

/**
 * Remove CRDT-duplicated recurring transactions from a list.
 * When Automerge merges docs from different actors, the same recurring item
 * can produce multiple transactions for the same date (different UUIDs).
 * This keeps only the earliest-created transaction per recurringItemId + date.
 */
function deduplicateRecurring<T extends Transaction>(txns: T[]): T[] {
  const seen = new Map<string, T>();
  const duplicateIds = new Set<string>();
  for (const tx of txns) {
    // Keyed on the due date a row STANDS FOR (#107), not only its own date.
    const key = recurringInstanceKey(tx);
    if (!key) continue;
    const existing = seen.get(key);
    if (existing) {
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
  return duplicateIds.size > 0 ? txns.filter((tx) => !duplicateIds.has(tx.id)) : txns;
}

export const useTransactionsStore = defineStore('transactions', () => {
  // State
  const transactions = ref<Transaction[]>([]);
  const isLoading = ref(false);
  const error = ref<string | null>(null);

  // Getters
  const sortedTransactions = computed(() =>
    [...transactions.value].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
  );

  const recentTransactions = computed(() => sortedTransactions.value.slice(0, 10));

  const thisMonthTransactions = computed(() => {
    const now = new Date();
    const start = toDateInputValue(getStartOfMonth(now));
    const end = toDateInputValue(getEndOfMonth(now));
    return transactions.value.filter((t) => isDateBetween(t.date, start, end));
  });

  // Total monthly income (includes both one-time and recurring transactions)
  // Converts each transaction to base currency first
  const thisMonthIncome = computed(() =>
    thisMonthTransactions.value
      .filter((t) => t.type === 'income')
      .reduce((sum, t) => sum + convertToBaseCurrency(t.amount, t.currency), 0)
  );

  // Total monthly expenses (includes both one-time and recurring transactions)
  // Converts each transaction to base currency first
  const thisMonthExpenses = computed(() =>
    thisMonthTransactions.value
      .filter((t) => t.type === 'expense')
      .reduce((sum, t) => sum + convertToBaseCurrency(t.amount, t.currency), 0)
  );

  // One-time income only (excludes transactions generated from recurring items)
  const thisMonthOneTimeIncome = computed(() =>
    thisMonthTransactions.value
      .filter((t) => t.type === 'income' && !t.recurringItemId)
      .reduce((sum, t) => sum + convertToBaseCurrency(t.amount, t.currency), 0)
  );

  // One-time expenses only (excludes transactions generated from recurring items)
  const thisMonthOneTimeExpenses = computed(() =>
    thisMonthTransactions.value
      .filter((t) => t.type === 'expense' && !t.recurringItemId)
      .reduce((sum, t) => sum + convertToBaseCurrency(t.amount, t.currency), 0)
  );

  // Recurring income only (transactions generated from recurring items)
  const thisMonthRecurringIncome = computed(() =>
    thisMonthTransactions.value
      .filter((t) => t.type === 'income' && t.recurringItemId)
      .reduce((sum, t) => sum + convertToBaseCurrency(t.amount, t.currency), 0)
  );

  // Recurring expenses only (transactions generated from recurring items)
  const thisMonthRecurringExpenses = computed(() =>
    thisMonthTransactions.value
      .filter((t) => t.type === 'expense' && t.recurringItemId)
      .reduce((sum, t) => sum + convertToBaseCurrency(t.amount, t.currency), 0)
  );

  const thisMonthNetCashFlow = computed(() => thisMonthIncome.value - thisMonthExpenses.value);

  const expensesByCategory = computed(() => {
    const categoryTotals = new Map<string, number>();
    for (const t of thisMonthTransactions.value.filter((t) => t.type === 'expense')) {
      const catId = normalizeCategoryId(t.category);
      const current = categoryTotals.get(catId) || 0;
      categoryTotals.set(catId, current + convertToBaseCurrency(t.amount, t.currency));
    }
    return categoryTotals;
  });

  // ========== FILTERED GETTERS (by global member filter) ==========

  // Helper to get account IDs for selected members
  function getSelectedAccountIds(): Set<string> {
    const memberFilter = useMemberFilterStore();
    const accountsStore = useAccountsStore();
    return memberFilter.getSelectedMemberAccountIds(accountsStore.accounts);
  }

  // Always return a new array to avoid Vue 3.4+ computed reference-equality
  // optimization swallowing downstream reactivity on in-place mutations.
  const filteredTransactions = computed(() => {
    const memberFilter = useMemberFilterStore();
    if (!memberFilter.isInitialized || memberFilter.isAllSelected) {
      return [...transactions.value];
    }
    const selectedAccountIds = getSelectedAccountIds();
    return transactions.value.filter((t) => selectedAccountIds.has(t.accountId));
  });

  const filteredSortedTransactions = computed(() =>
    [...filteredTransactions.value].sort(
      (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
    )
  );

  const filteredRecentTransactions = computed(() => filteredSortedTransactions.value.slice(0, 10));

  const filteredThisMonthTransactions = computed(() => {
    const now = new Date();
    const start = toDateInputValue(getStartOfMonth(now));
    const end = toDateInputValue(getEndOfMonth(now));
    return filteredTransactions.value.filter((t) => isDateBetween(t.date, start, end));
  });

  // Filtered totals for this month (respects global member filter)
  const filteredThisMonthIncome = computed(() =>
    filteredThisMonthTransactions.value
      .filter((t) => t.type === 'income')
      .reduce((sum, t) => sum + convertToBaseCurrency(t.amount, t.currency), 0)
  );

  const filteredThisMonthExpenses = computed(() =>
    filteredThisMonthTransactions.value
      .filter((t) => t.type === 'expense')
      .reduce((sum, t) => sum + convertToBaseCurrency(t.amount, t.currency), 0)
  );

  // Filtered one-time income for this month
  const filteredThisMonthOneTimeIncome = computed(() =>
    filteredThisMonthTransactions.value
      .filter((t) => t.type === 'income' && !t.recurringItemId)
      .reduce((sum, t) => sum + convertToBaseCurrency(t.amount, t.currency), 0)
  );

  // Filtered one-time expenses for this month
  const filteredThisMonthOneTimeExpenses = computed(() =>
    filteredThisMonthTransactions.value
      .filter((t) => t.type === 'expense' && !t.recurringItemId)
      .reduce((sum, t) => sum + convertToBaseCurrency(t.amount, t.currency), 0)
  );

  // Filtered recurring income for this month
  const filteredThisMonthRecurringIncome = computed(() =>
    filteredThisMonthTransactions.value
      .filter((t) => t.type === 'income' && t.recurringItemId)
      .reduce((sum, t) => sum + convertToBaseCurrency(t.amount, t.currency), 0)
  );

  // Filtered recurring expenses for this month
  const filteredThisMonthRecurringExpenses = computed(() =>
    filteredThisMonthTransactions.value
      .filter((t) => t.type === 'expense' && t.recurringItemId)
      .reduce((sum, t) => sum + convertToBaseCurrency(t.amount, t.currency), 0)
  );

  // Filtered expenses by category for this month
  const filteredExpensesByCategory = computed(() => {
    const categoryTotals = new Map<string, number>();
    for (const t of filteredThisMonthTransactions.value.filter((t) => t.type === 'expense')) {
      const catId = normalizeCategoryId(t.category);
      const current = categoryTotals.get(catId) || 0;
      categoryTotals.set(catId, current + convertToBaseCurrency(t.amount, t.currency));
    }
    return categoryTotals;
  });

  /**
   * The amount to credit a transfer's DESTINATION, in the destination's own
   * currency. Same currency → the raw amount; different currency → converted at
   * the current rate. This is the sole authority for a transfer's `toAmount`.
   *
   * No silent 1:1: if no exchange rate exists for the pair it reports and THROWS
   * so the caller aborts BEFORE mutating any balance (resolve-before-mutate) —
   * never a half-applied cascade. The modal blocks this case up-front; this is
   * the defensive backstop for any other caller.
   */
  function resolveTransferToAmount(
    sourceCurrency: CurrencyCode,
    toAccountId: string,
    amount: number
  ): number {
    const dest = useAccountsStore().accounts.find((a) => a.id === toAccountId);
    // Dangling destination (shouldn't happen from the modal) — no conversion basis.
    if (!dest || dest.currency === sourceCurrency) return amount;
    const rate = getRate(useSettingsStore().exchangeRates, sourceCurrency, dest.currency);
    if (rate === undefined) {
      reportError({
        surface: 'transactions.transfer-missing-rate',
        message: `No exchange rate ${sourceCurrency}->${dest.currency}; transfer not applied`,
        severity: 'error',
        context: { from: sourceCurrency, to: dest.currency },
      });
      throw new Error(`No exchange rate for ${sourceCurrency} → ${dest.currency}`);
    }
    return Math.round(amount * rate * 100) / 100;
  }

  /**
   * Fold a cascade's echo into the sibling stores: every account, goal and asset the worker
   * moved arrives folded, so the local arrays are replaced, never re-derived. A reference the
   * worker could not honour (an account or goal deleted by another device) is a breadcrumb,
   * never a toast: the row still landed, and the divergence stays diagnosable.
   */
  function absorbCascade(res: TransactionCascadeResult, action: string): void {
    const accountsStore = useAccountsStore();
    const goalsStore = useGoalsStore();
    const assetsStore = useAssetsStore();
    for (const account of res.accounts) accountsStore.applyEchoed(account);
    for (const goal of res.goals) goalsStore.applyEchoed(goal);
    for (const asset of res.assets) assetsStore.applyEchoed(asset);
    if (res.skipped.length > 0) {
      reportError({
        surface: 'transactions.cascade-skipped',
        message: 'transaction cascade skipped a reference missing from the document',
        severity: 'warning',
        context: { action, kind: res.skipped.map((s) => s.kind).join(',') },
      });
    }
  }

  /**
   * Resolve the `toAmount` a transfer edit should carry. Recompute the
   * conversion only when an input that affects it actually changed (amount,
   * source currency, destination), when switching INTO transfer, or when the
   * original lacked a `toAmount` — otherwise carry the original forward so an
   * unrelated edit (description/date) never re-runs FX or drifts the balance.
   * Returns undefined for non-transfer results. May throw (missing rate).
   */
  function resolveUpdatedTransferToAmount(
    original: Transaction,
    updated: Transaction,
    input: UpdateTransactionInput
  ): number | undefined {
    if (updated.type !== 'transfer' || !updated.toAccountId) return undefined;
    const conversionInputChanged =
      (input.amount !== undefined && input.amount !== original.amount) ||
      (input.toAccountId !== undefined && input.toAccountId !== original.toAccountId) ||
      (input.currency !== undefined && input.currency !== original.currency) ||
      original.type !== 'transfer' ||
      original.toAmount === undefined;
    return conversionInputChanged
      ? resolveTransferToAmount(updated.currency, updated.toAccountId, updated.amount)
      : original.toAmount;
  }

  // Actions
  async function loadTransactions() {
    await wrapAsync(
      isLoading,
      error,
      async () => {
        const raw = await transactionRepo.getAllTransactions();
        // Remove CRDT-duplicated recurring transactions at the source so all
        // consumers (budget, reports, dashboard) see clean data.
        transactions.value = deduplicateRecurring(raw);
      },
      { action: 'transactionsStore:loadTransactions' }
    );
  }

  async function createTransaction(input: CreateTransactionInput): Promise<Transaction | null> {
    const result = await wrapAsync(
      isLoading,
      error,
      async () => {
        // Balance adjustments are audit echoes of an already-applied balance change: the
        // worker applies no effects for them, and isReconciled is forced here so the invariant
        // lives in one place.
        // For a transfer, resolve the destination amount up-front (converts cross-currency;
        // THROWS on a missing rate so nothing is persisted).
        const createInput: CreateTransactionInput =
          input.type === 'balance_adjustment'
            ? { ...input, isReconciled: true }
            : input.type === 'transfer' && input.toAccountId
              ? {
                  ...input,
                  toAmount: resolveTransferToAmount(
                    input.currency,
                    input.toAccountId,
                    input.amount
                  ),
                }
              : input;

        // ONE Automerge change: the row, its balance movement(s), the goal allocation and the
        // loan amortisation (with the linked loan account mirror) land whole or not at all.
        const res = await transactionRepo.createTransactionCascade(createInput);
        const transaction = res.transaction!;
        const isFirst = transactions.value.length === 0;
        // Immutable update: assign a new array so downstream computeds re-evaluate
        transactions.value = [...transactions.value, transaction];
        absorbCascade(res, 'create');
        if (isFirst) {
          celebrate('first-transaction');
        }
        return transaction;
      },
      { action: 'transactionsStore:createTransaction' }
    );
    trackFeature(result, 'transaction');
    return result ?? null;
  }

  async function updateTransaction(
    id: string,
    input: UpdateTransactionInput
  ): Promise<Transaction | null> {
    const result = await wrapAsync(
      isLoading,
      error,
      async () => {
        // The original decides the transfer destination amount; the worker reads the stored row
        // for everything else (and reverses from the stored portions, never from this copy).
        const original =
          transactions.value.find((t) => t.id === id) ??
          (await transactionRepo.getTransactionById(id));
        if (!original) return null;

        // Resolve the updated shape's toAmount FIRST (may THROW on a missing rate) so the
        // cascade is never sent half-formed. `toAmount` travels in the patch only when it
        // changes, or is cleared when the row stops being a transfer; an unrelated edit
        // (description, date) carries no money field, so the worker patches the row only.
        const updatedShape: Transaction = { ...original, ...stripUndefinedInput(input) };
        const resolvedToAmount = resolveUpdatedTransferToAmount(original, updatedShape, input);
        const patch: UpdateTransactionInput = { ...input };
        if (resolvedToAmount !== undefined) {
          if (resolvedToAmount !== original.toAmount) patch.toAmount = resolvedToAmount;
        } else if (original.toAmount !== undefined) {
          patch.toAmount = undefined;
        }

        const res = await transactionRepo.updateTransactionCascade(id, patch);
        if (!res.found) {
          // A concurrent delete: the row is gone, so the edit has nothing to land on.
          transactions.value = transactions.value.filter((t) => t.id !== id);
          return null;
        }
        const updated = res.transaction!;
        // Immutable update: assign a new array so downstream computeds re-evaluate
        transactions.value = transactions.value.map((t) => (t.id === id ? updated : t));
        absorbCascade(res, 'update');
        return updated;
      },
      { action: 'transactionsStore:updateTransaction' }
    );
    return result ?? null;
  }

  /** `input` with its explicit clears (`undefined` values) removed, for a merged preview. */
  function stripUndefinedInput(input: UpdateTransactionInput): Partial<Transaction> {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(input)) if (v !== undefined) out[k] = v;
    return out as Partial<Transaction>;
  }

  async function deleteTransaction(id: string): Promise<boolean> {
    const result = await wrapAsync(
      isLoading,
      error,
      async () => {
        // The worker reverses the balance, goal and loan effects from the STORED row (its own
        // portions, never a possibly stale local copy) and deletes it, in one change.
        const res = await transactionRepo.deleteTransactionCascade(id);
        if (res.found) {
          transactions.value = transactions.value.filter((t) => t.id !== id);
          absorbCascade(res, 'delete');
        }
        return res.found;
      },
      { action: 'transactionsStore:deleteTransaction' }
    );
    return result ?? false;
  }

  async function deleteTransactionsByRecurringItemId(recurringItemId: string): Promise<number> {
    const result = await wrapAsync(
      isLoading,
      error,
      async () => {
        const toDelete = transactions.value.filter((t) => t.recurringItemId === recurringItemId);
        let count = 0;
        // One cascade per row (each atomic: balance, goal AND loan reversed with the delete).
        for (const tx of toDelete) {
          const res = await transactionRepo.deleteTransactionCascade(tx.id);
          if (res.found) {
            absorbCascade(res, 'delete');
            count++;
          }
        }
        transactions.value = transactions.value.filter(
          (t) => t.recurringItemId !== recurringItemId
        );
        return count;
      },
      { action: 'transactionsStore:deleteTransactionsByRecurringItemId' }
    );
    return result ?? 0;
  }

  function getTransactionById(id: string): Transaction | undefined {
    return transactions.value.find((t) => t.id === id);
  }

  function getTransactionsByAccountId(accountId: string): Transaction[] {
    return transactions.value.filter((t) => t.accountId === accountId);
  }

  /**
   * All transactions where the given account is the source OR destination,
   * sorted descending by (date, createdAt). Used by the account activity log.
   */
  function transactionsForAccount(accountId: string): Transaction[] {
    return transactions.value
      .filter((t) => t.accountId === accountId || t.toAccountId === accountId)
      .sort((a, b) => {
        const d = b.date.localeCompare(a.date);
        return d !== 0 ? d : b.createdAt.localeCompare(a.createdAt);
      });
  }

  /**
   * All transactions directed at a given goal (via `goalId`), sorted
   * descending by (date, createdAt). Used by the goal activity log. Manual
   * contributions (inline on Goal.manualContributions) are merged in at the
   * component layer.
   */
  function transactionsForGoal(goalId: string): Transaction[] {
    return transactions.value
      .filter((t) => t.goalId === goalId)
      .sort((a, b) => {
        const d = b.date.localeCompare(a.date);
        return d !== 0 ? d : b.createdAt.localeCompare(a.createdAt);
      });
  }

  function getTransactionsByDateRange(start: ISODateString, end: ISODateString): Transaction[] {
    return transactions.value.filter((t) => isDateBetween(t.date, start, end));
  }

  function resetState() {
    transactions.value = [];
    isLoading.value = false;
    error.value = null;
  }

  return {
    // State
    transactions,
    isLoading,
    error,
    // Getters
    sortedTransactions,
    recentTransactions,
    thisMonthTransactions,
    thisMonthIncome,
    thisMonthExpenses,
    thisMonthOneTimeIncome,
    thisMonthOneTimeExpenses,
    thisMonthRecurringIncome,
    thisMonthRecurringExpenses,
    thisMonthNetCashFlow,
    expensesByCategory,
    // Filtered getters (by global member filter)
    filteredTransactions,
    filteredSortedTransactions,
    filteredRecentTransactions,
    filteredThisMonthTransactions,
    filteredThisMonthIncome,
    filteredThisMonthExpenses,
    filteredThisMonthOneTimeIncome,
    filteredThisMonthOneTimeExpenses,
    filteredThisMonthRecurringIncome,
    filteredThisMonthRecurringExpenses,
    filteredExpensesByCategory,
    // Actions
    loadTransactions,
    createTransaction,
    updateTransaction,
    deleteTransaction,
    deleteTransactionsByRecurringItemId,
    getTransactionById,
    getTransactionsByAccountId,
    transactionsForAccount,
    transactionsForGoal,
    getTransactionsByDateRange,
    // Exposed for the statement import (#107), which builds its adds as one batch and must
    // convert a transfer's destination amount with the SAME authority (and the same
    // missing-rate refusal) the single-row cascade uses.
    resolveTransferToAmount,
    resetState,
  };
});
