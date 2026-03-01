import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { useAccountsStore } from './accountsStore';
import { useMemberFilterStore } from './memberFilterStore';
import { useTombstoneStore } from './tombstoneStore';
import { wrapAsync } from '@/composables/useStoreActions';
import { convertToBaseCurrency } from '@/utils/currency';
import * as recurringRepo from '@/services/indexeddb/repositories/recurringItemRepository';
import type {
  RecurringItem,
  CreateRecurringItemInput,
  UpdateRecurringItemInput,
} from '@/types/models';

export const useRecurringStore = defineStore('recurring', () => {
  // State
  const recurringItems = ref<RecurringItem[]>([]);
  const isLoading = ref(false);
  const error = ref<string | null>(null);

  // Getters
  const activeItems = computed(() => recurringItems.value.filter((item) => item.isActive));

  const incomeItems = computed(() => recurringItems.value.filter((item) => item.type === 'income'));

  const expenseItems = computed(() =>
    recurringItems.value.filter((item) => item.type === 'expense')
  );

  const activeIncomeItems = computed(() =>
    activeItems.value.filter((item) => item.type === 'income')
  );

  const activeExpenseItems = computed(() =>
    activeItems.value.filter((item) => item.type === 'expense')
  );

  // Normalize amount to monthly equivalent
  function normalizeToMonthly(amount: number, frequency: string): number {
    switch (frequency) {
      case 'daily':
        return amount * 30;
      case 'monthly':
        return amount;
      case 'yearly':
        return amount / 12;
      default:
        return amount;
    }
  }

  // Total monthly recurring income - converts each item to base currency first
  const totalMonthlyRecurringIncome = computed(() =>
    activeIncomeItems.value.reduce((sum, item) => {
      const monthlyAmount = normalizeToMonthly(item.amount, item.frequency);
      const convertedAmount = convertToBaseCurrency(monthlyAmount, item.currency);
      return sum + convertedAmount;
    }, 0)
  );

  // Total monthly recurring expenses - converts each item to base currency first
  const totalMonthlyRecurringExpenses = computed(() =>
    activeExpenseItems.value.reduce((sum, item) => {
      const monthlyAmount = normalizeToMonthly(item.amount, item.frequency);
      const convertedAmount = convertToBaseCurrency(monthlyAmount, item.currency);
      return sum + convertedAmount;
    }, 0)
  );

  const netMonthlyRecurring = computed(
    () => totalMonthlyRecurringIncome.value - totalMonthlyRecurringExpenses.value
  );

  // ========== FILTERED GETTERS (by global member filter) ==========

  // Helper to get account IDs for selected members
  function getSelectedAccountIds(): Set<string> {
    const memberFilter = useMemberFilterStore();
    const accountsStore = useAccountsStore();
    return memberFilter.getSelectedMemberAccountIds(accountsStore.accounts);
  }

  // Recurring items filtered by global member filter (via account ownership)
  const filteredRecurringItems = computed(() => {
    const memberFilter = useMemberFilterStore();
    if (!memberFilter.isInitialized || memberFilter.isAllSelected) {
      return recurringItems.value;
    }
    const selectedAccountIds = getSelectedAccountIds();
    return recurringItems.value.filter((item) => selectedAccountIds.has(item.accountId));
  });

  const filteredActiveItems = computed(() =>
    filteredRecurringItems.value.filter((item) => item.isActive)
  );

  const filteredActiveIncomeItems = computed(() =>
    filteredActiveItems.value.filter((item) => item.type === 'income')
  );

  const filteredActiveExpenseItems = computed(() =>
    filteredActiveItems.value.filter((item) => item.type === 'expense')
  );

  // Filtered total monthly recurring income
  const filteredTotalMonthlyRecurringIncome = computed(() =>
    filteredActiveIncomeItems.value.reduce((sum, item) => {
      const monthlyAmount = normalizeToMonthly(item.amount, item.frequency);
      const convertedAmount = convertToBaseCurrency(monthlyAmount, item.currency);
      return sum + convertedAmount;
    }, 0)
  );

  // Filtered total monthly recurring expenses
  const filteredTotalMonthlyRecurringExpenses = computed(() =>
    filteredActiveExpenseItems.value.reduce((sum, item) => {
      const monthlyAmount = normalizeToMonthly(item.amount, item.frequency);
      const convertedAmount = convertToBaseCurrency(monthlyAmount, item.currency);
      return sum + convertedAmount;
    }, 0)
  );

  const filteredNetMonthlyRecurring = computed(
    () => filteredTotalMonthlyRecurringIncome.value - filteredTotalMonthlyRecurringExpenses.value
  );

  const sortedByDescription = computed(() =>
    [...recurringItems.value].sort((a, b) => a.description.localeCompare(b.description))
  );

  // Actions
  async function loadRecurringItems(): Promise<void> {
    await wrapAsync(isLoading, error, async () => {
      recurringItems.value = await recurringRepo.getAllRecurringItems();
    });
  }

  async function createRecurringItem(
    input: CreateRecurringItemInput
  ): Promise<RecurringItem | null> {
    const result = await wrapAsync(isLoading, error, async () => {
      const item = await recurringRepo.createRecurringItem(input);
      recurringItems.value.push(item);
      return item;
    });
    return result ?? null;
  }

  async function updateRecurringItem(
    id: string,
    input: UpdateRecurringItemInput
  ): Promise<RecurringItem | null> {
    const result = await wrapAsync(isLoading, error, async () => {
      const updated = await recurringRepo.updateRecurringItem(id, input);
      if (updated) {
        const index = recurringItems.value.findIndex((item) => item.id === id);
        if (index !== -1) {
          recurringItems.value[index] = updated;
        }
      }
      return updated;
    });
    return result ?? null;
  }

  async function deleteRecurringItem(id: string): Promise<boolean> {
    const result = await wrapAsync(isLoading, error, async () => {
      const success = await recurringRepo.deleteRecurringItem(id);
      if (success) {
        useTombstoneStore().recordDeletion('recurringItem', id);
        recurringItems.value = recurringItems.value.filter((item) => item.id !== id);
      }
      return success;
    });
    return result ?? false;
  }

  async function toggleActive(id: string): Promise<boolean> {
    const item = recurringItems.value.find((i) => i.id === id);
    if (!item) return false;
    const updated = await updateRecurringItem(id, { isActive: !item.isActive });
    return !!updated;
  }

  function getRecurringItemById(id: string): RecurringItem | undefined {
    return recurringItems.value.find((item) => item.id === id);
  }

  function getItemsByAccountId(accountId: string): RecurringItem[] {
    return recurringItems.value.filter((item) => item.accountId === accountId);
  }

  function resetState() {
    recurringItems.value = [];
    isLoading.value = false;
    error.value = null;
  }

  return {
    // State
    recurringItems,
    isLoading,
    error,
    // Getters
    activeItems,
    incomeItems,
    expenseItems,
    activeIncomeItems,
    activeExpenseItems,
    totalMonthlyRecurringIncome,
    totalMonthlyRecurringExpenses,
    netMonthlyRecurring,
    sortedByDescription,
    // Filtered getters (by global member filter)
    filteredRecurringItems,
    filteredActiveItems,
    filteredActiveIncomeItems,
    filteredActiveExpenseItems,
    filteredTotalMonthlyRecurringIncome,
    filteredTotalMonthlyRecurringExpenses,
    filteredNetMonthlyRecurring,
    // Actions
    loadRecurringItems,
    createRecurringItem,
    updateRecurringItem,
    deleteRecurringItem,
    toggleActive,
    getRecurringItemById,
    getItemsByAccountId,
    resetState,
  };
});
