import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { processRecurringItems } from './recurringProcessor';
import type { RecurringItem, Account } from '@/types/models';

// Mock the repositories
vi.mock('@/services/indexeddb/repositories/recurringItemRepository', () => ({
  getActiveRecurringItems: vi.fn(),
  updateRecurringItem: vi.fn(),
  updateLastProcessedDate: vi.fn(),
}));

vi.mock('@/services/indexeddb/repositories/transactionRepository', () => ({
  createTransaction: vi.fn(),
}));

vi.mock('@/services/indexeddb/repositories/accountRepository', () => ({
  getAccountById: vi.fn(),
  updateAccountBalance: vi.fn(),
}));

import * as recurringRepo from '@/services/indexeddb/repositories/recurringItemRepository';
import * as transactionRepo from '@/services/indexeddb/repositories/transactionRepository';
import * as accountRepo from '@/services/indexeddb/repositories/accountRepository';

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
