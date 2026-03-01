import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { celebrate } from '@/composables/useCelebration';
import * as transactionRepo from '@/services/indexeddb/repositories/transactionRepository';
import { useAccountsStore } from '@/stores/accountsStore';
import { useMemberFilterStore } from '@/stores/memberFilterStore';
import { useTombstoneStore } from '@/stores/tombstoneStore';
import { wrapAsync } from '@/composables/useStoreActions';
import { convertToBaseCurrency } from '@/utils/currency';
import type {
  Transaction,
  CreateTransactionInput,
  UpdateTransactionInput,
  ISODateString,
} from '@/types/models';
import { getStartOfMonth, getEndOfMonth, toDateInputValue, isDateBetween } from '@/utils/date';

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

  // Transactions filtered by global member filter (via account ownership)
  const filteredTransactions = computed(() => {
    const memberFilter = useMemberFilterStore();
    if (!memberFilter.isInitialized || memberFilter.isAllSelected) {
      return transactions.value;
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
   * Calculate the balance adjustment for an account based on transaction type.
   * Income adds to balance, expense subtracts from balance.
   * For transfers: source account is debited, destination account is credited.
   */
  function calculateBalanceAdjustment(
    type: 'income' | 'expense' | 'transfer',
    amount: number,
    isSourceAccount: boolean = true
  ): number {
    switch (type) {
      case 'income':
        return amount;
      case 'expense':
        return -amount;
      case 'transfer':
        return isSourceAccount ? -amount : amount;
      default:
        return 0;
    }
  }

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

  // Actions
  async function loadTransactions() {
    await wrapAsync(isLoading, error, async () => {
      transactions.value = await transactionRepo.getAllTransactions();
    });
  }

  async function createTransaction(input: CreateTransactionInput): Promise<Transaction | null> {
    const result = await wrapAsync(isLoading, error, async () => {
      const transaction = await transactionRepo.createTransaction(input);
      const isFirst = transactions.value.length === 0;
      transactions.value.push(transaction);
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
        const index = transactions.value.findIndex((t) => t.id === id);
        if (index !== -1) {
          transactions.value[index] = updated;
        }

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
        }
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
        useTombstoneStore().recordDeletion('transaction', id);
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
          useTombstoneStore().recordDeletion('transaction', tx.id);
          // Reverse balance
          const adjustment = calculateBalanceAdjustment(tx.type, tx.amount, true);
          await adjustAccountBalance(tx.accountId, -adjustment);
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
