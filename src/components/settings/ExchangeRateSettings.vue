<script setup lang="ts">
import { onMounted } from 'vue';
import { BaseCard, BaseButton } from '@/components/ui';
import { useExchangeRates } from '@/composables/useExchangeRates';
import { getCurrencyInfo } from '@/constants/currencies';
import { useSettingsStore } from '@/stores/settingsStore';
import { useTranslation } from '@/composables/useTranslation';

const { t } = useTranslation();

/**
 * `readOnly` locks the family-shared *auto-update preference* (a config toggle)
 * for non-admins. It deliberately does NOT gate the manual Refresh/Fetch buttons —
 * pulling current rates is a non-destructive utility that any member may use.
 */
const props = withDefaults(defineProps<{ standalone?: boolean; readOnly?: boolean }>(), {
  standalone: true,
  readOnly: false,
});

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
  if (props.readOnly) return; // defense in depth — the toggle also renders disabled
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
  <component
    :is="props.standalone ? BaseCard : 'div'"
    :title="props.standalone ? t('settings.exchangeRates.title') : undefined"
  >
    <div class="space-y-4">
      <!-- Last update info -->
      <div class="flex items-center justify-between">
        <div>
          <p class="dark:text-ink-soft text-sm text-gray-500">
            {{ t('settings.exchangeRates.lastUpdated') }}
            <span
              :class="
                isStale
                  ? 'dark:text-terracotta-lift text-yellow-600'
                  : 'dark:text-ink-soft text-gray-700'
              "
            >
              {{ lastUpdateFormatted }}
            </span>
          </p>
          <p v-if="isStale" class="dark:text-terracotta-lift mt-1 text-xs text-yellow-600">
            {{ t('settings.exchangeRates.stale') }}
          </p>
        </div>
        <BaseButton variant="secondary" size="sm" :disabled="isUpdating" @click="handleRefresh">
          <span v-if="isUpdating" class="flex items-center gap-2">
            <img
              src="/brand/beanies_spinner_transparent_192x192.png"
              alt=""
              class="h-4 w-4 animate-spin"
              style="animation-duration: 1.8s"
            />
            {{ t('settings.exchangeRates.updating') }}
          </span>
          <span v-else>{{ t('settings.exchangeRates.refresh') }}</span>
        </BaseButton>
      </div>

      <!-- Error message -->
      <div v-if="updateError" class="rounded-lg bg-red-50 p-3 dark:bg-red-900/20">
        <p class="dark:text-danger-lift text-sm text-red-700">{{ updateError }}</p>
      </div>

      <!-- Auto-update toggle -->
      <div class="dark:border-line flex items-center justify-between border-t border-gray-100 py-2">
        <div>
          <p class="dark:text-ink-soft text-sm font-medium text-gray-700">
            {{ t('settings.exchangeRates.autoUpdate') }}
          </p>
          <p class="dark:text-ink-soft text-xs text-gray-500">
            {{ t('settings.exchangeRates.autoUpdateHint') }}
          </p>
        </div>
        <button
          type="button"
          role="switch"
          :aria-checked="autoUpdateEnabled"
          :disabled="props.readOnly"
          :class="[
            'relative inline-flex h-6 w-11 flex-shrink-0 rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:outline-none',
            autoUpdateEnabled ? 'bg-blue-600' : 'dark:bg-surface-overlay bg-gray-200',
            props.readOnly ? 'cursor-not-allowed opacity-50' : 'cursor-pointer',
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
      <div v-if="exchangeRates.length > 0" class="dark:border-line border-t border-gray-100 pt-4">
        <p class="dark:text-ink-soft mb-3 text-sm font-medium text-gray-700">
          {{
            t('settings.exchangeRates.currentRates').replace('{base}', settingsStore.baseCurrency)
          }}
        </p>
        <div class="max-h-64 overflow-y-auto">
          <table class="w-full text-sm">
            <thead class="dark:bg-surface-raised sticky top-0 bg-white">
              <tr class="dark:text-ink-soft text-left text-gray-500">
                <th class="pb-2 font-medium">{{ t('settings.exchangeRates.currency') }}</th>
                <th class="pb-2 text-right font-medium">
                  {{ t('settings.exchangeRates.rate') }}
                </th>
              </tr>
            </thead>
            <tbody class="dark:divide-surface-overlay divide-y divide-gray-100">
              <tr
                v-for="rate in exchangeRates"
                :key="`${rate.from}-${rate.to}`"
                class="dark:text-ink-soft text-gray-700"
              >
                <td class="py-2">
                  <span class="font-medium">{{ rate.to }}</span>
                  <span class="dark:text-ink-faint ml-1 text-xs text-gray-400">
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
      <div v-else class="dark:border-line border-t border-gray-100 py-6 text-center">
        <svg
          class="dark:text-ink-faint mx-auto mb-3 h-10 w-10 text-gray-300"
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
        <p class="dark:text-ink-soft mb-3 text-sm text-gray-500">
          {{ t('settings.exchangeRates.empty') }}
        </p>
        <BaseButton variant="secondary" size="sm" :disabled="isUpdating" @click="handleRefresh">
          {{ t('settings.exchangeRates.fetch') }}
        </BaseButton>
      </div>
    </div>
  </component>
</template>
