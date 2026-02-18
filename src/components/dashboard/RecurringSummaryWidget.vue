<script setup lang="ts">
import { computed } from 'vue';
import CurrencyAmount from '@/components/common/CurrencyAmount.vue';
import { BaseCard } from '@/components/ui';
import { useCurrencyDisplay } from '@/composables/useCurrencyDisplay';
import { usePrivacyMode } from '@/composables/usePrivacyMode';
import { getNextDueDateForItem } from '@/services/recurring/recurringProcessor';
import { useRecurringStore } from '@/stores/recurringStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { formatDateShort } from '@/utils/date';

const recurringStore = useRecurringStore();
const settingsStore = useSettingsStore();
const { formatInDisplayCurrency } = useCurrencyDisplay();
const { formatMasked } = usePrivacyMode();

// Uses filtered data based on global member filter
const monthlyIncome = computed(() =>
  formatInDisplayCurrency(
    recurringStore.filteredTotalMonthlyRecurringIncome,
    settingsStore.baseCurrency
  )
);

const monthlyExpenses = computed(() =>
  formatInDisplayCurrency(
    recurringStore.filteredTotalMonthlyRecurringExpenses,
    settingsStore.baseCurrency
  )
);

const netRecurring = computed(() => recurringStore.filteredNetMonthlyRecurring);

const netRecurringFormatted = computed(() =>
  formatInDisplayCurrency(Math.abs(netRecurring.value), settingsStore.baseCurrency)
);

// Get upcoming items sorted by next due date (uses filtered data)
const upcomingItems = computed(() => {
  const itemsWithDates = recurringStore.filteredActiveItems
    .map((item) => ({
      item,
      nextDate: getNextDueDateForItem(item),
    }))
    .filter((i) => i.nextDate !== null)
    .sort((a, b) => a.nextDate!.getTime() - b.nextDate!.getTime());

  return itemsWithDates.slice(0, 5);
});
</script>

<template>
  <BaseCard title="Recurring Summary">
    <div class="space-y-4">
      <!-- Empty state -->
      <div v-if="recurringStore.filteredRecurringItems.length === 0" class="py-4 text-center">
        <svg
          class="mx-auto mb-3 h-10 w-10 text-gray-300 dark:text-gray-600"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
          />
        </svg>
        <p class="text-sm text-gray-500 dark:text-gray-400">No recurring items yet</p>
      </div>

      <!-- Monthly totals -->
      <div v-else>
        <div class="grid grid-cols-2 gap-4">
          <div>
            <p class="text-sm text-gray-500 dark:text-gray-400">Monthly Income</p>
            <p class="text-lg font-semibold text-green-600 dark:text-green-400">
              {{ formatMasked('+' + monthlyIncome) }}
            </p>
          </div>
          <div>
            <p class="text-sm text-gray-500 dark:text-gray-400">Monthly Expenses</p>
            <p class="text-lg font-semibold text-red-600 dark:text-red-400">
              {{ formatMasked('-' + monthlyExpenses) }}
            </p>
          </div>
        </div>

        <!-- Net -->
        <div class="border-t border-gray-100 pt-3 dark:border-slate-700">
          <p class="text-sm text-gray-500 dark:text-gray-400">Net Recurring (Monthly)</p>
          <p
            class="text-xl font-bold"
            :class="
              netRecurring >= 0
                ? 'text-green-600 dark:text-green-400'
                : 'text-red-600 dark:text-red-400'
            "
          >
            {{ formatMasked((netRecurring >= 0 ? '+' : '-') + netRecurringFormatted) }}
          </p>
        </div>

        <!-- Upcoming items -->
        <div
          v-if="upcomingItems.length > 0"
          class="border-t border-gray-100 pt-3 dark:border-slate-700"
        >
          <p class="mb-2 text-sm text-gray-500 dark:text-gray-400">Upcoming</p>
          <div class="space-y-2">
            <div
              v-for="{ item, nextDate } in upcomingItems"
              :key="item.id"
              class="flex items-center justify-between text-sm"
            >
              <div class="flex min-w-0 items-center gap-2">
                <span
                  class="h-2 w-2 flex-shrink-0 rounded-full"
                  :class="item.type === 'income' ? 'bg-green-500' : 'bg-red-500'"
                />
                <span class="truncate text-gray-700 dark:text-gray-300">
                  {{ item.description }}
                </span>
              </div>
              <div class="ml-2 flex flex-shrink-0 items-center gap-2">
                <span class="text-xs text-gray-400 dark:text-gray-500">
                  {{ nextDate ? formatDateShort(nextDate.toISOString()) : '' }}
                </span>
                <CurrencyAmount
                  :amount="item.amount"
                  :currency="item.currency"
                  :type="item.type === 'income' ? 'income' : 'expense'"
                  size="sm"
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </BaseCard>
</template>
