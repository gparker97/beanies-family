import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { processRecurringItems } from './recurringProcessor';
import type { RecurringItem, Account, Asset } from '@/types/models';

// Mock the repositories
vi.mock('@/services/automerge/repositories/recurringItemRepository', () => ({
  getActiveRecurringItems: vi.fn(),
  updateRecurringItem: vi.fn(),
  updateLastProcessedDate: vi.fn(),
}));

vi.mock('@/services/automerge/repositories/transactionRepository', () => ({
  getAllTransactions: vi.fn().mockResolvedValue([]),
  createTransaction: vi.fn(),
}));

vi.mock('@/services/automerge/repositories/accountRepository', () => ({
  getAccountById: vi.fn(),
  getAllAccounts: vi.fn().mockResolvedValue([]),
  updateAccountBalance: vi.fn(),
}));

vi.mock('@/services/automerge/repositories/assetRepository', () => ({
  getAllAssets: vi.fn().mockResolvedValue([]),
  updateAsset: vi.fn(),
}));

vi.mock('@/services/automerge/repositories/goalRepository', () => ({
  getGoalById: vi.fn(),
  updateGoalProgress: vi.fn(),
}));

import * as recurringRepo from '@/services/automerge/repositories/recurringItemRepository';
import * as transactionRepo from '@/services/automerge/repositories/transactionRepository';
import * as accountRepo from '@/services/automerge/repositories/accountRepository';
import * as assetRepo from '@/services/automerge/repositories/assetRepository';
import * as goalRepo from '@/services/automerge/repositories/goalRepository';

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

describe('recurringProcessor - Account Balance Sync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should decrease account balance when processing a recurring expense', async () => {
    // Set current date
    vi.setSystemTime(new Date('2024-01-15T12:00:00.000Z'));

    const recurringExpense: RecurringItem = {
      id: 'recurring-1',
      accountId: 'test-account-1',
      type: 'expense',
      amount: 50,
      currency: 'USD',
      category: 'subscription',
      description: 'Netflix',
      frequency: 'monthly',
      dayOfMonth: 15,
      startDate: '2024-01-01T00:00:00.000Z',
      isActive: true,
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    };

    vi.mocked(recurringRepo.getActiveRecurringItems).mockResolvedValue([recurringExpense]);
    vi.mocked(transactionRepo.createTransaction).mockResolvedValue({
      id: 'tx-1',
      accountId: 'test-account-1',
      type: 'expense',
      amount: 50,
      currency: 'USD',
      category: 'subscription',
      date: '2024-01-15T00:00:00.000Z',
      description: 'Netflix',
      isReconciled: false,
      recurringItemId: 'recurring-1',
      createdAt: '2024-01-15T00:00:00.000Z',
      updatedAt: '2024-01-15T00:00:00.000Z',
    });
    vi.mocked(accountRepo.getAccountById).mockResolvedValue({ ...mockAccount });
    vi.mocked(accountRepo.updateAccountBalance).mockResolvedValue({ ...mockAccount, balance: 950 });
    vi.mocked(recurringRepo.updateLastProcessedDate).mockResolvedValue(undefined);

    // Act
    const result = await processRecurringItems();

    // Assert
    expect(result.processed).toBe(1);
    expect(accountRepo.getAccountById).toHaveBeenCalledWith('test-account-1');
    expect(accountRepo.updateAccountBalance).toHaveBeenCalledWith('test-account-1', 950);
  });

  it('should increase account balance when processing a recurring income', async () => {
    // Set current date
    vi.setSystemTime(new Date('2024-01-15T12:00:00.000Z'));

    const recurringIncome: RecurringItem = {
      id: 'recurring-2',
      accountId: 'test-account-1',
      type: 'income',
      amount: 3000,
      currency: 'USD',
      category: 'salary',
      description: 'Monthly Salary',
      frequency: 'monthly',
      dayOfMonth: 15,
      startDate: '2024-01-01T00:00:00.000Z',
      isActive: true,
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    };

    vi.mocked(recurringRepo.getActiveRecurringItems).mockResolvedValue([recurringIncome]);
    vi.mocked(transactionRepo.createTransaction).mockResolvedValue({
      id: 'tx-2',
      accountId: 'test-account-1',
      type: 'income',
      amount: 3000,
      currency: 'USD',
      category: 'salary',
      date: '2024-01-15T00:00:00.000Z',
      description: 'Monthly Salary',
      isReconciled: false,
      recurringItemId: 'recurring-2',
      createdAt: '2024-01-15T00:00:00.000Z',
      updatedAt: '2024-01-15T00:00:00.000Z',
    });
    vi.mocked(accountRepo.getAccountById).mockResolvedValue({ ...mockAccount });
    vi.mocked(accountRepo.updateAccountBalance).mockResolvedValue({
      ...mockAccount,
      balance: 4000,
    });
    vi.mocked(recurringRepo.updateLastProcessedDate).mockResolvedValue(undefined);

    // Act
    const result = await processRecurringItems();

    // Assert
    expect(result.processed).toBe(1);
    expect(accountRepo.updateAccountBalance).toHaveBeenCalledWith('test-account-1', 4000);
  });

  it('should process multiple recurring items and update balances correctly', async () => {
    // Set current date
    vi.setSystemTime(new Date('2024-01-15T12:00:00.000Z'));

    const recurringItems: RecurringItem[] = [
      {
        id: 'recurring-1',
        accountId: 'test-account-1',
        type: 'income',
        amount: 3000,
        currency: 'USD',
        category: 'salary',
        description: 'Monthly Salary',
        frequency: 'monthly',
        dayOfMonth: 15,
        startDate: '2024-01-01T00:00:00.000Z',
        isActive: true,
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      },
      {
        id: 'recurring-2',
        accountId: 'test-account-1',
        type: 'expense',
        amount: 100,
        currency: 'USD',
        category: 'utilities',
        description: 'Electric Bill',
        frequency: 'monthly',
        dayOfMonth: 15,
        startDate: '2024-01-01T00:00:00.000Z',
        isActive: true,
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      },
    ];

    vi.mocked(recurringRepo.getActiveRecurringItems).mockResolvedValue(recurringItems);
    vi.mocked(transactionRepo.createTransaction).mockResolvedValue({} as any);
    vi.mocked(accountRepo.getAccountById)
      .mockResolvedValueOnce({ ...mockAccount, balance: 1000 })
      .mockResolvedValueOnce({ ...mockAccount, balance: 4000 }); // After income
    vi.mocked(accountRepo.updateAccountBalance)
      .mockResolvedValueOnce({ ...mockAccount, balance: 4000 })
      .mockResolvedValueOnce({ ...mockAccount, balance: 3900 });
    vi.mocked(recurringRepo.updateLastProcessedDate).mockResolvedValue(undefined);

    // Act
    const result = await processRecurringItems();

    // Assert
    expect(result.processed).toBe(2);
    expect(accountRepo.updateAccountBalance).toHaveBeenCalledTimes(2);
  });
});

describe('recurringProcessor - Goal Allocation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should apply goal allocation when processing recurring income', async () => {
    vi.setSystemTime(new Date('2024-01-15T12:00:00.000Z'));

    const recurringIncome: RecurringItem = {
      id: 'recurring-goal-1',
      accountId: 'test-account-1',
      type: 'income',
      amount: 1000,
      currency: 'USD',
      category: 'salary',
      description: 'Monthly Salary',
      frequency: 'monthly',
      dayOfMonth: 15,
      startDate: '2024-01-01T00:00:00.000Z',
      isActive: true,
      goalId: 'goal-1',
      goalAllocMode: 'percentage',
      goalAllocValue: 20,
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    };

    vi.mocked(recurringRepo.getActiveRecurringItems).mockResolvedValue([recurringIncome]);
    vi.mocked(transactionRepo.createTransaction).mockResolvedValue({} as any);
    vi.mocked(accountRepo.getAccountById).mockResolvedValue({ ...mockAccount });
    vi.mocked(accountRepo.updateAccountBalance).mockResolvedValue({
      ...mockAccount,
      balance: 2000,
    });
    vi.mocked(recurringRepo.updateLastProcessedDate).mockResolvedValue(undefined);
    vi.mocked(goalRepo.getGoalById).mockResolvedValue({
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
    });
    vi.mocked(goalRepo.updateGoalProgress).mockResolvedValue(undefined as any);

    const result = await processRecurringItems();

    expect(result.processed).toBe(1);
    // Transaction should include goal allocation fields
    expect(transactionRepo.createTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        goalId: 'goal-1',
        goalAllocMode: 'percentage',
        goalAllocValue: 20,
        goalAllocApplied: 200, // 20% of 1000
      })
    );
    // Goal progress should be updated
    expect(goalRepo.updateGoalProgress).toHaveBeenCalledWith('goal-1', 200);
  });

  it('should cap goal allocation to remaining amount', async () => {
    vi.setSystemTime(new Date('2024-01-15T12:00:00.000Z'));

    const recurringIncome: RecurringItem = {
      id: 'recurring-goal-2',
      accountId: 'test-account-1',
      type: 'income',
      amount: 1000,
      currency: 'USD',
      category: 'salary',
      description: 'Monthly Salary',
      frequency: 'monthly',
      dayOfMonth: 15,
      startDate: '2024-01-01T00:00:00.000Z',
      isActive: true,
      goalId: 'goal-1',
      goalAllocMode: 'percentage',
      goalAllocValue: 50, // 50% = $500
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    };

    vi.mocked(recurringRepo.getActiveRecurringItems).mockResolvedValue([recurringIncome]);
    vi.mocked(transactionRepo.createTransaction).mockResolvedValue({} as any);
    vi.mocked(accountRepo.getAccountById).mockResolvedValue({ ...mockAccount });
    vi.mocked(accountRepo.updateAccountBalance).mockResolvedValue({
      ...mockAccount,
      balance: 2000,
    });
    vi.mocked(recurringRepo.updateLastProcessedDate).mockResolvedValue(undefined);
    vi.mocked(goalRepo.getGoalById).mockResolvedValue({
      id: 'goal-1',
      name: 'Buy a Car',
      type: 'savings',
      targetAmount: 10000,
      currentAmount: 9900, // Only $100 remaining
      currency: 'USD',
      priority: 'high',
      isCompleted: false,
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    });
    vi.mocked(goalRepo.updateGoalProgress).mockResolvedValue(undefined as any);

    await processRecurringItems();

    // Should cap at $100 (remaining), not $500 (50% of 1000)
    expect(transactionRepo.createTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        goalAllocApplied: 100,
      })
    );
    expect(goalRepo.updateGoalProgress).toHaveBeenCalledWith('goal-1', 10000);
  });

  it('should skip allocation for completed goals', async () => {
    vi.setSystemTime(new Date('2024-01-15T12:00:00.000Z'));

    const recurringIncome: RecurringItem = {
      id: 'recurring-goal-3',
      accountId: 'test-account-1',
      type: 'income',
      amount: 1000,
      currency: 'USD',
      category: 'salary',
      description: 'Monthly Salary',
      frequency: 'monthly',
      dayOfMonth: 15,
      startDate: '2024-01-01T00:00:00.000Z',
      isActive: true,
      goalId: 'goal-1',
      goalAllocMode: 'percentage',
      goalAllocValue: 20,
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    };

    vi.mocked(recurringRepo.getActiveRecurringItems).mockResolvedValue([recurringIncome]);
    vi.mocked(transactionRepo.createTransaction).mockResolvedValue({} as any);
    vi.mocked(accountRepo.getAccountById).mockResolvedValue({ ...mockAccount });
    vi.mocked(accountRepo.updateAccountBalance).mockResolvedValue({
      ...mockAccount,
      balance: 2000,
    });
    vi.mocked(recurringRepo.updateLastProcessedDate).mockResolvedValue(undefined);
    vi.mocked(goalRepo.getGoalById).mockResolvedValue({
      id: 'goal-1',
      name: 'Buy a Car',
      type: 'savings',
      targetAmount: 10000,
      currentAmount: 10000,
      currency: 'USD',
      priority: 'high',
      isCompleted: true, // Goal already completed
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    });

    await processRecurringItems();

    // Transaction should NOT include goal allocation
    expect(transactionRepo.createTransaction).toHaveBeenCalledWith(
      expect.not.objectContaining({
        goalAllocApplied: expect.any(Number),
      })
    );
    // Goal progress should NOT be updated
    expect(goalRepo.updateGoalProgress).not.toHaveBeenCalled();
  });
});

// --- Loan Payment Generation ---

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

const mockLinkedLoanAccount: Account = {
  id: 'linked-loan-account-1',
  memberId: 'member-1',
  name: 'Test House Loan',
  type: 'loan',
  currency: 'USD',
  balance: 200000,
  institution: 'Test Bank',
  isActive: true,
  includeInNetWorth: true,
  linkedAssetId: 'asset-loan-1',
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
};

const mockStandaloneLoanAccount: Account = {
  id: 'standalone-loan-1',
  memberId: 'member-1',
  name: 'Car Loan',
  type: 'loan',
  currency: 'USD',
  balance: 15000,
  institution: 'Test Credit Union',
  isActive: true,
  includeInNetWorth: true,
  interestRate: 5,
  monthlyPayment: 400,
  loanTermMonths: 48,
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
};

describe('recurringProcessor - Loan Payment Generation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should apply amortization to asset-linked recurring loan payment', async () => {
    vi.setSystemTime(new Date('2024-01-15T12:00:00.000Z'));

    const recurringLoanPayment: RecurringItem = {
      id: 'recurring-mortgage-1',
      accountId: 'test-account-1',
      type: 'expense',
      amount: 1500,
      currency: 'USD',
      category: 'loan_payment',
      description: 'Mortgage Payment',
      frequency: 'monthly',
      dayOfMonth: 15,
      startDate: '2024-01-01T00:00:00.000Z',
      isActive: true,
      loanId: 'asset-loan-1',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    };

    vi.mocked(recurringRepo.getActiveRecurringItems).mockResolvedValue([recurringLoanPayment]);
    vi.mocked(assetRepo.getAllAssets).mockResolvedValue([{ ...mockAssetWithLoan }]);
    vi.mocked(accountRepo.getAllAccounts).mockResolvedValue([
      { ...mockAccount },
      { ...mockLinkedLoanAccount },
    ]);
    vi.mocked(transactionRepo.createTransaction).mockResolvedValue({} as any);
    vi.mocked(accountRepo.getAccountById).mockResolvedValue({ ...mockAccount });
    vi.mocked(accountRepo.updateAccountBalance).mockResolvedValue({} as any);
    vi.mocked(assetRepo.updateAsset).mockResolvedValue({} as any);
    vi.mocked(recurringRepo.updateLastProcessedDate).mockResolvedValue(undefined);

    const result = await processRecurringItems();

    expect(result.processed).toBe(1);

    // Transaction should include amortization fields
    expect(transactionRepo.createTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        loanId: 'asset-loan-1',
        loanInterestPortion: expect.any(Number),
        loanPrincipalPortion: expect.any(Number),
      })
    );

    // Verify the interest/principal split makes sense (6% on 200k = 1000/mo interest)
    const txInput = vi.mocked(transactionRepo.createTransaction).mock.calls[0]![0];
    expect(txInput.loanInterestPortion).toBe(1000); // 200000 * 0.06 / 12
    expect(txInput.loanPrincipalPortion).toBe(500); // 1500 - 1000

    // Asset loan balance should be reduced
    expect(assetRepo.updateAsset).toHaveBeenCalledWith(
      'asset-loan-1',
      expect.objectContaining({
        loan: expect.objectContaining({
          outstandingBalance: 199500, // 200000 - 500
        }),
      })
    );

    // Linked loan account should be synced
    expect(accountRepo.updateAccountBalance).toHaveBeenCalledWith('linked-loan-account-1', 199500);
  });

  it('should reduce standalone loan account balance for recurring payment', async () => {
    vi.setSystemTime(new Date('2024-01-15T12:00:00.000Z'));

    const recurringCarPayment: RecurringItem = {
      id: 'recurring-car-1',
      accountId: 'test-account-1',
      type: 'expense',
      amount: 400,
      currency: 'USD',
      category: 'loan_payment',
      description: 'Car Loan Payment',
      frequency: 'monthly',
      dayOfMonth: 15,
      startDate: '2024-01-01T00:00:00.000Z',
      isActive: true,
      loanId: 'standalone-loan-1',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    };

    vi.mocked(recurringRepo.getActiveRecurringItems).mockResolvedValue([recurringCarPayment]);
    vi.mocked(assetRepo.getAllAssets).mockResolvedValue([]);
    vi.mocked(accountRepo.getAllAccounts).mockResolvedValue([
      { ...mockAccount },
      { ...mockStandaloneLoanAccount },
    ]);
    vi.mocked(transactionRepo.createTransaction).mockResolvedValue({} as any);
    vi.mocked(accountRepo.getAccountById).mockResolvedValue({ ...mockAccount });
    vi.mocked(accountRepo.updateAccountBalance).mockResolvedValue({} as any);
    vi.mocked(recurringRepo.updateLastProcessedDate).mockResolvedValue(undefined);

    const result = await processRecurringItems();

    expect(result.processed).toBe(1);

    // Transaction should include amortization fields
    const txInput = vi.mocked(transactionRepo.createTransaction).mock.calls[0]![0];
    expect(txInput.loanId).toBe('standalone-loan-1');
    expect(txInput.loanInterestPortion).toBe(62.5); // 15000 * 0.05 / 12
    expect(txInput.loanPrincipalPortion).toBe(337.5); // 400 - 62.5

    // Standalone loan account balance should be reduced via updateAccountBalance
    expect(accountRepo.updateAccountBalance).toHaveBeenCalledWith(
      'standalone-loan-1',
      14662.5 // 15000 - 337.5
    );
  });

  it('should skip loan allocation when loan has zero outstanding balance', async () => {
    vi.setSystemTime(new Date('2024-01-15T12:00:00.000Z'));

    const recurringPaidOff: RecurringItem = {
      id: 'recurring-paidoff-1',
      accountId: 'test-account-1',
      type: 'expense',
      amount: 400,
      currency: 'USD',
      category: 'loan_payment',
      description: 'Paid Off Loan Payment',
      frequency: 'monthly',
      dayOfMonth: 15,
      startDate: '2024-01-01T00:00:00.000Z',
      isActive: true,
      loanId: 'standalone-loan-1',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    };

    const paidOffLoan = { ...mockStandaloneLoanAccount, balance: 0 };

    vi.mocked(recurringRepo.getActiveRecurringItems).mockResolvedValue([recurringPaidOff]);
    vi.mocked(assetRepo.getAllAssets).mockResolvedValue([]);
    vi.mocked(accountRepo.getAllAccounts).mockResolvedValue([{ ...mockAccount }, paidOffLoan]);
    vi.mocked(transactionRepo.createTransaction).mockResolvedValue({} as any);
    vi.mocked(accountRepo.getAccountById).mockResolvedValue({ ...mockAccount });
    vi.mocked(accountRepo.updateAccountBalance).mockResolvedValue({} as any);
    vi.mocked(recurringRepo.updateLastProcessedDate).mockResolvedValue(undefined);

    const result = await processRecurringItems();

    expect(result.processed).toBe(1);

    // Transaction should NOT include loan fields (zero balance → skipped)
    expect(transactionRepo.createTransaction).toHaveBeenCalledWith(
      expect.not.objectContaining({
        loanId: expect.any(String),
        loanInterestPortion: expect.any(Number),
        loanPrincipalPortion: expect.any(Number),
      })
    );

    // No asset update or loan balance update should have occurred
    expect(assetRepo.updateAsset).not.toHaveBeenCalled();
    // updateAccountBalance should only be called once for the source account, not for the loan
    const balanceCalls = vi.mocked(accountRepo.updateAccountBalance).mock.calls;
    for (const call of balanceCalls) {
      expect(call[0]).not.toBe('standalone-loan-1');
    }
  });
});

// --- Activity ID Passthrough ---

describe('recurringProcessor - Activity ID Passthrough', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should pass activityId through to the generated transaction', async () => {
    vi.setSystemTime(new Date('2024-01-15T12:00:00.000Z'));

    const recurringWithActivity: RecurringItem = {
      id: 'recurring-activity-1',
      accountId: 'test-account-1',
      type: 'expense',
      amount: 200,
      currency: 'USD',
      category: 'lesson_fees',
      description: 'Swimming Lessons',
      frequency: 'monthly',
      dayOfMonth: 15,
      startDate: '2024-01-01T00:00:00.000Z',
      isActive: true,
      activityId: 'activity-swim-1',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    };

    vi.mocked(recurringRepo.getActiveRecurringItems).mockResolvedValue([recurringWithActivity]);
    vi.mocked(transactionRepo.createTransaction).mockResolvedValue({
      id: 'tx-activity-1',
      accountId: 'test-account-1',
      type: 'expense',
      amount: 200,
      currency: 'USD',
      category: 'lesson_fees',
      date: '2024-01-15T00:00:00.000Z',
      description: 'Swimming Lessons',
      isReconciled: false,
      recurringItemId: 'recurring-activity-1',
      activityId: 'activity-swim-1',
      createdAt: '2024-01-15T00:00:00.000Z',
      updatedAt: '2024-01-15T00:00:00.000Z',
    });
    vi.mocked(accountRepo.getAccountById).mockResolvedValue({ ...mockAccount });
    vi.mocked(accountRepo.updateAccountBalance).mockResolvedValue({ ...mockAccount, balance: 800 });
    vi.mocked(recurringRepo.updateLastProcessedDate).mockResolvedValue(undefined);

    const result = await processRecurringItems();

    expect(result.processed).toBe(1);
    // Verify the transaction input includes activityId
    expect(transactionRepo.createTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        activityId: 'activity-swim-1',
        recurringItemId: 'recurring-activity-1',
      })
    );
  });
});
