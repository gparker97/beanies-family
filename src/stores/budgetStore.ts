import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { createMemberFiltered } from '@/composables/useMemberFiltered';
import { useTombstoneStore } from './tombstoneStore';
import { useTransactionsStore } from './transactionsStore';
import { useRecurringStore } from './recurringStore';
import { wrapAsync } from '@/composables/useStoreActions';
import * as budgetRepo from '@/services/indexeddb/repositories/budgetRepository';
import { getCategoryById } from '@/constants/categories';
import type { Budget, CreateBudgetInput, UpdateBudgetInput } from '@/types/models';

export type PaceStatus = 'great' | 'onTrack' | 'caution' | 'overBudget';
export type CategoryBudgetStatus = 'ok' | 'warning' | 'over';

export interface CategoryBudgetInfo {
  categoryId: string;
  name: string;
  icon: string;
  color: string;
  budgeted: number;
  spent: number;
  percentUsed: number;
  status: CategoryBudgetStatus;
}

export const useBudgetStore = defineStore('budget', () => {
  // State
  const budgets = ref<Budget[]>([]);
  const isLoading = ref(false);
  const error = ref<string | null>(null);

  // ========== GETTERS ==========

  const activeBudget = computed(() => budgets.value.find((b) => b.isActive) ?? null);

  // Budgets filtered by global member filter
  const filteredBudgets = createMemberFiltered(budgets, (b) => b.memberId);

  const filteredActiveBudget = computed(
    () => filteredBudgets.value.find((b) => b.isActive) ?? null
  );

  // Cross-store computed: monthly income (respects global member filter)
  const monthlyIncome = computed(() => {
    const txStore = useTransactionsStore();
    return txStore.filteredThisMonthIncome;
  });

  // Cross-store computed: current month spending (respects global member filter)
  const currentMonthSpending = computed(() => {
    const txStore = useTransactionsStore();
    return txStore.filteredThisMonthExpenses;
  });

  // Monthly savings = income - spending
  const monthlySavings = computed(() => monthlyIncome.value - currentMonthSpending.value);

  // Savings rate as percentage
  const savingsRate = computed(() => {
    if (monthlyIncome.value <= 0) return 0;
    return Math.round((monthlySavings.value / monthlyIncome.value) * 100);
  });

  // Effective budget amount (resolves percentage mode to actual amount)
  const effectiveBudgetAmount = computed(() => {
    const budget = activeBudget.value;
    if (!budget) return 0;
    if (budget.mode === 'percentage') {
      return Math.round(monthlyIncome.value * ((budget.percentage ?? 0) / 100));
    }
    return budget.totalAmount;
  });

  // Spending by category (respects global member filter)
  const spendingByCategory = computed(() => {
    const txStore = useTransactionsStore();
    return txStore.filteredExpensesByCategory;
  });

  // Category budget status array
  const categoryBudgetStatus = computed<CategoryBudgetInfo[]>(() => {
    const budget = activeBudget.value;
    if (!budget || budget.categories.length === 0) return [];

    return budget.categories
      .map((bc) => {
        const cat = getCategoryById(bc.categoryId);
        const spent = spendingByCategory.value.get(bc.categoryId) ?? 0;
        // spent is already in base currency (converted in transactionsStore)
        const percentUsed = bc.amount > 0 ? (spent / bc.amount) * 100 : 0;

        let status: CategoryBudgetStatus = 'ok';
        if (percentUsed >= 100) status = 'over';
        else if (percentUsed >= 75) status = 'warning';

        return {
          categoryId: bc.categoryId,
          name: cat?.name ?? bc.categoryId,
          icon: cat?.icon ?? '',
          color: cat?.color ?? '#6B7280',
          budgeted: bc.amount,
          spent,
          percentUsed: Math.round(percentUsed),
          status,
        };
      })
      .sort((a, b) => b.percentUsed - a.percentUsed);
  });

  // Overall budget progress percentage
  const budgetProgress = computed(() => {
    const budget = effectiveBudgetAmount.value;
    if (budget <= 0) return 0;
    return Math.min(200, Math.round((currentMonthSpending.value / budget) * 100));
  });

  // Time progress: what % of the month has passed
  const monthTimeProgress = computed(() => {
    const now = new Date();
    const day = now.getDate();
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    return Math.round((day / daysInMonth) * 100);
  });

  // Pace status based on spending vs time progress
  const paceStatus = computed<PaceStatus>(() => {
    const budget = effectiveBudgetAmount.value;
    if (budget <= 0) return 'onTrack';

    const spendingPercent = (currentMonthSpending.value / budget) * 100;
    const timePercent = monthTimeProgress.value;

    if (spendingPercent > 100) return 'overBudget';
    if (spendingPercent > timePercent + 15) return 'caution';
    if (spendingPercent < timePercent - 15) return 'great';
    return 'onTrack';
  });

  // Upcoming recurring transactions (next 5)
  const upcomingTransactions = computed(() => {
    const recurringStore = useRecurringStore();
    const now = new Date();
    const currentDay = now.getDate();
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();

    return recurringStore.activeItems
      .map((item) => {
        // Calculate next occurrence day this month
        const dayOfMonth = Math.min(item.dayOfMonth, daysInMonth);
        const isPast = dayOfMonth <= currentDay;
        const nextDate = new Date(
          now.getFullYear(),
          isPast ? now.getMonth() + 1 : now.getMonth(),
          dayOfMonth
        );

        return {
          id: item.id,
          description: item.description,
          amount: item.amount,
          currency: item.currency,
          category: item.category,
          type: item.type,
          nextDate: nextDate.toISOString().split('T')[0],
          daysUntil: Math.ceil((nextDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)),
        };
      })
      .sort((a, b) => a.daysUntil - b.daysUntil)
      .slice(0, 5);
  });

  // Recurring vs one-time breakdowns (respects global member filter)
  const recurringIncome = computed(() => useTransactionsStore().filteredThisMonthRecurringIncome);
  const oneTimeIncome = computed(() => useTransactionsStore().filteredThisMonthOneTimeIncome);
  const recurringExpenses = computed(
    () => useTransactionsStore().filteredThisMonthRecurringExpenses
  );
  const oneTimeExpenses = computed(() => useTransactionsStore().filteredThisMonthOneTimeExpenses);

  // ========== ACTIONS ==========

  async function loadBudgets() {
    await wrapAsync(isLoading, error, async () => {
      budgets.value = await budgetRepo.getAllBudgets();
    });
  }

  async function createBudget(input: CreateBudgetInput): Promise<Budget | null> {
    const result = await wrapAsync(isLoading, error, async () => {
      // Deactivate other budgets when creating a new active one
      if (input.isActive) {
        for (const existing of budgets.value.filter((b) => b.isActive)) {
          await budgetRepo.updateBudget(existing.id, { isActive: false });
          const idx = budgets.value.findIndex((b) => b.id === existing.id);
          if (idx !== -1) {
            budgets.value[idx] = { ...budgets.value[idx]!, isActive: false };
          }
        }
      }
      const budget = await budgetRepo.createBudget(input);
      budgets.value.push(budget);
      return budget;
    });
    return result ?? null;
  }

  async function updateBudget(id: string, input: UpdateBudgetInput): Promise<Budget | null> {
    const result = await wrapAsync(isLoading, error, async () => {
      // Deactivate other budgets when setting this one active
      if (input.isActive) {
        for (const existing of budgets.value.filter((b) => b.isActive && b.id !== id)) {
          await budgetRepo.updateBudget(existing.id, { isActive: false });
          const idx = budgets.value.findIndex((b) => b.id === existing.id);
          if (idx !== -1) {
            budgets.value[idx] = { ...budgets.value[idx]!, isActive: false };
          }
        }
      }
      const updated = await budgetRepo.updateBudget(id, input);
      if (updated) {
        const index = budgets.value.findIndex((b) => b.id === id);
        if (index !== -1) {
          budgets.value[index] = updated;
        }
      }
      return updated;
    });
    return result ?? null;
  }

  async function deleteBudget(id: string): Promise<boolean> {
    const result = await wrapAsync(isLoading, error, async () => {
      const success = await budgetRepo.deleteBudget(id);
      if (success) {
        useTombstoneStore().recordDeletion('budget', id);
        budgets.value = budgets.value.filter((b) => b.id !== id);
      }
      return success;
    });
    return result ?? false;
  }

  function resetState() {
    budgets.value = [];
    isLoading.value = false;
    error.value = null;
  }

  return {
    // State
    budgets,
    isLoading,
    error,
    // Getters
    activeBudget,
    filteredBudgets,
    filteredActiveBudget,
    monthlyIncome,
    currentMonthSpending,
    monthlySavings,
    savingsRate,
    effectiveBudgetAmount,
    spendingByCategory,
    categoryBudgetStatus,
    budgetProgress,
    monthTimeProgress,
    paceStatus,
    upcomingTransactions,
    recurringIncome,
    oneTimeIncome,
    recurringExpenses,
    oneTimeExpenses,
    // Actions
    loadBudgets,
    createBudget,
    updateBudget,
    deleteBudget,
    resetState,
  };
});
