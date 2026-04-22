/**
 * Month-over-month cash flow computeds used by dashboard SummaryStatCards.
 *
 * Extracted from `useNetWorthHistory` so the chart composable can stay
 * single-responsibility (chart math only). Consumers that just want
 * "this month vs last month" diffs no longer pay the cost of subscribing
 * to chart-history reactive dependencies.
 *
 * All values are in base currency. All values respect the global member filter.
 */
import { computed } from 'vue';
import { useTransactionsStore } from '@/stores/transactionsStore';
import { useRecurringStore } from '@/stores/recurringStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { convertAmount } from '@/utils/currency';
import {
  addMonths,
  getStartOfMonth,
  getEndOfMonth,
  toISODateString,
  isDateBetween,
} from '@/utils/date';

export function useMonthOverMonthCashFlow() {
  const transactionsStore = useTransactionsStore();
  const recurringStore = useRecurringStore();
  const settingsStore = useSettingsStore();

  /** Sum of one-time income transactions (no recurring) within the previous calendar month, in base currency. */
  const lastMonthOneTimeIncome = computed(() => {
    const baseCurrency = settingsStore.baseCurrency;
    const rates = settingsStore.exchangeRates;
    const lastMonth = addMonths(new Date(), -1);
    const start = toISODateString(getStartOfMonth(lastMonth));
    const end = toISODateString(getEndOfMonth(lastMonth));

    return transactionsStore.filteredTransactions
      .filter((t) => t.type === 'income' && !t.recurringItemId && isDateBetween(t.date, start, end))
      .reduce((sum, t) => sum + convertAmount(t.amount, t.currency, baseCurrency, rates), 0);
  });

  /** Sum of one-time expense transactions (no recurring) within the previous calendar month, in base currency. */
  const lastMonthOneTimeExpenses = computed(() => {
    const baseCurrency = settingsStore.baseCurrency;
    const rates = settingsStore.exchangeRates;
    const lastMonth = addMonths(new Date(), -1);
    const start = toISODateString(getStartOfMonth(lastMonth));
    const end = toISODateString(getEndOfMonth(lastMonth));

    return transactionsStore.filteredTransactions
      .filter(
        (t) => t.type === 'expense' && !t.recurringItemId && isDateBetween(t.date, start, end)
      )
      .reduce((sum, t) => sum + convertAmount(t.amount, t.currency, baseCurrency, rates), 0);
  });

  /** Total income for last calendar month: one-time + recurring (normalised to monthly). */
  const lastMonthIncome = computed(
    () => lastMonthOneTimeIncome.value + recurringStore.filteredTotalMonthlyRecurringIncome
  );

  /** Total expenses for last calendar month: one-time + recurring (normalised to monthly). */
  const lastMonthExpenses = computed(
    () => lastMonthOneTimeExpenses.value + recurringStore.filteredTotalMonthlyRecurringExpenses
  );

  /** Net cash flow (income − expenses) for last calendar month. */
  const lastMonthCashFlow = computed(() => lastMonthIncome.value - lastMonthExpenses.value);

  /** This month total income minus last month total income. Positive = better. */
  const incomeChange = computed(() => {
    const thisMonth =
      transactionsStore.filteredThisMonthOneTimeIncome +
      recurringStore.filteredTotalMonthlyRecurringIncome;
    return thisMonth - lastMonthIncome.value;
  });

  /** This month total expenses minus last month total expenses. Positive = worse. */
  const expenseChange = computed(() => {
    const thisMonth =
      transactionsStore.filteredThisMonthOneTimeExpenses +
      recurringStore.filteredTotalMonthlyRecurringExpenses;
    return thisMonth - lastMonthExpenses.value;
  });

  /** This month cash flow minus last month cash flow. Positive = better. */
  const cashFlowChange = computed(() => {
    const thisMonthIncome =
      transactionsStore.filteredThisMonthOneTimeIncome +
      recurringStore.filteredTotalMonthlyRecurringIncome;
    const thisMonthExpenses =
      transactionsStore.filteredThisMonthOneTimeExpenses +
      recurringStore.filteredTotalMonthlyRecurringExpenses;
    const thisMonthCashFlow = thisMonthIncome - thisMonthExpenses;
    return thisMonthCashFlow - lastMonthCashFlow.value;
  });

  return {
    lastMonthIncome,
    lastMonthExpenses,
    lastMonthCashFlow,
    incomeChange,
    expenseChange,
    cashFlowChange,
  };
}
