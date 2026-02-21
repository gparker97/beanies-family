import { ref, computed } from 'vue';
import { useAccountsStore } from '@/stores/accountsStore';
import { useTransactionsStore } from '@/stores/transactionsStore';
import { useRecurringStore } from '@/stores/recurringStore';
import { useSettingsStore } from '@/stores/settingsStore';
import {
  addDays,
  addMonths,
  getStartOfMonth,
  getEndOfMonth,
  getStartOfDay,
  toISODateString,
  isDateBetween,
} from '@/utils/date';
import type { CurrencyCode, ExchangeRate } from '@/types/models';

export type PeriodKey = '1W' | '1M' | '3M' | '1Y' | 'all';

export interface NetWorthDataPoint {
  date: Date;
  label: string;
  value: number;
}

export interface PeriodComparison {
  changeAmount: number;
  changePercent: number;
}

function getRate(rates: ExchangeRate[], from: CurrencyCode, to: CurrencyCode): number | undefined {
  if (from === to) return 1;
  const direct = rates.find((r) => r.from === from && r.to === to);
  if (direct) return direct.rate;
  const inverse = rates.find((r) => r.from === to && r.to === from);
  if (inverse) return 1 / inverse.rate;
  return undefined;
}

function convertAmount(
  amount: number,
  fromCurrency: CurrencyCode,
  baseCurrency: CurrencyCode,
  rates: ExchangeRate[]
): number {
  if (fromCurrency === baseCurrency) return amount;
  const rate = getRate(rates, fromCurrency, baseCurrency);
  return rate !== undefined ? amount * rate : amount;
}

function formatLabel(date: Date, period: PeriodKey): string {
  if (period === '1W') {
    return date.toLocaleDateString('en-US', { weekday: 'short' });
  }
  if (period === '1M' || period === '3M') {
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }
  return date.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
}

export function useNetWorthHistory() {
  const accountsStore = useAccountsStore();
  const transactionsStore = useTransactionsStore();
  const recurringStore = useRecurringStore();
  const settingsStore = useSettingsStore();

  const selectedPeriod = ref<PeriodKey>('1M');

  /**
   * Compute historical net worth data points by replaying transactions backwards.
   *
   * Starting from the current net worth, we walk backwards through time,
   * reversing the effect of each transaction to reconstruct what the
   * net worth was at each point in the past.
   *
   * Assets are treated as constant (no historical valuation data).
   */
  const chartData = computed<NetWorthDataPoint[]>(() => {
    const baseCurrency = settingsStore.baseCurrency;
    const rates = settingsStore.exchangeRates;
    const currentNetWorth = accountsStore.filteredCombinedNetWorth;
    const period = selectedPeriod.value;

    const now = getStartOfDay(new Date());
    let startDate: Date;
    let stepDays: number;

    switch (period) {
      case '1W':
        startDate = addDays(now, -6);
        stepDays = 1;
        break;
      case '1M':
        startDate = addDays(now, -29);
        stepDays = 1;
        break;
      case '3M':
        startDate = addDays(now, -89);
        stepDays = 3;
        break;
      case '1Y':
        startDate = addDays(now, -364);
        stepDays = 14;
        break;
      case 'all': {
        const allTxns = transactionsStore.filteredTransactions;
        if (allTxns.length > 0) {
          const earliest = allTxns.reduce((min, t) => {
            const d = new Date(t.date);
            return d < min ? d : min;
          }, new Date());
          startDate = getStartOfDay(earliest);
          const minStart = addDays(now, -29);
          if (startDate > minStart) startDate = minStart;
        } else {
          startDate = addDays(now, -89);
        }
        const totalDays = Math.max(
          1,
          Math.round((now.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24))
        );
        stepDays = Math.max(1, Math.round(totalDays / 30));
        break;
      }
    }

    // Sorted newest-first for backward replay
    const transactions = [...transactionsStore.filteredTransactions].sort(
      (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
    );

    // Build date points from now backwards to startDate
    const datePoints: Date[] = [];
    let cursor = new Date(now);
    while (cursor >= startDate) {
      datePoints.push(new Date(cursor));
      cursor = addDays(cursor, -stepDays);
    }
    if (datePoints[datePoints.length - 1]?.getTime() !== startDate.getTime()) {
      datePoints.push(new Date(startDate));
    }

    // Process: walk date points newest→oldest, reversing transactions after each point
    const result: NetWorthDataPoint[] = [];
    let runningNetWorth = currentNetWorth;
    let txnIdx = 0;

    for (const pointDate of datePoints) {
      // Reverse all transactions that happened after this date point
      while (txnIdx < transactions.length) {
        const txn = transactions[txnIdx]!;
        const txnDate = getStartOfDay(new Date(txn.date));
        if (txnDate <= pointDate) break;

        const converted = convertAmount(txn.amount, txn.currency, baseCurrency, rates);

        if (txn.type === 'income') {
          runningNetWorth -= converted;
        } else if (txn.type === 'expense') {
          runningNetWorth += converted;
        }
        txnIdx++;
      }

      result.push({
        date: pointDate,
        label: formatLabel(pointDate, period),
        value: runningNetWorth,
      });
    }

    // datePoints were built newest→oldest, so reverse to get chronological order
    result.reverse();
    return result;
  });

  /**
   * Period-over-period comparison for net worth.
   */
  const periodComparison = computed<PeriodComparison>(() => {
    const data = chartData.value;
    if (data.length < 2) return { changeAmount: 0, changePercent: 0 };

    const first = data[0];
    const last = data[data.length - 1];
    if (!first || !last) return { changeAmount: 0, changePercent: 0 };
    const startValue = first.value;
    const endValue = last.value;
    const changeAmount = endValue - startValue;
    const changePercent = startValue !== 0 ? (changeAmount / Math.abs(startValue)) * 100 : 0;

    return { changeAmount, changePercent };
  });

  // ── Last month comparison data for SummaryStatCards ────────────────────────

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

  const lastMonthIncome = computed(
    () => lastMonthOneTimeIncome.value + recurringStore.filteredTotalMonthlyRecurringIncome
  );

  const lastMonthExpenses = computed(
    () => lastMonthOneTimeExpenses.value + recurringStore.filteredTotalMonthlyRecurringExpenses
  );

  const lastMonthCashFlow = computed(() => lastMonthIncome.value - lastMonthExpenses.value);

  const incomeChange = computed(() => {
    const thisMonth =
      transactionsStore.filteredThisMonthOneTimeIncome +
      recurringStore.filteredTotalMonthlyRecurringIncome;
    return thisMonth - lastMonthIncome.value;
  });

  const expenseChange = computed(() => {
    const thisMonth =
      transactionsStore.filteredThisMonthOneTimeExpenses +
      recurringStore.filteredTotalMonthlyRecurringExpenses;
    return thisMonth - lastMonthExpenses.value;
  });

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
    selectedPeriod,
    chartData,
    periodComparison,
    incomeChange,
    expenseChange,
    cashFlowChange,
  };
}
