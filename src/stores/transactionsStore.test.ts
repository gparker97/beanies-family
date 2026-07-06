import { setActivePinia, createPinia } from 'pinia';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useAccountsStore } from './accountsStore';
import { useAssetsStore } from './assetsStore';
import { useGoalsStore } from './goalsStore';
import { useTransactionsStore } from './transactionsStore';
import type { Transaction, Account, Asset, Goal } from '@/types/models';

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

// Mock the asset repository
vi.mock('@/services/automerge/repositories/assetRepository', () => ({
  getAllAssets: vi.fn().mockResolvedValue([]),
  getAssetById: vi.fn(),
  createAsset: vi.fn(),
  updateAsset: vi.fn(),
  deleteAsset: vi.fn(),
}));

// Mock linkedRecurringItem (imported by assetsStore)
vi.mock('@/utils/linkedRecurringItem', () => ({
  syncEntityLinkedRecurringItem: vi.fn().mockResolvedValue(undefined),
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

// Mock the worker docClient — the store atomic methods route through `mutate`
// (the worker/inline op RPC) instead of the repos for balance cascades.
vi.mock('@/services/automerge/worker/docClient', () => ({ mutate: vi.fn() }));

import * as transactionRepo from '@/services/automerge/repositories/transactionRepository';
import * as assetRepo from '@/services/automerge/repositories/assetRepository';
import { mutate } from '@/services/automerge/worker/docClient';

/**
 * Centralized smart `mutate` mock. Reads the seeded store state and returns the
 * echoed entity exactly as the real worker op would, so the store atomic methods
 * (`incrementBalance` / `applyContribution` / `applyLoanPayment` /
 * `reverseLoanPayment`) complete and surgically update their local refs. Call
 * from each describe's `beforeEach` (after `clearAllMocks`).
 */
function setupMutateMock(): void {
  vi.mocked(mutate).mockImplementation(async (op: any) => {
    const accountsStore = useAccountsStore();
    const goalsStore = useGoalsStore();
    const assetsStore = useAssetsStore();

    // Atomic relative balance adjustment.
    if (op.op === 'increment' && op.collection === 'accounts') {
      const a = accountsStore.accounts.find((x) => x.id === op.id)!;
      return { ...a, [op.field]: (a as any)[op.field] + op.delta } as any;
    }

    // Atomic relative goal contribution (clamp at 0 + auto-complete).
    if (op.op === 'named' && op.name === 'applyGoalContribution') {
      const g = goalsStore.goals.find((x) => x.id === op.args.id)!;
      const currentAmount = Math.max(0, g.currentAmount + op.args.delta);
      return { ...g, currentAmount, isCompleted: currentAmount >= g.targetAmount } as any;
    }

    // Loan payment: fold the loan host (asset loan.outstandingBalance OR
    // standalone loan account balance) downward by a principal portion. Exact
    // amortization lives in the worker docOps unit suite; here we only need a
    // plausible echoed host + split so the cascade wiring can be asserted.
    if (op.op === 'named' && op.name === 'applyLoanPayment') {
      const { loanId, paymentAmount, isRecurring } = op.args;
      const asset = assetsStore.assets.find((x) => x.id === loanId);
      if (asset?.loan) {
        const outstanding = asset.loan.outstandingBalance ?? 0;
        if (outstanding <= 0) return { applied: false } as any;
        const interestPortion = isRecurring ? Math.min(outstanding, paymentAmount * 0.5) : 0;
        const principalPortion = isRecurring ? paymentAmount - interestPortion : paymentAmount;
        const host = {
          ...asset,
          loan: { ...asset.loan, outstandingBalance: Math.max(0, outstanding - principalPortion) },
        };
        return {
          applied: true,
          hostCollection: 'assets',
          host,
          interestPortion,
          principalPortion,
        } as any;
      }
      const account = accountsStore.accounts.find((x) => x.id === loanId);
      if (account) {
        const outstanding = account.balance;
        if (outstanding <= 0) return { applied: false } as any;
        const interestPortion = isRecurring ? Math.min(outstanding, paymentAmount * 0.5) : 0;
        const principalPortion = isRecurring ? paymentAmount - interestPortion : paymentAmount;
        const host = { ...account, balance: Math.max(0, outstanding - principalPortion) };
        return {
          applied: true,
          hostCollection: 'accounts',
          host,
          interestPortion,
          principalPortion,
        } as any;
      }
      return { applied: false } as any;
    }

    // Reverse loan payment: fold the loan host upward by the restored principal.
    if (op.op === 'named' && op.name === 'reverseLoanPayment') {
      const { loanId, principalToRestore } = op.args;
      const asset = assetsStore.assets.find((x) => x.id === loanId);
      if (asset?.loan) {
        const host = {
          ...asset,
          loan: {
            ...asset.loan,
            outstandingBalance: (asset.loan.outstandingBalance ?? 0) + principalToRestore,
          },
        };
        return { applied: true, hostCollection: 'assets', host } as any;
      }
      const account = accountsStore.accounts.find((x) => x.id === loanId);
      if (account) {
        return {
          applied: true,
          hostCollection: 'accounts',
          host: { ...account, balance: account.balance + principalToRestore },
        } as any;
      }
      return { applied: false } as any;
    }

    return undefined as any;
  });
}

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
    setupMutateMock();
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

      // Assert: expense of 100 on a 1000 balance → 900 (via atomic increment)
      expect(result).not.toBeNull();
      expect(accountsStore.getAccountById('test-account-1')!.balance).toBe(900);
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

      // Assert: income of 500 on a 1000 balance → 1500
      expect(result).not.toBeNull();
      expect(accountsStore.getAccountById('test-account-1')!.balance).toBe(1500);
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

      // Assert: transfer of 200 → source 1000-200=800, dest 5000+200=5200
      expect(result).not.toBeNull();
      expect(accountsStore.getAccountById('test-account-1')!.balance).toBe(800);
      expect(accountsStore.getAccountById('test-account-2')!.balance).toBe(5200);
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

      // Act
      const result = await transactionsStore.deleteTransaction('test-transaction-1');

      // Assert: deleting expense of 100 restores 900 → 1000
      expect(result).toBe(true);
      expect(accountsStore.getAccountById('test-account-1')!.balance).toBe(1000);
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

      // Act
      const result = await transactionsStore.deleteTransaction('income-tx-1');

      // Assert: deleting income of 500 reverses 1500 → 1000
      expect(result).toBe(true);
      expect(accountsStore.getAccountById('test-account-1')!.balance).toBe(1000);
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

      // Act
      const result = await transactionsStore.deleteTransaction('transfer-tx-1');

      // Assert: deleting transfer restores source 800→1000, dest 5200→5000
      expect(result).toBe(true);
      expect(accountsStore.getAccountById('test-account-1')!.balance).toBe(1000);
      expect(accountsStore.getAccountById('test-account-2')!.balance).toBe(5000);
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

      // Act
      const result = await transactionsStore.updateTransaction('test-transaction-1', {
        amount: 150,
      });

      // Assert: reverse old expense (+100 → 1000), apply new expense (-150 → 850)
      expect(result).not.toBeNull();
      expect(accountsStore.getAccountById('test-account-1')!.balance).toBe(850);
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

      // Act
      const result = await transactionsStore.updateTransaction('test-transaction-1', {
        type: 'income',
      });

      // Assert: reverse old expense (+100 → 1000), apply new income (+100 → 1100)
      expect(result).not.toBeNull();
      expect(accountsStore.getAccountById('test-account-1')!.balance).toBe(1100);
    });
  });
});

describe('transactionsStore - Summary Card Calculations', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    setupMutateMock();
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

      await store.deleteTransactionsByRecurringItemId('recurring-1');

      // Balance should be reversed: expense of 500 reversed = +500 → 1000 + 500 = 1500
      expect(accountsStore.getAccountById('test-account-1')!.balance).toBe(1500);
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

describe('transactionsStore - Goal Allocation Sync', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    setupMutateMock();
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

    await transactionsStore.deleteTransactionsByRecurringItemId('recurring-1');

    // 400 - 200 - 200 = 0
    expect(goalsStore.goals[0]!.currentAmount).toBe(0);
  });
});

// --- Loan Balance Reduction ---

const mockAssetWithLoan: Asset = {
  id: 'asset-loan-1',
  memberId: 'member-1',
  type: 'real_estate',
  name: 'Test House',
  purchaseValue: 300000,
  currentValue: 320000,
  currency: 'USD',
  includeInNetWorth: true,
  loan: {
    hasLoan: true,
    loanAmount: 250000,
    outstandingBalance: 200000,
    interestRate: 6,
    monthlyPayment: 1500,
    loanTermMonths: 360,
    lender: 'Test Bank',
  },
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
};

const mockLoanAccount: Account = {
  id: 'loan-account-1',
  memberId: 'member-1',
  name: 'Car Loan',
  type: 'loan',
  currency: 'USD',
  balance: 15000, // outstanding balance for standalone loan accounts
  institution: 'Test Credit Union',
  isActive: true,
  includeInNetWorth: true,
  interestRate: 5,
  monthlyPayment: 400,
  loanTermMonths: 48,
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
};

describe('transactionsStore - Loan Balance Reduction', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    setupMutateMock();
  });

  it('should apply amortization and reduce asset loan balance when creating expense with loanId', async () => {
    const transactionsStore = useTransactionsStore();
    const accountsStore = useAccountsStore();
    const assetsStore = useAssetsStore();

    // Setup: source account for the payment + asset with loan
    accountsStore.accounts.push({ ...mockAccount });
    assetsStore.assets.push({ ...mockAssetWithLoan, loan: { ...mockAssetWithLoan.loan! } });

    // The created transaction (from repo)
    const loanTx: Transaction = {
      ...mockTransaction,
      id: 'loan-tx-1',
      type: 'expense',
      amount: 1500,
      category: 'loan_payment',
      loanId: 'asset-loan-1',
      recurringItemId: 'recurring-loan-1', // recurring → standard amortization
    };
    vi.mocked(transactionRepo.createTransaction).mockResolvedValue(loanTx);

    // applyLoanPayment calls transactionRepo.updateTransaction to store amortization fields
    vi.mocked(transactionRepo.updateTransaction).mockResolvedValue({
      ...loanTx,
      loanInterestPortion: 1000,
      loanPrincipalPortion: 500,
    });

    await transactionsStore.createTransaction({
      accountId: 'test-account-1',
      type: 'expense',
      amount: 1500,
      currency: 'USD',
      category: 'loan_payment',
      date: '2024-01-15T00:00:00.000Z',
      description: 'Mortgage Payment',
      isReconciled: false,
      loanId: 'asset-loan-1',
      recurringItemId: 'recurring-loan-1',
    });

    // Verify amortization fields were stored on the transaction
    expect(transactionRepo.updateTransaction).toHaveBeenCalledWith('loan-tx-1', {
      loanInterestPortion: expect.any(Number),
      loanPrincipalPortion: expect.any(Number),
    });

    // Verify the atomic loan op ran with the right args…
    expect(mutate).toHaveBeenCalledWith(
      expect.objectContaining({
        op: 'named',
        name: 'applyLoanPayment',
        args: expect.objectContaining({ loanId: 'asset-loan-1', isRecurring: true }),
      })
    );
    // …and the echoed host folded into the store reduced the loan balance.
    expect(assetsStore.getAssetById('asset-loan-1')!.loan!.outstandingBalance!).toBeLessThan(
      200000
    );
  });

  it('should reduce standalone loan account balance when creating expense with loanId', async () => {
    const transactionsStore = useTransactionsStore();
    const accountsStore = useAccountsStore();

    // Setup: source account + standalone loan account
    accountsStore.accounts.push({ ...mockAccount });
    accountsStore.accounts.push({ ...mockLoanAccount });

    const loanTx: Transaction = {
      ...mockTransaction,
      id: 'loan-tx-2',
      type: 'expense',
      amount: 400,
      category: 'loan_payment',
      loanId: 'loan-account-1',
      recurringItemId: 'recurring-car-loan', // recurring → standard amortization
    };
    vi.mocked(transactionRepo.createTransaction).mockResolvedValue(loanTx);

    // applyLoanPayment stores amortization fields
    vi.mocked(transactionRepo.updateTransaction).mockResolvedValue({
      ...loanTx,
      loanInterestPortion: 62.5,
      loanPrincipalPortion: 337.5,
    });

    await transactionsStore.createTransaction({
      accountId: 'test-account-1',
      type: 'expense',
      amount: 400,
      currency: 'USD',
      category: 'loan_payment',
      date: '2024-01-15T00:00:00.000Z',
      description: 'Car Loan Payment',
      isReconciled: false,
      loanId: 'loan-account-1',
      recurringItemId: 'recurring-car-loan',
    });

    // Verify amortization fields were stored
    expect(transactionRepo.updateTransaction).toHaveBeenCalledWith('loan-tx-2', {
      loanInterestPortion: expect.any(Number),
      loanPrincipalPortion: expect.any(Number),
    });

    // Verify the atomic loan op ran and the echoed host reduced the loan balance
    expect(mutate).toHaveBeenCalledWith(
      expect.objectContaining({
        op: 'named',
        name: 'applyLoanPayment',
        args: expect.objectContaining({ loanId: 'loan-account-1', isRecurring: true }),
      })
    );
    expect(accountsStore.getAccountById('loan-account-1')!.balance).toBeLessThan(15000);
  });

  it('should restore loan balance when deleting a loan-linked transaction', async () => {
    const transactionsStore = useTransactionsStore();
    const accountsStore = useAccountsStore();

    // Setup: loan account with reduced balance after a payment was applied
    const reducedLoanAccount = { ...mockLoanAccount, balance: 14662.5 };
    accountsStore.accounts.push({ ...mockAccount, balance: 600 });
    accountsStore.accounts.push(reducedLoanAccount);

    // The existing transaction to delete (has principal portion stored)
    const existingTx: Transaction = {
      ...mockTransaction,
      id: 'loan-tx-del',
      type: 'expense',
      amount: 400,
      category: 'loan_payment',
      loanId: 'loan-account-1',
      loanInterestPortion: 62.5,
      loanPrincipalPortion: 337.5,
      recurringItemId: 'recurring-car-loan',
    };
    transactionsStore.transactions.push(existingTx);

    vi.mocked(transactionRepo.deleteTransaction).mockResolvedValue(true);

    const result = await transactionsStore.deleteTransaction('loan-tx-del');

    expect(result).toBe(true);
    // Verify the atomic reverse op ran with the stored principal…
    expect(mutate).toHaveBeenCalledWith(
      expect.objectContaining({
        op: 'named',
        name: 'reverseLoanPayment',
        args: expect.objectContaining({ loanId: 'loan-account-1', principalToRestore: 337.5 }),
      })
    );
    // …and the echoed host restored the loan balance upward (principal added back).
    expect(accountsStore.getAccountById('loan-account-1')!.balance).toBeGreaterThan(14662.5);
  });

  it('should use extra payment calculation for one-time payment (no recurringItemId)', async () => {
    const transactionsStore = useTransactionsStore();
    const accountsStore = useAccountsStore();

    // Setup: source account + standalone loan account
    accountsStore.accounts.push({ ...mockAccount });
    accountsStore.accounts.push({ ...mockLoanAccount });

    // One-time transaction (no recurringItemId) → calculateExtraPayment
    const extraTx: Transaction = {
      ...mockTransaction,
      id: 'extra-tx-1',
      type: 'expense',
      amount: 1000,
      category: 'loan_payment',
      loanId: 'loan-account-1',
      // No recurringItemId — this is an extra payment
    };
    vi.mocked(transactionRepo.createTransaction).mockResolvedValue(extraTx);

    // Extra payment: full amount goes to principal, no interest
    vi.mocked(transactionRepo.updateTransaction).mockResolvedValue({
      ...extraTx,
      loanInterestPortion: 0,
      loanPrincipalPortion: 1000,
    });

    await transactionsStore.createTransaction({
      accountId: 'test-account-1',
      type: 'expense',
      amount: 1000,
      currency: 'USD',
      category: 'loan_payment',
      date: '2024-01-15T00:00:00.000Z',
      description: 'Extra Car Loan Payment',
      isReconciled: false,
      loanId: 'loan-account-1',
    });

    // Verify the transaction was updated with extra payment (0 interest, full principal)
    expect(transactionRepo.updateTransaction).toHaveBeenCalledWith('extra-tx-1', {
      loanInterestPortion: 0,
      loanPrincipalPortion: 1000,
    });
  });

  it('should not attempt balance reduction when loan has zero outstanding balance', async () => {
    const transactionsStore = useTransactionsStore();
    const accountsStore = useAccountsStore();

    // Setup: source account + loan account with zero balance (paid off)
    accountsStore.accounts.push({ ...mockAccount });
    const paidOffLoan = { ...mockLoanAccount, balance: 0 };
    accountsStore.accounts.push(paidOffLoan);

    const loanTx: Transaction = {
      ...mockTransaction,
      id: 'zero-loan-tx-1',
      type: 'expense',
      amount: 400,
      category: 'loan_payment',
      loanId: 'loan-account-1',
      recurringItemId: 'recurring-car-loan',
    };
    vi.mocked(transactionRepo.createTransaction).mockResolvedValue(loanTx);

    await transactionsStore.createTransaction({
      accountId: 'test-account-1',
      type: 'expense',
      amount: 400,
      currency: 'USD',
      category: 'loan_payment',
      date: '2024-01-15T00:00:00.000Z',
      description: 'Car Loan Payment',
      isReconciled: false,
      loanId: 'loan-account-1',
      recurringItemId: 'recurring-car-loan',
    });

    // transactionRepo.updateTransaction should NOT be called for loan fields
    // because the loan has zero balance — the atomic op returns applied:false
    expect(transactionRepo.updateTransaction).not.toHaveBeenCalled();
  });
});

// --- Activity Linking ---

describe('transactionsStore - Activity Linking', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    setupMutateMock();
  });

  it('should store activityId when creating a transaction with activityId', async () => {
    const transactionsStore = useTransactionsStore();
    const accountsStore = useAccountsStore();

    accountsStore.accounts.push({ ...mockAccount });

    const txWithActivity: Transaction = {
      ...mockTransaction,
      id: 'activity-tx-1',
      activityId: 'activity-swim-1',
    };
    vi.mocked(transactionRepo.createTransaction).mockResolvedValue(txWithActivity);

    const result = await transactionsStore.createTransaction({
      accountId: 'test-account-1',
      type: 'expense',
      amount: 100,
      currency: 'USD',
      category: 'lesson_fees',
      date: '2024-01-15T00:00:00.000Z',
      description: 'Swimming lesson fee',
      isReconciled: false,
      activityId: 'activity-swim-1',
    });

    expect(result).not.toBeNull();
    // Verify the activityId was passed through to the repository
    expect(transactionRepo.createTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        activityId: 'activity-swim-1',
      })
    );
  });

  it('should store activityId when updating a transaction to add activityId', async () => {
    const transactionsStore = useTransactionsStore();
    const accountsStore = useAccountsStore();

    accountsStore.accounts.push({ ...mockAccount });
    transactionsStore.transactions.push({ ...mockTransaction });

    const updatedTx: Transaction = {
      ...mockTransaction,
      activityId: 'activity-piano-1',
    };
    vi.mocked(transactionRepo.updateTransaction).mockResolvedValue(updatedTx);

    const result = await transactionsStore.updateTransaction('test-transaction-1', {
      activityId: 'activity-piano-1',
    });

    expect(result).not.toBeNull();
    expect(transactionRepo.updateTransaction).toHaveBeenCalledWith(
      'test-transaction-1',
      expect.objectContaining({
        activityId: 'activity-piano-1',
      })
    );
  });

  it('should handle updating loanId: restore old loan balance and reduce new loan balance', async () => {
    const transactionsStore = useTransactionsStore();
    const accountsStore = useAccountsStore();

    // Two standalone loan accounts
    const oldLoan: Account = {
      ...mockLoanAccount,
      id: 'old-loan-1',
      name: 'Old Loan',
      balance: 14662.5, // Already reduced by a previous payment
      interestRate: 5,
      monthlyPayment: 400,
    };
    const newLoan: Account = {
      ...mockLoanAccount,
      id: 'new-loan-1',
      name: 'New Loan',
      balance: 20000,
      interestRate: 4,
      monthlyPayment: 500,
    };

    accountsStore.accounts.push({ ...mockAccount });
    accountsStore.accounts.push(oldLoan);
    accountsStore.accounts.push(newLoan);

    // Existing transaction linked to old loan with stored amortization
    const existingTx: Transaction = {
      ...mockTransaction,
      id: 'loan-switch-tx',
      type: 'expense',
      amount: 400,
      category: 'loan_payment',
      loanId: 'old-loan-1',
      loanInterestPortion: 62.5,
      loanPrincipalPortion: 337.5,
      recurringItemId: 'recurring-old-loan',
    };
    transactionsStore.transactions.push(existingTx);

    // The updated transaction returned from repo
    const updatedTx: Transaction = {
      ...existingTx,
      loanId: 'new-loan-1',
    };
    vi.mocked(transactionRepo.updateTransaction).mockResolvedValue(updatedTx);

    await transactionsStore.updateTransaction('loan-switch-tx', {
      loanId: 'new-loan-1',
    });

    // Verify the update was called with the new loanId
    expect(transactionRepo.updateTransaction).toHaveBeenCalledWith(
      'loan-switch-tx',
      expect.objectContaining({
        loanId: 'new-loan-1',
      })
    );
  });

  it('should not change loan balances when deleting a transaction with only activityId', async () => {
    const transactionsStore = useTransactionsStore();
    const accountsStore = useAccountsStore();

    accountsStore.accounts.push({ ...mockAccount });

    // Transaction linked to an activity but NOT a loan
    const activityOnlyTx: Transaction = {
      ...mockTransaction,
      id: 'activity-only-tx',
      type: 'expense',
      amount: 150,
      category: 'lesson_fees',
      activityId: 'activity-dance-1',
      // No loanId, no loanInterestPortion, no loanPrincipalPortion
    };
    transactionsStore.transactions.push(activityOnlyTx);

    vi.mocked(transactionRepo.deleteTransaction).mockResolvedValue(true);

    const result = await transactionsStore.deleteTransaction('activity-only-tx');

    expect(result).toBe(true);
    // Source account balance should be restored (expense of 150 deleted → 1000 + 150)
    expect(accountsStore.getAccountById('test-account-1')!.balance).toBe(1150);
    // No asset update should occur (no loan involved)
    expect(assetRepo.updateAsset).not.toHaveBeenCalled();
    // Only ONE atomic mutation should occur — the source-account increment; no
    // loan op runs (reverseLoanPayment early-returns without a loanId/principal).
    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate).toHaveBeenCalledWith(
      expect.objectContaining({ op: 'increment', collection: 'accounts', id: 'test-account-1' })
    );
  });
});
