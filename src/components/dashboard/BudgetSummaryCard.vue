<script setup lang="ts">
import { computed } from 'vue';
import { useRouter } from 'vue-router';
import EmptyStateIllustration from '@/components/ui/EmptyStateIllustration.vue';
import { useCurrencyDisplay } from '@/composables/useCurrencyDisplay';
import { usePrivacyMode } from '@/composables/usePrivacyMode';
import { useTranslation } from '@/composables/useTranslation';
import { CATEGORY_EMOJI_MAP } from '@/constants/categories';
import { useBudgetStore } from '@/stores/budgetStore';
import { useSettingsStore } from '@/stores/settingsStore';
import type { PaceStatus, CategoryBudgetInfo } from '@/stores/budgetStore';
import type { UIStringKey } from '@/services/translation/uiStrings';

const router = useRouter();
const budgetStore = useBudgetStore();
const settingsStore = useSettingsStore();
const { isUnlocked, MASK } = usePrivacyMode();
const { formatInDisplayCurrency } = useCurrencyDisplay();
const { t } = useTranslation();

const hasBudget = computed(() => !!budgetStore.activeBudget);
const budgetAmount = computed(() => budgetStore.effectiveBudgetAmount);
const spent = computed(() => budgetStore.currentMonthSpending);
const progress = computed(() => budgetStore.budgetProgress);
const progressWidth = computed(() => Math.min(100, progress.value));
const paceStatus = computed(() => budgetStore.paceStatus);
const remaining = computed(() => Math.max(0, budgetAmount.value - spent.value));

// Show up to 3 categories: prioritize over-budget, then warning, then highest spend
const topCategories = computed<CategoryBudgetInfo[]>(() => {
  const cats = budgetStore.categoryBudgetStatus;
  if (cats.length === 0) return [];

  // Already sorted by percentUsed desc in the store — over-budget and warning come first
  // Filter to only those with activity or over-budget
  const withActivity = cats.filter((c) => c.spent > 0 || c.status === 'over');
  return withActivity.slice(0, 3);
});

const paceEmoji = computed(() => {
  const map: Record<PaceStatus, string> = {
    great: '\u{1F31F}',
    onTrack: '\u{1F44D}',
    caution: '\u26A0\uFE0F',
    overBudget: '\u{1F6A8}',
  };
  return map[paceStatus.value];
});

const paceMessageKey = computed<UIStringKey>(() => {
  const map: Record<PaceStatus, UIStringKey> = {
    great: 'budget.pace.great',
    onTrack: 'budget.pace.onTrack',
    caution: 'budget.pace.caution',
    overBudget: 'budget.pace.over',
  };
  return map[paceStatus.value];
});

const progressBarColor = computed(() => {
  if (progress.value >= 100) return 'bg-[#F15D22]';
  if (progress.value >= 75) return 'bg-gradient-to-r from-[#F15D22] to-[#E67E22]';
  return 'bg-gradient-to-r from-[#27AE60] to-[#2ECC71]';
});

function categoryProgressWidth(cat: CategoryBudgetInfo): number {
  return Math.min(100, cat.percentUsed);
}

function categoryBarColor(cat: CategoryBudgetInfo): string {
  if (cat.status === 'over') return 'bg-[#F15D22]';
  if (cat.status === 'warning') return 'bg-gradient-to-r from-[#F15D22] to-[#E67E22]';
  return 'bg-gradient-to-r from-[#27AE60] to-[#2ECC71]';
}
</script>

<template>
  <div
    class="rounded-[var(--sq)] bg-white p-6 shadow-[var(--card-shadow)] dark:bg-slate-800"
    data-testid="budget-summary-card"
  >
    <!-- Header -->
    <div class="mb-4 flex items-center justify-between">
      <div class="nook-section-label text-secondary-500 dark:text-gray-400">
        {{ t('dashboard.budgetSummary') }}
      </div>
      <router-link
        to="/budgets"
        class="text-primary-500 hover:text-primary-600 text-xs font-medium"
      >
        {{ t('dashboard.seeAll') }}
      </router-link>
    </div>

    <!-- Empty state: no active budget -->
    <div v-if="!hasBudget" class="py-8 text-center">
      <EmptyStateIllustration variant="budget" class="mb-4" />
      <p class="text-sm text-gray-500 dark:text-gray-400">
        {{ t('dashboard.noBudget') }}
      </p>
      <button
        class="text-primary-500 hover:text-primary-600 mt-2 text-xs font-medium"
        @click="router.push('/budgets')"
      >
        {{ t('dashboard.createBudget') }}
      </button>
    </div>

    <!-- Budget content -->
    <div v-else>
      <!-- Overall progress -->
      <div class="mb-4">
        <div class="mb-2 flex items-center justify-between">
          <div class="flex items-center gap-2">
            <span class="text-lg">{{ paceEmoji }}</span>
            <span class="font-outfit text-secondary-500 text-sm font-semibold dark:text-gray-100">
              {{ t(paceMessageKey) }}
            </span>
          </div>
          <span class="font-outfit text-secondary-500 text-sm font-bold dark:text-gray-200">
            {{ progress }}%
          </span>
        </div>

        <!-- Progress bar -->
        <div class="h-2.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-600/40">
          <div
            class="h-full rounded-full transition-all duration-500"
            :class="progressBarColor"
            :style="{ width: `${progressWidth}%` }"
          />
        </div>

        <!-- Spent / Budget amounts -->
        <div class="mt-2 flex items-center justify-between text-xs">
          <span class="text-secondary-500/50 dark:text-gray-400">
            <template v-if="isUnlocked">
              {{ formatInDisplayCurrency(spent, settingsStore.baseCurrency) }}
              {{ t('dashboard.budgetSpent') }}
            </template>
            <template v-else>{{ MASK }}</template>
          </span>
          <span class="text-secondary-500/50 dark:text-gray-400">
            <template v-if="isUnlocked">
              {{ formatInDisplayCurrency(remaining, settingsStore.baseCurrency) }}
              {{ t('dashboard.budgetRemaining') }}
            </template>
            <template v-else>{{ MASK }}</template>
          </span>
        </div>
      </div>

      <!-- Top categories -->
      <div v-if="topCategories.length > 0">
        <div class="mb-2 border-t border-[var(--tint-slate-5)] pt-3 dark:border-slate-700">
          <span class="text-secondary-500/40 text-xs font-medium dark:text-gray-500">
            {{ t('dashboard.budgetCategories') }}
          </span>
        </div>

        <div class="space-y-2.5">
          <div
            v-for="cat in topCategories"
            :key="cat.categoryId"
            class="cursor-pointer rounded-xl px-2 py-1.5 transition-colors"
            :class="
              cat.status === 'over'
                ? 'bg-[#F15D22]/5 dark:bg-[#F15D22]/10'
                : 'hover:bg-gray-50 dark:hover:bg-slate-700/50'
            "
            @click="router.push('/budgets')"
          >
            <div class="mb-1 flex items-center justify-between">
              <div class="flex items-center gap-2">
                <span class="text-base">{{ CATEGORY_EMOJI_MAP[cat.categoryId] || '' }}</span>
                <span
                  class="text-xs font-medium"
                  :class="
                    cat.status === 'over'
                      ? 'text-[#F15D22]'
                      : 'text-secondary-500 dark:text-gray-200'
                  "
                >
                  {{ cat.name }}
                </span>
              </div>
              <span
                v-if="isUnlocked"
                class="font-outfit text-xs font-semibold"
                :class="
                  cat.status === 'over' ? 'text-[#F15D22]' : 'text-slate-700 dark:text-slate-200'
                "
              >
                {{ formatInDisplayCurrency(cat.spent, settingsStore.baseCurrency) }}
                <span
                  class="font-normal"
                  :class="cat.status === 'over' ? 'text-[#F15D22]/60' : 'text-slate-400'"
                >
                  / {{ formatInDisplayCurrency(cat.budgeted, settingsStore.baseCurrency) }}
                </span>
              </span>
              <span v-else class="text-secondary-500/40 text-xs dark:text-gray-400">{{
                MASK
              }}</span>
            </div>
            <!-- Category progress bar -->
            <div
              class="overflow-hidden rounded-full"
              :class="
                cat.status === 'over'
                  ? 'h-2.5 bg-[#F15D22]/20'
                  : 'h-1.5 bg-slate-100 dark:bg-slate-600/40'
              "
            >
              <div
                class="h-full rounded-full transition-all duration-500"
                :class="categoryBarColor(cat)"
                :style="{ width: `${categoryProgressWidth(cat)}%` }"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
