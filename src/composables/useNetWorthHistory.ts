/**
 * Reactive composable for the dashboard NetWorth chart.
 *
 * Thin orchestrator: reads filtered store snapshots, hands them to the
 * pure helpers in `utils/netWorthHistory.ts`, and exposes the resulting
 * data points + an error message if construction fails.
 *
 * Sign conventions, replay invariants, and per-event-type math live in
 * the pure module. Adding a new transaction type or event source should
 * happen there, not here.
 */
import { ref, computed } from 'vue';
import { useAccountsStore } from '@/stores/accountsStore';
import { useAssetsStore } from '@/stores/assetsStore';
import { useTransactionsStore } from '@/stores/transactionsStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useToday } from '@/composables/useToday';
import { buildNetWorthChanges, replayNetWorthHistory } from '@/utils/netWorthHistory';
import {
  addDays,
  getStartOfDay,
  formatDateShort,
  formatMonthYearShort,
  toDateInputValue,
} from '@/utils/date';

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

const DAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function formatLabel(date: Date, period: PeriodKey): string {
  if (period === '1W') {
    return DAYS_SHORT[date.getDay()]!;
  }
  if (period === '1M' || period === '3M') {
    return formatDateShort(toDateInputValue(date));
  }
  return formatMonthYearShort(date);
}

/**
 * Build the descending list of chart-point dates for a given period.
 * Newest-first to match the backward-walk replay direction.
 */
function buildChartPointsNewestFirst(
  period: PeriodKey,
  earliestTxnDate: Date | null,
  now: Date
): Date[] {
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
      if (earliestTxnDate) {
        startDate = getStartOfDay(earliestTxnDate);
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

  const points: Date[] = [];
  let cursor = new Date(now);
  while (cursor >= startDate) {
    points.push(new Date(cursor));
    cursor = addDays(cursor, -stepDays);
  }
  if (points[points.length - 1]?.getTime() !== startDate.getTime()) {
    points.push(new Date(startDate));
  }
  return points;
}

export function useNetWorthHistory() {
  const accountsStore = useAccountsStore();
  const assetsStore = useAssetsStore();
  const transactionsStore = useTransactionsStore();
  const settingsStore = useSettingsStore();
  const { startOfToday } = useToday();

  const selectedPeriod = ref<PeriodKey>('1M');

  /**
   * Single source of truth for chart state. Keeping data + error in one
   * computed (rather than mutating an external ref from inside the
   * computed) avoids the well-known anti-pattern of side effects in
   * computeds, which can fire at surprising times under reactivity changes.
   *
   * `chartData` and `chartError` are thin destructure-computeds over this.
   */
  const chartResult = computed<{ data: NetWorthDataPoint[]; error: string | null }>(() => {
    try {
      const period = selectedPeriod.value;
      const baseCurrency = settingsStore.baseCurrency;
      const rates = settingsStore.exchangeRates;

      const transactions = transactionsStore.filteredTransactions;

      // Filter to net-worth-eligible entities ONCE here; downstream uses
      // these snapshots and assumes they're already eligibility-filtered.
      const eligibleAccounts = accountsStore.filteredAccounts.filter(
        (a) => a.isActive && a.includeInNetWorth
      );
      const eligibleAssets = assetsStore.filteredAssets.filter((a) => a.includeInNetWorth);

      const earliestTxnDate = transactions.length
        ? transactions.reduce<Date>((min, t) => {
            const d = new Date(t.date);
            return d < min ? d : min;
          }, new Date())
        : null;

      const chartPointsNewestFirst = buildChartPointsNewestFirst(
        period,
        earliestTxnDate,
        startOfToday.value
      );

      const changesNewestFirst = buildNetWorthChanges({
        accounts: eligibleAccounts,
        assets: eligibleAssets,
        transactions,
        baseCurrency,
        rates,
      });

      const values = replayNetWorthHistory({
        currentNetWorth: accountsStore.filteredCombinedNetWorth,
        chartPointsNewestFirst,
        changesNewestFirst,
      });

      const data: NetWorthDataPoint[] = chartPointsNewestFirst.map((date, i) => ({
        date,
        label: formatLabel(date, period),
        value: values[i] ?? 0,
      }));
      // Chart consumers expect chronological order (oldest → newest).
      data.reverse();

      return { data, error: null };
    } catch (e) {
      console.error('[useNetWorthHistory] chart construction failed:', e);
      return {
        data: [],
        error: 'Could not render net worth history. Check the console for details.',
      };
    }
  });

  const chartData = computed(() => chartResult.value.data);
  const chartError = computed(() => chartResult.value.error);

  /** Period-over-period comparison: first vs last point in chronological order. */
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

  return {
    selectedPeriod,
    chartData,
    chartError,
    periodComparison,
  };
}
