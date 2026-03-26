import { setActivePinia, createPinia } from 'pinia';
import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock recurringItemRepository BEFORE importing the store
vi.mock('@/services/automerge/repositories/recurringItemRepository', () => ({
  getAllRecurringItems: vi.fn().mockResolvedValue([]),
  getRecurringItemById: vi.fn(),
  createRecurringItem: vi.fn(),
  updateRecurringItem: vi.fn(),
  deleteRecurringItem: vi.fn(),
}));

// Mock transactionsStore to avoid circular dependency issues
vi.mock('@/stores/transactionsStore', () => ({
  useTransactionsStore: () => ({
    deleteTransactionsByRecurringItemId: vi.fn().mockResolvedValue(0),
  }),
}));

import { syncEntityLinkedRecurringItem } from '../linkedRecurringItem';
import * as recurringRepo from '@/services/automerge/repositories/recurringItemRepository';

describe('syncEntityLinkedRecurringItem', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  const baseOpts = {
    enabled: true,
    accountId: 'account-1',
    amount: 500,
    currency: 'USD' as const,
    category: 'lesson_fees',
    description: 'Piano Lessons',
  };

  // --- Disabled / deletion paths ---

  it('should delete existing recurring item when enabled=false', async () => {
    vi.mocked(recurringRepo.deleteRecurringItem).mockResolvedValue(true);

    const result = await syncEntityLinkedRecurringItem({
      ...baseOpts,
      enabled: false,
      existingItemId: 'existing-item-1',
    });

    expect(result).toBeUndefined();
    expect(recurringRepo.deleteRecurringItem).toHaveBeenCalledWith('existing-item-1');
  });

  it('should return undefined (no-op) when enabled=false and no existing item', async () => {
    const result = await syncEntityLinkedRecurringItem({
      ...baseOpts,
      enabled: false,
    });

    expect(result).toBeUndefined();
    expect(recurringRepo.deleteRecurringItem).not.toHaveBeenCalled();
    expect(recurringRepo.createRecurringItem).not.toHaveBeenCalled();
  });

  it('should return undefined when enabled=true but no accountId', async () => {
    const result = await syncEntityLinkedRecurringItem({
      ...baseOpts,
      enabled: true,
      accountId: undefined,
    });

    expect(result).toBeUndefined();
    expect(recurringRepo.createRecurringItem).not.toHaveBeenCalled();
  });

  it('should delete existing item when enabled=true but no accountId', async () => {
    vi.mocked(recurringRepo.deleteRecurringItem).mockResolvedValue(true);

    const result = await syncEntityLinkedRecurringItem({
      ...baseOpts,
      enabled: true,
      accountId: undefined,
      existingItemId: 'existing-item-2',
    });

    expect(result).toBeUndefined();
    expect(recurringRepo.deleteRecurringItem).toHaveBeenCalledWith('existing-item-2');
  });

  // --- Create path ---

  it('should create new recurring item when enabled=true and no existing item', async () => {
    vi.mocked(recurringRepo.createRecurringItem).mockResolvedValue({
      id: 'new-item-1',
      accountId: 'account-1',
      type: 'expense',
      amount: 500,
      currency: 'USD',
      category: 'lesson_fees',
      description: 'Piano Lessons',
      frequency: 'monthly',
      dayOfMonth: 15,
      startDate: '2026-03-15',
      isActive: true,
      createdAt: '2026-03-15T00:00:00.000Z',
      updatedAt: '2026-03-15T00:00:00.000Z',
    });

    const result = await syncEntityLinkedRecurringItem({
      ...baseOpts,
      startDate: '2026-03-15',
    });

    expect(result).toBe('new-item-1');
    expect(recurringRepo.createRecurringItem).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: 'account-1',
        type: 'expense',
        amount: 500,
        currency: 'USD',
        category: 'lesson_fees',
        description: 'Piano Lessons',
        frequency: 'monthly',
        dayOfMonth: 15,
        isActive: true,
      })
    );
  });

  // --- Update path ---

  it('should update existing recurring item when enabled=true and existingItemId provided', async () => {
    vi.mocked(recurringRepo.updateRecurringItem).mockResolvedValue({
      id: 'existing-item-3',
      accountId: 'account-1',
      type: 'expense',
      amount: 600,
      currency: 'USD',
      category: 'lesson_fees',
      description: 'Piano Lessons (Updated)',
      frequency: 'monthly',
      dayOfMonth: 10,
      startDate: '2026-03-10',
      isActive: true,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-03-16T00:00:00.000Z',
    });

    const result = await syncEntityLinkedRecurringItem({
      ...baseOpts,
      amount: 600,
      description: 'Piano Lessons (Updated)',
      existingItemId: 'existing-item-3',
      startDate: '2026-03-10',
    });

    expect(result).toBe('existing-item-3');
    expect(recurringRepo.updateRecurringItem).toHaveBeenCalledWith(
      'existing-item-3',
      expect.objectContaining({
        accountId: 'account-1',
        amount: 600,
        description: 'Piano Lessons (Updated)',
      })
    );
    expect(recurringRepo.createRecurringItem).not.toHaveBeenCalled();
  });

  // --- loanId and activityId spreading ---

  it('should spread loanId when truthy', async () => {
    vi.mocked(recurringRepo.createRecurringItem).mockResolvedValue({
      id: 'loan-item-1',
      accountId: 'account-1',
      type: 'expense',
      amount: 500,
      currency: 'USD',
      category: 'loan_payment',
      description: 'Mortgage',
      frequency: 'monthly',
      dayOfMonth: 1,
      startDate: '2026-01-01',
      isActive: true,
      loanId: 'asset-loan-1',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });

    await syncEntityLinkedRecurringItem({
      ...baseOpts,
      category: 'loan_payment',
      description: 'Mortgage',
      loanId: 'asset-loan-1',
      startDate: '2026-01-01',
    });

    expect(recurringRepo.createRecurringItem).toHaveBeenCalledWith(
      expect.objectContaining({ loanId: 'asset-loan-1' })
    );
  });

  it('should spread activityId when truthy', async () => {
    vi.mocked(recurringRepo.createRecurringItem).mockResolvedValue({
      id: 'activity-item-1',
      accountId: 'account-1',
      type: 'expense',
      amount: 200,
      currency: 'USD',
      category: 'lesson_fees',
      description: 'Swimming Lessons',
      frequency: 'monthly',
      dayOfMonth: 1,
      startDate: '2026-01-01',
      isActive: true,
      activityId: 'activity-swim-1',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });

    await syncEntityLinkedRecurringItem({
      ...baseOpts,
      amount: 200,
      description: 'Swimming Lessons',
      activityId: 'activity-swim-1',
      startDate: '2026-01-01',
    });

    expect(recurringRepo.createRecurringItem).toHaveBeenCalledWith(
      expect.objectContaining({ activityId: 'activity-swim-1' })
    );
    // loanId should NOT be present when not provided
    const callArg = vi.mocked(recurringRepo.createRecurringItem).mock.calls[0]![0];
    expect(callArg).not.toHaveProperty('loanId');
  });

  // --- Frequency and dayOfMonth ---

  it('should default frequency to monthly and cap dayOfMonth at 28', async () => {
    vi.mocked(recurringRepo.createRecurringItem).mockResolvedValue({
      id: 'capped-item-1',
      accountId: 'account-1',
      type: 'expense',
      amount: 500,
      currency: 'USD',
      category: 'lesson_fees',
      description: 'Piano Lessons',
      frequency: 'monthly',
      dayOfMonth: 28,
      startDate: '2026-01-31',
      isActive: true,
      createdAt: '2026-01-31T00:00:00.000Z',
      updatedAt: '2026-01-31T00:00:00.000Z',
    });

    await syncEntityLinkedRecurringItem({
      ...baseOpts,
      startDate: '2026-01-31', // Day 31 → capped to 28
    });

    expect(recurringRepo.createRecurringItem).toHaveBeenCalledWith(
      expect.objectContaining({
        frequency: 'monthly',
        dayOfMonth: 28,
      })
    );
    // No monthOfYear for monthly
    const callArg = vi.mocked(recurringRepo.createRecurringItem).mock.calls[0]![0];
    expect(callArg).not.toHaveProperty('monthOfYear');
  });

  // --- One-time frequency (used by 'all' fee schedule) ---

  it('should create item with endDate=startDate for one-time frequency', async () => {
    vi.mocked(recurringRepo.createRecurringItem).mockResolvedValue({
      id: 'one-time-item-1',
      accountId: 'account-1',
      type: 'expense',
      amount: 500,
      currency: 'USD',
      category: 'lesson_fees',
      description: 'Swimming Term Fee',
      frequency: 'monthly',
      dayOfMonth: 10,
      startDate: '2026-03-10',
      endDate: '2026-03-10',
      isActive: true,
      createdAt: '2026-03-10T00:00:00.000Z',
      updatedAt: '2026-03-10T00:00:00.000Z',
    });

    const result = await syncEntityLinkedRecurringItem({
      ...baseOpts,
      description: 'Swimming Term Fee',
      frequency: 'one-time',
      startDate: '2026-03-10',
      activityId: 'activity-swim-1',
    });

    expect(result).toBe('one-time-item-1');
    const callArg = vi.mocked(recurringRepo.createRecurringItem).mock.calls[0]![0];
    // Uses monthly frequency internally but endDate = startDate limits to one occurrence
    expect(callArg).toMatchObject({
      frequency: 'monthly',
      startDate: '2026-03-10',
      endDate: '2026-03-10',
      amount: 500,
      activityId: 'activity-swim-1',
    });
  });

  it('should update existing item to one-time (endDate=startDate)', async () => {
    vi.mocked(recurringRepo.updateRecurringItem).mockResolvedValue({
      id: 'existing-recurring-1',
      accountId: 'account-1',
      type: 'expense',
      amount: 300,
      currency: 'USD',
      category: 'lesson_fees',
      description: 'Piano Term Fee',
      frequency: 'monthly',
      dayOfMonth: 5,
      startDate: '2026-04-05',
      endDate: '2026-04-05',
      isActive: true,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-04-01T00:00:00.000Z',
    });

    const result = await syncEntityLinkedRecurringItem({
      ...baseOpts,
      amount: 300,
      description: 'Piano Term Fee',
      existingItemId: 'existing-recurring-1',
      frequency: 'one-time',
      startDate: '2026-04-05',
    });

    expect(result).toBe('existing-recurring-1');
    const callArg = vi.mocked(recurringRepo.updateRecurringItem).mock.calls[0]![1];
    expect(callArg).toMatchObject({
      frequency: 'monthly',
      startDate: '2026-04-05',
      endDate: '2026-04-05',
    });
  });

  it('should NOT set endDate for non-one-time frequency', async () => {
    vi.mocked(recurringRepo.createRecurringItem).mockResolvedValue({
      id: 'monthly-item-1',
      accountId: 'account-1',
      type: 'expense',
      amount: 200,
      currency: 'USD',
      category: 'lesson_fees',
      description: 'Monthly Lesson',
      frequency: 'monthly',
      dayOfMonth: 15,
      startDate: '2026-03-15',
      isActive: true,
      createdAt: '2026-03-15T00:00:00.000Z',
      updatedAt: '2026-03-15T00:00:00.000Z',
    });

    await syncEntityLinkedRecurringItem({
      ...baseOpts,
      amount: 200,
      description: 'Monthly Lesson',
      frequency: 'monthly',
      startDate: '2026-03-15',
    });

    const callArg = vi.mocked(recurringRepo.createRecurringItem).mock.calls[0]![0];
    expect(callArg).not.toHaveProperty('endDate');
  });

  it('should set monthOfYear for yearly frequency', async () => {
    vi.mocked(recurringRepo.createRecurringItem).mockResolvedValue({
      id: 'yearly-item-1',
      accountId: 'account-1',
      type: 'expense',
      amount: 1200,
      currency: 'USD',
      category: 'lesson_fees',
      description: 'Annual Tuition',
      frequency: 'yearly',
      dayOfMonth: 15,
      monthOfYear: 9,
      startDate: '2026-09-15',
      isActive: true,
      createdAt: '2026-09-15T00:00:00.000Z',
      updatedAt: '2026-09-15T00:00:00.000Z',
    });

    await syncEntityLinkedRecurringItem({
      ...baseOpts,
      amount: 1200,
      description: 'Annual Tuition',
      frequency: 'yearly',
      startDate: '2026-09-15', // September 15 → monthOfYear = 9
    });

    expect(recurringRepo.createRecurringItem).toHaveBeenCalledWith(
      expect.objectContaining({
        frequency: 'yearly',
        dayOfMonth: 15,
        monthOfYear: 9,
      })
    );
  });
});
