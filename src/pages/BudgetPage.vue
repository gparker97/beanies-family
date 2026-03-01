<script setup lang="ts">
import { ref, computed } from 'vue';
import BudgetSettingsModal from '@/components/budget/BudgetSettingsModal.vue';
import QuickAddTransactionModal from '@/components/budget/QuickAddTransactionModal.vue';
import EmptyStateIllustration from '@/components/ui/EmptyStateIllustration.vue';
import BaseButton from '@/components/ui/BaseButton.vue';
import BeanieIcon from '@/components/ui/BeanieIcon.vue';
import SummaryStatCard from '@/components/dashboard/SummaryStatCard.vue';
import ActivityItem from '@/components/dashboard/ActivityItem.vue';
import { useTranslation } from '@/composables/useTranslation';
import { usePrivacyMode } from '@/composables/usePrivacyMode';
import { useSyncHighlight } from '@/composables/useSyncHighlight';
import { confirm } from '@/composables/useConfirm';
import { useCurrencyDisplay } from '@/composables/useCurrencyDisplay';
import { playWhoosh } from '@/composables/useSounds';
import { CATEGORY_EMOJI_MAP } from '@/constants/categories';
import { formatMonthYearShort } from '@/utils/date';
import { useBudgetStore } from '@/stores/budgetStore';
import { useTransactionsStore } from '@/stores/transactionsStore';
import { useSettingsStore } from '@/stores/settingsStore';
import type { CreateBudgetInput, UpdateBudgetInput, CreateTransactionInput } from '@/types/models';
import type { CurrencyCode } from '@/types/models';

const budgetStore = useBudgetStore();
const transactionsStore = useTransactionsStore();
const settingsStore = useSettingsStore();
const { isUnlocked, MASK } = usePrivacyMode();
const { formatInDisplayCurrency } = useCurrencyDisplay();
const { t } = useTranslation();
const { syncHighlightClass } = useSyncHighlight();

// Modals
const showSettingsModal = ref(false);
const showQuickAddModal = ref(false);

// Hero card values
const budgetAmount = computed(() =>
  isUnlocked.value
    ? formatInDisplayCurrency(budgetStore.effectiveBudgetAmount, settingsStore.baseCurrency)
    : MASK
);
const spentAmount = computed(() =>
  isUnlocked.value
    ? formatInDisplayCurrency(budgetStore.currentMonthSpending, settingsStore.baseCurrency)
    : MASK
);
const remainingAmount = computed(() => {
  if (!isUnlocked.value) return MASK;
  const remaining = budgetStore.effectiveBudgetAmount - budgetStore.currentMonthSpending;
  return formatInDisplayCurrency(Math.abs(remaining), settingsStore.baseCurrency);
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

// Hero card — days tracking
const daysInMonth = computed(() => {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
});
const currentDay = computed(() => new Date().getDate());

// Percentage spent text
const percentSpentText = computed(() => `${Math.round(budgetStore.budgetProgress)}%`);

// Current month/year label for category header
const currentMonthLabel = computed(() => formatMonthYearShort(new Date()));

// Build subtitle for upcoming transaction rows
function buildUpcomingSubtitle(tx: { daysUntil: number }): string {
  let label: string;
  if (tx.daysUntil === 0) label = t('budget.upcoming.today');
  else if (tx.daysUntil === 1) label = t('budget.upcoming.tomorrow');
  else label = t('budget.upcoming.inDays').replace('{days}', String(tx.daysUntil));
  return `${label} · ${t('budget.upcoming.recurring')}`;
}

// Category progress bar gradient class by status
function getCategoryBarClass(status: string): string {
  switch (status) {
    case 'over':
      return 'bg-[var(--heritage-orange)]';
    case 'warning':
      return 'bg-gradient-to-r from-[#F15D22] to-[#E67E22]';
    default:
      return 'bg-gradient-to-r from-[#27AE60] to-[#2ECC71]';
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
    title: 'budget.confirm.deleteTitle',
    message: 'budget.confirm.deleteMessage',
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
        class="relative overflow-hidden rounded-[var(--sq)] bg-gradient-to-br from-[#2C3E50] to-[#3D5368] p-6 text-white shadow-lg"
        :class="syncHighlightClass(budgetStore.activeBudget.id)"
      >
        <!-- Decorative radial glow -->
        <div
          class="pointer-events-none absolute -top-16 -right-16 h-48 w-48 rounded-full"
          style="background: radial-gradient(circle, rgb(241 93 34 / 10%) 0%, transparent 70%)"
        />

        <div class="relative flex flex-col gap-5 lg:flex-row lg:items-stretch">
          <!-- Left content -->
          <div class="min-w-0 flex-1">
            <!-- Icon + label row -->
            <div class="mb-3 flex items-center gap-3">
              <div
                class="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-[14px] bg-[rgba(241,93,34,0.15)]"
              >
                <BeanieIcon name="target" size="md" class="text-[var(--heritage-orange)]" />
              </div>
              <div>
                <p class="font-outfit text-[0.85rem] font-bold">
                  {{ t('budget.hero.budgetProgress') }}
                </p>
                <p class="text-[0.7rem] text-white/50">
                  {{ t('budget.hero.dayLabel') }} {{ currentDay }} {{ t('budget.hero.daysOf') }}
                  {{ daysInMonth }}
                </p>
              </div>
            </div>

            <!-- Amount line: $3,760 / $5,032 -->
            <div class="mb-2 flex items-baseline gap-1.5">
              <span class="font-outfit text-[2.2rem] leading-none font-extrabold">
                {{ spentAmount }}
              </span>
              <span class="font-outfit text-[1rem] font-medium text-white/35">
                / {{ budgetAmount }}
              </span>
            </div>

            <!-- Percentage + remaining -->
            <div class="mb-4 flex items-center gap-1.5 text-[0.8rem]">
              <span
                class="bg-gradient-to-r from-[#F15D22] to-[#E67E22] bg-clip-text font-bold text-transparent"
              >
                {{ percentSpentText }} {{ t('budget.hero.percentSpent') }}
              </span>
              <span class="text-white/35">·</span>
              <span :class="isOverBudget ? 'text-orange-300' : 'text-emerald-300'">
                {{ remainingAmount }}
                {{ isOverBudget ? t('budget.hero.over') : t('budget.hero.remaining') }}
              </span>
            </div>

            <!-- Progress bar with fill marker + time marker -->
            <div class="relative">
              <div class="h-3.5 overflow-hidden rounded-full bg-white/10">
                <div
                  class="relative h-full rounded-full transition-all duration-700 ease-out"
                  :class="
                    isOverBudget
                      ? 'bg-gradient-to-r from-orange-400 to-red-400'
                      : 'bg-gradient-to-r from-[#F15D22] to-[#E67E22]'
                  "
                  :style="{ width: `${progressWidth}%` }"
                >
                  <!-- White fill marker at edge -->
                  <div
                    class="absolute top-1/2 right-0 h-[14px] w-[3px] -translate-y-1/2 rounded-full bg-white shadow-[0_0_6px_rgba(255,255,255,0.5)]"
                  />
                </div>
              </div>
              <!-- Time position marker -->
              <div
                class="absolute top-0 h-3.5"
                :style="{ left: `${budgetStore.monthTimeProgress}%` }"
              >
                <div class="h-full w-0.5 bg-white/25" />
              </div>
            </div>

            <!-- Scale labels -->
            <div class="mt-1.5 flex items-center justify-between text-[0.6rem] text-white/30">
              <span>
                <template v-if="isUnlocked">
                  {{ formatInDisplayCurrency(0, settingsStore.baseCurrency) }}
                </template>
                <template v-else>{{ MASK }}</template>
              </span>
              <span> ↑ {{ Math.round(budgetStore.monthTimeProgress) }}%</span>
              <span>
                <template v-if="isUnlocked">{{ budgetAmount }}</template>
                <template v-else>{{ MASK }}</template>
              </span>
            </div>
          </div>

          <!-- Right motivational panel -->
          <div
            class="flex w-full flex-col items-center justify-center rounded-2xl bg-white/5 px-5 py-4 text-center lg:w-[200px]"
          >
            <span class="text-[2.5rem]">{{ paceEmoji }}</span>
            <p class="font-outfit mt-2 text-[1.05rem] font-bold">{{ t(paceMessageKey) }}</p>
            <p class="mt-1 text-[0.72rem] text-white/40">
              {{ remainingAmount }}
              {{ isOverBudget ? t('budget.hero.over') : t('budget.hero.remaining') }}
            </p>
          </div>
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
              {{ formatInDisplayCurrency(budgetStore.recurringIncome, settingsStore.baseCurrency) }}
            </span>
            <span
              class="rounded-full bg-slate-100 px-2 py-0.5 text-[0.6rem] font-medium text-slate-500 opacity-60 dark:bg-slate-700/40 dark:text-slate-400"
            >
              {{ t('budget.summary.oneTime') }}:
              {{ formatInDisplayCurrency(budgetStore.oneTimeIncome, settingsStore.baseCurrency) }}
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
                formatInDisplayCurrency(budgetStore.recurringExpenses, settingsStore.baseCurrency)
              }}
            </span>
            <span
              class="rounded-full bg-slate-100 px-2 py-0.5 text-[0.6rem] font-medium text-slate-500 opacity-60 dark:bg-slate-700/40 dark:text-slate-400"
            >
              {{ t('budget.summary.oneTime') }}:
              {{ formatInDisplayCurrency(budgetStore.oneTimeExpenses, settingsStore.baseCurrency) }}
            </span>
          </div>
        </SummaryStatCard>

        <SummaryStatCard
          :label="t('budget.summary.monthlySavings')"
          :amount="budgetStore.monthlySavings"
          :currency="settingsStore.baseCurrency"
          tint="green"
        >
          <div v-if="isUnlocked && budgetStore.monthlyIncome > 0" class="mt-1">
            <span
              class="text-[0.6rem] font-semibold"
              :class="
                budgetStore.savingsRate >= 0
                  ? 'text-[#27AE60] dark:text-emerald-400'
                  : 'text-[var(--heritage-orange)]'
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
          <div v-else>
            <ActivityItem
              v-for="tx in budgetStore.upcomingTransactions"
              :key="tx.id"
              :icon="CATEGORY_EMOJI_MAP[tx.category] || '💰'"
              :icon-tint="tx.type === 'income' ? 'green' : 'orange'"
              :name="tx.description"
              :subtitle="buildUpcomingSubtitle(tx)"
              :amount="tx.amount"
              :currency="tx.currency as CurrencyCode"
              :type="tx.type === 'income' ? 'income' : 'expense'"
            />
          </div>
        </div>

        <!-- Spending by Category -->
        <div class="rounded-[var(--sq)] bg-white p-6 shadow-[var(--card-shadow)] dark:bg-slate-800">
          <div class="mb-4 flex items-center justify-between">
            <span class="nook-section-label text-secondary-500 dark:text-gray-400">
              {{ t('budget.section.spendingByCategory') }}
            </span>
            <span class="text-[0.7rem] font-medium text-slate-400 dark:text-slate-500">
              {{ currentMonthLabel }}
            </span>
          </div>
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
              class="rounded-[14px] px-3 py-2.5"
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
                    {{ formatInDisplayCurrency(cat.spent, settingsStore.baseCurrency) }}
                    <span class="text-xs font-normal text-slate-400">
                      / {{ formatInDisplayCurrency(cat.budgeted, settingsStore.baseCurrency) }}
                    </span>
                  </span>
                  <span v-else class="text-sm text-slate-400">{{ MASK }}</span>
                </div>
              </div>
              <!-- Progress bar -->
              <div class="h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-600/40">
                <div
                  class="h-full rounded-full transition-all duration-500"
                  :class="getCategoryBarClass(cat.status)"
                  :style="{ width: `${Math.min(100, cat.percentUsed)}%` }"
                />
              </div>
              <!-- Over-budget message (only for over status) -->
              <div v-if="cat.status === 'over' && isUnlocked" class="mt-1">
                <span class="text-[0.6rem] font-medium text-[var(--heritage-orange)]">
                  {{
                    formatInDisplayCurrency(cat.spent - cat.budgeted, settingsStore.baseCurrency)
                  }}
                  {{ t('budget.category.overAmount') }} ·
                  {{ t('budget.category.overEncouragement') }} 💪
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
                    : `${formatInDisplayCurrency(0, settingsStore.baseCurrency)} / ${t('budget.settings.perMonth')}`
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
          <span class="nook-section-label text-secondary-500 block dark:text-gray-400">
            {{ t('budget.section.addTransactions') }}
          </span>
          <p class="mt-1 mb-4 text-[0.7rem] text-slate-400 dark:text-slate-500">
            {{ t('budget.addTransactions.subtitle') }}
          </p>
          <div class="space-y-3">
            <!-- Quick Add (functional) -->
            <button
              class="flex w-full items-center gap-3.5 rounded-[14px] bg-[var(--tint-slate-5)] p-3.5 text-left transition-colors hover:bg-slate-100 dark:bg-slate-700/30 dark:hover:bg-slate-700/50"
              @click="showQuickAddModal = true"
            >
              <div
                class="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-gradient-to-r from-[#F15D22] to-[#E67E22]"
              >
                <BeanieIcon name="plus" size="sm" class="text-white" />
              </div>
              <div class="min-w-0 flex-1">
                <p class="text-[0.8rem] font-semibold text-slate-700 dark:text-slate-200">
                  {{ t('budget.quickAdd.title') }}
                </p>
                <p class="text-[0.65rem] text-slate-400 dark:text-slate-500">
                  {{ t('budget.quickAdd.subtitle') }}
                </p>
              </div>
              <BeanieIcon
                name="chevron-right"
                size="sm"
                class="flex-shrink-0 text-slate-300 dark:text-slate-600"
              />
            </button>

            <!-- Batch Add (coming soon) -->
            <div
              class="relative flex items-center gap-3.5 rounded-[14px] bg-[var(--tint-slate-5)] p-3.5 opacity-60 dark:bg-slate-700/30"
            >
              <div
                class="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-[var(--tint-silk-10)]"
              >
                <span class="text-[0.9rem]">📋</span>
              </div>
              <div class="min-w-0 flex-1">
                <p class="text-[0.8rem] font-semibold text-slate-600 dark:text-slate-300">
                  {{ t('budget.batchAdd.title') }}
                </p>
                <p class="text-[0.65rem] text-slate-400 dark:text-slate-500">
                  {{ t('budget.batchAdd.subtitle') }}
                </p>
              </div>
              <span
                class="ml-auto flex-shrink-0 rounded-full bg-sky-100 px-2 py-0.5 text-[0.6rem] font-semibold text-sky-700 dark:bg-sky-900/40 dark:text-sky-300"
              >
                {{ t('budget.comingSoon') }}
              </span>
            </div>

            <!-- CSV Upload (coming soon) -->
            <div
              class="relative flex items-center gap-3.5 rounded-[14px] bg-[var(--tint-slate-5)] p-3.5 opacity-60 dark:bg-slate-700/30"
            >
              <div
                class="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-[var(--tint-slate-5)]"
              >
                <span class="text-[0.9rem]">📄</span>
              </div>
              <div class="min-w-0 flex-1">
                <p class="text-[0.8rem] font-semibold text-slate-600 dark:text-slate-300">
                  {{ t('budget.csvUpload.title') }}
                </p>
                <p class="text-[0.65rem] text-slate-400 dark:text-slate-500">
                  {{ t('budget.csvUpload.subtitle') }}
                </p>
              </div>
              <span
                class="ml-auto flex-shrink-0 rounded-full bg-sky-100 px-2 py-0.5 text-[0.6rem] font-semibold text-sky-700 dark:bg-sky-900/40 dark:text-sky-300"
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
