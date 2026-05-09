<script setup lang="ts">
import { ref, computed } from 'vue';
import OnboardingStepHeader from './OnboardingStepHeader.vue';
import OnboardingStepShell from './OnboardingStepShell.vue';
import CurrencyAmountInput from '@/components/ui/CurrencyAmountInput.vue';
import TogglePillGroup from '@/components/ui/TogglePillGroup.vue';
import { useSettingsStore } from '@/stores/settingsStore';
import { useRecurringStore } from '@/stores/recurringStore';
import { useTranslation } from '@/composables/useTranslation';

defineEmits<{
  next: [];
  back: [];
}>();

// 2-way binding to the wizard. Vue 3.5 defineModel: single line, no manual
// emit + watch ceremony. Default-initializes to 20 if the wizard hasn't
// passed a value (matches today's hardcoded default).
const savingsPercent = defineModel<number>('savingsPercent', { default: 20 });

const { t } = useTranslation();
const settingsStore = useSettingsStore();
const recurringStore = useRecurringStore();

const savingsMode = ref('percent');
const fixedSavingsAmount = ref<number | undefined>(undefined);
const fixedSavingsCurrency = ref<string>(settingsStore.baseCurrency);

// Total income reads from the recurring store (set in Step 3) so the
// "$X / mo into your bean jar" preview updates as the slider moves.
const totalIncome = computed(() =>
  recurringStore.recurringItems
    .filter((r) => r.type === 'income' && r.isActive)
    .reduce((sum, r) => sum + r.amount, 0)
);

const savingsAmount = computed(() => {
  if (savingsMode.value === 'fixed') {
    return fixedSavingsAmount.value || 0;
  }
  if (totalIncome.value > 0) {
    return Math.round((totalIncome.value * savingsPercent.value) / 100);
  }
  return 0;
});

const savingsModeOptions = computed(() => [
  { value: 'percent', label: t('onboarding.savingsMode.percent') },
  { value: 'fixed', label: t('onboarding.savingsMode.fixed') },
]);

const sliderLabels = [5, 10, 15, 20, 25, 30, 35, 40, 45, 50];
</script>

<template>
  <OnboardingStepShell>
    <template #decorations>
      <div class="ob-float-emoji" style="font-size: 1.375rem; left: 50px; top: 36px">🌱</div>
      <div
        class="ob-float-emoji"
        style="animation-delay: 0.7s; font-size: 1.5rem; right: 60px; top: 130px"
      >
        🫘
      </div>
      <div
        class="ob-float-emoji"
        style="animation-delay: 0.3s; bottom: 110px; font-size: 1.25rem; left: 70px"
      >
        🎯
      </div>
    </template>

    <OnboardingStepHeader
      icon="🌱"
      title-prefix-key="onboarding.savings.titlePrefix"
      title-highlight-key="onboarding.savings.titleHighlight"
      :current-step="4"
      :total-steps="6"
    />

    <div class="ob-section" style="margin-bottom: 12px">
      <div class="ob-savings-card">
        <!-- Mode toggle -->
        <div class="mb-3">
          <TogglePillGroup v-model="savingsMode" :options="savingsModeOptions" />
        </div>

        <!-- Percent mode: slider -->
        <template v-if="savingsMode === 'percent'">
          <div class="mb-1 flex items-end justify-between">
            <span class="font-heading text-heritage-orange text-2xl font-extrabold">
              {{ savingsPercent }}%
            </span>
            <div class="text-right">
              <span v-if="totalIncome > 0" class="font-heading text-sm font-semibold opacity-40">
                ${{ savingsAmount.toLocaleString() }}/mo
              </span>
              <div class="font-heading text-xs font-medium opacity-35">
                {{ t('onboarding.ofMyIncome') }}
              </div>
            </div>
          </div>

          <input
            v-model.number="savingsPercent"
            type="range"
            min="5"
            max="50"
            step="5"
            class="ob-slider"
            data-testid="onboarding-savings-slider"
          />

          <div class="ob-slider-labels">
            <span
              v-for="label in sliderLabels"
              :key="label"
              :class="{ 'ob-slider-active': label === savingsPercent }"
            >
              {{ label }}%
            </span>
          </div>
        </template>

        <!-- Fixed mode: amount input -->
        <template v-else>
          <div class="ob-detail-label">{{ t('onboarding.amount') }}</div>
          <div class="max-w-[300px]">
            <CurrencyAmountInput
              :amount="fixedSavingsAmount"
              :currency="fixedSavingsCurrency"
              font-size="0.85rem"
              @update:amount="fixedSavingsAmount = $event"
              @update:currency="fixedSavingsCurrency = $event"
            />
          </div>
        </template>

        <!-- Encouragement -->
        <div
          v-if="savingsAmount > 0"
          class="mt-2.5 flex items-center gap-2 rounded-xl p-2 px-3"
          style="background: rgb(174 214 241 / 10%)"
        >
          <span class="text-sm">🥫</span>
          <span class="text-xs leading-snug opacity-55">
            <strong class="text-heritage-orange">{{ t('onboarding.savingsNice') }}</strong>
            {{
              t('onboarding.savingsEncouragement').replace(
                '{amount}',
                `$${savingsAmount.toLocaleString()}`
              )
            }}
          </span>
        </div>
      </div>
    </div>
  </OnboardingStepShell>
</template>
