<script setup lang="ts">
import { computed } from 'vue';
import type { AccountType } from '@/types/models';

const props = defineProps<{
  type: AccountType;
  size?: 'sm' | 'md' | 'lg';
}>();

const sizeClasses = computed(() => {
  switch (props.size) {
    case 'sm': return 'w-3.5 h-3.5';
    case 'lg': return 'w-5 h-5';
    default: return 'w-4 h-4';
  }
});

// Map account types to SVG paths and colors
const accountTypeConfig: Record<AccountType, { path: string; color: string; label: string }> = {
  checking: {
    path: 'M3 6h18M3 12h18M3 18h18',
    color: '#3b82f6',
    label: 'Checking'
  },
  savings: {
    path: 'M19 5h-14a2 2 0 00-2 2v10a2 2 0 002 2h14a2 2 0 002-2v-10a2 2 0 00-2-2zM12 15a3 3 0 100-6 3 3 0 000 6z',
    color: '#10b981',
    label: 'Savings'
  },
  credit_card: {
    path: 'M1 5a2 2 0 012-2h18a2 2 0 012 2v14a2 2 0 01-2 2H3a2 2 0 01-2-2V5zM1 10h22',
    color: '#8b5cf6',
    label: 'Credit Card'
  },
  investment: {
    path: 'M23 6l-9.5 9.5-5-5L1 18M17 6h6v6',
    color: '#f59e0b',
    label: 'Investment'
  },
  crypto: {
    path: 'M11.767 19.089c4.924.868 6.14-6.025 1.216-6.894m-1.216 6.894L5.86 18.047m5.908 1.042l-.347 1.97m1.563-8.864c4.924.869 6.14-6.025 1.215-6.893m-1.215 6.893l-3.94-.694m5.155-6.2L8.29 4.26m5.908 1.042l.348-1.97M7.48 20.364l3.126-17.727',
    color: '#f97316',
    label: 'Crypto'
  },
  cash: {
    path: 'M12 2v20M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6',
    color: '#22c55e',
    label: 'Cash'
  },
  loan: {
    path: 'M12 2v6m0 8v6M9 8h6a3 3 0 013 3v2a3 3 0 01-3 3H9a3 3 0 01-3-3v-2a3 3 0 013-3z',
    color: '#ef4444',
    label: 'Loan'
  },
  other: {
    path: 'M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10zM12 6v6l4 2',
    color: '#6b7280',
    label: 'Other'
  }
};

const config = computed(() => accountTypeConfig[props.type] || accountTypeConfig.other);
</script>

<template>
  <span
    class="inline-flex items-center justify-center"
    :style="{ color: config.color }"
    :title="config.label"
  >
    <svg
      :class="sizeClasses"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <path :d="config.path" />
    </svg>
  </span>
</template>
