<script setup lang="ts">
import { ref, computed } from 'vue';
import CategoryIcon from '@/components/common/CategoryIcon.vue';
import CurrencyAmount from '@/components/common/CurrencyAmount.vue';
import BudgetSettingsModal from '@/components/budget/BudgetSettingsModal.vue';
import QuickAddTransactionModal from '@/components/budget/QuickAddTransactionModal.vue';
import EmptyStateIllustration from '@/components/ui/EmptyStateIllustration.vue';
import BaseButton from '@/components/ui/BaseButton.vue';
import BeanieIcon from '@/components/ui/BeanieIcon.vue';
import SummaryStatCard from '@/components/dashboard/SummaryStatCard.vue';
import { useTranslation } from '@/composables/useTranslation';
import { usePrivacyMode } from '@/composables/usePrivacyMode';
import { useSyncHighlight } from '@/composables/useSyncHighlight';
import { confirm } from '@/composables/useConfirm';
import { formatCurrencyWithCode } from '@/composables/useCurrencyDisplay';
import { playWhoosh } from '@/composables/useSounds';
import { CATEGORY_EMOJI_MAP } from '@/constants/categories';
import { useBudgetStore } from '@/stores/budgetStore';
import { useTransactionsStore } from '@/stores/transactionsStore';
import { useSettingsStore } from '@/stores/settingsStore';
import type { CreateBudgetInput, UpdateBudgetInput, CreateTransactionInput } from '@/types/models';

const budgetStore = useBudgetStore();
const transactionsStore = useTransactionsStore();
const settingsStore = useSettingsStore();
const { isUnlocked, MASK } = usePrivacyMode();
const { t } = useTranslation();
const { syncHighlightClass } = useSyncHighlight();

// Modals
const showSettingsModal = ref(false);
const showQuickAddModal = ref(false);

// Hero card values
const budgetAmount = computed(() =>
  isUnlocked.value
    ? formatCurrencyWithCode(budgetStore.effectiveBudgetAmount, settingsStore.baseCurrency)
    : MASK
);
const spentAmount = computed(() =>
  isUnlocked.value
    ? formatCurrencyWithCode(budgetStore.currentMonthSpending, settingsStore.baseCurrency)
    : MASK
);
const remainingAmount = computed(() => {
  if (!isUnlocked.value) return MASK;
  const remaining = budgetStore.effectiveBudgetAmount - budgetStore.currentMonthSpending;
  return formatCurrencyWithCode(Math.abs(remaining), settingsStore.baseCurrency);
});
const isOverBudget = computed(
  () => budgetStore.currentMonthSpending > budgetStore.effectiveBudgetAmount
);

// Progress bar width (capped at 100% visually)
const progressWidth = computed(() => Math.min(100, budgetStore.budgetProgress));

// Pace emoji
const paceEmoji = computed(() => {
  switch (budgetStore.paceStatus) {
    case 'great':
      return '\u{1F31F}';
    case 'onTrack':
      return '\u{1F44D}';
    case 'caution':
      return '\u26A0\uFE0F';
    case 'overBudget':
      return '\u{1F6A8}';
    default:
      return '\u{1F44D}';
  }
});

// Pace message key
const paceMessageKey = computed(() => {
  switch (budgetStore.paceStatus) {
    case 'great':
      return 'budget.pace.great';
    case 'onTrack':
      return 'budget.pace.onTrack';
    case 'caution':
      return 'budget.pace.caution';
    case 'overBudget':
      return 'budget.pace.over';
    default:
      return 'budget.pace.onTrack';
  }
});

// Mode display text
const modeText = computed(() => {
  const budget = budgetStore.activeBudget;
  if (!budget) return '';
  if (budget.mode === 'percentage') {
    return `${budget.percentage}${t('budget.hero.percentageMode')}`;
  }
  return t('budget.hero.fixedMode');
});

// Category status colors
function getCategoryStatusColor(status: string): string {
  switch (status) {
    case 'over':
      return 'bg-orange-500';
    case 'warning':
      return 'bg-amber-400';
    default:
      return 'bg-emerald-500';
  }
}

function getCategoryStatusBg(status: string): string {
  switch (status) {
    case 'over':
      return 'bg-orange-50 dark:bg-orange-900/20';
    case 'warning':
      return 'bg-amber-50 dark:bg-amber-900/20';
    default:
      return 'bg-emerald-50 dark:bg-emerald-900/20';
  }
}

// ── Actions ──

async function handleSaveBudget(data: CreateBudgetInput | { id: string; data: UpdateBudgetInput }) {
  if ('id' in data) {
    await budgetStore.updateBudget(data.id, data.data);
  } else {
    await budgetStore.createBudget(data);
  }
  showSettingsModal.value = false;
  playWhoosh();
}

async function handleDeleteBudget(id: string) {
  const confirmed = await confirm({
    title: t('budget.confirm.deleteTitle'),
    message: t('budget.confirm.deleteMessage'),
    variant: 'danger',
  });
  if (confirmed) {
    await budgetStore.deleteBudget(id);
    showSettingsModal.value = false;
  }
}

async function handleQuickAdd(data: CreateTransactionInput) {
  await transactionsStore.createTransaction(data);
  showQuickAddModal.value = false;
  playWhoosh();
}
</script>

<template>
  <div class="space-y-6">
    <!-- ── Empty State ─────────────────────────────────────────────────── -->
    <div v-if="!budgetStore.activeBudget" class="py-16 text-center">
      <EmptyStateIllustration variant="budget" class="mx-auto mb-6" />
      <h2 class="font-outfit text-xl font-bold text-slate-700 dark:text-slate-200">
        {{ t('budget.empty.title') }}
      </h2>
      <p class="mx-auto mt-2 max-w-sm text-sm text-slate-500 dark:text-slate-400">
        {{ t('budget.empty.description') }}
      </p>
      <BaseButton class="mt-6" @click="showSettingsModal = true">
        <BeanieIcon name="plus" size="md" class="mr-1.5 -ml-1" />
        {{ t('budget.addBudget') }}
      </BaseButton>
    </div>

    <!-- ── Active Budget View ──────────────────────────────────────────── -->
    <template v-else>
      <!-- Hero Card -->
      <div
        class="overflow-hidden rounded-[var(--sq)] bg-gradient-to-br from-[#2C3E50] to-[#34495E] p-6 text-white shadow-lg"
        :class="syncHighlightClass(budgetStore.activeBudget.id)"
      >
        <!-- Top row: spent vs budget -->
        <div class="flex items-baseline justify-between">
          <div>
            <p class="text-xs font-medium tracking-wider text-slate-300 uppercase">
              {{ t('budget.hero.spent') }}
            </p>
            <p class="font-outfit mt-1 text-3xl font-extrabold">{{ spentAmount }}</p>
          </div>
          <div class="text-right">
            <p class="text-xs font-medium tracking-wider text-slate-300 uppercase">
              {{ t('budget.hero.of') }}
            </p>
            <p class="font-outfit mt-1 text-xl font-bold text-slate-200">{{ budgetAmount }}</p>
          </div>
        </div>

        <!-- Progress bar with time marker -->
        <div class="relative mt-5">
          <div class="h-3 overflow-hidden rounded-full bg-white/10">
            <div
              class="h-full rounded-full transition-all duration-700 ease-out"
              :class="
                isOverBudget
                  ? 'bg-gradient-to-r from-orange-400 to-red-400'
                  : 'bg-gradient-to-r from-[#F15D22] to-[#E67E22]'
              "
              :style="{ width: `${progressWidth}%` }"
            />
          </div>
          <!-- Time position marker -->
          <div class="absolute top-0 h-3" :style="{ left: `${budgetStore.monthTimeProgress}%` }">
            <div class="h-full w-0.5 border-l-2 border-dashed border-white/40" />
          </div>
        </div>

        <!-- Bottom row: remaining + motivational message -->
        <div class="mt-3 flex items-center justify-between">
          <div class="flex items-center gap-2">
            <span class="text-lg">{{ paceEmoji }}</span>
            <span class="text-sm text-slate-300">{{ t(paceMessageKey) }}</span>
          </div>
          <div class="text-right">
            <span class="text-sm" :class="isOverBudget ? 'text-orange-300' : 'text-emerald-300'">
              {{ remainingAmount }}
              {{ isOverBudget ? t('budget.hero.over') : t('budget.hero.remaining') }}
            </span>
          </div>
        </div>

        <!-- Mode indicator -->
        <div class="mt-2 text-right">
          <span
            class="rounded-full bg-white/10 px-2.5 py-0.5 text-[0.65rem] font-medium text-slate-300"
          >
            {{ modeText }}
          </span>
        </div>
      </div>

      <!-- ── Summary Cards (3-column) ──────────────────────────────────── -->
      <div class="grid grid-cols-1 gap-4 md:grid-cols-3">
        <SummaryStatCard
          :label="t('budget.summary.monthlyIncome')"
          :amount="budgetStore.monthlyIncome"
          :currency="settingsStore.baseCurrency"
          tint="green"
        >
          <div v-if="isUnlocked" class="mt-1 flex flex-wrap gap-1.5">
            <span
              class="rounded-full bg-emerald-50 px-2 py-0.5 text-[0.6rem] font-medium text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400"
            >
              {{ t('budget.summary.recurring') }}:
              {{ formatCurrencyWithCode(budgetStore.recurringIncome, settingsStore.baseCurrency) }}
            </span>
            <span
              class="rounded-full bg-sky-50 px-2 py-0.5 text-[0.6rem] font-medium text-sky-600 dark:bg-sky-900/30 dark:text-sky-400"
            >
              {{ t('budget.summary.oneTime') }}:
              {{ formatCurrencyWithCode(budgetStore.oneTimeIncome, settingsStore.baseCurrency) }}
            </span>
          </div>
        </SummaryStatCard>

        <SummaryStatCard
          :label="t('budget.summary.currentSpending')"
          :amount="budgetStore.currentMonthSpending"
          :currency="settingsStore.baseCurrency"
          tint="orange"
        >
          <div v-if="isUnlocked" class="mt-1 flex flex-wrap gap-1.5">
            <span
              class="rounded-full bg-orange-50 px-2 py-0.5 text-[0.6rem] font-medium text-orange-600 dark:bg-orange-900/30 dark:text-orange-400"
            >
              {{ t('budget.summary.recurring') }}:
              {{
                formatCurrencyWithCode(budgetStore.recurringExpenses, settingsStore.baseCurrency)
              }}
            </span>
            <span
              class="rounded-full bg-sky-50 px-2 py-0.5 text-[0.6rem] font-medium text-sky-600 dark:bg-sky-900/30 dark:text-sky-400"
            >
              {{ t('budget.summary.oneTime') }}:
              {{ formatCurrencyWithCode(budgetStore.oneTimeExpenses, settingsStore.baseCurrency) }}
            </span>
          </div>
        </SummaryStatCard>

        <SummaryStatCard
          :label="t('budget.summary.monthlySavings')"
          :amount="budgetStore.monthlySavings"
          :currency="settingsStore.baseCurrency"
          tint="slate"
          :dark="true"
        >
          <div v-if="isUnlocked && budgetStore.monthlyIncome > 0" class="mt-1">
            <span
              class="rounded-full px-2 py-0.5 text-[0.6rem] font-semibold"
              :class="
                budgetStore.savingsRate >= 0
                  ? 'bg-emerald-400/20 text-emerald-300'
                  : 'bg-orange-400/20 text-orange-300'
              "
            >
              {{ budgetStore.savingsRate }}% {{ t('budget.summary.savingsRate') }}
            </span>
          </div>
        </SummaryStatCard>
      </div>

      <!-- ── Two-Column: Upcoming + Category Breakdown ─────────────────── -->
      <div class="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <!-- Upcoming Transactions -->
        <div class="rounded-[var(--sq)] bg-white p-6 shadow-[var(--card-shadow)] dark:bg-slate-800">
          <div class="mb-4 flex items-center justify-between">
            <span class="nook-section-label text-secondary-500 dark:text-gray-400">
              {{ t('budget.section.upcomingTransactions') }}
            </span>
            <router-link
              to="/transactions"
              class="text-primary-500 hover:text-primary-600 text-[0.75rem] font-medium"
            >
              {{ t('budget.section.viewAll') }}
            </router-link>
          </div>
          <div
            v-if="budgetStore.upcomingTransactions.length === 0"
            class="py-6 text-center text-sm text-slate-400 dark:text-slate-500"
          >
            {{ t('budget.empty.title') }}
          </div>
          <div v-else class="space-y-3">
            <div
              v-for="tx in budgetStore.upcomingTransactions"
              :key="tx.id"
              class="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2.5 dark:bg-slate-700/30"
            >
              <div class="flex items-center gap-3">
                <CategoryIcon :category="tx.category" size="sm" />
                <div>
                  <p class="text-sm font-medium text-slate-700 dark:text-slate-200">
                    {{ tx.description }}
                  </p>
                  <p class="text-xs text-slate-400 dark:text-slate-500">
                    {{
                      tx.daysUntil === 0
                        ? 'Today'
                        : tx.daysUntil === 1
                          ? 'Tomorrow'
                          : `In ${tx.daysUntil} days`
                    }}
                  </p>
                </div>
              </div>
              <span
                class="font-outfit text-sm font-semibold"
                :class="
                  tx.type === 'income'
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : 'text-slate-700 dark:text-slate-200'
                "
              >
                <template v-if="isUnlocked">
                  {{ tx.type === 'income' ? '+' : '-' }}
                  <CurrencyAmount :amount="tx.amount" :currency="tx.currency" />
                </template>
                <template v-else>{{ MASK }}</template>
              </span>
            </div>
          </div>
        </div>

        <!-- Spending by Category -->
        <div class="rounded-[var(--sq)] bg-white p-6 shadow-[var(--card-shadow)] dark:bg-slate-800">
          <span class="nook-section-label text-secondary-500 mb-4 block dark:text-gray-400">
            {{ t('budget.section.spendingByCategory') }}
          </span>
          <div
            v-if="budgetStore.categoryBudgetStatus.length === 0"
            class="py-6 text-center text-sm text-slate-400 dark:text-slate-500"
          >
            {{ t('budget.category.noBudget') }}
          </div>
          <div v-else class="space-y-3">
            <div
              v-for="cat in budgetStore.categoryBudgetStatus"
              :key="cat.categoryId"
              class="rounded-lg px-3 py-2.5"
              :class="getCategoryStatusBg(cat.status)"
            >
              <div class="mb-1.5 flex items-center justify-between">
                <div class="flex items-center gap-2">
                  <span class="text-base">{{ CATEGORY_EMOJI_MAP[cat.categoryId] || '' }}</span>
                  <span class="text-sm font-medium text-slate-700 dark:text-slate-200">
                    {{ cat.name }}
                  </span>
                </div>
                <div class="text-right">
                  <span
                    v-if="isUnlocked"
                    class="font-outfit text-sm font-semibold text-slate-700 dark:text-slate-200"
                  >
                    {{ formatCurrencyWithCode(cat.spent, settingsStore.baseCurrency) }}
                    <span class="text-xs font-normal text-slate-400">
                      / {{ formatCurrencyWithCode(cat.budgeted, settingsStore.baseCurrency) }}
                    </span>
                  </span>
                  <span v-else class="text-sm text-slate-400">{{ MASK }}</span>
                </div>
              </div>
              <!-- Progress bar -->
              <div class="h-1.5 overflow-hidden rounded-full bg-white/60 dark:bg-slate-600/40">
                <div
                  class="h-full rounded-full transition-all duration-500"
                  :class="getCategoryStatusColor(cat.status)"
                  :style="{ width: `${Math.min(100, cat.percentUsed)}%` }"
                />
              </div>
              <div class="mt-1 text-right">
                <span
                  class="text-[0.6rem] font-semibold uppercase"
                  :class="{
                    'text-emerald-600 dark:text-emerald-400': cat.status === 'ok',
                    'text-amber-600 dark:text-amber-400': cat.status === 'warning',
                    'text-orange-600 dark:text-orange-400': cat.status === 'over',
                  }"
                >
                  {{ cat.percentUsed }}%
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- ── Bottom Section: Settings + Add Transactions ───────────────── -->
      <div class="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <!-- Budget Settings -->
        <div class="rounded-[var(--sq)] bg-white p-6 shadow-[var(--card-shadow)] dark:bg-slate-800">
          <!-- Header row: title + edit button -->
          <div class="mb-4 flex items-center justify-between">
            <span class="font-outfit text-[0.9rem] font-bold text-slate-700 dark:text-slate-200">
              {{ t('budget.section.budgetSettings') }}
            </span>
            <button
              class="flex items-center gap-1.5 rounded-[10px] bg-slate-50 px-3.5 py-1.5 transition-colors hover:bg-slate-100 dark:bg-slate-700/50 dark:hover:bg-slate-700"
              @click="showSettingsModal = true"
            >
              <BeanieIcon name="edit-2" size="xs" class="text-[var(--heritage-orange)]" />
              <span class="font-outfit text-[0.65rem] font-semibold text-[var(--heritage-orange)]">
                {{ t('budget.editBudget') }}
              </span>
            </button>
          </div>

          <!-- Mode cards (side by side) -->
          <div class="mb-4 flex gap-2">
            <!-- Percentage card -->
            <div
              class="flex-1 rounded-2xl border-2 p-4"
              :class="
                budgetStore.activeBudget?.mode === 'percentage'
                  ? 'border-[var(--heritage-orange)] bg-gradient-to-br from-[#2C3E50] to-[#3D5368] text-white'
                  : 'border-transparent bg-slate-50 dark:bg-slate-700/30'
              "
            >
              <p
                class="font-outfit mb-1 text-[0.7rem] font-bold"
                :class="
                  budgetStore.activeBudget?.mode === 'percentage'
                    ? 'text-white'
                    : 'text-slate-400 dark:text-slate-500'
                "
              >
                {{ t('budget.settings.percentageOfIncome') }}
              </p>
              <p
                class="font-outfit text-[1.3rem] font-extrabold"
                :class="
                  budgetStore.activeBudget?.mode === 'percentage'
                    ? 'text-white'
                    : 'text-slate-300 dark:text-slate-600'
                "
              >
                {{ isUnlocked ? `${budgetStore.activeBudget?.percentage ?? 70}%` : MASK }}
              </p>
              <p
                class="text-[0.55rem]"
                :class="
                  budgetStore.activeBudget?.mode === 'percentage'
                    ? 'text-white/40'
                    : 'text-slate-300 dark:text-slate-600'
                "
              >
                {{
                  isUnlocked && budgetStore.activeBudget?.mode === 'percentage'
                    ? `= ${budgetAmount} / ${t('budget.settings.perMonth')}`
                    : `$0 / ${t('budget.settings.perMonth')}`
                }}
              </p>
            </div>

            <!-- Fixed amount card -->
            <div
              class="flex-1 rounded-2xl border-2 p-4"
              :class="
                budgetStore.activeBudget?.mode === 'fixed'
                  ? 'border-[var(--heritage-orange)] bg-gradient-to-br from-[#2C3E50] to-[#3D5368] text-white'
                  : 'border-transparent bg-slate-50 dark:bg-slate-700/30'
              "
            >
              <p
                class="font-outfit mb-1 text-[0.7rem] font-bold"
                :class="
                  budgetStore.activeBudget?.mode === 'fixed'
                    ? 'text-white'
                    : 'text-slate-400 dark:text-slate-500'
                "
              >
                {{ t('budget.settings.fixedAmount') }}
              </p>
              <p
                class="font-outfit text-[1.3rem] font-extrabold"
                :class="
                  budgetStore.activeBudget?.mode === 'fixed'
                    ? 'text-white'
                    : 'text-slate-300 dark:text-slate-600'
                "
              >
                {{ isUnlocked ? budgetAmount : MASK }}
              </p>
              <p
                class="text-[0.55rem]"
                :class="
                  budgetStore.activeBudget?.mode === 'fixed'
                    ? 'text-white/40'
                    : 'text-slate-300 dark:text-slate-600'
                "
              >
                {{ t('budget.settings.perMonth') }}
              </p>
            </div>
          </div>

          <!-- Info callout -->
          <div
            class="rounded-[14px] border-l-[3px] border-[var(--heritage-orange)] bg-[rgba(241,93,34,0.04)] p-3.5 dark:bg-[rgba(241,93,34,0.08)]"
          >
            <p class="text-[0.72rem] leading-relaxed text-slate-600/55 dark:text-slate-400/55">
              <template v-if="budgetStore.activeBudget?.mode === 'percentage'">
                {{
                  t('budget.settings.infoPercentage')
                    .replace('{percentage}', String(budgetStore.activeBudget?.percentage ?? 70))
                    .replace(
                      '{remaining}',
                      String(100 - (budgetStore.activeBudget?.percentage ?? 70))
                    )
                }}
              </template>
              <template v-else>
                {{ t('budget.settings.infoFixed').replace('{amount}', budgetAmount) }}
              </template>
            </p>
          </div>
        </div>

        <!-- Add Transactions -->
        <div class="rounded-[var(--sq)] bg-white p-6 shadow-[var(--card-shadow)] dark:bg-slate-800">
          <span class="nook-section-label text-secondary-500 mb-4 block dark:text-gray-400">
            {{ t('budget.section.addTransactions') }}
          </span>
          <div class="space-y-3">
            <!-- Quick Add (functional) -->
            <button
              class="flex w-full items-center gap-3 rounded-lg bg-gradient-to-r from-[#F15D22] to-[#E67E22] px-4 py-3 text-left text-white shadow-sm transition-transform hover:scale-[1.01] active:scale-[0.99]"
              @click="showQuickAddModal = true"
            >
              <span class="text-xl">⚡</span>
              <div>
                <p class="text-sm font-semibold">{{ t('budget.quickAdd.title') }}</p>
                <p class="text-xs opacity-80">{{ t('budget.quickAdd.description') }}</p>
              </div>
            </button>

            <!-- Batch Add (coming soon) -->
            <div
              class="relative flex items-center gap-3 rounded-lg bg-slate-50 px-4 py-3 opacity-60 dark:bg-slate-700/30"
            >
              <span class="text-xl">📋</span>
              <div>
                <p class="text-sm font-semibold text-slate-600 dark:text-slate-300">
                  {{ t('budget.batchAdd.title') }}
                </p>
              </div>
              <span
                class="ml-auto rounded-full bg-sky-100 px-2 py-0.5 text-[0.6rem] font-semibold text-sky-700 dark:bg-sky-900/40 dark:text-sky-300"
              >
                {{ t('budget.comingSoon') }}
              </span>
            </div>

            <!-- CSV Upload (coming soon) -->
            <div
              class="relative flex items-center gap-3 rounded-lg bg-slate-50 px-4 py-3 opacity-60 dark:bg-slate-700/30"
            >
              <span class="text-xl">📄</span>
              <div>
                <p class="text-sm font-semibold text-slate-600 dark:text-slate-300">
                  {{ t('budget.csvUpload.title') }}
                </p>
              </div>
              <span
                class="ml-auto rounded-full bg-sky-100 px-2 py-0.5 text-[0.6rem] font-semibold text-sky-700 dark:bg-sky-900/40 dark:text-sky-300"
              >
                {{ t('budget.comingSoon') }}
              </span>
            </div>
          </div>
        </div>
      </div>
    </template>

    <!-- ── Modals ──────────────────────────────────────────────────────── -->
    <BudgetSettingsModal
      :open="showSettingsModal"
      :budget="budgetStore.activeBudget"
      @close="showSettingsModal = false"
      @save="handleSaveBudget"
      @delete="handleDeleteBudget"
    />

    <QuickAddTransactionModal
      :open="showQuickAddModal"
      @close="showQuickAddModal = false"
      @save="handleQuickAdd"
    />
  </div>
</template>
