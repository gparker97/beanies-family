<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { Line } from 'vue-chartjs';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Filler,
  Tooltip,
} from 'chart.js';
import { usePrivacyMode } from '@/composables/usePrivacyMode';
import { useCurrencyDisplay } from '@/composables/useCurrencyDisplay';
import type { CurrencyCode } from '@/types/models';
import type { PeriodKey, NetWorthDataPoint } from '@/composables/useNetWorthHistory';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Filler, Tooltip);

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
  /** Selected time period */
  selectedPeriod?: PeriodKey;
  /** Chart data points */
  historyData?: NetWorthDataPoint[];
}

const props = withDefaults(defineProps<Props>(), {
  changeAmount: 0,
  changePercent: 0,
  label: 'Family Net Worth',
  selectedPeriod: '1M',
  historyData: () => [],
});

const emit = defineEmits<{
  'update:selectedPeriod': [period: PeriodKey];
}>();

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

const periods: { key: PeriodKey; label: string }[] = [
  { key: '1W', label: '1W' },
  { key: '1M', label: '1M' },
  { key: '3M', label: '3M' },
  { key: '1Y', label: '1Y' },
  { key: 'all', label: 'All' },
];

function selectPeriod(key: PeriodKey) {
  emit('update:selectedPeriod', key);
}

// ── Chart configuration ─────────────────────────────────────────────────────

const chartCanvasKey = ref(0);

// Rerender chart when privacy mode changes
watch(
  () => isUnlocked.value,
  () => {
    chartCanvasKey.value++;
  }
);

const chartDataConfig = computed(() => {
  const data = props.historyData;
  if (!isUnlocked.value || data.length === 0) {
    return {
      labels: [] as string[],
      datasets: [],
    };
  }

  return {
    labels: data.map((d) => d.label),
    datasets: [
      {
        data: data.map((d) => d.value),
        borderColor: '#F15D22',
        borderWidth: 2,
        backgroundColor: (ctx: { chart: ChartJS }) => {
          const chart = ctx.chart;
          const { ctx: canvasCtx, chartArea } = chart;
          if (!chartArea) return 'rgba(241,93,34,0)';
          const gradient = canvasCtx.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
          gradient.addColorStop(0, 'rgba(241,93,34,0.3)');
          gradient.addColorStop(1, 'rgba(241,93,34,0)');
          return gradient;
        },
        fill: true,
        tension: 0.35,
        pointRadius: 0,
        pointHoverRadius: 4,
        pointHoverBackgroundColor: '#F15D22',
        pointHoverBorderColor: '#FFFFFF',
        pointHoverBorderWidth: 2,
      },
    ],
  };
});

const chartOptions = computed(() => ({
  responsive: true,
  maintainAspectRatio: false,
  animation: {
    duration: 400,
    easing: 'easeOutQuart' as const,
  },
  interaction: {
    intersect: false,
    mode: 'index' as const,
  },
  plugins: {
    legend: { display: false },
    tooltip: {
      enabled: isUnlocked.value,
      backgroundColor: 'rgba(44,62,80,0.95)',
      titleColor: 'rgba(255,255,255,0.6)',
      bodyColor: '#FFFFFF',
      titleFont: { family: 'Outfit', size: 11 },
      bodyFont: { family: 'Outfit', size: 13, weight: 'bold' as const },
      padding: { top: 8, bottom: 8, left: 12, right: 12 },
      cornerRadius: 10,
      displayColors: false,
      callbacks: {
        label: (ctx: { parsed: { y: number | null } }) => {
          if (!isUnlocked.value) return MASK;
          const val = ctx.parsed.y ?? 0;
          return convertToDisplay(val, props.currency).displayFormatted;
        },
      },
    },
  },
  scales: {
    x: {
      display: false,
      grid: { display: false },
    },
    y: {
      display: false,
      grid: {
        display: true,
        color: 'rgba(255,255,255,0.04)',
        lineWidth: 1,
      },
    },
  },
  elements: {
    line: {
      capBezierPoints: true,
    },
  },
}));

// Show last data point as a glowing dot via a custom dataset
const chartDataWithDot = computed(() => {
  const base = chartDataConfig.value;
  if (!isUnlocked.value || base.datasets.length === 0) return base;

  const values = props.historyData.map((d) => d.value);
  // Create array of nulls with only the last point set
  const lastPointData: (number | null)[] = values.map((_, i) =>
    i === values.length - 1 ? (values[i] ?? null) : null
  );

  return {
    ...base,
    datasets: [
      ...base.datasets,
      {
        data: lastPointData,
        borderColor: 'transparent',
        backgroundColor: '#F15D22',
        pointRadius: 5,
        pointBorderColor: '#FFFFFF',
        pointBorderWidth: 2,
        pointHoverRadius: 6,
        fill: false,
        showLine: false,
      },
    ],
  };
});

const periodLabel = computed(() => {
  switch (props.selectedPeriod) {
    case '1W':
      return 'this week';
    case '1M':
      return 'this month';
    case '3M':
      return 'past 3 months';
    case '1Y':
      return 'this year';
    case 'all':
      return 'all time';
    default:
      return 'this month';
  }
});
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
            {{ isPositiveChange ? '+' : '' }}{{ changePercent.toFixed(1) }}% {{ periodLabel }}
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
            period.key === selectedPeriod
              ? 'bg-primary-500/40 text-white shadow-[0_2px_8px_rgba(241,93,34,0.2)]'
              : 'text-white/35 hover:text-white/60'
          "
          @click="selectPeriod(period.key)"
        >
          {{ period.label }}
        </button>
      </div>
    </div>

    <!-- Chart area -->
    <div class="relative mt-5 h-20">
      <div v-if="!isUnlocked" class="flex h-full items-center justify-center">
        <span class="font-outfit text-[0.75rem] font-medium text-white/20"> Chart hidden </span>
      </div>
      <div v-else-if="historyData.length === 0" class="flex h-full items-center justify-center">
        <span class="font-outfit text-[0.75rem] font-medium text-white/20"> No data yet </span>
      </div>
      <Line
        v-else
        :key="chartCanvasKey"
        :data="chartDataWithDot"
        :options="chartOptions"
        class="h-full w-full"
      />
    </div>
  </div>
</template>
