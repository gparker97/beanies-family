import { setActivePinia, createPinia } from 'pinia';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useRecurringStore } from '@/stores/recurringStore';
import { useTransactionsStore } from '@/stores/transactionsStore';
import type { Transaction, RecurringItem } from '@/types/models';

// Mock the repositories
vi.mock('@/services/indexeddb/repositories/transactionRepository', () => ({
  getAllTransactions: vi.fn(),
  getTransactionById: vi.fn(),
  createTransaction: vi.fn(),
  updateTransaction: vi.fn(),
  deleteTransaction: vi.fn(),
}));

vi.mock('@/services/indexeddb/repositories/recurringItemRepository', () => ({
  getAllRecurringItems: vi.fn(),
  getRecurringItemById: vi.fn(),
  createRecurringItem: vi.fn(),
  updateRecurringItem: vi.fn(),
  deleteRecurringItem: vi.fn(),
}));

vi.mock('@/services/indexeddb/repositories/accountRepository', () => ({
  getAllAccounts: vi.fn(),
  getAccountById: vi.fn(),
  createAccount: vi.fn(),
  updateAccount: vi.fn(),
  deleteAccount: vi.fn(),
  updateAccountBalance: vi.fn(),
}));

describe('Dashboard Summary Cards - One-time + Recurring Integration', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  // Helper to create a transaction for current month
  const createThisMonthTransaction = (overrides: Partial<Transaction> = {}): Transaction => {
    const now = new Date();
    const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-15T00:00:00.000Z`;
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

  // Helper to create a recurring item
  const createRecurringItem = (overrides: Partial<RecurringItem> = {}): RecurringItem => {
    return {
      id: `recurring-${Math.random().toString(36).slice(2)}`,
      accountId: 'test-account-1',
      type: 'expense',
      amount: 100,
      currency: 'USD',
      category: 'utilities',
      description: 'Monthly bill',
      frequency: 'monthly',
      startDate: '2024-01-01',
      isActive: true,
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
      ...overrides,
    };
  };

  describe('Monthly Income calculation', () => {
    it('should combine one-time transaction income with recurring store income', () => {
      const transactionsStore = useTransactionsStore();
      const recurringStore = useRecurringStore();

      // Add one-time income transactions (no recurringItemId)
      transactionsStore.transactions.push(
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

      // Add active recurring income items
      recurringStore.recurringItems.push(
        createRecurringItem({ id: 'r1', type: 'income', amount: 5000, description: 'Salary' }),
        createRecurringItem({
          id: 'r2',
          type: 'income',
          amount: 1000,
          description: 'Rental income',
        })
      );

      // Dashboard Monthly Income = One-time income + Recurring income
      // One-time: 500 + 300 = 800
      // Recurring: 5000 + 1000 = 6000
      // Total: 800 + 6000 = 6800
      const monthlyIncome =
        transactionsStore.thisMonthOneTimeIncome + recurringStore.totalMonthlyRecurringIncome;
      expect(monthlyIncome).toBe(6800);
    });

    it('should only count one-time transactions (not transactions with recurringItemId)', () => {
      const transactionsStore = useTransactionsStore();
      const recurringStore = useRecurringStore();

      // Add one-time income
      transactionsStore.transactions.push(
        createThisMonthTransaction({ id: 'txn-1', type: 'income', amount: 500 })
      );

      // Add a transaction that was generated from a recurring item
      // This should NOT be counted in one-time, as the recurring store handles it
      transactionsStore.transactions.push(
        createThisMonthTransaction({
          id: 'txn-2',
          type: 'income',
          amount: 5000,
          recurringItemId: 'r1',
        })
      );

      // Add the recurring item
      recurringStore.recurringItems.push(
        createRecurringItem({ id: 'r1', type: 'income', amount: 5000 })
      );

      // One-time income should only be 500
      expect(transactionsStore.thisMonthOneTimeIncome).toBe(500);

      // Recurring income from store should be 5000
      expect(recurringStore.totalMonthlyRecurringIncome).toBe(5000);

      // Dashboard total = 500 + 5000 = 5500
      const monthlyIncome =
        transactionsStore.thisMonthOneTimeIncome + recurringStore.totalMonthlyRecurringIncome;
      expect(monthlyIncome).toBe(5500);
    });

    it('should return only recurring when no one-time income exists', () => {
      const transactionsStore = useTransactionsStore();
      const recurringStore = useRecurringStore();

      // No one-time transactions
      // Add recurring income
      recurringStore.recurringItems.push(
        createRecurringItem({ id: 'r1', type: 'income', amount: 5000 })
      );

      expect(transactionsStore.thisMonthOneTimeIncome).toBe(0);
      expect(recurringStore.totalMonthlyRecurringIncome).toBe(5000);

      const monthlyIncome =
        transactionsStore.thisMonthOneTimeIncome + recurringStore.totalMonthlyRecurringIncome;
      expect(monthlyIncome).toBe(5000);
    });

    it('should return only one-time when no recurring income exists', () => {
      const transactionsStore = useTransactionsStore();
      const recurringStore = useRecurringStore();

      // Add one-time income
      transactionsStore.transactions.push(
        createThisMonthTransaction({ id: 'txn-1', type: 'income', amount: 500 })
      );

      // No recurring items

      expect(transactionsStore.thisMonthOneTimeIncome).toBe(500);
      expect(recurringStore.totalMonthlyRecurringIncome).toBe(0);

      const monthlyIncome =
        transactionsStore.thisMonthOneTimeIncome + recurringStore.totalMonthlyRecurringIncome;
      expect(monthlyIncome).toBe(500);
    });
  });

  describe('Monthly Expenses calculation', () => {
    it('should combine one-time transaction expenses with recurring store expenses', () => {
      const transactionsStore = useTransactionsStore();
      const recurringStore = useRecurringStore();

      // Add one-time expense transactions
      transactionsStore.transactions.push(
        createThisMonthTransaction({
          id: 'txn-1',
          type: 'expense',
          amount: 50,
          description: 'Coffee',
        }),
        createThisMonthTransaction({
          id: 'txn-2',
          type: 'expense',
          amount: 150,
          description: 'Groceries',
        })
      );

      // Add active recurring expense items
      recurringStore.recurringItems.push(
        createRecurringItem({ id: 'r1', type: 'expense', amount: 2000, description: 'Rent' }),
        createRecurringItem({ id: 'r2', type: 'expense', amount: 100, description: 'Netflix' })
      );

      // Dashboard Monthly Expenses = One-time + Recurring
      // One-time: 50 + 150 = 200
      // Recurring: 2000 + 100 = 2100
      // Total: 200 + 2100 = 2300
      const monthlyExpenses =
        transactionsStore.thisMonthOneTimeExpenses + recurringStore.totalMonthlyRecurringExpenses;
      expect(monthlyExpenses).toBe(2300);
    });

    it('should only count one-time expense transactions (not transactions with recurringItemId)', () => {
      const transactionsStore = useTransactionsStore();
      const recurringStore = useRecurringStore();

      // Add one-time expense
      transactionsStore.transactions.push(
        createThisMonthTransaction({ id: 'txn-1', type: 'expense', amount: 50 })
      );

      // Add a transaction that was generated from a recurring item
      transactionsStore.transactions.push(
        createThisMonthTransaction({
          id: 'txn-2',
          type: 'expense',
          amount: 2000,
          recurringItemId: 'r1',
        })
      );

      // Add the recurring item
      recurringStore.recurringItems.push(
        createRecurringItem({ id: 'r1', type: 'expense', amount: 2000 })
      );

      // One-time expenses should only be 50
      expect(transactionsStore.thisMonthOneTimeExpenses).toBe(50);

      // Recurring expenses from store should be 2000
      expect(recurringStore.totalMonthlyRecurringExpenses).toBe(2000);

      // Dashboard total = 50 + 2000 = 2050
      const monthlyExpenses =
        transactionsStore.thisMonthOneTimeExpenses + recurringStore.totalMonthlyRecurringExpenses;
      expect(monthlyExpenses).toBe(2050);
    });
  });

  describe('Net Cash Flow calculation', () => {
    it('should calculate net as (one-time + recurring income) - (one-time + recurring expenses)', () => {
      const transactionsStore = useTransactionsStore();
      const recurringStore = useRecurringStore();

      // One-time transactions
      transactionsStore.transactions.push(
        createThisMonthTransaction({ id: 'txn-1', type: 'income', amount: 500 }),
        createThisMonthTransaction({ id: 'txn-2', type: 'expense', amount: 100 })
      );

      // Recurring items
      recurringStore.recurringItems.push(
        createRecurringItem({ id: 'r1', type: 'income', amount: 5000 }),
        createRecurringItem({ id: 'r2', type: 'expense', amount: 2000 })
      );

      const monthlyIncome =
        transactionsStore.thisMonthOneTimeIncome + recurringStore.totalMonthlyRecurringIncome;
      const monthlyExpenses =
        transactionsStore.thisMonthOneTimeExpenses + recurringStore.totalMonthlyRecurringExpenses;
      const netCashFlow = monthlyIncome - monthlyExpenses;

      // Income: 500 + 5000 = 5500
      // Expenses: 100 + 2000 = 2100
      // Net: 5500 - 2100 = 3400
      expect(monthlyIncome).toBe(5500);
      expect(monthlyExpenses).toBe(2100);
      expect(netCashFlow).toBe(3400);
    });

    it('should be negative when expenses exceed income', () => {
      const transactionsStore = useTransactionsStore();
      const recurringStore = useRecurringStore();

      transactionsStore.transactions.push(
        createThisMonthTransaction({ id: 'txn-1', type: 'income', amount: 100 }),
        createThisMonthTransaction({ id: 'txn-2', type: 'expense', amount: 500 })
      );

      recurringStore.recurringItems.push(
        createRecurringItem({ id: 'r1', type: 'income', amount: 1000 }),
        createRecurringItem({ id: 'r2', type: 'expense', amount: 3000 })
      );

      const monthlyIncome =
        transactionsStore.thisMonthOneTimeIncome + recurringStore.totalMonthlyRecurringIncome;
      const monthlyExpenses =
        transactionsStore.thisMonthOneTimeExpenses + recurringStore.totalMonthlyRecurringExpenses;
      const netCashFlow = monthlyIncome - monthlyExpenses;

      // Income: 100 + 1000 = 1100
      // Expenses: 500 + 3000 = 3500
      // Net: 1100 - 3500 = -2400
      expect(netCashFlow).toBe(-2400);
    });
  });

  describe('Inactive recurring items', () => {
    it('should not include inactive recurring items in totals', () => {
      const _transactionsStore = useTransactionsStore();
      const recurringStore = useRecurringStore();

      // Active recurring income
      recurringStore.recurringItems.push(
        createRecurringItem({ id: 'r1', type: 'income', amount: 5000, isActive: true })
      );

      // Inactive recurring income (should not be counted)
      recurringStore.recurringItems.push(
        createRecurringItem({ id: 'r2', type: 'income', amount: 1000, isActive: false })
      );

      // Only active items should be counted
      expect(recurringStore.totalMonthlyRecurringIncome).toBe(5000);
    });
  });

  describe('Different frequencies', () => {
    it('should normalize daily recurring to monthly', () => {
      const recurringStore = useRecurringStore();

      // Daily income of $10 = $300/month
      recurringStore.recurringItems.push(
        createRecurringItem({ id: 'r1', type: 'income', amount: 10, frequency: 'daily' })
      );

      expect(recurringStore.totalMonthlyRecurringIncome).toBe(300);
    });

    it('should normalize yearly recurring to monthly', () => {
      const recurringStore = useRecurringStore();

      // Yearly income of $12000 = $1000/month
      recurringStore.recurringItems.push(
        createRecurringItem({ id: 'r1', type: 'income', amount: 12000, frequency: 'yearly' })
      );

      expect(recurringStore.totalMonthlyRecurringIncome).toBe(1000);
    });

    it('should handle mixed frequencies correctly', () => {
      const recurringStore = useRecurringStore();

      recurringStore.recurringItems.push(
        // Daily: $5 * 30 = $150/month
        createRecurringItem({ id: 'r1', type: 'income', amount: 5, frequency: 'daily' }),
        // Monthly: $1000/month
        createRecurringItem({ id: 'r2', type: 'income', amount: 1000, frequency: 'monthly' }),
        // Yearly: $2400 / 12 = $200/month
        createRecurringItem({ id: 'r3', type: 'income', amount: 2400, frequency: 'yearly' })
      );

      // Total: 150 + 1000 + 200 = 1350
      expect(recurringStore.totalMonthlyRecurringIncome).toBe(1350);
    });
  });
});
