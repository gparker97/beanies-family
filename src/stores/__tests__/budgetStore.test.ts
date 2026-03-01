import { setActivePinia, createPinia } from 'pinia';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { toDateInputValue } from '@/utils/date';
import type { Transaction, Budget } from '@/types/models';

// Mock repositories
vi.mock('@/services/indexeddb/repositories/transactionRepository', () => ({
  getAllTransactions: vi.fn(),
  getTransactionById: vi.fn(),
  createTransaction: vi.fn(),
  updateTransaction: vi.fn(),
  deleteTransaction: vi.fn(),
}));

vi.mock('@/services/indexeddb/repositories/accountRepository', () => ({
  getAllAccounts: vi.fn(),
  getAccountById: vi.fn(),
  createAccount: vi.fn(),
  updateAccount: vi.fn(),
  deleteAccount: vi.fn(),
  updateAccountBalance: vi.fn(),
}));

vi.mock('@/services/indexeddb/repositories/budgetRepository', () => ({
  getAllBudgets: vi.fn().mockResolvedValue([]),
  createBudget: vi.fn(),
  updateBudget: vi.fn(),
  deleteBudget: vi.fn(),
}));

vi.mock('@/services/indexeddb/repositories/recurringRepository', () => ({
  getAllRecurringItems: vi.fn().mockResolvedValue([]),
}));

import { useTransactionsStore } from '../transactionsStore';
import { useBudgetStore } from '../budgetStore';

// Helper to create a transaction with YYYY-MM-DD date
function createTransaction(overrides: Partial<Transaction> = {}): Transaction {
  const now = new Date();
  const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-15`;
  return {
    id: `txn-${Math.random().toString(36).slice(2)}`,
    accountId: 'account-1',
    type: 'expense',
    amount: 100,
    currency: 'USD',
    category: 'food',
    date: thisMonth,
    description: 'Test',
    isReconciled: false,
    createdAt: thisMonth,
    updatedAt: thisMonth,
    ...overrides,
  };
}

describe('budgetStore - spending calculations', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  describe('currentMonthSpending', () => {
    it('sums current-month expense transactions', () => {
      const txStore = useTransactionsStore();
      const budgetStore = useBudgetStore();

      txStore.transactions.push(
        createTransaction({ id: 'tx-1', amount: 50, category: 'food' }),
        createTransaction({ id: 'tx-2', amount: 75, category: 'transport' }),
        createTransaction({ id: 'tx-3', amount: 25, category: 'entertainment' })
      );

      // currentMonthSpending delegates to filteredThisMonthExpenses
      expect(budgetStore.currentMonthSpending).toBe(150);
    });

    it('counts transactions with YYYY-MM-DD dates', () => {
      const txStore = useTransactionsStore();
      const budgetStore = useBudgetStore();
      const now = new Date();
      const dateStr = toDateInputValue(now);

      txStore.transactions.push(createTransaction({ id: 'tx-1', amount: 200, date: dateStr }));

      expect(budgetStore.currentMonthSpending).toBe(200);
    });

    it('excludes income transactions from spending', () => {
      const txStore = useTransactionsStore();
      const budgetStore = useBudgetStore();

      txStore.transactions.push(
        createTransaction({ id: 'tx-1', type: 'expense', amount: 100 }),
        createTransaction({ id: 'tx-2', type: 'income', amount: 5000 })
      );

      expect(budgetStore.currentMonthSpending).toBe(100);
    });

    it('excludes previous month transactions', () => {
      const txStore = useTransactionsStore();
      const budgetStore = useBudgetStore();

      const now = new Date();
      const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 15);
      const lastMonthStr = toDateInputValue(lastMonth);

      txStore.transactions.push(
        createTransaction({ id: 'tx-current', amount: 100 }), // current month
        createTransaction({ id: 'tx-old', amount: 500, date: lastMonthStr }) // last month
      );

      expect(budgetStore.currentMonthSpending).toBe(100);
    });
  });

  describe('budgetProgress', () => {
    it('calculates percentage of budget spent', () => {
      const txStore = useTransactionsStore();
      const budgetStore = useBudgetStore();

      // Set up an active budget
      const budget: Budget = {
        id: 'budget-1',
        mode: 'fixed',
        totalAmount: 1000,
        currency: 'USD',
        categories: [],
        isActive: true,
        createdAt: '2026-01-01',
        updatedAt: '2026-01-01',
      };
      budgetStore.budgets.push(budget);

      // Add spending = 500 out of 1000 = 50%
      txStore.transactions.push(
        createTransaction({ id: 'tx-1', amount: 300 }),
        createTransaction({ id: 'tx-2', amount: 200 })
      );

      expect(budgetStore.budgetProgress).toBe(50);
    });

    it('returns 0 when no active budget', () => {
      const budgetStore = useBudgetStore();
      expect(budgetStore.budgetProgress).toBe(0);
    });

    it('caps at 200%', () => {
      const txStore = useTransactionsStore();
      const budgetStore = useBudgetStore();

      budgetStore.budgets.push({
        id: 'budget-1',
        mode: 'fixed',
        totalAmount: 100,
        currency: 'USD',
        categories: [],
        isActive: true,
        createdAt: '2026-01-01',
        updatedAt: '2026-01-01',
      });

      // Spend 300 out of 100 = 300%, should cap at 200
      txStore.transactions.push(createTransaction({ id: 'tx-1', amount: 300 }));

      expect(budgetStore.budgetProgress).toBe(200);
    });
  });

  describe('categoryBudgetStatus', () => {
    it('computes status for each budgeted category', () => {
      const txStore = useTransactionsStore();
      const budgetStore = useBudgetStore();

      budgetStore.budgets.push({
        id: 'budget-1',
        mode: 'fixed',
        totalAmount: 1000,
        currency: 'USD',
        categories: [
          { categoryId: 'food', amount: 200 },
          { categoryId: 'transport', amount: 100 },
        ],
        isActive: true,
        createdAt: '2026-01-01',
        updatedAt: '2026-01-01',
      });

      // food: 180/200 = 90% → warning
      txStore.transactions.push(createTransaction({ id: 'tx-1', amount: 180, category: 'food' }));
      // transport: 110/100 = 110% → over
      txStore.transactions.push(
        createTransaction({ id: 'tx-2', amount: 110, category: 'transport' })
      );

      const statuses = budgetStore.categoryBudgetStatus;
      expect(statuses).toHaveLength(2);

      const transport = statuses.find((s) => s.categoryId === 'transport');
      expect(transport?.status).toBe('over');
      expect(transport?.percentUsed).toBe(110);

      const food = statuses.find((s) => s.categoryId === 'food');
      expect(food?.status).toBe('warning');
      expect(food?.percentUsed).toBe(90);
    });

    it('returns ok status when under 75%', () => {
      const txStore = useTransactionsStore();
      const budgetStore = useBudgetStore();

      budgetStore.budgets.push({
        id: 'budget-1',
        mode: 'fixed',
        totalAmount: 1000,
        currency: 'USD',
        categories: [{ categoryId: 'food', amount: 400 }],
        isActive: true,
        createdAt: '2026-01-01',
        updatedAt: '2026-01-01',
      });

      // food: 100/400 = 25% → ok
      txStore.transactions.push(createTransaction({ id: 'tx-1', amount: 100, category: 'food' }));

      const statuses = budgetStore.categoryBudgetStatus;
      expect(statuses[0]?.status).toBe('ok');
    });

    it('returns empty array when no active budget', () => {
      const budgetStore = useBudgetStore();
      expect(budgetStore.categoryBudgetStatus).toEqual([]);
    });
  });
});
