<script setup lang="ts">
import AmountInput from '@/components/ui/AmountInput.vue';
import { useSettingsStore } from '@/stores/settingsStore';
import { useCurrencyOptions } from '@/composables/useCurrencyOptions';

withDefaults(
  defineProps<{
    amount?: number;
    currency: string;
    fontSize?: string;
  }>(),
  {
    amount: undefined,
    fontSize: '1.8rem',
  }
);

const emit = defineEmits<{
  'update:amount': [value: number | undefined];
  'update:currency': [value: string];
}>();

const settingsStore = useSettingsStore();
const { currencyOptions } = useCurrencyOptions();

function onCurrencyChange(event: Event) {
  emit('update:currency', (event.target as HTMLSelectElement).value);
}
</script>

<template>
  <div class="flex items-stretch gap-2">
    <div class="relative flex-shrink-0">
      <select
        :value="currency"
        class="focus:border-primary-500 font-outfit h-full w-[82px] cursor-pointer appearance-none rounded-[16px] border-2 border-transparent bg-[var(--tint-slate-5)] px-3 pr-7 text-center text-sm font-bold text-[var(--color-text)] transition-all duration-200 focus:shadow-[0_0_0_3px_rgba(241,93,34,0.1)] focus:outline-none dark:bg-slate-700 dark:text-gray-100"
        @change="onCurrencyChange"
      >
        <option v-for="opt in currencyOptions" :key="opt.value" :value="opt.value">
          {{ opt.value }}
        </option>
      </select>
      <div class="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-2">
        <svg
          class="h-3 w-3 text-[var(--color-text)] opacity-35"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M19 9l-7 7-7-7"
          />
        </svg>
      </div>
    </div>
    <div class="min-w-0 flex-1">
      <AmountInput
        :model-value="amount"
        :currency-symbol="currency || settingsStore.displayCurrency"
        :font-size="fontSize"
        @update:model-value="emit('update:amount', $event)"
      />
    </div>
  </div>
</template>
