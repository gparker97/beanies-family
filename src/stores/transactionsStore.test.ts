import { setActivePinia, createPinia } from 'pinia';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useAccountsStore } from './accountsStore';
import { useGoalsStore } from './goalsStore';
import { useTransactionsStore } from './transactionsStore';
import type { Transaction, Account, Goal } from '@/types/models';

// Mock the transaction repository
vi.mock('@/services/automerge/repositories/transactionRepository', () => ({
  getAllTransactions: vi.fn(),
  getTransactionById: vi.fn(),
  createTransaction: vi.fn(),
  updateTransaction: vi.fn(),
  deleteTransaction: vi.fn(),
}));

// Mock the account repository
vi.mock('@/services/automerge/repositories/accountRepository', () => ({
  getAllAccounts: vi.fn(),
  getAccountById: vi.fn(),
  createAccount: vi.fn(),
  updateAccount: vi.fn(),
  deleteAccount: vi.fn(),
  updateAccountBalance: vi.fn(),
}));

// Mock the goal repository
vi.mock('@/services/automerge/repositories/goalRepository', () => ({
  getAllGoals: vi.fn().mockResolvedValue([]),
  getGoalById: vi.fn(),
  createGoal: vi.fn(),
  updateGoal: vi.fn(),
  deleteGoal: vi.fn(),
  updateGoalProgress: vi.fn(),
  getGoalProgress: vi.fn(),
  getActiveGoals: vi.fn().mockResolvedValue([]),
  getFamilyGoals: vi.fn().mockResolvedValue([]),
  getGoalsByMemberId: vi.fn().mockResolvedValue([]),
}));

import * as transactionRepo from '@/services/automerge/repositories/transactionRepository';
import * as accountRepo from '@/services/automerge/repositories/accountRepository';

const mockAccount: Account = {
  id: 'test-account-1',
  memberId: 'member-1',
  name: 'Test Checking',
  type: 'checking',
  currency: 'USD',
  balance: 1000,
  institution: 'Test Bank',
  isActive: true,
  includeInNetWorth: true,
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
};

const mockDestAccount: Account = {
  id: 'test-account-2',
  memberId: 'member-1',
  name: 'Test Savings',
  type: 'savings',
  currency: 'USD',
  balance: 5000,
  institution: 'Test Bank',
  isActive: true,
  includeInNetWorth: true,
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
};

const mockTransaction: Transaction = {
  id: 'test-transaction-1',
  accountId: 'test-account-1',
  type: 'expense',
  amount: 100,
  currency: 'USD',
  category: 'groceries',
  date: '2024-01-15T00:00:00.000Z',
  description: 'Grocery shopping',
  isReconciled: false,
  createdAt: '2024-01-15T00:00:00.000Z',
  updatedAt: '2024-01-15T00:00:00.000Z',
};

describe('transactionsStore - Account Balance Sync', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  describe('createTransaction - balance updates', () => {
    it('should decrease account balance when creating an expense', async () => {
      const transactionsStore = useTransactionsStore();
      const accountsStore = useAccountsStore();

      // Setup: add account to the accounts store
      accountsStore.accounts.push({ ...mockAccount });

      // Mock repository responses
      const newTransaction = { ...mockTransaction, id: 'new-tx-1' };
      vi.mocked(transactionRepo.createTransaction).mockResolvedValue(newTransaction);
      vi.mocked(accountRepo.updateAccount).mockResolvedValue({
        ...mockAccount,
        balance: 900,
      });

      // Act: create an expense transaction
      const result = await transactionsStore.createTransaction({
        accountId: 'test-account-1',
        type: 'expense',
        amount: 100,
        currency: 'USD',
        category: 'groceries',
        date: '2024-01-15T00:00:00.000Z',
        description: 'Grocery shopping',
        isReconciled: false,
      });

      // Assert
      expect(result).not.toBeNull();
      expect(accountRepo.updateAccount).toHaveBeenCalledWith('test-account-1', { balance: 900 });
    });

    it('should increase account balance when creating an income', async () => {
      const transactionsStore = useTransactionsStore();
      const accountsStore = useAccountsStore();

      // Setup
      accountsStore.accounts.push({ ...mockAccount });

      const incomeTransaction = {
        ...mockTransaction,
        id: 'income-tx-1',
        type: 'income' as const,
        amount: 500,
        category: 'salary',
      };
      vi.mocked(transactionRepo.createTransaction).mockResolvedValue(incomeTransaction);
      vi.mocked(accountRepo.updateAccount).mockResolvedValue({
        ...mockAccount,
        balance: 1500,
      });

      // Act
      const result = await transactionsStore.createTransaction({
        accountId: 'test-account-1',
        type: 'income',
        amount: 500,
        currency: 'USD',
        category: 'salary',
        date: '2024-01-15T00:00:00.000Z',
        description: 'Monthly salary',
        isReconciled: false,
      });

      // Assert
      expect(result).not.toBeNull();
      expect(accountRepo.updateAccount).toHaveBeenCalledWith('test-account-1', { balance: 1500 });
    });

    it('should update both accounts when creating a transfer', async () => {
      const transactionsStore = useTransactionsStore();
      const accountsStore = useAccountsStore();

      // Setup: add both accounts
      accountsStore.accounts.push({ ...mockAccount });
      accountsStore.accounts.push({ ...mockDestAccount });

      const transferTransaction = {
        ...mockTransaction,
        id: 'transfer-tx-1',
        type: 'transfer' as const,
        toAccountId: 'test-account-2',
        amount: 200,
      };
      vi.mocked(transactionRepo.createTransaction).mockResolvedValue(transferTransaction);
      vi.mocked(accountRepo.updateAccount)
        .mockResolvedValueOnce({ ...mockAccount, balance: 800 })
        .mockResolvedValueOnce({ ...mockDestAccount, balance: 5200 });

      // Act
      const result = await transactionsStore.createTransaction({
        accountId: 'test-account-1',
        toAccountId: 'test-account-2',
        type: 'transfer',
        amount: 200,
        currency: 'USD',
        category: 'transfer',
        date: '2024-01-15T00:00:00.000Z',
        description: 'Transfer to savings',
        isReconciled: false,
      });

      // Assert
      expect(result).not.toBeNull();
      expect(accountRepo.updateAccount).toHaveBeenCalledTimes(2);
      expect(accountRepo.updateAccount).toHaveBeenCalledWith('test-account-1', { balance: 800 });
      expect(accountRepo.updateAccount).toHaveBeenCalledWith('test-account-2', { balance: 5200 });
    });
  });

  describe('deleteTransaction - balance reversal', () => {
    it('should restore account balance when deleting an expense', async () => {
      const transactionsStore = useTransactionsStore();
      const accountsStore = useAccountsStore();

      // Setup
      const accountWithBalance900 = { ...mockAccount, balance: 900 };
      accountsStore.accounts.push(accountWithBalance900);
      transactionsStore.transactions.push({ ...mockTransaction });

      vi.mocked(transactionRepo.deleteTransaction).mockResolvedValue(true);
      vi.mocked(accountRepo.updateAccount).mockResolvedValue({
        ...mockAccount,
        balance: 1000,
      });

      // Act
      const result = await transactionsStore.deleteTransaction('test-transaction-1');

      // Assert
      expect(result).toBe(true);
      expect(accountRepo.updateAccount).toHaveBeenCalledWith('test-account-1', { balance: 1000 });
    });

    it('should restore account balance when deleting an income', async () => {
      const transactionsStore = useTransactionsStore();
      const accountsStore = useAccountsStore();

      // Setup
      const incomeTransaction = {
        ...mockTransaction,
        id: 'income-tx-1',
        type: 'income' as const,
        amount: 500,
      };
      const accountWithBalance1500 = { ...mockAccount, balance: 1500 };
      accountsStore.accounts.push(accountWithBalance1500);
      transactionsStore.transactions.push(incomeTransaction);

      vi.mocked(transactionRepo.deleteTransaction).mockResolvedValue(true);
      vi.mocked(accountRepo.updateAccount).mockResolvedValue({
        ...mockAccount,
        balance: 1000,
      });

      // Act
      const result = await transactionsStore.deleteTransaction('income-tx-1');

      // Assert
      expect(result).toBe(true);
      expect(accountRepo.updateAccount).toHaveBeenCalledWith('test-account-1', { balance: 1000 });
    });

    it('should restore both account balances when deleting a transfer', async () => {
      const transactionsStore = useTransactionsStore();
      const accountsStore = useAccountsStore();

      // Setup
      const transferTransaction = {
        ...mockTransaction,
        id: 'transfer-tx-1',
        type: 'transfer' as const,
        toAccountId: 'test-account-2',
        amount: 200,
      };
      accountsStore.accounts.push({ ...mockAccount, balance: 800 });
      accountsStore.accounts.push({ ...mockDestAccount, balance: 5200 });
      transactionsStore.transactions.push(transferTransaction);

      vi.mocked(transactionRepo.deleteTransaction).mockResolvedValue(true);
      vi.mocked(accountRepo.updateAccount)
        .mockResolvedValueOnce({ ...mockAccount, balance: 1000 })
        .mockResolvedValueOnce({ ...mockDestAccount, balance: 5000 });

      // Act
      const result = await transactionsStore.deleteTransaction('transfer-tx-1');

      // Assert
      expect(result).toBe(true);
      expect(accountRepo.updateAccount).toHaveBeenCalledTimes(2);
      expect(accountRepo.updateAccount).toHaveBeenCalledWith('test-account-1', { balance: 1000 });
      expect(accountRepo.updateAccount).toHaveBeenCalledWith('test-account-2', { balance: 5000 });
    });
  });

  describe('updateTransaction - balance adjustments', () => {
    it('should adjust balance when transaction amount changes', async () => {
      const transactionsStore = useTransactionsStore();
      const accountsStore = useAccountsStore();

      // Setup: expense of 100, account balance at 900
      const accountWithBalance900 = { ...mockAccount, balance: 900 };
      accountsStore.accounts.push(accountWithBalance900);
      transactionsStore.transactions.push({ ...mockTransaction });

      // Updating to 150 should change balance to 850
      const updatedTransaction = { ...mockTransaction, amount: 150 };
      vi.mocked(transactionRepo.updateTransaction).mockResolvedValue(updatedTransaction);
      vi.mocked(accountRepo.updateAccount)
        .mockResolvedValueOnce({ ...mockAccount, balance: 1000 }) // Reverse old
        .mockResolvedValueOnce({ ...mockAccount, balance: 850 }); // Apply new

      // Act
      const result = await transactionsStore.updateTransaction('test-transaction-1', {
        amount: 150,
      });

      // Assert
      expect(result).not.toBeNull();
      expect(accountRepo.updateAccount).toHaveBeenCalledTimes(2);
    });

    it('should adjust balance when transaction type changes from expense to income', async () => {
      const transactionsStore = useTransactionsStore();
      const accountsStore = useAccountsStore();

      // Setup: expense of 100, account balance at 900
      const accountWithBalance900 = { ...mockAccount, balance: 900 };
      accountsStore.accounts.push(accountWithBalance900);
      transactionsStore.transactions.push({ ...mockTransaction });

      // Changing to income should change balance to 1100 (reverse -100, apply +100)
      const updatedTransaction = { ...mockTransaction, type: 'income' as const };
      vi.mocked(transactionRepo.updateTransaction).mockResolvedValue(updatedTransaction);
      vi.mocked(accountRepo.updateAccount)
        .mockResolvedValueOnce({ ...mockAccount, balance: 1000 }) // Reverse old expense
        .mockResolvedValueOnce({ ...mockAccount, balance: 1100 }); // Apply new income

      // Act
      const result = await transactionsStore.updateTransaction('test-transaction-1', {
        type: 'income',
      });

      // Assert
      expect(result).not.toBeNull();
      expect(accountRepo.updateAccount).toHaveBeenCalledTimes(2);
    });
  });
});

describe('transactionsStore - Summary Card Calculations', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  // Helper to create a transaction for current month
  const createThisMonthTransaction = (overrides: Partial<Transaction> = {}): Transaction => {
    const now = new Date();
    const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-15`;
    return {
      id: `txn-${Math.random().toString(36).slice(2)}`,
      accountId: 'test-account-1',
      type: 'expense',
      amount: 100,
      currency: 'USD',
      category: 'food',
      date: thisMonth,
      description: 'Test transaction',
      isReconciled: false,
      createdAt: thisMonth,
      updatedAt: thisMonth,
      ...overrides,
    };
  };

  describe('thisMonthIncome - includes both one-time and recurring transactions', () => {
    it('should sum ALL income transactions (one-time + recurring)', () => {
      const store = useTransactionsStore();

      // Add one-time income transactions
      store.transactions.push(
        createThisMonthTransaction({
          id: 'txn-1',
          type: 'income',
          amount: 500,
          description: 'Freelance',
        }),
        createThisMonthTransaction({
          id: 'txn-2',
          type: 'income',
          amount: 300,
          description: 'Side gig',
        })
      );

      // Add recurring-generated income (should be included)
      store.transactions.push(
        createThisMonthTransaction({
          id: 'txn-3',
          type: 'income',
          amount: 5000,
          description: 'Salary',
          recurringItemId: 'recurring-salary-1',
        })
      );

      // thisMonthIncome should include ALL: 500 + 300 + 5000 = 5800
      expect(store.thisMonthIncome).toBe(5800);
    });

    it('should include income from recurring items only', () => {
      const store = useTransactionsStore();

      store.transactions.push(
        createThisMonthTransaction({
          id: 'txn-1',
          type: 'income',
          amount: 5000,
          recurringItemId: 'recurring-1',
        })
      );

      expect(store.thisMonthIncome).toBe(5000);
    });

    it('should not include expenses in income calculation', () => {
      const store = useTransactionsStore();

      store.transactions.push(
        createThisMonthTransaction({ id: 'txn-1', type: 'income', amount: 1000 }),
        createThisMonthTransaction({ id: 'txn-2', type: 'expense', amount: 500 })
      );

      expect(store.thisMonthIncome).toBe(1000);
    });
  });

  describe('thisMonthExpenses - includes both one-time and recurring transactions', () => {
    it('should sum ALL expense transactions (one-time + recurring)', () => {
      const store = useTransactionsStore();

      // Add one-time expenses
      store.transactions.push(
        createThisMonthTransaction({
          id: 'txn-1',
          type: 'expense',
          amount: 50,
          description: 'Coffee',
        }),
        createThisMonthTransaction({
          id: 'txn-2',
          type: 'expense',
          amount: 100,
          description: 'Groceries',
        })
      );

      // Add recurring-generated expense (should be included)
      store.transactions.push(
        createThisMonthTransaction({
          id: 'txn-3',
          type: 'expense',
          amount: 2000,
          description: 'Rent',
          recurringItemId: 'recurring-rent-1',
        })
      );

      // thisMonthExpenses should include ALL: 50 + 100 + 2000 = 2150
      expect(store.thisMonthExpenses).toBe(2150);
    });

    it('should include expenses from recurring items only', () => {
      const store = useTransactionsStore();

      store.transactions.push(
        createThisMonthTransaction({
          id: 'txn-1',
          type: 'expense',
          amount: 2000,
          recurringItemId: 'recurring-1',
        })
      );

      expect(store.thisMonthExpenses).toBe(2000);
    });
  });

  describe('thisMonthOneTimeIncome - excludes recurring transactions', () => {
    it('should sum only one-time income transactions', () => {
      const store = useTransactionsStore();

      store.transactions.push(
        createThisMonthTransaction({ id: 'txn-1', type: 'income', amount: 500 }),
        createThisMonthTransaction({ id: 'txn-2', type: 'income', amount: 300 }),
        createThisMonthTransaction({
          id: 'txn-3',
          type: 'income',
          amount: 5000,
          recurringItemId: 'r1',
        })
      );

      // Should only include one-time: 500 + 300 = 800
      expect(store.thisMonthOneTimeIncome).toBe(800);
    });

    it('should return 0 when all income is from recurring items', () => {
      const store = useTransactionsStore();

      store.transactions.push(
        createThisMonthTransaction({
          id: 'txn-1',
          type: 'income',
          amount: 5000,
          recurringItemId: 'r1',
        })
      );

      expect(store.thisMonthOneTimeIncome).toBe(0);
    });
  });

  describe('thisMonthOneTimeExpenses - excludes recurring transactions', () => {
    it('should sum only one-time expense transactions', () => {
      const store = useTransactionsStore();

      store.transactions.push(
        createThisMonthTransaction({ id: 'txn-1', type: 'expense', amount: 50 }),
        createThisMonthTransaction({ id: 'txn-2', type: 'expense', amount: 100 }),
        createThisMonthTransaction({
          id: 'txn-3',
          type: 'expense',
          amount: 2000,
          recurringItemId: 'r1',
        })
      );

      // Should only include one-time: 50 + 100 = 150
      expect(store.thisMonthOneTimeExpenses).toBe(150);
    });

    it('should return 0 when all expenses are from recurring items', () => {
      const store = useTransactionsStore();

      store.transactions.push(
        createThisMonthTransaction({
          id: 'txn-1',
          type: 'expense',
          amount: 2000,
          recurringItemId: 'r1',
        })
      );

      expect(store.thisMonthOneTimeExpenses).toBe(0);
    });
  });

  describe('thisMonthRecurringIncome - only recurring transactions', () => {
    it('should sum only recurring income transactions', () => {
      const store = useTransactionsStore();

      store.transactions.push(
        createThisMonthTransaction({ id: 'txn-1', type: 'income', amount: 500 }),
        createThisMonthTransaction({
          id: 'txn-2',
          type: 'income',
          amount: 5000,
          recurringItemId: 'salary',
        }),
        createThisMonthTransaction({
          id: 'txn-3',
          type: 'income',
          amount: 1000,
          recurringItemId: 'rental',
        })
      );

      // Should only include recurring: 5000 + 1000 = 6000
      expect(store.thisMonthRecurringIncome).toBe(6000);
    });

    it('should return 0 when no recurring income exists', () => {
      const store = useTransactionsStore();

      store.transactions.push(
        createThisMonthTransaction({ id: 'txn-1', type: 'income', amount: 500 })
      );

      expect(store.thisMonthRecurringIncome).toBe(0);
    });
  });

  describe('thisMonthRecurringExpenses - only recurring transactions', () => {
    it('should sum only recurring expense transactions', () => {
      const store = useTransactionsStore();

      store.transactions.push(
        createThisMonthTransaction({ id: 'txn-1', type: 'expense', amount: 50 }),
        createThisMonthTransaction({
          id: 'txn-2',
          type: 'expense',
          amount: 2000,
          recurringItemId: 'rent',
        }),
        createThisMonthTransaction({
          id: 'txn-3',
          type: 'expense',
          amount: 100,
          recurringItemId: 'netflix',
        })
      );

      // Should only include recurring: 2000 + 100 = 2100
      expect(store.thisMonthRecurringExpenses).toBe(2100);
    });

    it('should return 0 when no recurring expenses exist', () => {
      const store = useTransactionsStore();

      store.transactions.push(
        createThisMonthTransaction({ id: 'txn-1', type: 'expense', amount: 50 })
      );

      expect(store.thisMonthRecurringExpenses).toBe(0);
    });
  });

  describe('thisMonthNetCashFlow', () => {
    it('should be the difference between ALL income and ALL expenses (one-time + recurring)', () => {
      const store = useTransactionsStore();

      store.transactions.push(
        // One-time income
        createThisMonthTransaction({ id: 'txn-1', type: 'income', amount: 1000 }),
        // One-time expense
        createThisMonthTransaction({ id: 'txn-2', type: 'expense', amount: 300 }),
        // Recurring income
        createThisMonthTransaction({
          id: 'txn-3',
          type: 'income',
          amount: 5000,
          recurringItemId: 'r1',
        }),
        // Recurring expense
        createThisMonthTransaction({
          id: 'txn-4',
          type: 'expense',
          amount: 2000,
          recurringItemId: 'r2',
        })
      );

      // Net = (1000 + 5000) - (300 + 2000) = 6000 - 2300 = 3700
      expect(store.thisMonthNetCashFlow).toBe(3700);
    });

    it('should be negative when total expenses exceed total income', () => {
      const store = useTransactionsStore();

      store.transactions.push(
        createThisMonthTransaction({ id: 'txn-1', type: 'income', amount: 500 }),
        createThisMonthTransaction({ id: 'txn-2', type: 'expense', amount: 800 })
      );

      expect(store.thisMonthNetCashFlow).toBe(-300);
    });
  });

  describe('breakdown verification', () => {
    it('should have one-time + recurring equal to total for income', () => {
      const store = useTransactionsStore();

      store.transactions.push(
        createThisMonthTransaction({ id: 'txn-1', type: 'income', amount: 500 }),
        createThisMonthTransaction({ id: 'txn-2', type: 'income', amount: 300 }),
        createThisMonthTransaction({
          id: 'txn-3',
          type: 'income',
          amount: 5000,
          recurringItemId: 'salary',
        })
      );

      expect(store.thisMonthOneTimeIncome + store.thisMonthRecurringIncome).toBe(
        store.thisMonthIncome
      );
    });

    it('should have one-time + recurring equal to total for expenses', () => {
      const store = useTransactionsStore();

      store.transactions.push(
        createThisMonthTransaction({ id: 'txn-1', type: 'expense', amount: 50 }),
        createThisMonthTransaction({ id: 'txn-2', type: 'expense', amount: 100 }),
        createThisMonthTransaction({
          id: 'txn-3',
          type: 'expense',
          amount: 2000,
          recurringItemId: 'rent',
        })
      );

      expect(store.thisMonthOneTimeExpenses + store.thisMonthRecurringExpenses).toBe(
        store.thisMonthExpenses
      );
    });
  });

  describe('deleteTransactionsByRecurringItemId', () => {
    it('should delete all transactions with the given recurringItemId', async () => {
      const store = useTransactionsStore();
      const accountsStore = useAccountsStore();
      accountsStore.accounts.push({ ...mockAccount });

      store.transactions.push(
        createThisMonthTransaction({
          id: 'txn-1',
          type: 'expense',
          amount: 100,
          recurringItemId: 'recurring-1',
        }),
        createThisMonthTransaction({
          id: 'txn-2',
          type: 'expense',
          amount: 200,
          recurringItemId: 'recurring-1',
        }),
        createThisMonthTransaction({ id: 'txn-3', type: 'expense', amount: 50 }) // one-time
      );

      vi.mocked(transactionRepo.deleteTransaction).mockResolvedValue(true);

      const count = await store.deleteTransactionsByRecurringItemId('recurring-1');

      expect(count).toBe(2);
      expect(store.transactions).toHaveLength(1);
      expect(store.transactions[0]!.id).toBe('txn-3');
    });

    it('should not affect transactions from other recurring items', async () => {
      const store = useTransactionsStore();
      const accountsStore = useAccountsStore();
      accountsStore.accounts.push({ ...mockAccount });

      store.transactions.push(
        createThisMonthTransaction({
          id: 'txn-1',
          type: 'expense',
          amount: 100,
          recurringItemId: 'recurring-1',
        }),
        createThisMonthTransaction({
          id: 'txn-2',
          type: 'expense',
          amount: 200,
          recurringItemId: 'recurring-2',
        })
      );

      vi.mocked(transactionRepo.deleteTransaction).mockResolvedValue(true);

      await store.deleteTransactionsByRecurringItemId('recurring-1');

      expect(store.transactions).toHaveLength(1);
      expect(store.transactions[0]!.recurringItemId).toBe('recurring-2');
    });

    it('should return 0 when no transactions match', async () => {
      const store = useTransactionsStore();

      store.transactions.push(
        createThisMonthTransaction({ id: 'txn-1', type: 'expense', amount: 100 })
      );

      const count = await store.deleteTransactionsByRecurringItemId('nonexistent');

      expect(count).toBe(0);
      expect(store.transactions).toHaveLength(1);
    });

    it('should reverse account balances for deleted transactions', async () => {
      const store = useTransactionsStore();
      const accountsStore = useAccountsStore();
      accountsStore.accounts.push({ ...mockAccount });

      store.transactions.push(
        createThisMonthTransaction({
          id: 'txn-1',
          type: 'expense',
          amount: 500,
          recurringItemId: 'recurring-1',
        })
      );

      vi.mocked(transactionRepo.deleteTransaction).mockResolvedValue(true);
      vi.mocked(accountRepo.updateAccount).mockResolvedValue({
        ...mockAccount,
        balance: 1500,
      });

      await store.deleteTransactionsByRecurringItemId('recurring-1');

      // Balance should be reversed: expense of 500 reversed = +500
      expect(accountRepo.updateAccount).toHaveBeenCalledWith('test-account-1', { balance: 1500 });
    });
  });
});

// --- Goal Allocation Sync ---

const mockGoal: Goal = {
  id: 'goal-1',
  name: 'Buy a Car',
  type: 'savings',
  targetAmount: 10000,
  currentAmount: 0,
  currency: 'USD',
  priority: 'high',
  isCompleted: false,
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
};

import * as goalRepo from '@/services/automerge/repositories/goalRepository';

describe('transactionsStore - Goal Allocation Sync', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  function seedStores() {
    const transactionsStore = useTransactionsStore();
    const accountsStore = useAccountsStore();
    const goalsStore = useGoalsStore();

    accountsStore.accounts.push({ ...mockAccount });
    goalsStore.goals.push({ ...mockGoal });

    return { transactionsStore, accountsStore, goalsStore };
  }

  it('should update goal progress with percentage allocation on create', async () => {
    const { transactionsStore, goalsStore } = seedStores();

    const createdTx: Transaction = {
      ...mockTransaction,
      type: 'income',
      amount: 1000,
      goalId: 'goal-1',
      goalAllocMode: 'percentage',
      goalAllocValue: 20,
    };
    vi.mocked(transactionRepo.createTransaction).mockResolvedValue(createdTx);
    vi.mocked(transactionRepo.updateTransaction).mockResolvedValue({
      ...createdTx,
      goalAllocApplied: 200,
    });
    vi.mocked(accountRepo.updateAccount).mockResolvedValue({ ...mockAccount, balance: 2000 });
    vi.mocked(goalRepo.updateGoal).mockResolvedValue({
      ...mockGoal,
      currentAmount: 200,
    });

    await transactionsStore.createTransaction({
      accountId: 'test-account-1',
      type: 'income',
      amount: 1000,
      currency: 'USD',
      category: 'salary',
      date: '2024-01-15',
      description: 'Salary',
      isReconciled: false,
      goalId: 'goal-1',
      goalAllocMode: 'percentage',
      goalAllocValue: 20,
    });

    // Should store applied amount on transaction
    expect(transactionRepo.updateTransaction).toHaveBeenCalledWith(createdTx.id, {
      goalAllocApplied: 200,
    });
    // Should update goal progress: 0 + 200 = 200
    expect(goalsStore.goals[0]!.currentAmount).toBe(200);
  });

  it('should update goal progress with fixed allocation on create', async () => {
    const { transactionsStore, goalsStore } = seedStores();

    const createdTx: Transaction = {
      ...mockTransaction,
      type: 'income',
      amount: 1000,
      goalId: 'goal-1',
      goalAllocMode: 'fixed',
      goalAllocValue: 300,
    };
    vi.mocked(transactionRepo.createTransaction).mockResolvedValue(createdTx);
    vi.mocked(transactionRepo.updateTransaction).mockResolvedValue({
      ...createdTx,
      goalAllocApplied: 300,
    });
    vi.mocked(accountRepo.updateAccount).mockResolvedValue({ ...mockAccount, balance: 2000 });
    vi.mocked(goalRepo.updateGoal).mockResolvedValue({
      ...mockGoal,
      currentAmount: 300,
    });

    await transactionsStore.createTransaction({
      accountId: 'test-account-1',
      type: 'income',
      amount: 1000,
      currency: 'USD',
      category: 'salary',
      date: '2024-01-15',
      description: 'Salary',
      isReconciled: false,
      goalId: 'goal-1',
      goalAllocMode: 'fixed',
      goalAllocValue: 300,
    });

    expect(transactionRepo.updateTransaction).toHaveBeenCalledWith(createdTx.id, {
      goalAllocApplied: 300,
    });
    expect(goalsStore.goals[0]!.currentAmount).toBe(300);
  });

  it('should cap allocation to remaining goal amount', async () => {
    const { transactionsStore, goalsStore } = seedStores();
    goalsStore.goals[0]!.currentAmount = 9900; // Only 100 remaining

    const createdTx: Transaction = {
      ...mockTransaction,
      type: 'income',
      amount: 1000,
      goalId: 'goal-1',
      goalAllocMode: 'percentage',
      goalAllocValue: 50, // 50% = $500, but only $100 remaining
    };
    vi.mocked(transactionRepo.createTransaction).mockResolvedValue(createdTx);
    vi.mocked(transactionRepo.updateTransaction).mockResolvedValue({
      ...createdTx,
      goalAllocApplied: 100,
    });
    vi.mocked(accountRepo.updateAccount).mockResolvedValue({ ...mockAccount, balance: 2000 });
    vi.mocked(goalRepo.updateGoal).mockResolvedValue({
      ...mockGoal,
      currentAmount: 10000,
      isCompleted: true,
    });

    await transactionsStore.createTransaction({
      accountId: 'test-account-1',
      type: 'income',
      amount: 1000,
      currency: 'USD',
      category: 'salary',
      date: '2024-01-15',
      description: 'Salary',
      isReconciled: false,
      goalId: 'goal-1',
      goalAllocMode: 'percentage',
      goalAllocValue: 50,
    });

    // Should cap at remaining amount (100), not full 500
    expect(transactionRepo.updateTransaction).toHaveBeenCalledWith(createdTx.id, {
      goalAllocApplied: 100,
    });
  });

  it('should reverse goal progress on delete', async () => {
    const { transactionsStore, goalsStore } = seedStores();
    goalsStore.goals[0]!.currentAmount = 200;

    // Seed a transaction with goal allocation
    transactionsStore.transactions.push({
      ...mockTransaction,
      type: 'income',
      amount: 1000,
      goalId: 'goal-1',
      goalAllocMode: 'percentage',
      goalAllocValue: 20,
      goalAllocApplied: 200,
    });

    vi.mocked(transactionRepo.deleteTransaction).mockResolvedValue(true);
    vi.mocked(accountRepo.updateAccount).mockResolvedValue({ ...mockAccount, balance: 0 });
    vi.mocked(goalRepo.updateGoal).mockResolvedValue({
      ...mockGoal,
      currentAmount: 0,
    });

    await transactionsStore.deleteTransaction(mockTransaction.id);

    // Goal progress should be reversed: 200 - 200 = 0
    expect(goalsStore.goals[0]!.currentAmount).toBe(0);
  });

  it('should reverse old and apply new allocation on update', async () => {
    const { transactionsStore, goalsStore } = seedStores();
    goalsStore.goals[0]!.currentAmount = 200;

    // Seed a transaction with 20% allocation (applied = 200)
    const originalTx: Transaction = {
      ...mockTransaction,
      type: 'income',
      amount: 1000,
      goalId: 'goal-1',
      goalAllocMode: 'percentage',
      goalAllocValue: 20,
      goalAllocApplied: 200,
    };
    transactionsStore.transactions.push(originalTx);

    const updatedTx: Transaction = {
      ...originalTx,
      goalAllocMode: 'percentage',
      goalAllocValue: 50,
    };
    vi.mocked(transactionRepo.updateTransaction).mockResolvedValue(updatedTx);
    vi.mocked(accountRepo.updateAccount).mockResolvedValue({ ...mockAccount });
    vi.mocked(goalRepo.updateGoal).mockImplementation(async (_id, input) => {
      goalsStore.goals[0]!.currentAmount =
        input.currentAmount ?? goalsStore.goals[0]!.currentAmount;
      return { ...goalsStore.goals[0]! };
    });

    await transactionsStore.updateTransaction(mockTransaction.id, {
      goalAllocMode: 'percentage',
      goalAllocValue: 50,
    });

    // Old allocation reversed (200 → 0), new allocation applied (50% of 1000 = 500)
    // Final goal currentAmount: 0 + 500 = 500
    expect(goalsStore.goals[0]!.currentAmount).toBe(500);
  });

  it('should reverse goal progress for each tx in bulk recurring delete', async () => {
    const { transactionsStore, goalsStore } = seedStores();
    goalsStore.goals[0]!.currentAmount = 400;

    // Two recurring transactions with goal allocation
    transactionsStore.transactions.push(
      {
        ...mockTransaction,
        id: 'tx-r1',
        recurringItemId: 'recurring-1',
        type: 'income',
        amount: 1000,
        goalId: 'goal-1',
        goalAllocApplied: 200,
      },
      {
        ...mockTransaction,
        id: 'tx-r2',
        recurringItemId: 'recurring-1',
        type: 'income',
        amount: 1000,
        goalId: 'goal-1',
        goalAllocApplied: 200,
      }
    );

    vi.mocked(transactionRepo.deleteTransaction).mockResolvedValue(true);
    vi.mocked(accountRepo.updateAccount).mockResolvedValue({ ...mockAccount });
    vi.mocked(goalRepo.updateGoal).mockImplementation(async (_id, input) => {
      goalsStore.goals[0]!.currentAmount =
        input.currentAmount ?? goalsStore.goals[0]!.currentAmount;
      return { ...goalsStore.goals[0]! };
    });

    await transactionsStore.deleteTransactionsByRecurringItemId('recurring-1');

    // 400 - 200 - 200 = 0
    expect(goalsStore.goals[0]!.currentAmount).toBe(0);
  });
});
