import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { celebrate } from '@/composables/useCelebration';
import * as transactionRepo from '@/services/automerge/repositories/transactionRepository';
import { useAccountsStore } from '@/stores/accountsStore';
import { useAssetsStore } from '@/stores/assetsStore';
import { useGoalsStore } from '@/stores/goalsStore';
import { useMemberFilterStore } from '@/stores/memberFilterStore';
import { wrapAsync } from '@/composables/useStoreActions';
import { convertToBaseCurrency, getRate } from '@/utils/currency';
import { computeGoalAllocRaw, signedAccountDelta } from '@/utils/finance';
import { reportError } from '@/utils/errorReporter';
import { useSettingsStore } from '@/stores/settingsStore';
import { mutate } from '@/services/automerge/worker/docClient';
import type {
  Transaction,
  CreateTransactionInput,
  UpdateTransactionInput,
  ISODateString,
  Account,
  Asset,
  CurrencyCode,
} from '@/types/models';
import {
  getStartOfMonth,
  getEndOfMonth,
  toDateInputValue,
  isDateBetween,
  extractDatePart,
} from '@/utils/date';
import { normalizeCategoryId } from '@/constants/categories';

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
    if (!tx.recurringItemId) continue;
    const key = `${tx.recurringItemId}|${extractDatePart(tx.date)}`;
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
   * Update account balance in both store and database.
   */
  async function adjustAccountBalance(accountId: string, adjustment: number): Promise<void> {
    // Atomic relative adjustment (worker `increment` op) — no lost update if a
    // poll-merge lands a peer's balance change between read and write.
    await useAccountsStore().incrementBalance(accountId, adjustment);
  }

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
   * Apply (`direction: 1`) or reverse (`direction: -1`) a transaction's effect
   * on account balances — the SINGLE place balance signs + the transfer
   * destination live. Liability-aware via `signedAccountDelta` (a card purchase
   * raises owed; a transfer to a card lowers it); the destination of a transfer
   * is credited its stored `toAmount` (converted). Mirrors the store's existing
   * apply/reverse symmetry for goals and loans, so create/update/delete each
   * reduce to one or two calls instead of three parallel copies of the math.
   *
   * A missing (deleted) account is warned and skipped, matching the app's
   * existing tolerance of dangling references.
   */
  async function applyTransactionToBalances(tx: Transaction, direction: 1 | -1): Promise<void> {
    const accountsStore = useAccountsStore();
    const source = accountsStore.accounts.find((a) => a.id === tx.accountId);
    if (source) {
      const delta = signedAccountDelta(tx.type, tx.amount, source.type, true) * direction;
      if (delta !== 0) await adjustAccountBalance(tx.accountId, delta);
    } else {
      console.warn(
        '[transactionsStore] source account not found; balance not adjusted:',
        tx.accountId
      );
    }
    if (tx.type === 'transfer' && tx.toAccountId) {
      const dest = accountsStore.accounts.find((a) => a.id === tx.toAccountId);
      if (dest) {
        const magnitude = tx.toAmount ?? tx.amount;
        const delta = signedAccountDelta('transfer', magnitude, dest.type, false) * direction;
        if (delta !== 0) await adjustAccountBalance(tx.toAccountId, delta);
      } else {
        console.warn(
          '[transactionsStore] transfer destination not found; balance not adjusted:',
          tx.toAccountId
        );
      }
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

  /**
   * Adjust a linked goal's progress by a relative delta. The worker
   * `applyGoalContribution` op clamps at 0 + auto-completes atomically.
   */
  async function adjustGoalProgress(
    goalId: string | undefined,
    appliedAmount: number | undefined,
    reverse = false
  ): Promise<void> {
    if (!goalId || !appliedAmount) return;
    const delta = reverse ? -appliedAmount : appliedAmount;
    await useGoalsStore().applyContribution(goalId, delta);
  }

  /**
   * Compute and apply goal allocation for a transaction, with guardrail.
   * Returns the applied amount (0 if no allocation).
   */
  async function applyGoalAllocation(transaction: Transaction): Promise<number> {
    if (!transaction.goalId || !transaction.goalAllocMode || !transaction.goalAllocValue) return 0;
    const goalsStore = useGoalsStore();
    const goal = goalsStore.goals.find((g) => g.id === transaction.goalId);
    if (!goal) return 0;
    const raw = computeGoalAllocRaw(
      transaction.goalAllocMode,
      transaction.goalAllocValue,
      transaction.amount
    );
    const remaining = Math.max(0, goal.targetAmount - goal.currentAmount);
    const applied = Math.min(raw, remaining);
    if (applied > 0) {
      await transactionRepo.updateTransaction(transaction.id, { goalAllocApplied: applied });
      transaction.goalAllocApplied = applied;
      await adjustGoalProgress(transaction.goalId, applied);
    }
    return applied;
  }

  /**
   * Apply loan payment: calculate amortization, store interest/principal on tx, reduce loan balance.
   * Recurring payments use standard amortization; one-time payments are extra (full to principal).
   */
  /** Route the echoed loan host into the owning store's local array (the doc was
   * already mutated atomically by the named op — no re-write / re-read race). */
  function applyLoanHost(hostCollection: string | undefined, host: unknown): void {
    if (!host) return;
    if (hostCollection === 'assets') useAssetsStore().applyEchoed(host as Asset);
    else useAccountsStore().applyEchoed(host as Account);
  }

  async function applyLoanPayment(transaction: Transaction): Promise<void> {
    if (!transaction.loanId) return;
    try {
      // The worker `applyLoanPayment` op reads the loan host, amortizes, and
      // writes the new balance atomically — closing the async lost-update the
      // old read-then-absolute-write had. It returns the echoed host + split.
      const res = await mutate<{
        applied: boolean;
        hostCollection?: string;
        host?: Account | Asset;
        interestPortion?: number;
        principalPortion?: number;
      }>({
        op: 'named',
        name: 'applyLoanPayment',
        args: {
          loanId: transaction.loanId,
          paymentAmount: transaction.amount,
          isRecurring: !!transaction.recurringItemId,
        },
      });
      if (!res.applied) return;
      applyLoanHost(res.hostCollection, res.host);
      // The interest/principal portions belong to the just-created transaction
      // (no concurrent writer) → write them the ordinary way.
      await transactionRepo.updateTransaction(transaction.id, {
        loanInterestPortion: res.interestPortion,
        loanPrincipalPortion: res.principalPortion,
      });
      transaction.loanInterestPortion = res.interestPortion;
      transaction.loanPrincipalPortion = res.principalPortion;
    } catch (e) {
      console.error('Failed to apply loan payment:', e);
    }
  }

  /**
   * Reverse a loan payment: add the principal portion back to the loan balance
   * (atomic worker `reverseLoanPayment` op).
   */
  async function reverseLoanPayment(transaction: Transaction): Promise<void> {
    if (!transaction.loanId || !transaction.loanPrincipalPortion) return;
    try {
      const res = await mutate<{
        applied: boolean;
        hostCollection?: string;
        host?: Account | Asset;
      }>({
        op: 'named',
        name: 'reverseLoanPayment',
        args: {
          loanId: transaction.loanId,
          principalToRestore: transaction.loanPrincipalPortion,
        },
      });
      if (!res.applied) return;
      applyLoanHost(res.hostCollection, res.host);
    } catch (e) {
      console.error('Failed to reverse loan payment:', e);
    }
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
        // Balance adjustments are audit echoes of an already-applied balance change.
        // Skip all cascading side effects (balance mutation, goal/loan application)
        // and force isReconciled: true so the invariant lives in one place.
        if (input.type === 'balance_adjustment') {
          const normalized = { ...input, isReconciled: true };
          const transaction = await transactionRepo.createTransaction(normalized);
          transactions.value = [...transactions.value, transaction];
          return transaction;
        }

        // For a transfer, resolve the destination amount up-front (converts
        // cross-currency; THROWS on a missing rate so nothing is persisted).
        const createInput: CreateTransactionInput =
          input.type === 'transfer' && input.toAccountId
            ? {
                ...input,
                toAmount: resolveTransferToAmount(input.currency, input.toAccountId, input.amount),
              }
            : input;

        const transaction = await transactionRepo.createTransaction(createInput);
        const isFirst = transactions.value.length === 0;
        // Immutable update: assign a new array so downstream computeds re-evaluate
        transactions.value = [...transactions.value, transaction];
        if (isFirst) {
          celebrate('first-transaction');
        }

        // Update account balance(s) — liability-aware, transfer destination
        // credited its converted toAmount (single shared routine).
        await applyTransactionToBalances(transaction, 1);

        // Apply goal allocation (if linked)
        await applyGoalAllocation(transaction);

        // Apply loan payment (if linked)
        await applyLoanPayment(transaction);

        return transaction;
      },
      { action: 'transactionsStore:createTransaction' }
    );
    if (result) window.plausible?.('feature_used', { props: { feature: 'transaction' } });
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
        // Get the original transaction to calculate balance adjustments
        const original = transactions.value.find((t) => t.id === id);

        const updated = await transactionRepo.updateTransaction(id, input);
        if (updated) {
          // Immutable update: assign a new array so downstream computeds re-evaluate
          transactions.value = transactions.value.map((t) => (t.id === id ? updated : t));

          // Balance adjustments carry no side effects (see createTransaction for rationale).
          // Skip the reverse-and-reapply dance for both the original and updated shape.
          if (original?.type === 'balance_adjustment' || updated.type === 'balance_adjustment') {
            return updated;
          }

          // If amount, type, account, destination, or currency changed, adjust balances
          if (original) {
            // Resolve the updated shape's toAmount FIRST (may THROW on a missing
            // rate) so the whole cascade aborts before any balance is touched —
            // never a reversed-but-not-reapplied (half-applied) state.
            const resolvedToAmount = resolveUpdatedTransferToAmount(original, updated, input);
            const updatedForCascade: Transaction = { ...updated, toAmount: resolvedToAmount };

            // Reverse the original effect, then apply the updated effect — both
            // via the single liability-aware routine (dest uses each shape's toAmount).
            await applyTransactionToBalances(original, -1);
            await applyTransactionToBalances(updatedForCascade, 1);

            // Persist the corrected toAmount when it changed on a transfer result.
            if (
              updatedForCascade.type === 'transfer' &&
              updatedForCascade.toAmount !== updated.toAmount
            ) {
              await transactionRepo.updateTransaction(id, { toAmount: updatedForCascade.toAmount });
              transactions.value = transactions.value.map((t) =>
                t.id === id ? { ...t, toAmount: updatedForCascade.toAmount } : t
              );
            }

            // Reverse old goal allocation
            await adjustGoalProgress(original.goalId, original.goalAllocApplied, true);

            // Reverse old loan payment
            await reverseLoanPayment(original);
          }

          // Apply new goal allocation (if linked)
          await applyGoalAllocation(updated);

          // Apply new loan payment (if linked)
          await applyLoanPayment(updated);
        }
        return updated;
      },
      { action: 'transactionsStore:updateTransaction' }
    );
    return result ?? null;
  }

  async function deleteTransaction(id: string): Promise<boolean> {
    const result = await wrapAsync(
      isLoading,
      error,
      async () => {
        // Get the transaction before deleting to reverse balance
        const transaction = transactions.value.find((t) => t.id === id);

        const success = await transactionRepo.deleteTransaction(id);
        if (success) {
          transactions.value = transactions.value.filter((t) => t.id !== id);

          // Balance adjustments carry no side effects — skip reversal.
          if (transaction?.type === 'balance_adjustment') {
            return success;
          }

          // Reverse the transaction's effect on account balance(s)
          if (transaction) {
            await applyTransactionToBalances(transaction, -1);

            // Reverse goal allocation
            await adjustGoalProgress(transaction.goalId, transaction.goalAllocApplied, true);

            // Reverse loan payment
            await reverseLoanPayment(transaction);
          }
        }
        return success;
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
        for (const tx of toDelete) {
          const success = await transactionRepo.deleteTransaction(tx.id);
          if (success) {
            // Reverse balance (liability-aware; recurring items are income/expense)
            await applyTransactionToBalances(tx, -1);
            // Reverse goal allocation
            await adjustGoalProgress(tx.goalId, tx.goalAllocApplied, true);
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
    resetState,
  };
});
