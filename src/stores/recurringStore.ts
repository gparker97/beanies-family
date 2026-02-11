import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { useAccountsStore } from './accountsStore';
import { useMemberFilterStore } from './memberFilterStore';
import { useSettingsStore } from './settingsStore';
import * as recurringRepo from '@/services/indexeddb/repositories/recurringItemRepository';
import type {
  RecurringItem,
  CreateRecurringItemInput,
  UpdateRecurringItemInput,
  CurrencyCode,
  ExchangeRate,
} from '@/types/models';

export const useRecurringStore = defineStore('recurring', () => {
  // State
  const recurringItems = ref<RecurringItem[]>([]);
  const isLoading = ref(false);
  const error = ref<string | null>(null);

  // Helper to get exchange rate
  function getRate(
    rates: ExchangeRate[],
    from: CurrencyCode,
    to: CurrencyCode
  ): number | undefined {
    if (from === to) return 1;

    // Direct rate
    const direct = rates.find((r) => r.from === from && r.to === to);
    if (direct) return direct.rate;

    // Inverse rate
    const inverse = rates.find((r) => r.from === to && r.to === from);
    if (inverse) return 1 / inverse.rate;

    return undefined;
  }

  // Helper to convert amount to base currency
  function convertToBaseCurrency(amount: number, fromCurrency: CurrencyCode): number {
    const settingsStore = useSettingsStore();
    const baseCurrency = settingsStore.baseCurrency;

    if (fromCurrency === baseCurrency) return amount;

    const rate = getRate(settingsStore.exchangeRates, fromCurrency, baseCurrency);
    return rate !== undefined ? amount * rate : amount;
  }

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
    isLoading.value = true;
    error.value = null;
    try {
      recurringItems.value = await recurringRepo.getAllRecurringItems();
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to load recurring items';
    } finally {
      isLoading.value = false;
    }
  }

  async function createRecurringItem(
    input: CreateRecurringItemInput
  ): Promise<RecurringItem | null> {
    isLoading.value = true;
    error.value = null;
    try {
      const item = await recurringRepo.createRecurringItem(input);
      recurringItems.value.push(item);
      return item;
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to create recurring item';
      return null;
    } finally {
      isLoading.value = false;
    }
  }

  async function updateRecurringItem(
    id: string,
    input: UpdateRecurringItemInput
  ): Promise<RecurringItem | null> {
    isLoading.value = true;
    error.value = null;
    try {
      const updated = await recurringRepo.updateRecurringItem(id, input);
      if (updated) {
        const index = recurringItems.value.findIndex((item) => item.id === id);
        if (index !== -1) {
          recurringItems.value[index] = updated;
        }
      }
      return updated ?? null;
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to update recurring item';
      return null;
    } finally {
      isLoading.value = false;
    }
  }

  async function deleteRecurringItem(id: string): Promise<boolean> {
    isLoading.value = true;
    error.value = null;
    try {
      const success = await recurringRepo.deleteRecurringItem(id);
      if (success) {
        recurringItems.value = recurringItems.value.filter((item) => item.id !== id);
      }
      return success;
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to delete recurring item';
      return false;
    } finally {
      isLoading.value = false;
    }
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
  };
});
