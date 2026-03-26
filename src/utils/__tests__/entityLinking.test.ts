/**
 * Comprehensive integration tests for entity-to-transaction linking.
 *
 * Covers:
 * - Activity → Recurring item linking (all fee schedules including 'all')
 * - Loan account → Recurring item linking
 * - One-time vs recurring payment creation
 * - Goal allocation from transactions (percentage, fixed, guardrails)
 * - Loan payment processing (amortization, extra payments)
 * - Edge cases: disable/re-enable, schedule type changes, deletion cleanup
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';

// ── Mocks (must be before imports) ──────────────────────────────────────────

vi.mock('@/services/automerge/repositories/recurringItemRepository', () => ({
  getAllRecurringItems: vi.fn().mockResolvedValue([]),
  getRecurringItemById: vi.fn(),
  createRecurringItem: vi.fn(),
  updateRecurringItem: vi.fn(),
  deleteRecurringItem: vi.fn(),
}));

vi.mock('@/stores/transactionsStore', () => ({
  useTransactionsStore: () => ({
    deleteTransactionsByRecurringItemId: vi.fn().mockResolvedValue(0),
  }),
}));

import { syncEntityLinkedRecurringItem } from '../linkedRecurringItem';
import { calculateMonthlyFee, computeGoalAllocRaw, calculateBalanceAdjustment } from '../finance';
import * as recurringRepo from '@/services/automerge/repositories/recurringItemRepository';

// ── Helpers ─────────────────────────────────────────────────────────────────

function mockCreateReturning(overrides: Record<string, unknown> = {}) {
  vi.mocked(recurringRepo.createRecurringItem).mockResolvedValue({
    id: overrides.id ?? 'new-item-1',
    accountId: 'account-1',
    type: 'expense',
    amount: 100,
    currency: 'USD',
    category: 'lesson_fees',
    description: 'Test',
    frequency: 'monthly',
    dayOfMonth: 1,
    startDate: '2026-03-01',
    isActive: true,
    createdAt: '2026-03-01T00:00:00.000Z',
    updatedAt: '2026-03-01T00:00:00.000Z',
    ...overrides,
  } as any);
}

function mockUpdateReturning(overrides: Record<string, unknown> = {}) {
  vi.mocked(recurringRepo.updateRecurringItem).mockResolvedValue({
    id: 'existing-item-1',
    accountId: 'account-1',
    type: 'expense',
    amount: 100,
    currency: 'USD',
    category: 'lesson_fees',
    description: 'Test',
    frequency: 'monthly',
    dayOfMonth: 1,
    startDate: '2026-03-01',
    isActive: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-03-26T00:00:00.000Z',
    ...overrides,
  } as any);
}

const activityBase = {
  enabled: true,
  accountId: 'checking-1',
  amount: 200,
  currency: 'SGD' as const,
  category: 'lesson_fees',
  description: 'Swimming Lessons Fee',
  activityId: 'activity-swim-1',
  startDate: '2026-04-01',
};

const loanBase = {
  enabled: true,
  accountId: 'savings-1',
  amount: 1500,
  currency: 'USD' as const,
  category: 'loan_payment',
  description: 'Home Loan Payment',
  loanId: 'asset-home-1',
  startDate: '2026-01-15',
};

// ═════════════════════════════════════════════════════════════════════════════
// ACTIVITY → RECURRING ITEM LINKING
// ═════════════════════════════════════════════════════════════════════════════

describe('Activity → Recurring Item Linking', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  // ── Fee schedule → monthly amount calculation ──

  describe('fee schedule calculations', () => {
    it('per_session with 2 sessions/week calculates correct monthly', () => {
      const monthly = calculateMonthlyFee({
        feeSchedule: 'per_session',
        feeAmount: 25,
        sessionsPerWeek: 2,
      });
      // 25 * 2 * 52 / 12 = 216.67
      expect(monthly).toBe(216.67);
    });

    it('weekly fee calculates correct monthly', () => {
      const monthly = calculateMonthlyFee({
        feeSchedule: 'weekly',
        feeAmount: 40,
      });
      // 40 * 52 / 12 = 173.33
      expect(monthly).toBe(173.33);
    });

    it('monthly fee is identity', () => {
      expect(calculateMonthlyFee({ feeSchedule: 'monthly', feeAmount: 150 })).toBe(150);
    });

    it('yearly fee divides by 12', () => {
      expect(calculateMonthlyFee({ feeSchedule: 'yearly', feeAmount: 600 })).toBe(50);
    });

    it('custom weeks: $400 every 8 weeks', () => {
      const monthly = calculateMonthlyFee({
        feeSchedule: 'custom',
        feeAmount: 400,
        feeCustomPeriod: 8,
        feeCustomPeriodUnit: 'weeks',
      });
      // 400 / 8 * (52/12) = 216.67
      expect(monthly).toBe(216.67);
    });

    it('custom months: $600 every 2 months', () => {
      const monthly = calculateMonthlyFee({
        feeSchedule: 'custom',
        feeAmount: 600,
        feeCustomPeriod: 2,
        feeCustomPeriodUnit: 'months',
      });
      expect(monthly).toBe(300);
    });

    it('"all" schedule returns full amount (no monthly conversion)', () => {
      const result = calculateMonthlyFee({
        feeSchedule: 'all',
        feeAmount: 800,
      });
      expect(result).toBe(800);
    });

    it('zero amount returns 0 for any schedule', () => {
      for (const schedule of ['per_session', 'weekly', 'monthly', 'yearly', 'all', 'custom']) {
        expect(calculateMonthlyFee({ feeSchedule: schedule, feeAmount: 0 })).toBe(0);
      }
    });

    it('negative amount returns 0', () => {
      expect(calculateMonthlyFee({ feeSchedule: 'monthly', feeAmount: -100 })).toBe(0);
    });
  });

  // ── Creating linked recurring items from activities ──

  describe('creating linked recurring items', () => {
    it('creates monthly recurring item for per_session activity', async () => {
      const monthlyAmount = calculateMonthlyFee({
        feeSchedule: 'per_session',
        feeAmount: 30,
        sessionsPerWeek: 2,
      });
      mockCreateReturning({ id: 'ri-1', amount: monthlyAmount });

      const result = await syncEntityLinkedRecurringItem({
        ...activityBase,
        amount: monthlyAmount,
      });

      expect(result).toBe('ri-1');
      expect(recurringRepo.createRecurringItem).toHaveBeenCalledWith(
        expect.objectContaining({
          accountId: 'checking-1',
          type: 'expense',
          amount: monthlyAmount,
          currency: 'SGD',
          category: 'lesson_fees',
          frequency: 'monthly',
          activityId: 'activity-swim-1',
          isActive: true,
        })
      );
    });

    it('creates one-time item for "all" fee schedule (endDate = startDate)', async () => {
      mockCreateReturning({
        id: 'ri-all-1',
        amount: 500,
        startDate: '2026-04-01',
        endDate: '2026-04-01',
      });

      const result = await syncEntityLinkedRecurringItem({
        ...activityBase,
        amount: 500,
        frequency: 'one-time',
      });

      expect(result).toBe('ri-all-1');
      const callArg = vi.mocked(recurringRepo.createRecurringItem).mock.calls[0]![0];
      expect(callArg).toMatchObject({
        frequency: 'monthly', // Internal representation
        startDate: '2026-04-01',
        endDate: '2026-04-01', // Same as startDate → one occurrence
        amount: 500,
        activityId: 'activity-swim-1',
      });
    });

    it('creates yearly recurring item when frequency=yearly', async () => {
      mockCreateReturning({
        id: 'ri-yearly-1',
        amount: 1200,
        frequency: 'yearly',
        monthOfYear: 4,
      });

      const result = await syncEntityLinkedRecurringItem({
        ...activityBase,
        amount: 1200,
        frequency: 'yearly',
      });

      expect(result).toBe('ri-yearly-1');
      const callArg = vi.mocked(recurringRepo.createRecurringItem).mock.calls[0]![0];
      expect(callArg).toMatchObject({
        frequency: 'yearly',
        monthOfYear: 4, // April
      });
      expect(callArg).not.toHaveProperty('endDate');
    });

    it('links activityId but NOT loanId for activity items', async () => {
      mockCreateReturning({ id: 'ri-act-1' });

      await syncEntityLinkedRecurringItem(activityBase);

      const callArg = vi.mocked(recurringRepo.createRecurringItem).mock.calls[0]![0];
      expect(callArg).toHaveProperty('activityId', 'activity-swim-1');
      expect(callArg).not.toHaveProperty('loanId');
    });
  });

  // ── Updating linked recurring items ──

  describe('updating linked recurring items', () => {
    it('updates existing item when existingItemId provided', async () => {
      mockUpdateReturning({ amount: 350 });

      const result = await syncEntityLinkedRecurringItem({
        ...activityBase,
        amount: 350,
        existingItemId: 'existing-item-1',
      });

      expect(result).toBe('existing-item-1');
      expect(recurringRepo.updateRecurringItem).toHaveBeenCalledWith(
        'existing-item-1',
        expect.objectContaining({ amount: 350 })
      );
      expect(recurringRepo.createRecurringItem).not.toHaveBeenCalled();
    });

    it('switches from monthly to one-time when fee schedule changes to "all"', async () => {
      mockUpdateReturning({
        amount: 800,
        startDate: '2026-04-01',
        endDate: '2026-04-01',
      });

      await syncEntityLinkedRecurringItem({
        ...activityBase,
        amount: 800,
        existingItemId: 'existing-item-1',
        frequency: 'one-time',
      });

      const callArg = vi.mocked(recurringRepo.updateRecurringItem).mock.calls[0]![1];
      expect(callArg).toMatchObject({
        frequency: 'monthly',
        startDate: '2026-04-01',
        endDate: '2026-04-01',
      });
    });

    it('switches from one-time back to monthly (no endDate)', async () => {
      mockUpdateReturning({ amount: 200 });

      await syncEntityLinkedRecurringItem({
        ...activityBase,
        amount: 200,
        existingItemId: 'existing-item-1',
        frequency: 'monthly',
      });

      const callArg = vi.mocked(recurringRepo.updateRecurringItem).mock.calls[0]![1];
      expect(callArg.frequency).toBe('monthly');
      expect(callArg).not.toHaveProperty('endDate');
    });
  });

  // ── Disabling and re-enabling ──

  describe('disabling and re-enabling', () => {
    it('deletes recurring item when activity has no payFromAccountId', async () => {
      vi.mocked(recurringRepo.deleteRecurringItem).mockResolvedValue(true);

      const result = await syncEntityLinkedRecurringItem({
        ...activityBase,
        enabled: true,
        accountId: undefined,
        existingItemId: 'ri-to-delete',
      });

      expect(result).toBeUndefined();
      expect(recurringRepo.deleteRecurringItem).toHaveBeenCalledWith('ri-to-delete');
    });

    it('deletes recurring item when enabled=false', async () => {
      vi.mocked(recurringRepo.deleteRecurringItem).mockResolvedValue(true);

      const result = await syncEntityLinkedRecurringItem({
        ...activityBase,
        enabled: false,
        existingItemId: 'ri-to-delete',
      });

      expect(result).toBeUndefined();
      expect(recurringRepo.deleteRecurringItem).toHaveBeenCalledWith('ri-to-delete');
    });

    it('no-op when disabled and no existing item', async () => {
      const result = await syncEntityLinkedRecurringItem({
        ...activityBase,
        enabled: false,
      });

      expect(result).toBeUndefined();
      expect(recurringRepo.deleteRecurringItem).not.toHaveBeenCalled();
      expect(recurringRepo.createRecurringItem).not.toHaveBeenCalled();
    });

    it('creates new item after previously deleting (re-enable)', async () => {
      mockCreateReturning({ id: 'ri-re-enabled' });

      const result = await syncEntityLinkedRecurringItem({
        ...activityBase,
        enabled: true,
        // No existingItemId — it was previously deleted
      });

      expect(result).toBe('ri-re-enabled');
      expect(recurringRepo.createRecurringItem).toHaveBeenCalled();
    });
  });

  // ── Day-of-month capping ──

  describe('day-of-month handling', () => {
    it('caps dayOfMonth at 28 for dates on 29th-31st', async () => {
      mockCreateReturning({});

      await syncEntityLinkedRecurringItem({
        ...activityBase,
        startDate: '2026-01-31',
      });

      const callArg = vi.mocked(recurringRepo.createRecurringItem).mock.calls[0]![0];
      expect(callArg.dayOfMonth).toBe(28);
    });

    it('preserves dayOfMonth for dates 1-28', async () => {
      mockCreateReturning({});

      await syncEntityLinkedRecurringItem({
        ...activityBase,
        startDate: '2026-03-15',
      });

      const callArg = vi.mocked(recurringRepo.createRecurringItem).mock.calls[0]![0];
      expect(callArg.dayOfMonth).toBe(15);
    });

    it('uses today when no startDate provided', async () => {
      mockCreateReturning({});

      await syncEntityLinkedRecurringItem({
        ...activityBase,
        startDate: undefined,
      });

      // Should still create successfully — defaults to today
      expect(recurringRepo.createRecurringItem).toHaveBeenCalledWith(
        expect.objectContaining({
          isActive: true,
          type: 'expense',
        })
      );
    });
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// LOAN → RECURRING ITEM LINKING
// ═════════════════════════════════════════════════════════════════════════════

describe('Loan → Recurring Item Linking', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  it('creates loan payment recurring item with loanId', async () => {
    mockCreateReturning({
      id: 'ri-loan-1',
      amount: 1500,
      category: 'loan_payment',
      loanId: 'asset-home-1',
    });

    const result = await syncEntityLinkedRecurringItem(loanBase);

    expect(result).toBe('ri-loan-1');
    const callArg = vi.mocked(recurringRepo.createRecurringItem).mock.calls[0]![0];
    expect(callArg).toMatchObject({
      accountId: 'savings-1',
      amount: 1500,
      currency: 'USD',
      category: 'loan_payment',
      description: 'Home Loan Payment',
      loanId: 'asset-home-1',
      frequency: 'monthly',
    });
    expect(callArg).not.toHaveProperty('activityId');
  });

  it('updates loan payment amount when refinanced', async () => {
    mockUpdateReturning({ amount: 1200 });

    await syncEntityLinkedRecurringItem({
      ...loanBase,
      amount: 1200,
      existingItemId: 'ri-loan-existing',
    });

    expect(recurringRepo.updateRecurringItem).toHaveBeenCalledWith(
      'ri-loan-existing',
      expect.objectContaining({ amount: 1200, loanId: 'asset-home-1' })
    );
  });

  it('deletes loan recurring item when pay-from account removed', async () => {
    vi.mocked(recurringRepo.deleteRecurringItem).mockResolvedValue(true);

    const result = await syncEntityLinkedRecurringItem({
      ...loanBase,
      accountId: undefined,
      existingItemId: 'ri-loan-existing',
    });

    expect(result).toBeUndefined();
    expect(recurringRepo.deleteRecurringItem).toHaveBeenCalledWith('ri-loan-existing');
  });

  it('creates yearly loan item for annual payments', async () => {
    mockCreateReturning({
      id: 'ri-loan-yearly',
      frequency: 'yearly',
      monthOfYear: 1,
    });

    await syncEntityLinkedRecurringItem({
      ...loanBase,
      frequency: 'yearly',
      startDate: '2026-01-15',
    });

    const callArg = vi.mocked(recurringRepo.createRecurringItem).mock.calls[0]![0];
    expect(callArg).toMatchObject({
      frequency: 'yearly',
      monthOfYear: 1, // January
      dayOfMonth: 15,
    });
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// GOAL ALLOCATION FROM TRANSACTIONS
// ═════════════════════════════════════════════════════════════════════════════

describe('Goal Allocation from Transactions', () => {
  describe('computeGoalAllocRaw', () => {
    it('percentage: 10% of $500 = $50', () => {
      expect(computeGoalAllocRaw('percentage', 10, 500)).toBe(50);
    });

    it('percentage: 25% of $1000 = $250', () => {
      expect(computeGoalAllocRaw('percentage', 25, 1000)).toBe(250);
    });

    it('percentage: 100% of $200 = $200', () => {
      expect(computeGoalAllocRaw('percentage', 100, 200)).toBe(200);
    });

    it('percentage: 0% of $500 = $0', () => {
      expect(computeGoalAllocRaw('percentage', 0, 500)).toBe(0);
    });

    it('fixed: $75 regardless of transaction amount', () => {
      expect(computeGoalAllocRaw('fixed', 75, 500)).toBe(75);
      expect(computeGoalAllocRaw('fixed', 75, 1000)).toBe(75);
      expect(computeGoalAllocRaw('fixed', 75, 10)).toBe(75);
    });

    it('fixed: $0 returns $0', () => {
      expect(computeGoalAllocRaw('fixed', 0, 500)).toBe(0);
    });

    it('percentage with small amounts avoids floating point issues', () => {
      const result = computeGoalAllocRaw('percentage', 33, 100);
      expect(result).toBe(33);
    });
  });

  describe('guardrail: allocation capped at remaining goal capacity', () => {
    // This tests the logic pattern used in transactionsStore.applyGoalAllocation
    function applyGuardrail(raw: number, goalTarget: number, goalCurrent: number): number {
      const remaining = Math.max(0, goalTarget - goalCurrent);
      return Math.min(raw, remaining);
    }

    it('full allocation when goal has plenty of room', () => {
      const raw = computeGoalAllocRaw('percentage', 10, 500); // 50
      expect(applyGuardrail(raw, 10000, 500)).toBe(50);
    });

    it('capped allocation when goal is nearly full', () => {
      const raw = computeGoalAllocRaw('fixed', 100, 500); // 100
      expect(applyGuardrail(raw, 1000, 950)).toBe(50); // Only 50 remaining
    });

    it('zero allocation when goal is already met', () => {
      const raw = computeGoalAllocRaw('fixed', 100, 500);
      expect(applyGuardrail(raw, 1000, 1000)).toBe(0);
    });

    it('zero allocation when goal is overfunded', () => {
      const raw = computeGoalAllocRaw('fixed', 100, 500);
      expect(applyGuardrail(raw, 1000, 1200)).toBe(0);
    });

    it('handles exact-to-target allocation', () => {
      const raw = computeGoalAllocRaw('fixed', 50, 500);
      expect(applyGuardrail(raw, 1000, 950)).toBe(50); // Exactly fills goal
    });
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// BALANCE ADJUSTMENT (TRANSACTION ↔ ACCOUNT)
// ═════════════════════════════════════════════════════════════════════════════

describe('Balance Adjustment (Transaction ↔ Account)', () => {
  it('income adds to balance', () => {
    expect(calculateBalanceAdjustment('income', 500)).toBe(500);
  });

  it('expense subtracts from balance', () => {
    expect(calculateBalanceAdjustment('expense', 300)).toBe(-300);
  });

  it('transfer debits source account', () => {
    expect(calculateBalanceAdjustment('transfer', 200, true)).toBe(-200);
  });

  it('transfer credits destination account', () => {
    expect(calculateBalanceAdjustment('transfer', 200, false)).toBe(200);
  });

  it('zero amount produces zero adjustment', () => {
    expect(calculateBalanceAdjustment('income', 0)).toBe(0);
    expect(calculateBalanceAdjustment('expense', 0)).toBe(-0);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// "ALL" FEE SCHEDULE END-TO-END
// ═════════════════════════════════════════════════════════════════════════════

describe('"All Sessions" Fee Schedule — End-to-End', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  it('full flow: $800 total for all sessions → one-time recurring item', async () => {
    // Step 1: Calculate — 'all' returns the full amount
    const paymentAmount = calculateMonthlyFee({
      feeSchedule: 'all',
      feeAmount: 800,
    });
    expect(paymentAmount).toBe(800);

    // Step 2: Create linked recurring item as one-time
    mockCreateReturning({
      id: 'ri-all-e2e',
      amount: 800,
      startDate: '2026-04-07',
      endDate: '2026-04-07',
      activityId: 'activity-term-1',
    });

    const itemId = await syncEntityLinkedRecurringItem({
      enabled: true,
      accountId: 'checking-1',
      amount: paymentAmount,
      currency: 'SGD' as const,
      category: 'lesson_fees',
      description: 'Swimming Term Fee',
      activityId: 'activity-term-1',
      startDate: '2026-04-07',
      frequency: 'one-time',
    });

    expect(itemId).toBe('ri-all-e2e');

    // Verify the created item has the right properties
    const callArg = vi.mocked(recurringRepo.createRecurringItem).mock.calls[0]![0];
    expect(callArg).toMatchObject({
      accountId: 'checking-1',
      type: 'expense',
      amount: 800, // Full amount, not monthly equivalent
      currency: 'SGD',
      category: 'lesson_fees',
      description: 'Swimming Term Fee',
      frequency: 'monthly', // Internal representation
      startDate: '2026-04-07',
      endDate: '2026-04-07', // Same as start → one occurrence
      activityId: 'activity-term-1',
      isActive: true,
    });
    expect(callArg).not.toHaveProperty('loanId');
  });

  it('changing from "all" to "monthly" removes endDate constraint', async () => {
    mockUpdateReturning({ amount: 100 });

    await syncEntityLinkedRecurringItem({
      enabled: true,
      accountId: 'checking-1',
      amount: 100,
      currency: 'SGD' as const,
      category: 'lesson_fees',
      description: 'Swimming Monthly Fee',
      activityId: 'activity-term-1',
      startDate: '2026-04-07',
      frequency: 'monthly', // Changed from one-time
      existingItemId: 'ri-all-e2e',
    });

    const callArg = vi.mocked(recurringRepo.updateRecurringItem).mock.calls[0]![1];
    expect(callArg.frequency).toBe('monthly');
    expect(callArg).not.toHaveProperty('endDate');
  });

  it('changing from "monthly" to "all" adds endDate constraint', async () => {
    mockUpdateReturning({
      amount: 500,
      startDate: '2026-04-07',
      endDate: '2026-04-07',
    });

    await syncEntityLinkedRecurringItem({
      enabled: true,
      accountId: 'checking-1',
      amount: 500,
      currency: 'SGD' as const,
      category: 'lesson_fees',
      description: 'Swimming Term Fee',
      activityId: 'activity-term-1',
      startDate: '2026-04-07',
      frequency: 'one-time', // Changed to one-time
      existingItemId: 'ri-monthly-1',
    });

    const callArg = vi.mocked(recurringRepo.updateRecurringItem).mock.calls[0]![1];
    expect(callArg).toMatchObject({
      frequency: 'monthly',
      startDate: '2026-04-07',
      endDate: '2026-04-07',
    });
  });

  it('preserves activityId through schedule change', async () => {
    mockUpdateReturning({});

    await syncEntityLinkedRecurringItem({
      ...activityBase,
      existingItemId: 'existing-1',
      frequency: 'one-time',
    });

    const callArg = vi.mocked(recurringRepo.updateRecurringItem).mock.calls[0]![1];
    expect(callArg).toHaveProperty('activityId', 'activity-swim-1');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// MIXED ENTITY SCENARIOS
// ═════════════════════════════════════════════════════════════════════════════

describe('Mixed Entity Scenarios', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  it('activity and loan create separate recurring items', async () => {
    // First: activity
    mockCreateReturning({ id: 'ri-activity' });
    const activityItemId = await syncEntityLinkedRecurringItem(activityBase);

    // Second: loan
    mockCreateReturning({ id: 'ri-loan' });
    const loanItemId = await syncEntityLinkedRecurringItem(loanBase);

    expect(activityItemId).toBe('ri-activity');
    expect(loanItemId).toBe('ri-loan');
    expect(recurringRepo.createRecurringItem).toHaveBeenCalledTimes(2);

    // Verify they have different linking IDs
    const activityCall = vi.mocked(recurringRepo.createRecurringItem).mock.calls[0]![0];
    const loanCall = vi.mocked(recurringRepo.createRecurringItem).mock.calls[1]![0];

    expect(activityCall).toHaveProperty('activityId');
    expect(activityCall).not.toHaveProperty('loanId');
    expect(loanCall).toHaveProperty('loanId');
    expect(loanCall).not.toHaveProperty('activityId');
  });

  it('disabling one entity does not affect another', async () => {
    // Delete activity link
    vi.mocked(recurringRepo.deleteRecurringItem).mockResolvedValue(true);
    await syncEntityLinkedRecurringItem({
      ...activityBase,
      enabled: false,
      existingItemId: 'ri-activity',
    });

    // Loan link should still work independently
    mockCreateReturning({ id: 'ri-loan-new' });
    const loanResult = await syncEntityLinkedRecurringItem(loanBase);

    expect(loanResult).toBe('ri-loan-new');
    expect(recurringRepo.deleteRecurringItem).toHaveBeenCalledTimes(1);
    expect(recurringRepo.deleteRecurringItem).toHaveBeenCalledWith('ri-activity');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// EDGE CASES
// ═════════════════════════════════════════════════════════════════════════════

describe('Edge Cases', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  it('handles zero amount gracefully (creates item with amount 0)', async () => {
    mockCreateReturning({ amount: 0 });

    await syncEntityLinkedRecurringItem({
      ...activityBase,
      amount: 0,
    });

    const callArg = vi.mocked(recurringRepo.createRecurringItem).mock.calls[0]![0];
    expect(callArg.amount).toBe(0);
  });

  it('handles very large amounts without precision loss', async () => {
    mockCreateReturning({ amount: 999999.99 });

    await syncEntityLinkedRecurringItem({
      ...activityBase,
      amount: 999999.99,
    });

    const callArg = vi.mocked(recurringRepo.createRecurringItem).mock.calls[0]![0];
    expect(callArg.amount).toBe(999999.99);
  });

  it('handles fractional cent amounts', async () => {
    const monthly = calculateMonthlyFee({
      feeSchedule: 'per_session',
      feeAmount: 33,
      sessionsPerWeek: 3,
    });
    // 33 * 3 * 52 / 12 = 429.00
    expect(monthly).toBe(429);
  });

  it('one-time with start date on 31st caps dayOfMonth at 28', async () => {
    mockCreateReturning({});

    await syncEntityLinkedRecurringItem({
      ...activityBase,
      frequency: 'one-time',
      startDate: '2026-01-31',
    });

    const callArg = vi.mocked(recurringRepo.createRecurringItem).mock.calls[0]![0];
    expect(callArg.dayOfMonth).toBe(28);
    expect(callArg.endDate).toBe('2026-01-31'); // endDate preserves original
    expect(callArg.startDate).toBe('2026-01-31'); // startDate preserves original
  });

  it('custom schedule with period=0 falls back to feeAmount', () => {
    const result = calculateMonthlyFee({
      feeSchedule: 'custom',
      feeAmount: 200,
      feeCustomPeriod: 0,
      feeCustomPeriodUnit: 'weeks',
    });
    expect(result).toBe(200);
  });

  it('custom schedule with missing unit falls back to feeAmount', () => {
    const result = calculateMonthlyFee({
      feeSchedule: 'custom',
      feeAmount: 300,
      feeCustomPeriod: 4,
    });
    expect(result).toBe(300);
  });
});
