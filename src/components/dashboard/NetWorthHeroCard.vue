<script setup lang="ts">
import { computed } from 'vue';
import { usePrivacyMode } from '@/composables/usePrivacyMode';
import { useCurrencyDisplay } from '@/composables/useCurrencyDisplay';
import type { CurrencyCode } from '@/types/models';

interface Props {
  /** Net worth amount */
  amount: number;
  /** Currency code */
  currency: CurrencyCode;
  /** Monthly change amount (positive or negative) */
  changeAmount?: number;
  /** Monthly change percentage */
  changePercent?: number;
  /** Label displayed above the amount */
  label?: string;
}

const props = withDefaults(defineProps<Props>(), {
  changeAmount: 0,
  changePercent: 0,
  label: 'Family Net Worth',
});

const { isUnlocked, MASK } = usePrivacyMode();
const { convertToDisplay } = useCurrencyDisplay();

const converted = computed(() => convertToDisplay(props.amount, props.currency));

const formattedAmount = computed(() => {
  if (!isUnlocked.value) return MASK;
  return converted.value.displayFormatted;
});

const changeConverted = computed(() =>
  convertToDisplay(Math.abs(props.changeAmount), props.currency)
);

const isPositiveChange = computed(() => props.changeAmount >= 0);

const periods = [
  { key: '1W', label: '1W' },
  { key: '1M', label: '1M' },
  { key: '3M', label: '3M' },
  { key: '1Y', label: '1Y' },
  { key: 'all', label: 'All' },
] as const;
</script>

<template>
  <div
    class="from-secondary-500 relative overflow-hidden rounded-[var(--sq)] bg-gradient-to-br to-[#3D5368] p-8 text-white"
  >
    <!-- Decorative radial gradient -->
    <div
      class="pointer-events-none absolute -top-[30px] -right-[30px] h-[200px] w-[200px] rounded-full bg-[radial-gradient(circle,rgba(241,93,34,0.15),transparent_70%)]"
    />

    <div class="relative z-10 flex items-start justify-between">
      <div>
        <div
          class="font-outfit mb-2 text-[0.7rem] font-semibold tracking-[0.15em] uppercase opacity-50"
        >
          {{ label }}
        </div>
        <div
          data-testid="hero-amount"
          class="font-outfit mb-1 text-[2.8rem] leading-none font-extrabold"
        >
          {{ formattedAmount }}
        </div>
        <div
          v-if="isUnlocked && (changeAmount !== 0 || changePercent !== 0)"
          class="font-outfit mt-2 inline-flex items-center gap-1.5 text-[0.8rem] font-semibold"
          :class="isPositiveChange ? 'text-emerald-300' : 'text-red-300'"
        >
          <span>{{ isPositiveChange ? '↑' : '↓' }}</span>
          <span v-if="changePercent !== 0">
            {{ isPositiveChange ? '+' : '' }}{{ changePercent.toFixed(1) }}% this month
          </span>
          <span v-if="changeAmount !== 0" class="opacity-60">
            · {{ isPositiveChange ? '+' : '-' }}{{ changeConverted.displayFormatted }}
          </span>
        </div>
      </div>

      <!-- Time period pills -->
      <div class="flex gap-1 rounded-xl bg-white/[0.08] p-[3px]">
        <button
          v-for="period in periods"
          :key="period.key"
          type="button"
          class="font-outfit cursor-pointer rounded-[10px] px-3 py-1.5 text-[0.6rem] font-semibold transition-all"
          :class="
            period.key === '1M'
              ? 'bg-primary-500/40 text-white shadow-[0_2px_8px_rgba(241,93,34,0.2)]'
              : 'text-white/35 hover:text-white/60'
          "
        >
          {{ period.label }}
        </button>
      </div>
    </div>

    <!-- Sparkline area chart placeholder -->
    <div class="relative mt-5 h-20">
      <svg viewBox="0 0 600 80" preserveAspectRatio="none" class="h-full w-full">
        <defs>
          <linearGradient id="nw-chart-gradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="rgba(241,93,34,0.3)" />
            <stop offset="100%" stop-color="rgba(241,93,34,0)" />
          </linearGradient>
        </defs>
        <!-- Grid lines -->
        <line x1="0" y1="20" x2="600" y2="20" stroke="rgba(255,255,255,0.04)" stroke-width="1" />
        <line x1="0" y1="40" x2="600" y2="40" stroke="rgba(255,255,255,0.04)" stroke-width="1" />
        <line x1="0" y1="60" x2="600" y2="60" stroke="rgba(255,255,255,0.04)" stroke-width="1" />
        <!-- Line -->
        <path
          d="M0,60 Q60,55 120,48 T240,35 T360,28 T480,18 T600,8"
          fill="none"
          stroke="rgba(241,93,34,0.6)"
          stroke-width="2"
        />
        <!-- Fill area -->
        <path
          d="M0,60 Q60,55 120,48 T240,35 T360,28 T480,18 T600,8 L600,80 L0,80 Z"
          fill="url(#nw-chart-gradient)"
        />
        <!-- Current point -->
        <circle cx="600" cy="8" r="4" fill="#F15D22" stroke="white" stroke-width="2" />
      </svg>
    </div>
  </div>
</template>
