import { computed, type Ref } from 'vue';
import { useRecurringStore } from '@/stores/recurringStore';
import { useToday } from '@/composables/useToday';
import { projectRecurringTransactions } from '@/services/recurring/recurringProcessor';
import type { DisplayTransaction } from '@/types/models';
import { getStartOfMonth, getEndOfMonth } from '@/utils/date';

/**
 * Generates ephemeral projected transactions for the current and future months
 * from active recurring items. Projections are never written to IndexedDB.
 * The page-level dedup in TransactionsPage filters out projections that
 * already have a real (materialized) transaction for the same date.
 */
export function useProjectedTransactions(selectedMonth: Ref<Date>) {
  const recurringStore = useRecurringStore();

  const { startOfToday } = useToday();

  const isFutureMonth = computed(() => {
    const monthStart = getStartOfMonth(selectedMonth.value);
    return monthStart > startOfToday.value;
  });

  const isCurrentOrFutureMonth = computed(() => {
    const monthEnd = getEndOfMonth(selectedMonth.value);
    return monthEnd >= startOfToday.value;
  });

  const projectedTransactions = computed<DisplayTransaction[]>(() => {
    if (!isCurrentOrFutureMonth.value) return [];

    const start = getStartOfMonth(selectedMonth.value);
    const end = getEndOfMonth(selectedMonth.value);
    return projectRecurringTransactions(recurringStore.filteredActiveItems, start, end);
  });

  return { isFutureMonth, projectedTransactions };
}
