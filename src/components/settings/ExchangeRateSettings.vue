<script setup lang="ts">
import { onMounted } from 'vue';
import { BaseCard, BaseButton } from '@/components/ui';
import { useExchangeRates } from '@/composables/useExchangeRates';
import { getCurrencyInfo } from '@/constants/currencies';
import { useSettingsStore } from '@/stores/settingsStore';

const settingsStore = useSettingsStore();
const {
  isUpdating,
  updateError,
  isStale,
  lastUpdateFormatted,
  autoUpdateEnabled,
  exchangeRates,
  checkStaleness,
  refreshRates,
  setAutoUpdate,
  clearError,
} = useExchangeRates();

onMounted(async () => {
  await checkStaleness();
});

async function handleRefresh() {
  clearError();
  await refreshRates();
}

async function toggleAutoUpdate() {
  await setAutoUpdate(!autoUpdateEnabled.value);
}

function formatRate(rate: number): string {
  if (rate >= 100) {
    return rate.toFixed(2);
  } else if (rate >= 1) {
    return rate.toFixed(4);
  } else {
    return rate.toFixed(6);
  }
}
</script>

<template>
  <BaseCard title="Exchange Rates">
    <div class="space-y-4">
      <!-- Last update info -->
      <div class="flex items-center justify-between">
        <div>
          <p class="text-sm text-gray-500 dark:text-gray-400">
            Last updated:
            <span
              :class="
                isStale
                  ? 'text-yellow-600 dark:text-yellow-400'
                  : 'text-gray-700 dark:text-gray-300'
              "
            >
              {{ lastUpdateFormatted }}
            </span>
          </p>
          <p v-if="isStale" class="mt-1 text-xs text-yellow-600 dark:text-yellow-400">
            Rates may be outdated
          </p>
        </div>
        <BaseButton variant="secondary" size="sm" :disabled="isUpdating" @click="handleRefresh">
          <span v-if="isUpdating" class="flex items-center gap-2">
            <svg class="h-4 w-4 animate-spin" viewBox="0 0 24 24">
              <circle
                class="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                stroke-width="4"
                fill="none"
              />
              <path
                class="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
              />
            </svg>
            Updating...
          </span>
          <span v-else>Refresh Rates</span>
        </BaseButton>
      </div>

      <!-- Error message -->
      <div v-if="updateError" class="rounded-lg bg-red-50 p-3 dark:bg-red-900/20">
        <p class="text-sm text-red-700 dark:text-red-300">{{ updateError }}</p>
      </div>

      <!-- Auto-update toggle -->
      <div
        class="flex items-center justify-between border-t border-gray-100 py-2 dark:border-slate-700"
      >
        <div>
          <p class="text-sm font-medium text-gray-700 dark:text-gray-300">Auto-update rates</p>
          <p class="text-xs text-gray-500 dark:text-gray-400">
            Automatically fetch new rates daily on app start
          </p>
        </div>
        <button
          type="button"
          role="switch"
          :aria-checked="autoUpdateEnabled"
          :class="[
            'relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:outline-none',
            autoUpdateEnabled ? 'bg-blue-600' : 'bg-gray-200 dark:bg-gray-700',
          ]"
          @click="toggleAutoUpdate"
        >
          <span
            :class="[
              'pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out',
              autoUpdateEnabled ? 'translate-x-5' : 'translate-x-0',
            ]"
          />
        </button>
      </div>

      <!-- Exchange rates table -->
      <div
        v-if="exchangeRates.length > 0"
        class="border-t border-gray-100 pt-4 dark:border-slate-700"
      >
        <p class="mb-3 text-sm font-medium text-gray-700 dark:text-gray-300">
          Current rates (base: {{ settingsStore.baseCurrency }})
        </p>
        <div class="max-h-64 overflow-y-auto">
          <table class="w-full text-sm">
            <thead class="sticky top-0 bg-white dark:bg-slate-800">
              <tr class="text-left text-gray-500 dark:text-gray-400">
                <th class="pb-2 font-medium">Currency</th>
                <th class="pb-2 text-right font-medium">Rate</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-100 dark:divide-slate-700">
              <tr
                v-for="rate in exchangeRates"
                :key="`${rate.from}-${rate.to}`"
                class="text-gray-700 dark:text-gray-300"
              >
                <td class="py-2">
                  <span class="font-medium">{{ rate.to }}</span>
                  <span class="ml-1 text-xs text-gray-400 dark:text-gray-500">
                    {{ getCurrencyInfo(rate.to)?.name }}
                  </span>
                </td>
                <td class="py-2 text-right font-mono">
                  {{ formatRate(rate.rate) }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- Empty state -->
      <div v-else class="border-t border-gray-100 py-6 text-center dark:border-slate-700">
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
            d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
        <p class="mb-3 text-sm text-gray-500 dark:text-gray-400">No exchange rates loaded yet</p>
        <BaseButton variant="secondary" size="sm" :disabled="isUpdating" @click="handleRefresh">
          Fetch Rates
        </BaseButton>
      </div>
    </div>
  </BaseCard>
</template>
