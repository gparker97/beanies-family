<script setup lang="ts">
import { useAssetsStore } from '@/stores/assetsStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { BaseCard } from '@/components/ui';
import { useCurrencyDisplay } from '@/composables/useCurrencyDisplay';

const assetsStore = useAssetsStore();
const settingsStore = useSettingsStore();
const { formatInDisplayCurrency } = useCurrencyDisplay();

function formatTotal(amount: number): string {
  return formatInDisplayCurrency(amount, settingsStore.baseCurrency);
}
</script>

<template>
  <div class="space-y-6">
    <div class="flex items-center justify-between">
      <div>
        <h1 class="text-2xl font-bold text-gray-900 dark:text-gray-100">Assets</h1>
        <p class="text-gray-500 dark:text-gray-400">Track your property, vehicles, and valuables</p>
      </div>
    </div>

    <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
      <BaseCard>
        <p class="text-sm text-gray-500 dark:text-gray-400">Total Asset Value</p>
        <p class="text-2xl font-bold text-green-600 dark:text-green-400 mt-1">
          {{ formatTotal(assetsStore.totalAssetValue) }}
        </p>
      </BaseCard>
      <BaseCard>
        <p class="text-sm text-gray-500 dark:text-gray-400">Total Purchase Value</p>
        <p class="text-2xl font-bold text-gray-600 dark:text-gray-400 mt-1">
          {{ formatTotal(assetsStore.totalPurchaseValue) }}
        </p>
      </BaseCard>
      <BaseCard>
        <p class="text-sm text-gray-500 dark:text-gray-400">Total Appreciation</p>
        <p
          class="text-2xl font-bold mt-1"
          :class="assetsStore.totalAppreciation >= 0 ? 'text-green-600' : 'text-red-600'"
        >
          {{ formatTotal(assetsStore.totalAppreciation) }}
        </p>
      </BaseCard>
    </div>

    <BaseCard title="Assets">
      <div class="text-center py-12 text-gray-500 dark:text-gray-400">
        <p>Asset tracking coming soon.</p>
        <p class="mt-2">Track real estate, vehicles, investments, and more.</p>
      </div>
    </BaseCard>
  </div>
</template>
