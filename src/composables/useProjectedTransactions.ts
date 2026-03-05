import { computed, type Ref } from 'vue';
import { useRecurringStore } from '@/stores/recurringStore';
import { getDueDatesInRange } from '@/services/recurring/recurringProcessor';
import type { DisplayTransaction } from '@/types/models';
import { getStartOfMonth, getEndOfMonth, getStartOfDay, toDateInputValue } from '@/utils/date';

/**
 * Generates ephemeral projected transactions for the current and future months
 * from active recurring items. Projections are never written to IndexedDB.
 * The page-level dedup in TransactionsPage filters out projections that
 * already have a real (materialized) transaction for the same date.
 */
export function useProjectedTransactions(selectedMonth: Ref<Date>) {
  const recurringStore = useRecurringStore();

  const isFutureMonth = computed(() => {
    const monthStart = getStartOfMonth(selectedMonth.value);
    const today = getStartOfDay(new Date());
    return monthStart > today;
  });

  const isCurrentOrFutureMonth = computed(() => {
    const monthEnd = getEndOfMonth(selectedMonth.value);
    const today = getStartOfDay(new Date());
    return monthEnd >= today;
  });

  const projectedTransactions = computed<DisplayTransaction[]>(() => {
    if (!isCurrentOrFutureMonth.value) return [];

    const start = getStartOfMonth(selectedMonth.value);
    const end = getEndOfMonth(selectedMonth.value);
    const projected: DisplayTransaction[] = [];

    for (const item of recurringStore.filteredActiveItems) {
      for (const date of getDueDatesInRange(item, start, end)) {
        projected.push({
          id: `projected-${item.id}-${toDateInputValue(date)}`,
          accountId: item.accountId,
          type: item.type,
          amount: item.amount,
          currency: item.currency,
          category: item.category,
          date: toDateInputValue(date),
          description: item.description,
          recurringItemId: item.id,
          isReconciled: false,
          isProjected: true,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
      }
    }

    return projected;
  });

  return { isFutureMonth, projectedTransactions };
}
