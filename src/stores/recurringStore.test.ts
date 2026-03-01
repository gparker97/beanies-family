import { setActivePinia, createPinia } from 'pinia';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useRecurringStore } from './recurringStore';
import * as recurringRepo from '@/services/indexeddb/repositories/recurringItemRepository';
import type { RecurringItem } from '@/types/models';

// Mock the recurring item repository
vi.mock('@/services/indexeddb/repositories/recurringItemRepository', () => ({
  getAllRecurringItems: vi.fn(),
  getRecurringItemById: vi.fn(),
  createRecurringItem: vi.fn(),
  updateRecurringItem: vi.fn(),
  deleteRecurringItem: vi.fn(),
}));

const createMockRecurringItem = (overrides: Partial<RecurringItem> = {}): RecurringItem => ({
  id: `recurring-${Math.random().toString(36).slice(2)}`,
  accountId: 'acc-1',
  type: 'expense',
  amount: 100,
  currency: 'USD',
  category: 'utilities',
  description: 'Test recurring item',
  frequency: 'monthly',
  dayOfMonth: 1,
  startDate: '2024-01-01T00:00:00.000Z',
  isActive: true,
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
  ...overrides,
});

describe('recurringStore - Monthly Summary Calculations', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  describe('totalMonthlyRecurringIncome', () => {
    it('should sum all active monthly income items', () => {
      const store = useRecurringStore();

      store.recurringItems.push(
        createMockRecurringItem({
          id: 'r1',
          type: 'income',
          amount: 5000,
          frequency: 'monthly',
          isActive: true,
        }),
        createMockRecurringItem({
          id: 'r2',
          type: 'income',
          amount: 1000,
          frequency: 'monthly',
          isActive: true,
        })
      );

      expect(store.totalMonthlyRecurringIncome).toBe(6000);
    });

    it('should normalize yearly income to monthly equivalent', () => {
      const store = useRecurringStore();

      // $12000 yearly = $1000 per month
      store.recurringItems.push(
        createMockRecurringItem({
          id: 'r1',
          type: 'income',
          amount: 12000,
          frequency: 'yearly',
          isActive: true,
        })
      );

      expect(store.totalMonthlyRecurringIncome).toBe(1000);
    });

    it('should normalize daily income to monthly equivalent', () => {
      const store = useRecurringStore();

      // $10 daily * 30 = $300 per month
      store.recurringItems.push(
        createMockRecurringItem({
          id: 'r1',
          type: 'income',
          amount: 10,
          frequency: 'daily',
          isActive: true,
        })
      );

      expect(store.totalMonthlyRecurringIncome).toBe(300);
    });

    it('should exclude inactive income items', () => {
      const store = useRecurringStore();

      store.recurringItems.push(
        createMockRecurringItem({ id: 'r1', type: 'income', amount: 5000, isActive: true }),
        createMockRecurringItem({ id: 'r2', type: 'income', amount: 3000, isActive: false }) // Inactive
      );

      expect(store.totalMonthlyRecurringIncome).toBe(5000);
    });

    it('should not include expense items', () => {
      const store = useRecurringStore();

      store.recurringItems.push(
        createMockRecurringItem({ id: 'r1', type: 'income', amount: 5000, isActive: true }),
        createMockRecurringItem({ id: 'r2', type: 'expense', amount: 2000, isActive: true })
      );

      expect(store.totalMonthlyRecurringIncome).toBe(5000);
    });
  });

  describe('totalMonthlyRecurringExpenses', () => {
    it('should sum all active monthly expense items', () => {
      const store = useRecurringStore();

      store.recurringItems.push(
        createMockRecurringItem({
          id: 'r1',
          type: 'expense',
          amount: 2000,
          frequency: 'monthly',
          isActive: true,
        }),
        createMockRecurringItem({
          id: 'r2',
          type: 'expense',
          amount: 500,
          frequency: 'monthly',
          isActive: true,
        })
      );

      expect(store.totalMonthlyRecurringExpenses).toBe(2500);
    });

    it('should normalize yearly expenses to monthly equivalent', () => {
      const store = useRecurringStore();

      // $1200 yearly = $100 per month
      store.recurringItems.push(
        createMockRecurringItem({
          id: 'r1',
          type: 'expense',
          amount: 1200,
          frequency: 'yearly',
          isActive: true,
        })
      );

      expect(store.totalMonthlyRecurringExpenses).toBe(100);
    });

    it('should exclude inactive expense items', () => {
      const store = useRecurringStore();

      store.recurringItems.push(
        createMockRecurringItem({ id: 'r1', type: 'expense', amount: 2000, isActive: true }),
        createMockRecurringItem({ id: 'r2', type: 'expense', amount: 1000, isActive: false }) // Inactive
      );

      expect(store.totalMonthlyRecurringExpenses).toBe(2000);
    });
  });

  describe('netMonthlyRecurring', () => {
    it('should be the difference between recurring income and expenses', () => {
      const store = useRecurringStore();

      store.recurringItems.push(
        createMockRecurringItem({ id: 'r1', type: 'income', amount: 5000, isActive: true }),
        createMockRecurringItem({ id: 'r2', type: 'expense', amount: 3000, isActive: true })
      );

      // 5000 - 3000 = 2000
      expect(store.netMonthlyRecurring).toBe(2000);
    });

    it('should be negative when expenses exceed income', () => {
      const store = useRecurringStore();

      store.recurringItems.push(
        createMockRecurringItem({ id: 'r1', type: 'income', amount: 3000, isActive: true }),
        createMockRecurringItem({ id: 'r2', type: 'expense', amount: 5000, isActive: true })
      );

      // 3000 - 5000 = -2000
      expect(store.netMonthlyRecurring).toBe(-2000);
    });

    it('should correctly combine different frequency items', () => {
      const store = useRecurringStore();

      store.recurringItems.push(
        // Monthly salary: $5000/month
        createMockRecurringItem({
          id: 'r1',
          type: 'income',
          amount: 5000,
          frequency: 'monthly',
          isActive: true,
        }),
        // Monthly rent: $2000/month
        createMockRecurringItem({
          id: 'r2',
          type: 'expense',
          amount: 2000,
          frequency: 'monthly',
          isActive: true,
        }),
        // Yearly insurance: $1200/year = $100/month
        createMockRecurringItem({
          id: 'r3',
          type: 'expense',
          amount: 1200,
          frequency: 'yearly',
          isActive: true,
        })
      );

      // Income: 5000, Expenses: 2000 + 100 = 2100
      // Net: 5000 - 2100 = 2900
      expect(store.netMonthlyRecurring).toBe(2900);
    });
  });

  describe('toggleActive', () => {
    it('should flip isActive from true to false', async () => {
      const store = useRecurringStore();
      const item = createMockRecurringItem({ id: 'r1', isActive: true });
      store.recurringItems.push(item);

      const updatedItem = { ...item, isActive: false, updatedAt: new Date().toISOString() };
      vi.mocked(recurringRepo.updateRecurringItem).mockResolvedValue(updatedItem);

      const result = await store.toggleActive('r1');

      expect(result).toBe(true);
      expect(recurringRepo.updateRecurringItem).toHaveBeenCalledWith('r1', { isActive: false });
      expect(store.recurringItems[0]!.isActive).toBe(false);
    });

    it('should flip isActive from false to true', async () => {
      const store = useRecurringStore();
      const item = createMockRecurringItem({ id: 'r1', isActive: false });
      store.recurringItems.push(item);

      const updatedItem = { ...item, isActive: true, updatedAt: new Date().toISOString() };
      vi.mocked(recurringRepo.updateRecurringItem).mockResolvedValue(updatedItem);

      const result = await store.toggleActive('r1');

      expect(result).toBe(true);
      expect(recurringRepo.updateRecurringItem).toHaveBeenCalledWith('r1', { isActive: true });
      expect(store.recurringItems[0]!.isActive).toBe(true);
    });

    it('should return false for non-existent item', async () => {
      const store = useRecurringStore();
      const result = await store.toggleActive('non-existent');
      expect(result).toBe(false);
    });
  });

  describe('activeItems getter', () => {
    it('should return only active items', () => {
      const store = useRecurringStore();

      store.recurringItems.push(
        createMockRecurringItem({ id: 'r1', isActive: true }),
        createMockRecurringItem({ id: 'r2', isActive: false }),
        createMockRecurringItem({ id: 'r3', isActive: true })
      );

      expect(store.activeItems).toHaveLength(2);
      expect(store.activeItems.map((i) => i.id)).toEqual(['r1', 'r3']);
    });

    it('should return empty array when all items are inactive', () => {
      const store = useRecurringStore();

      store.recurringItems.push(
        createMockRecurringItem({ id: 'r1', isActive: false }),
        createMockRecurringItem({ id: 'r2', isActive: false })
      );

      expect(store.activeItems).toHaveLength(0);
    });
  });

  describe('filtered getters exclude inactive items', () => {
    it('filteredActiveItems should exclude inactive', () => {
      const store = useRecurringStore();

      store.recurringItems.push(
        createMockRecurringItem({ id: 'r1', isActive: true, type: 'income' }),
        createMockRecurringItem({ id: 'r2', isActive: false, type: 'income' }),
        createMockRecurringItem({ id: 'r3', isActive: true, type: 'expense' })
      );

      // filteredActiveItems uses filteredRecurringItems (all selected by default) then filters isActive
      expect(store.filteredActiveItems).toHaveLength(2);
      expect(store.filteredActiveItems.map((i) => i.id)).toEqual(['r1', 'r3']);
    });

    it('filteredActiveIncomeItems should only include active income', () => {
      const store = useRecurringStore();

      store.recurringItems.push(
        createMockRecurringItem({ id: 'r1', isActive: true, type: 'income' }),
        createMockRecurringItem({ id: 'r2', isActive: false, type: 'income' }),
        createMockRecurringItem({ id: 'r3', isActive: true, type: 'expense' })
      );

      expect(store.filteredActiveIncomeItems).toHaveLength(1);
      expect(store.filteredActiveIncomeItems[0]!.id).toBe('r1');
    });

    it('filteredActiveExpenseItems should only include active expenses', () => {
      const store = useRecurringStore();

      store.recurringItems.push(
        createMockRecurringItem({ id: 'r1', isActive: true, type: 'expense' }),
        createMockRecurringItem({ id: 'r2', isActive: false, type: 'expense' }),
        createMockRecurringItem({ id: 'r3', isActive: true, type: 'income' })
      );

      expect(store.filteredActiveExpenseItems).toHaveLength(1);
      expect(store.filteredActiveExpenseItems[0]!.id).toBe('r1');
    });
  });

  describe('filtered totals exclude inactive items', () => {
    it('filteredTotalMonthlyRecurringIncome should skip inactive', () => {
      const store = useRecurringStore();

      store.recurringItems.push(
        createMockRecurringItem({ id: 'r1', type: 'income', amount: 5000, isActive: true }),
        createMockRecurringItem({ id: 'r2', type: 'income', amount: 3000, isActive: false })
      );

      expect(store.filteredTotalMonthlyRecurringIncome).toBe(5000);
    });

    it('filteredTotalMonthlyRecurringExpenses should skip inactive', () => {
      const store = useRecurringStore();

      store.recurringItems.push(
        createMockRecurringItem({ id: 'r1', type: 'expense', amount: 2000, isActive: true }),
        createMockRecurringItem({ id: 'r2', type: 'expense', amount: 1000, isActive: false })
      );

      expect(store.filteredTotalMonthlyRecurringExpenses).toBe(2000);
    });

    it('filteredNetMonthlyRecurring should only consider active items', () => {
      const store = useRecurringStore();

      store.recurringItems.push(
        createMockRecurringItem({ id: 'r1', type: 'income', amount: 5000, isActive: true }),
        createMockRecurringItem({ id: 'r2', type: 'income', amount: 2000, isActive: false }),
        createMockRecurringItem({ id: 'r3', type: 'expense', amount: 3000, isActive: true }),
        createMockRecurringItem({ id: 'r4', type: 'expense', amount: 1000, isActive: false })
      );

      // Only active: income 5000, expense 3000 => net 2000
      expect(store.filteredNetMonthlyRecurring).toBe(2000);
    });
  });
});
