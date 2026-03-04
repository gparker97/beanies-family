import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { useAccountsStore } from './accountsStore';
import { useMemberFilterStore } from './memberFilterStore';
import { useTransactionsStore } from './transactionsStore';
import { wrapAsync } from '@/composables/useStoreActions';
import { convertToBaseCurrency } from '@/utils/currency';
import { toDateInputValue, parseLocalDate, addDays } from '@/utils/date';
import * as recurringRepo from '@/services/automerge/repositories/recurringItemRepository';
import type {
  RecurringItem,
  CreateRecurringItemInput,
  UpdateRecurringItemInput,
  ISODateString,
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
  // Always return a new array to avoid Vue 3.4+ computed reference-equality
  // optimization swallowing downstream reactivity on in-place mutations.
  const filteredRecurringItems = computed(() => {
    const memberFilter = useMemberFilterStore();
    if (!memberFilter.isInitialized || memberFilter.isAllSelected) {
      return [...recurringItems.value];
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
      // Immutable update: assign a new array so downstream computeds re-evaluate
      recurringItems.value = [...recurringItems.value, item];
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
        // Immutable update: assign a new array so downstream computeds re-evaluate
        recurringItems.value = recurringItems.value.map((item) =>
          item.id === id ? updated : item
        );
      }
      return updated;
    });
    return result ?? null;
  }

  async function deleteRecurringItem(id: string): Promise<boolean> {
    const result = await wrapAsync(isLoading, error, async () => {
      const success = await recurringRepo.deleteRecurringItem(id);
      if (success) {
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

  /**
   * Split a recurring item at a given date.
   * End-dates the original at the day before, creates a new item from the split date,
   * and re-links any materialized transactions after the split to the new item.
   */
  async function splitRecurringItem(
    itemId: string,
    fromDate: ISODateString
  ): Promise<RecurringItem | null> {
    const original = recurringItems.value.find((r) => r.id === itemId);
    if (!original) return null;

    // 1. Calculate day before split date for endDate
    const dayBefore = toDateInputValue(addDays(parseLocalDate(fromDate), -1));

    // 2. End-date the original item
    await updateRecurringItem(itemId, { endDate: dayBefore });

    // 3. Create new item from split date forward
    const newItem = await createRecurringItem({
      accountId: original.accountId,
      type: original.type,
      amount: original.amount,
      currency: original.currency,
      category: original.category,
      description: original.description,
      frequency: original.frequency,
      dayOfMonth: original.dayOfMonth,
      monthOfYear: original.monthOfYear,
      startDate: fromDate,
      endDate: original.endDate, // preserve original end date if any
      isActive: true,
    });

    // 4. Re-link materialized transactions from old item after split date
    if (newItem) {
      const txStore = useTransactionsStore();
      const toRelink = txStore.transactions.filter(
        (tx) => tx.recurringItemId === itemId && toDateInputValue(new Date(tx.date)) >= fromDate
      );
      for (const tx of toRelink) {
        await txStore.updateTransaction(tx.id, { recurringItemId: newItem.id });
      }
    }

    return newItem;
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
    splitRecurringItem,
    resetState,
  };
});
