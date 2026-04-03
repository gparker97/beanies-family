import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { celebrate } from '@/composables/useCelebration';
import * as transactionRepo from '@/services/automerge/repositories/transactionRepository';
import { useAccountsStore } from '@/stores/accountsStore';
import { useAssetsStore } from '@/stores/assetsStore';
import { useGoalsStore } from '@/stores/goalsStore';
import { useMemberFilterStore } from '@/stores/memberFilterStore';
import { wrapAsync } from '@/composables/useStoreActions';
import { convertToBaseCurrency } from '@/utils/currency';
import { computeGoalAllocRaw, calculateBalanceAdjustment } from '@/utils/finance';
import { calculateAmortization, calculateExtraPayment, findLoanDetails } from '@/utils/loanPayment';
import type {
  Transaction,
  CreateTransactionInput,
  UpdateTransactionInput,
  ISODateString,
} from '@/types/models';
import {
  getStartOfMonth,
  getEndOfMonth,
  toDateInputValue,
  isDateBetween,
  extractDatePart,
} from '@/utils/date';

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
      const current = categoryTotals.get(t.category) || 0;
      categoryTotals.set(t.category, current + convertToBaseCurrency(t.amount, t.currency));
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
      const current = categoryTotals.get(t.category) || 0;
      categoryTotals.set(t.category, current + convertToBaseCurrency(t.amount, t.currency));
    }
    return categoryTotals;
  });

  /**
   * Update account balance in both store and database.
   */
  async function adjustAccountBalance(accountId: string, adjustment: number): Promise<void> {
    const accountsStore = useAccountsStore();
    const account = accountsStore.getAccountById(accountId);
    if (account) {
      const newBalance = account.balance + adjustment;
      await accountsStore.updateAccount(accountId, { balance: newBalance });
    }
  }

  /**
   * Adjust a linked goal's progress. Mirrors adjustAccountBalance pattern.
   */
  async function adjustGoalProgress(
    goalId: string | undefined,
    appliedAmount: number | undefined,
    reverse = false
  ): Promise<void> {
    if (!goalId || !appliedAmount) return;
    const goalsStore = useGoalsStore();
    const goal = goalsStore.goals.find((g) => g.id === goalId);
    if (!goal) return;
    const delta = reverse ? -appliedAmount : appliedAmount;
    const newAmount = Math.max(0, goal.currentAmount + delta);
    await goalsStore.updateProgress(goal.id, newAmount);
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
  async function applyLoanPayment(transaction: Transaction): Promise<void> {
    if (!transaction.loanId) return;
    try {
      const accountsStore = useAccountsStore();
      const assetsStore = useAssetsStore();
      const loan = findLoanDetails(transaction.loanId, assetsStore.assets, accountsStore.accounts);
      if (!loan || loan.outstandingBalance <= 0) return;

      // Recurring → standard amortization, one-time → extra payment (full to principal)
      const result = transaction.recurringItemId
        ? calculateAmortization(loan.outstandingBalance, loan.interestRate, transaction.amount)
        : calculateExtraPayment(loan.outstandingBalance, transaction.amount);

      // Store amortization fields on the transaction
      await transactionRepo.updateTransaction(transaction.id, {
        loanInterestPortion: result.interestPortion,
        loanPrincipalPortion: result.principalPortion,
      });
      transaction.loanInterestPortion = result.interestPortion;
      transaction.loanPrincipalPortion = result.principalPortion;

      // Reduce the loan balance
      if (loan.type === 'asset') {
        const asset = assetsStore.getAssetById(loan.entityId);
        if (asset?.loan) {
          await assetsStore.updateAsset(loan.entityId, {
            loan: { ...asset.loan, outstandingBalance: result.newBalance },
          });
        }
      } else {
        await accountsStore.updateAccount(loan.entityId, { balance: result.newBalance });
      }
    } catch (e) {
      console.error('Failed to apply loan payment:', e);
    }
  }

  /**
   * Reverse a loan payment: add principal portion back to the loan balance.
   */
  async function reverseLoanPayment(transaction: Transaction): Promise<void> {
    if (!transaction.loanId || !transaction.loanPrincipalPortion) return;
    try {
      const accountsStore = useAccountsStore();
      const assetsStore = useAssetsStore();
      const loan = findLoanDetails(transaction.loanId, assetsStore.assets, accountsStore.accounts);
      if (!loan) return;

      const restoredBalance = loan.outstandingBalance + transaction.loanPrincipalPortion;

      if (loan.type === 'asset') {
        const asset = assetsStore.getAssetById(loan.entityId);
        if (asset?.loan) {
          await assetsStore.updateAsset(loan.entityId, {
            loan: { ...asset.loan, outstandingBalance: restoredBalance },
          });
        }
      } else {
        await accountsStore.updateAccount(loan.entityId, { balance: restoredBalance });
      }
    } catch (e) {
      console.error('Failed to reverse loan payment:', e);
    }
  }

  // Actions
  async function loadTransactions() {
    await wrapAsync(isLoading, error, async () => {
      const raw = await transactionRepo.getAllTransactions();
      // Remove CRDT-duplicated recurring transactions at the source so all
      // consumers (budget, reports, dashboard) see clean data.
      transactions.value = deduplicateRecurring(raw);
    });
  }

  async function createTransaction(input: CreateTransactionInput): Promise<Transaction | null> {
    const result = await wrapAsync(isLoading, error, async () => {
      const transaction = await transactionRepo.createTransaction(input);
      const isFirst = transactions.value.length === 0;
      // Immutable update: assign a new array so downstream computeds re-evaluate
      transactions.value = [...transactions.value, transaction];
      if (isFirst) {
        celebrate('first-transaction');
      }

      // Update account balance
      const adjustment = calculateBalanceAdjustment(input.type, input.amount, true);
      await adjustAccountBalance(input.accountId, adjustment);

      // For transfers, also update destination account
      if (input.type === 'transfer' && input.toAccountId) {
        const destAdjustment = calculateBalanceAdjustment(input.type, input.amount, false);
        await adjustAccountBalance(input.toAccountId, destAdjustment);
      }

      // Apply goal allocation (if linked)
      await applyGoalAllocation(transaction);

      // Apply loan payment (if linked)
      await applyLoanPayment(transaction);

      return transaction;
    });
    return result ?? null;
  }

  async function updateTransaction(
    id: string,
    input: UpdateTransactionInput
  ): Promise<Transaction | null> {
    const result = await wrapAsync(isLoading, error, async () => {
      // Get the original transaction to calculate balance adjustments
      const original = transactions.value.find((t) => t.id === id);

      const updated = await transactionRepo.updateTransaction(id, input);
      if (updated) {
        // Immutable update: assign a new array so downstream computeds re-evaluate
        transactions.value = transactions.value.map((t) => (t.id === id ? updated : t));

        // If amount, type, or account changed, adjust balances
        if (original) {
          // Reverse the original transaction's effect
          const originalAdjustment = calculateBalanceAdjustment(
            original.type,
            original.amount,
            true
          );
          await adjustAccountBalance(original.accountId, -originalAdjustment);

          // If it was a transfer, also reverse destination
          if (original.type === 'transfer' && original.toAccountId) {
            const originalDestAdjustment = calculateBalanceAdjustment(
              original.type,
              original.amount,
              false
            );
            await adjustAccountBalance(original.toAccountId, -originalDestAdjustment);
          }

          // Apply the new transaction's effect
          const newType = input.type ?? original.type;
          const newAmount = input.amount ?? original.amount;
          const newAccountId = input.accountId ?? original.accountId;
          const newToAccountId = input.toAccountId ?? original.toAccountId;

          const newAdjustment = calculateBalanceAdjustment(newType, newAmount, true);
          await adjustAccountBalance(newAccountId, newAdjustment);

          // For transfers, also update destination
          if (newType === 'transfer' && newToAccountId) {
            const newDestAdjustment = calculateBalanceAdjustment(newType, newAmount, false);
            await adjustAccountBalance(newToAccountId, newDestAdjustment);
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
    });
    return result ?? null;
  }

  async function deleteTransaction(id: string): Promise<boolean> {
    const result = await wrapAsync(isLoading, error, async () => {
      // Get the transaction before deleting to reverse balance
      const transaction = transactions.value.find((t) => t.id === id);

      const success = await transactionRepo.deleteTransaction(id);
      if (success) {
        transactions.value = transactions.value.filter((t) => t.id !== id);

        // Reverse the transaction's effect on account balance
        if (transaction) {
          const adjustment = calculateBalanceAdjustment(transaction.type, transaction.amount, true);
          await adjustAccountBalance(transaction.accountId, -adjustment);

          // For transfers, also reverse destination
          if (transaction.type === 'transfer' && transaction.toAccountId) {
            const destAdjustment = calculateBalanceAdjustment(
              transaction.type,
              transaction.amount,
              false
            );
            await adjustAccountBalance(transaction.toAccountId, -destAdjustment);
          }

          // Reverse goal allocation
          await adjustGoalProgress(transaction.goalId, transaction.goalAllocApplied, true);

          // Reverse loan payment
          await reverseLoanPayment(transaction);
        }
      }
      return success;
    });
    return result ?? false;
  }

  async function deleteTransactionsByRecurringItemId(recurringItemId: string): Promise<number> {
    const result = await wrapAsync(isLoading, error, async () => {
      const toDelete = transactions.value.filter((t) => t.recurringItemId === recurringItemId);
      let count = 0;
      for (const tx of toDelete) {
        const success = await transactionRepo.deleteTransaction(tx.id);
        if (success) {
          // Reverse balance
          const adjustment = calculateBalanceAdjustment(tx.type, tx.amount, true);
          await adjustAccountBalance(tx.accountId, -adjustment);
          // Reverse goal allocation
          await adjustGoalProgress(tx.goalId, tx.goalAllocApplied, true);
          count++;
        }
      }
      transactions.value = transactions.value.filter((t) => t.recurringItemId !== recurringItemId);
      return count;
    });
    return result ?? 0;
  }

  function getTransactionById(id: string): Transaction | undefined {
    return transactions.value.find((t) => t.id === id);
  }

  function getTransactionsByAccountId(accountId: string): Transaction[] {
    return transactions.value.filter((t) => t.accountId === accountId);
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
    getTransactionsByDateRange,
    resetState,
  };
});
