<script setup lang="ts">
import { computed } from 'vue';
import { useRouter } from 'vue-router';
import { useTranslation } from '@/composables/useTranslation';
import { usePrivacyMode } from '@/composables/usePrivacyMode';
import { useCurrencyDisplay } from '@/composables/useCurrencyDisplay';
import { useAccountsStore } from '@/stores/accountsStore';
import { useTransactionsStore } from '@/stores/transactionsStore';
import { useRecurringStore } from '@/stores/recurringStore';
import { useSettingsStore } from '@/stores/settingsStore';

const router = useRouter();
const { t } = useTranslation();
const { isUnlocked, MASK } = usePrivacyMode();
const { formatInDisplayCurrency } = useCurrencyDisplay();
const accountsStore = useAccountsStore();
const transactionsStore = useTransactionsStore();
const recurringStore = useRecurringStore();
const settingsStore = useSettingsStore();

const netWorth = computed(() => accountsStore.filteredCombinedNetWorth);
const baseCurrency = computed(() => settingsStore.baseCurrency);

const monthlyIncome = computed(
  () =>
    transactionsStore.filteredThisMonthOneTimeIncome +
    recurringStore.filteredTotalMonthlyRecurringIncome
);

const monthlyExpenses = computed(
  () =>
    transactionsStore.filteredThisMonthOneTimeExpenses +
    recurringStore.filteredTotalMonthlyRecurringExpenses
);

const monthlyChange = computed(() => monthlyIncome.value - monthlyExpenses.value);

const budgetProgress = computed(() => {
  if (monthlyIncome.value <= 0) return 0;
  return Math.min((monthlyExpenses.value / monthlyIncome.value) * 100, 100);
});

const formattedNetWorth = computed(() => {
  if (!isUnlocked.value) return MASK;
  return formatInDisplayCurrency(netWorth.value, baseCurrency.value);
});

const formattedMonthlyChange = computed(() => {
  if (!isUnlocked.value) return MASK;
  const abs = Math.abs(monthlyChange.value);
  return formatInDisplayCurrency(abs, baseCurrency.value);
});

const formattedMonthlyExpenses = computed(() => {
  if (!isUnlocked.value) return MASK;
  return formatInDisplayCurrency(monthlyExpenses.value, baseCurrency.value);
});

const isPositiveChange = computed(() => monthlyChange.value >= 0);
</script>

<template>
  <div
    class="relative overflow-hidden rounded-[var(--sq)] p-6"
    :style="{ background: 'linear-gradient(135deg, #2C3E50, #3D5368)' }"
  >
    <!-- Radial glow -->
    <div
      class="pointer-events-none absolute -top-5 -right-5 h-[120px] w-[120px]"
      :style="{ background: 'radial-gradient(circle, rgba(241,93,34,0.15), transparent 70%)' }"
    />

    <!-- Header -->
    <div class="mb-4 flex items-center gap-2.5">
      <span class="text-xl">{{ '🐷' }}</span>
      <span class="font-outfit text-[0.75rem] font-bold tracking-[0.08em] text-white/50 uppercase">
        {{ t('nook.piggyBank') }}
      </span>
    </div>

    <!-- Net worth section -->
    <div>
      <div
        class="font-outfit mb-1 text-[0.65rem] font-semibold tracking-[0.1em] text-white/40 uppercase"
      >
        {{ t('nook.familyNetWorth') }}
      </div>
      <div class="font-outfit text-[2rem] font-extrabold text-white">
        {{ formattedNetWorth }}
      </div>
      <div class="mt-1 flex items-center gap-1.5">
        <span
          class="font-outfit text-[0.7rem] font-semibold"
          :class="isPositiveChange ? 'text-[#6EE7B7]' : 'text-red-400'"
        >
          {{ isPositiveChange ? '↑' : '↓' }}
          {{ isPositiveChange ? '+' : '-' }}{{ formattedMonthlyChange }}
        </span>
        <span class="text-[0.6rem] text-white/35">
          {{ t('nook.thisMonth') }}
        </span>
      </div>
    </div>

    <!-- Budget section -->
    <div class="mt-4 border-t border-white/[0.08] pt-4">
      <div class="flex items-center justify-between">
        <span class="text-[0.65rem] text-white/40">
          {{ t('nook.monthlyBudget') }}
        </span>
        <span class="font-outfit text-[0.7rem] font-semibold text-white">
          {{ formattedMonthlyExpenses }}
        </span>
      </div>
      <!-- Progress bar -->
      <div class="mt-2 h-2.5 rounded-full bg-white/[0.05]">
        <div
          class="h-full min-w-[4px] rounded-full"
          :style="{
            width: budgetProgress + '%',
            background: 'linear-gradient(90deg, #F15D22, #E67E22)',
          }"
        />
      </div>
    </div>

    <!-- CTA button -->
    <button
      class="font-outfit mt-4 w-full cursor-pointer rounded-[14px] py-3 text-center text-[0.8rem] font-semibold text-white"
      :style="{
        background: 'linear-gradient(135deg, #F15D22, #E67E22)',
        boxShadow: '0 4px 16px rgba(241,93,34,0.25)',
      }"
      @click="router.push('/dashboard')"
    >
      {{ t('nook.openPiggyBank') }}
    </button>
  </div>
</template>
