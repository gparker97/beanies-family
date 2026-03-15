<script setup lang="ts">
import { computed, ref } from 'vue';
import CurrencyAmount from '@/components/common/CurrencyAmount.vue';
import InfoHintBadge from '@/components/ui/InfoHintBadge.vue';
import { useTranslation } from '@/composables/useTranslation';
import { getSubtypeLabelKey } from '@/constants/accountCategories';
import { useAccountsStore } from '@/stores/accountsStore';
import { useAssetsStore } from '@/stores/assetsStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { convertToBaseCurrency } from '@/utils/currency';
import type { AccountType, CurrencyCode } from '@/types/models';
import type { UIStringKey } from '@/services/translation/uiStrings';

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

const LIABILITIES_DEF = {
  key: 'liabilities',
  color: '#E74C3C',
  route: '/accounts?groupBy=category',
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

// ── Expandable detail ───────────────────────────────────────────────────────

const expandedCategory = ref<string | null>(null);

function toggleCategory(key: string) {
  expandedCategory.value = expandedCategory.value === key ? null : key;
}

interface DetailItem {
  name: string;
  typeLabelKey: string;
  balance: number;
  currency: CurrencyCode;
}

function getDetailsForCategory(key: string): DetailItem[] {
  if (key === 'assets') {
    return assetsStore.filteredAssets
      .filter((a) => a.includeInNetWorth)
      .map((a) => ({
        name: a.name,
        typeLabelKey: `assets.type.${a.type}`,
        balance: a.currentValue,
        currency: a.currency,
      }))
      .sort(sortByBalanceDesc);
  }

  if (key === 'liabilities') {
    return accountsStore.filteredActiveAccounts
      .filter((a) => a.includeInNetWorth && (a.type === 'credit_card' || a.type === 'loan'))
      .map((a) => ({
        name: a.name,
        typeLabelKey: getSubtypeLabelKey(a.type),
        balance: a.balance,
        currency: a.currency,
      }))
      .sort(sortByBalanceDesc);
  }

  const catDef = CATEGORIES.find((c) => c.key === key);
  if (!catDef) return [];

  return accountsStore.filteredActiveAccounts
    .filter((a) => a.includeInNetWorth && catDef.types.includes(a.type))
    .map((a) => ({
      name: a.name,
      typeLabelKey: getSubtypeLabelKey(a.type),
      balance: a.balance,
      currency: a.currency,
    }))
    .sort(sortByBalanceDesc);
}

function sortByBalanceDesc(a: DetailItem, b: DetailItem): number {
  return (
    convertToBaseCurrency(b.balance, b.currency) - convertToBaseCurrency(a.balance, a.currency)
  );
}

function getRouteForCategory(key: string): string {
  if (key === 'liabilities') return LIABILITIES_DEF.route;
  if (key === 'assets') return ASSETS_DEF.route;
  return CATEGORIES.find((c) => c.key === key)?.route ?? '/accounts';
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
        class="cursor-pointer overflow-hidden rounded-[var(--sq)] bg-white shadow-[var(--card-shadow)] transition-[transform,box-shadow,ring] duration-200 dark:bg-slate-800"
        :class="
          expandedCategory === cat.key
            ? 'shadow-[var(--card-hover-shadow)] ring-2'
            : 'hover:-translate-y-0.5 hover:shadow-[var(--card-hover-shadow)]'
        "
        :style="expandedCategory === cat.key ? { '--tw-ring-color': cat.color + '40' } : {}"
        @click="toggleCategory(cat.key)"
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

        <!-- Inline expanded detail -->
        <div
          class="grid transition-[grid-template-rows] duration-300"
          :class="expandedCategory === cat.key ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'"
          style="transition-timing-function: cubic-bezier(0.4, 0, 0.2, 1)"
          @click.stop
        >
          <div class="overflow-hidden">
            <div class="border-t px-3 pt-2 pb-3" :style="{ borderColor: cat.color + '20' }">
              <div class="space-y-0.5">
                <div
                  v-for="(item, idx) in getDetailsForCategory(cat.key)"
                  :key="idx"
                  class="rounded-lg px-2 py-1.5"
                >
                  <div class="text-secondary-500 truncate text-xs font-medium dark:text-gray-200">
                    {{ item.name }}
                  </div>
                  <div class="mt-0.5 flex items-center justify-between">
                    <span class="truncate text-[11px] text-slate-400 dark:text-gray-500">
                      {{ t(item.typeLabelKey as UIStringKey) }}
                    </span>
                    <CurrencyAmount
                      :amount="item.balance"
                      :currency="item.currency"
                      size="sm"
                      :always-show-original="true"
                      class="ml-2 shrink-0"
                    />
                  </div>
                </div>
              </div>

              <!-- View all link -->
              <router-link
                :to="getRouteForCategory(cat.key)"
                class="text-primary-500 font-outfit mt-2 block text-center text-[11px] font-semibold hover:underline"
                @click.stop
              >
                {{
                  cat.key === 'assets'
                    ? t('dashboard.breakdown.viewAllAssets')
                    : t('dashboard.breakdown.viewAllAccounts')
                }}
                &rarr;
              </router-link>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Liabilities card -->
    <div
      v-if="liabilities > 0"
      class="mt-3 cursor-pointer overflow-hidden rounded-[var(--sq)] border border-red-200/60 bg-red-50/50 transition-[transform,box-shadow,ring] duration-200 dark:border-red-900/30 dark:bg-red-950/20"
      :class="
        expandedCategory === 'liabilities'
          ? 'shadow-[var(--card-shadow)] ring-2 ring-red-400/40'
          : 'hover:-translate-y-0.5 hover:shadow-[var(--card-shadow)]'
      "
      @click="toggleCategory('liabilities')"
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

      <!-- Inline expanded detail for liabilities -->
      <div
        class="grid transition-[grid-template-rows] duration-300"
        :class="expandedCategory === 'liabilities' ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'"
        style="transition-timing-function: cubic-bezier(0.4, 0, 0.2, 1)"
        @click.stop
      >
        <div class="overflow-hidden">
          <div class="border-t border-red-200/40 px-3 pt-2 pb-3 dark:border-red-900/20">
            <div class="space-y-0.5">
              <div
                v-for="(item, idx) in getDetailsForCategory('liabilities')"
                :key="idx"
                class="rounded-lg px-2 py-1.5"
              >
                <div class="text-secondary-500 truncate text-xs font-medium dark:text-gray-200">
                  {{ item.name }}
                </div>
                <div class="mt-0.5 flex items-center justify-between">
                  <span class="truncate text-[11px] text-slate-400 dark:text-gray-500">
                    {{ t(item.typeLabelKey as UIStringKey) }}
                  </span>
                  <CurrencyAmount
                    :amount="item.balance"
                    :currency="item.currency"
                    type="expense"
                    size="sm"
                    :always-show-original="true"
                    class="ml-2 shrink-0"
                  />
                </div>
              </div>
            </div>

            <!-- View all link -->
            <router-link
              to="/accounts?groupBy=category"
              class="text-primary-500 font-outfit mt-2 block text-center text-[11px] font-semibold hover:underline"
              @click.stop
            >
              {{ t('dashboard.breakdown.viewAllAccounts') }} &rarr;
            </router-link>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
