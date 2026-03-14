<script setup lang="ts">
import { computed } from 'vue';
import { useRouter } from 'vue-router';
import CurrencyAmount from '@/components/common/CurrencyAmount.vue';
import InfoHintBadge from '@/components/ui/InfoHintBadge.vue';
import { useTranslation } from '@/composables/useTranslation';
import { useAccountsStore } from '@/stores/accountsStore';
import { useAssetsStore } from '@/stores/assetsStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { convertToBaseCurrency } from '@/utils/currency';
import type { AccountType } from '@/types/models';
import type { UIStringKey } from '@/services/translation/uiStrings';

const router = useRouter();
const { t } = useTranslation();
const accountsStore = useAccountsStore();
const assetsStore = useAssetsStore();
const settingsStore = useSettingsStore();

// ── Category definitions ────────────────────────────────────────────────────

interface CategoryDef {
  key: string;
  labelKey: UIStringKey;
  emoji: string;
  color: string;
  types: AccountType[];
  route: string;
}

const CATEGORIES: CategoryDef[] = [
  {
    key: 'cash',
    labelKey: 'dashboard.breakdown.cash',
    emoji: '💵',
    color: '#27AE60',
    types: ['checking', 'savings', 'cash'],
    route: '/accounts?groupBy=category',
  },
  {
    key: 'investments',
    labelKey: 'dashboard.breakdown.investments',
    emoji: '📈',
    color: '#3498DB',
    types: ['investment', 'education_529', 'education_savings', 'other'],
    route: '/accounts?groupBy=category',
  },
  {
    key: 'crypto',
    labelKey: 'dashboard.breakdown.crypto',
    emoji: '🪙',
    color: '#9B59B6',
    types: ['crypto'],
    route: '/accounts?groupBy=category',
  },
  {
    key: 'retirement',
    labelKey: 'dashboard.breakdown.retirement',
    emoji: '🏖️',
    color: '#E67E22',
    types: [
      'retirement_401k',
      'retirement_ira',
      'retirement_roth_ira',
      'retirement_bene_ira',
      'retirement_kids_ira',
      'retirement',
    ],
    route: '/accounts?groupBy=category',
  },
];

const ASSETS_DEF = {
  key: 'assets',
  labelKey: 'dashboard.breakdown.assets' as UIStringKey,
  emoji: '🏠',
  color: '#2C3E50',
  route: '/assets',
};

// ── Computed breakdown ──────────────────────────────────────────────────────

const baseCurrency = computed(() => settingsStore.baseCurrency);

interface BreakdownItem {
  key: string;
  labelKey: UIStringKey;
  emoji: string;
  color: string;
  amount: number;
  percent: number;
  route: string;
}

const accountCategoryTotals = computed(() => {
  const accounts = accountsStore.filteredActiveAccounts.filter((a) => a.includeInNetWorth);
  const totals = new Map<string, number>();

  for (const cat of CATEGORIES) {
    let sum = 0;
    for (const account of accounts) {
      if (cat.types.includes(account.type)) {
        sum += convertToBaseCurrency(account.balance, account.currency);
      }
    }
    if (sum > 0) totals.set(cat.key, sum);
  }
  return totals;
});

const assetTotal = computed(() => assetsStore.filteredTotalAssetValue);
const liabilities = computed(() => accountsStore.filteredAccountLiabilities);

const grossTotal = computed(() => {
  let sum = 0;
  for (const val of accountCategoryTotals.value.values()) sum += val;
  if (assetTotal.value > 0) sum += assetTotal.value;
  return sum;
});

const categories = computed<BreakdownItem[]>(() => {
  if (grossTotal.value <= 0) return [];

  const items: BreakdownItem[] = [];

  // Build items in defined order: cash, investments, crypto, assets, retirement
  for (const cat of CATEGORIES) {
    const amount = accountCategoryTotals.value.get(cat.key) ?? 0;

    // Insert assets before retirement to maintain display order
    if (cat.key === 'retirement' && assetTotal.value > 0) {
      items.push({
        key: ASSETS_DEF.key,
        labelKey: ASSETS_DEF.labelKey,
        emoji: ASSETS_DEF.emoji,
        color: ASSETS_DEF.color,
        amount: assetTotal.value,
        percent: (assetTotal.value / grossTotal.value) * 100,
        route: ASSETS_DEF.route,
      });
    }

    if (amount <= 0) continue;
    items.push({
      key: cat.key,
      labelKey: cat.labelKey,
      emoji: cat.emoji,
      color: cat.color,
      amount,
      percent: (amount / grossTotal.value) * 100,
      route: cat.route,
    });
  }

  // If no retirement category existed but assets do, append assets
  if (assetTotal.value > 0 && !items.some((i) => i.key === 'assets')) {
    items.push({
      key: ASSETS_DEF.key,
      labelKey: ASSETS_DEF.labelKey,
      emoji: ASSETS_DEF.emoji,
      color: ASSETS_DEF.color,
      amount: assetTotal.value,
      percent: (assetTotal.value / grossTotal.value) * 100,
      route: ASSETS_DEF.route,
    });
  }

  return items;
});

const hasData = computed(() => categories.value.length > 0 || liabilities.value > 0);

function formatPercent(pct: number): string {
  if (pct < 1) return '<1%';
  return `${Math.round(pct)}%`;
}
</script>

<template>
  <div
    v-if="hasData"
    class="rounded-[var(--sq)] px-5 pt-5 pb-4"
    style="
      background: linear-gradient(
        135deg,
        rgb(44 62 80 / 3%) 0%,
        rgb(174 214 241 / 6%) 50%,
        rgb(241 93 34 / 3%) 100%
      );
    "
  >
    <!-- Header -->
    <div class="mb-4 flex items-center gap-1.5">
      <div class="nook-section-label text-secondary-500 dark:text-gray-400">
        {{ t('dashboard.netWorthBreakdown') }}
      </div>
      <InfoHintBadge :text="t('hints.netWorthBreakdown')" />
    </div>

    <!-- Category tile grid: 2 cols mobile, 3 cols tablet, 5 cols desktop -->
    <div class="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
      <div
        v-for="cat in categories"
        :key="cat.key"
        class="cursor-pointer overflow-hidden rounded-[var(--sq)] bg-white shadow-[var(--card-shadow)] transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:shadow-[var(--card-hover-shadow)] dark:bg-slate-800"
        @click="router.push(cat.route)"
      >
        <!-- Color accent bar -->
        <div class="h-1" :style="{ backgroundColor: cat.color }" />

        <div class="px-4 pt-3 pb-4">
          <!-- Emoji + Label -->
          <div class="mb-2 flex items-center gap-1.5">
            <span class="text-base">{{ cat.emoji }}</span>
            <span
              class="font-outfit text-secondary-500/50 truncate text-xs font-semibold tracking-wide uppercase dark:text-gray-400"
            >
              {{ t(cat.labelKey) }}
            </span>
          </div>

          <!-- Amount (hero) -->
          <div class="mb-1">
            <CurrencyAmount :amount="cat.amount" :currency="baseCurrency" size="md" />
          </div>

          <!-- Percentage badge -->
          <span
            class="inline-block rounded-full px-2 py-0.5 text-xs font-semibold"
            :style="{
              backgroundColor: cat.color + '15',
              color: cat.color,
            }"
          >
            {{ formatPercent(cat.percent) }}
          </span>
        </div>
      </div>
    </div>

    <!-- Liabilities card -->
    <div
      v-if="liabilities > 0"
      class="mt-3 cursor-pointer overflow-hidden rounded-[var(--sq)] border border-red-200/60 bg-red-50/50 transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:shadow-[var(--card-shadow)] dark:border-red-900/30 dark:bg-red-950/20"
      @click="router.push('/accounts?groupBy=category')"
    >
      <div class="flex items-center gap-3 px-4 py-3">
        <span class="text-base">🔻</span>
        <span
          class="font-outfit text-xs font-semibold tracking-wide text-red-500/70 uppercase dark:text-red-400/70"
        >
          {{ t('dashboard.breakdown.liabilities') }}
        </span>
        <CurrencyAmount
          :amount="liabilities"
          :currency="baseCurrency"
          type="expense"
          size="sm"
          class="ml-auto"
        />
      </div>
    </div>
  </div>
</template>
