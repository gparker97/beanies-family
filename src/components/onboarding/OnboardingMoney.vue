<script setup lang="ts">
import { ref, computed } from 'vue';
import OnboardingStepHeader from './OnboardingStepHeader.vue';
import OnboardingSectionLabel from './OnboardingSectionLabel.vue';
import OnboardingRecurringModal from './OnboardingRecurringModal.vue';
import FrequencyChips from '@/components/ui/FrequencyChips.vue';
import BaseCombobox from '@/components/ui/BaseCombobox.vue';
import BaseInput from '@/components/ui/BaseInput.vue';
import CurrencyAmountInput from '@/components/ui/CurrencyAmountInput.vue';
import TogglePillGroup from '@/components/ui/TogglePillGroup.vue';
import { useSettingsStore } from '@/stores/settingsStore';
import { useFamilyStore } from '@/stores/familyStore';
import { useAccountsStore } from '@/stores/accountsStore';
import { useRecurringStore } from '@/stores/recurringStore';
import { useTranslation } from '@/composables/useTranslation';
import { INSTITUTIONS } from '@/constants/institutions';
import {
  RECURRING_INCOME_PRESETS,
  RECURRING_EXPENSE_PRESETS,
  type RecurringPreset,
} from '@/constants/activityPresets';
import type { CurrencyCode } from '@/types/models';

defineEmits<{
  next: [];
  back: [];
}>();

const { t } = useTranslation();
const settingsStore = useSettingsStore();
const familyStore = useFamilyStore();
const accountsStore = useAccountsStore();
const recurringStore = useRecurringStore();

// ── Section A: Account ──────────────────────────────────────────────────────

const accountTypeOptions = [
  { value: 'checking', label: 'Checking', icon: '\u{1F3E6}' },
  { value: 'savings', label: 'Savings', icon: '\u{1F4B0}' },
  { value: 'credit_card', label: 'Credit Card', icon: '\u{1F4B3}' },
  { value: 'investment', label: 'Investment', icon: '\u{1F4C8}' },
  { value: 'loan', label: 'Mortgage', icon: '\u{1F3E0}' },
];

const accountType = ref('checking');
const bankInstitution = ref<string | undefined>(undefined);
const accountName = ref('');
const accountBalance = ref<number | undefined>(undefined);
const accountCurrency = ref<string>(settingsStore.baseCurrency);
const accountAdded = ref(false);
const addedAccountName = ref('');
const addedAccountId = ref('');

const institutionOptions = computed(() =>
  INSTITUTIONS.map((inst) => ({
    value: inst.name,
    label: inst.shortName,
  }))
);

async function handleAddAccount() {
  if (!accountName.value.trim()) return;
  const memberId = familyStore.owner?.id;
  if (!memberId) return;

  const account = await accountsStore.createAccount({
    memberId,
    name: accountName.value.trim(),
    type: accountType.value as any,
    currency: accountCurrency.value as CurrencyCode,
    balance: accountBalance.value || 0,
    institution: bankInstitution.value,
    isActive: true,
    includeInNetWorth: true,
  });

  if (account) {
    addedAccountName.value = `${bankInstitution.value ? bankInstitution.value + ' ' : ''}${account.name}`;
    addedAccountId.value = account.id;
    accountAdded.value = true;
  }
}

function handleAddAnother() {
  accountName.value = '';
  accountBalance.value = undefined;
  bankInstitution.value = undefined;
  accountType.value = 'checking';
  accountAdded.value = false;
}

// ── Section B: Recurring Transactions ───────────────────────────────────────

const recurringModalOpen = ref(false);
const selectedPreset = ref<RecurringPreset | null>(null);
const filledPresets = ref<Map<string, { name: string; amount: number; dayOfMonth: number }>>(
  new Map()
);

function openRecurringModal(preset: RecurringPreset) {
  if (!addedAccountId.value) return;
  selectedPreset.value = preset;
  recurringModalOpen.value = true;
}

async function handleRecurringSave(data: {
  type: 'income' | 'expense';
  name: string;
  amount: number;
  currency: string;
  category: string;
  dayOfMonth: number;
  frequency: 'monthly' | 'yearly';
}) {
  const accountId = addedAccountId.value;
  if (!accountId) return;

  const today = new Date().toISOString().split('T')[0] as string;
  await recurringStore.createRecurringItem({
    accountId,
    type: data.type,
    amount: data.amount,
    currency: data.currency as CurrencyCode,
    category: data.category,
    description: data.name,
    frequency: data.frequency,
    dayOfMonth: data.dayOfMonth,
    startDate: today,
    isActive: true,
  });

  if (selectedPreset.value) {
    filledPresets.value.set(selectedPreset.value.label, {
      name: data.name,
      amount: data.amount,
      dayOfMonth: data.dayOfMonth,
    });
  }

  recurringModalOpen.value = false;
}

// ── Section C: Savings Slider ───────────────────────────────────────────────

const savingsMode = ref('percent');
const savingsPercent = ref(20);

const totalIncome = computed(() => {
  let sum = 0;
  for (const p of RECURRING_INCOME_PRESETS) {
    const entry = filledPresets.value.get(p.label);
    if (entry) sum += entry.amount;
  }
  return sum;
});

const savingsAmount = computed(() => {
  if (savingsMode.value === 'percent' && totalIncome.value > 0) {
    return Math.round((totalIncome.value * savingsPercent.value) / 100);
  }
  return 0;
});

const totalExpenses = computed(() => {
  let sum = 0;
  for (const p of RECURRING_EXPENSE_PRESETS) {
    const entry = filledPresets.value.get(p.label);
    if (entry) sum += entry.amount;
  }
  return sum;
});

const flexibleAmount = computed(() => {
  return Math.max(0, totalIncome.value - totalExpenses.value - savingsAmount.value);
});

const savingsModeOptions = [
  { value: 'percent', label: '% of Income' },
  { value: 'fixed', label: 'Fixed $' },
];

const sliderLabels = [5, 10, 15, 20, 30, 40, 50];

function formatCurrency(val: number): string {
  if (val >= 1000) {
    return `$${(val / 1000).toFixed(val % 1000 === 0 ? 0 : 1)}k`;
  }
  return `$${val.toLocaleString()}`;
}
</script>

<template>
  <div class="ob-form">
    <OnboardingStepHeader
      icon="\u{1F437}"
      icon-bg="rgba(241,93,34,0.08)"
      step-label="Step 2 of 3"
      title-prefix="Your "
      title-highlight="money snapshot"
      :current-step="2"
      :total-steps="3"
    />

    <!-- Section A: Drop in an account -->
    <div class="ob-section">
      <OnboardingSectionLabel
        letter="A"
        :label="t('onboarding.sectionAccount')"
        :subtitle="t('onboarding.sectionAccountSub')"
        color="var(--heritage-orange, #F15D22)"
        badge-gradient="linear-gradient(135deg, var(--heritage-orange, #F15D22), var(--terracotta, #E67E22))"
      />

      <!-- Type chips -->
      <div class="mb-2.5">
        <FrequencyChips v-model="accountType" :options="accountTypeOptions" />
      </div>

      <template v-if="!accountAdded">
        <!-- Bank + Name + Balance grid -->
        <div class="ob-account-grid">
          <div>
            <div class="ob-label">{{ t('onboarding.bank') }}</div>
            <BaseCombobox
              v-model="bankInstitution"
              :options="institutionOptions"
              :placeholder="t('onboarding.bankPlaceholder')"
            />
          </div>
          <div>
            <div class="ob-label">{{ t('onboarding.accountName') }}</div>
            <BaseInput
              v-model="accountName"
              :placeholder="t('onboarding.accountNamePlaceholder')"
            />
          </div>
          <div>
            <div class="ob-label">{{ t('onboarding.balance') }}</div>
            <CurrencyAmountInput
              :amount="accountBalance"
              :currency="accountCurrency"
              @update:amount="accountBalance = $event"
              @update:currency="accountCurrency = $event"
            />
          </div>
        </div>

        <!-- Add button -->
        <div class="mt-2.5 flex justify-end">
          <button
            class="ob-add-pill"
            :disabled="!accountName.trim()"
            data-testid="onboarding-add-account"
            @click="handleAddAccount"
          >
            {{ t('onboarding.addAccount') }}
          </button>
        </div>
      </template>

      <!-- Confirmation row -->
      <div v-else class="mt-2.5 flex items-center justify-between">
        <div class="flex items-center gap-2">
          <span class="text-xs" style="color: #27ae60">{'\u2713'}</span>
          <span class="font-heading text-xs font-semibold" style="color: #27ae60">
            {{ addedAccountName }} {{ t('onboarding.added') }}
          </span>
        </div>
        <button class="ob-add-pill" @click="handleAddAnother">
          {{ t('onboarding.addAnother') }}
        </button>
      </div>
    </div>

    <!-- Divider -->
    <div class="ob-divider" />

    <!-- Section B: Regular transactions -->
    <div class="ob-section">
      <OnboardingSectionLabel
        letter="B"
        :label="t('onboarding.sectionRecurring')"
        :subtitle="t('onboarding.sectionRecurringSub')"
        color="var(--heritage-orange, #F15D22)"
        badge-gradient="linear-gradient(135deg, var(--heritage-orange, #F15D22), var(--terracotta, #E67E22))"
      />

      <!-- Income presets -->
      <div class="mb-2">
        <div class="ob-category-header ob-category-income">
          {{ t('onboarding.income') }}
        </div>
        <div class="flex flex-wrap gap-2">
          <div
            v-for="preset in RECURRING_INCOME_PRESETS"
            :key="preset.label"
            class="ob-preset-card"
            :class="{ 'ob-preset-filled': filledPresets.has(preset.label) }"
            @click="openRecurringModal(preset)"
          >
            <span class="text-base">{{ preset.icon }}</span>
            <div v-if="filledPresets.has(preset.label)">
              <div class="font-heading text-xs font-bold">{{ preset.label }}</div>
              <div class="text-xs opacity-45">
                ${{ filledPresets.get(preset.label)?.amount?.toLocaleString() }} &middot;
                {{ filledPresets.get(preset.label)?.dayOfMonth
                }}{{
                  ['st', 'nd', 'rd'][(filledPresets.get(preset.label)?.dayOfMonth ?? 1) - 1] || 'th'
                }}
              </div>
            </div>
            <span v-else class="font-heading text-xs font-semibold opacity-45">{{
              preset.label
            }}</span>
            <span
              v-if="filledPresets.has(preset.label)"
              class="text-xs font-bold"
              style="color: #27ae60"
              >{'\u2713'}</span
            >
          </div>
        </div>
      </div>

      <!-- Expense presets -->
      <div>
        <div class="ob-category-header ob-category-expense">
          {{ t('onboarding.expenses') }}
        </div>
        <div class="flex flex-wrap gap-2">
          <div
            v-for="preset in RECURRING_EXPENSE_PRESETS"
            :key="preset.label"
            class="ob-preset-card"
            :class="{ 'ob-preset-filled': filledPresets.has(preset.label) }"
            @click="openRecurringModal(preset)"
          >
            <span class="text-base">{{ preset.icon }}</span>
            <div v-if="filledPresets.has(preset.label)">
              <div class="font-heading text-xs font-bold">{{ preset.label }}</div>
              <div class="text-xs opacity-45">
                ${{ filledPresets.get(preset.label)?.amount?.toLocaleString() }} &middot;
                {{ filledPresets.get(preset.label)?.dayOfMonth
                }}{{
                  ['st', 'nd', 'rd'][(filledPresets.get(preset.label)?.dayOfMonth ?? 1) - 1] || 'th'
                }}
              </div>
            </div>
            <span v-else class="font-heading text-xs font-semibold opacity-45">{{
              preset.label
            }}</span>
            <span
              v-if="filledPresets.has(preset.label)"
              class="text-xs font-bold"
              style="color: #27ae60"
              >{'\u2713'}</span
            >
          </div>
        </div>
      </div>
    </div>

    <!-- Divider -->
    <div class="ob-divider" />

    <!-- Section C: Savings slider -->
    <div class="ob-section" style="margin-bottom: 12px">
      <OnboardingSectionLabel
        letter="C"
        :label="t('onboarding.sectionSavings')"
        color="var(--heritage-orange, #F15D22)"
        badge-gradient="linear-gradient(135deg, var(--heritage-orange, #F15D22), var(--terracotta, #E67E22))"
      />

      <div class="ob-savings-card">
        <!-- Mode toggle + value -->
        <div class="mb-1.5 flex items-center justify-between">
          <TogglePillGroup v-model="savingsMode" :options="savingsModeOptions" />
          <div class="text-right">
            <span class="font-heading text-heritage-orange text-2xl font-extrabold">
              {{ savingsPercent }}%
            </span>
            <span
              v-if="totalIncome > 0"
              class="font-heading ml-1.5 text-sm font-semibold opacity-40"
            >
              ${{ savingsAmount.toLocaleString() }}/mo
            </span>
          </div>
        </div>

        <!-- Slider -->
        <input
          v-model.number="savingsPercent"
          type="range"
          min="5"
          max="50"
          step="5"
          class="ob-slider"
          data-testid="onboarding-savings-slider"
        />

        <!-- Scale labels -->
        <div class="ob-slider-labels">
          <span
            v-for="label in sliderLabels"
            :key="label"
            :class="{ 'ob-slider-active': label === savingsPercent }"
          >
            {{ label }}%
          </span>
        </div>

        <!-- Encouragement -->
        <div
          v-if="totalIncome > 0"
          class="mt-2.5 flex items-center gap-2 rounded-xl p-2 px-3"
          style="background: rgb(174 214 241 / 10%)"
        >
          <span class="text-sm">{'\u{1F96B}'}</span>
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

    <!-- Summary bar -->
    <div v-if="totalIncome > 0" class="ob-summary-bar">
      <div>
        <div class="ob-summary-bar-value" style="color: #6ee7b7">
          +{{ formatCurrency(totalIncome) }}
        </div>
        <div class="ob-summary-bar-label">{{ t('onboarding.summaryIncome') }}</div>
      </div>
      <div class="ob-summary-bar-divider" />
      <div>
        <div class="ob-summary-bar-value text-heritage-orange">
          -{{ formatCurrency(totalExpenses) }}
        </div>
        <div class="ob-summary-bar-label">{{ t('onboarding.summaryFixedCosts') }}</div>
      </div>
      <div class="ob-summary-bar-divider" />
      <div>
        <div class="ob-summary-bar-value" style="color: #6ee7b7">
          {{ formatCurrency(savingsAmount) }}
        </div>
        <div class="ob-summary-bar-label">{{ t('onboarding.summarySavingsBar') }}</div>
      </div>
      <div class="ob-summary-bar-divider" />
      <div>
        <div class="ob-summary-bar-value text-white">{{ formatCurrency(flexibleAmount) }}</div>
        <div class="ob-summary-bar-label">{{ t('onboarding.summaryFlexible') }}</div>
      </div>
    </div>

    <!-- Recurring Modal -->
    <OnboardingRecurringModal
      :open="recurringModalOpen"
      :preset="selectedPreset"
      :account-name="addedAccountName"
      :account-id="addedAccountId"
      @close="recurringModalOpen = false"
      @save="handleRecurringSave"
    />
  </div>
</template>

<style scoped>
.ob-form {
  background: linear-gradient(180deg, var(--cloud-white, #f8f9fa) 0%, #edf6fc 100%);
  min-height: 100%;
  overflow: hidden;
  padding: 20px 16px;
  position: relative;
}

.dark .ob-form {
  background: linear-gradient(180deg, #1a252f 0%, #1e3040 100%);
}

.ob-form::before {
  background: radial-gradient(circle, rgb(174 214 241 / 20%), transparent 70%);
  border-radius: 50%;
  bottom: -80px;
  content: '';
  height: 300px;
  position: absolute;
  right: -80px;
  width: 300px;
}

.ob-form::after {
  background: radial-gradient(circle, rgb(241 93 34 / 6%), transparent 70%);
  border-radius: 50%;
  content: '';
  height: 200px;
  left: -40px;
  position: absolute;
  top: -40px;
  width: 200px;
}

@media (width >= 640px) {
  .ob-form {
    padding: 32px 40px;
  }
}

.ob-section {
  margin-bottom: 20px;
  position: relative;
  z-index: 1;
}

.ob-divider {
  background: rgb(44 62 80 / 5%);
  height: 1px;
  margin: 4px 0 20px;
  position: relative;
  z-index: 1;
}

.dark .ob-divider {
  background: rgb(255 255 255 / 6%);
}

.ob-label {
  font-family: Outfit, sans-serif;
  font-size: 0.58rem;
  font-weight: 600;
  letter-spacing: 0.1em;
  margin-bottom: 5px;
  opacity: 0.4;
  text-transform: uppercase;
}

.ob-account-grid {
  display: grid;
  gap: 10px;
  grid-template-columns: 1fr;
}

@media (width >= 640px) {
  .ob-account-grid {
    align-items: end;
    grid-template-columns: 1fr 1fr 0.8fr;
  }
}

.ob-add-pill {
  background: rgb(241 93 34 / 8%);
  border: none;
  border-radius: 12px;
  color: var(--heritage-orange, #f15d22);
  cursor: pointer;
  font-family: Outfit, sans-serif;
  font-size: 0.68rem;
  font-weight: 600;
  padding: 4px 12px;
  transition: opacity 0.2s;
}

.ob-add-pill:disabled {
  cursor: not-allowed;
  opacity: 0.4;
}

.ob-category-header {
  align-items: center;
  display: flex;
  font-family: Outfit, sans-serif;
  font-size: 0.55rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  margin-bottom: 6px;
  text-transform: uppercase;
  width: 100%;
}

.ob-category-income {
  color: #27ae60;
}

.ob-category-expense {
  color: var(--heritage-orange, #f15d22);
}

.ob-preset-card {
  align-items: center;
  background: white;
  border: 2px solid rgb(44 62 80 / 5%);
  border-radius: 12px;
  cursor: pointer;
  display: flex;
  gap: 8px;
  padding: 8px 14px;
  transition: all 0.2s;
}

.dark .ob-preset-card {
  background: #243342;
  border-color: rgb(255 255 255 / 6%);
}

.ob-preset-card:not(.ob-preset-filled):hover {
  border-color: var(--sky-silk, #aed6f1);
  box-shadow: 0 4px 16px rgb(44 62 80 / 6%);
  transform: translateY(-1px);
}

.ob-preset-filled {
  background: rgb(39 174 96 / 6%);
  border-color: #27ae60;
}

.dark .ob-preset-filled {
  background: rgb(39 174 96 / 10%);
}

.ob-savings-card {
  background: white;
  border-radius: 16px;
  box-shadow: 0 2px 12px rgb(44 62 80 / 4%);
  padding: 14px;
  position: relative;
  z-index: 1;
}

.dark .ob-savings-card {
  background: #243342;
  box-shadow: 0 2px 12px rgb(0 0 0 / 20%);
}

@media (width >= 640px) {
  .ob-savings-card {
    padding: 18px 20px;
  }
}

.ob-slider {
  appearance: none;
  background: rgb(44 62 80 / 5%);
  border-radius: 6px;
  height: 6px;
  margin: 12px 0 4px;
  outline: none;
  width: 100%;
}

.ob-slider::-webkit-slider-thumb {
  appearance: none;
  background: white;
  border: 3px solid var(--heritage-orange, #f15d22);
  border-radius: 50%;
  box-shadow: 0 2px 8px rgb(241 93 34 / 20%);
  cursor: grab;
  height: 20px;
  width: 20px;
}

.ob-slider::-moz-range-thumb {
  background: white;
  border: 3px solid var(--heritage-orange, #f15d22);
  border-radius: 50%;
  box-shadow: 0 2px 8px rgb(241 93 34 / 20%);
  cursor: grab;
  height: 20px;
  width: 20px;
}

.ob-slider-labels {
  display: flex;
  font-family: Outfit, sans-serif;
  font-size: 0.55rem;
  font-weight: 600;
  justify-content: space-between;
  margin-top: 2px;
  opacity: 0.25;
}

.ob-slider-active {
  color: var(--heritage-orange, #f15d22);
  font-weight: 700;
  opacity: 1;
}

.ob-summary-bar {
  background: linear-gradient(135deg, var(--deep-slate, #2c3e50), #3d5368);
  border-radius: 14px;
  color: white;
  display: flex;
  justify-content: space-around;
  padding: 12px;
  position: relative;
  text-align: center;
  z-index: 1;
}

@media (width >= 640px) {
  .ob-summary-bar {
    border-radius: 16px;
    padding: 14px 20px;
  }
}

.ob-summary-bar-value {
  font-family: Outfit, sans-serif;
  font-size: 0.78rem;
  font-weight: 800;
}

@media (width >= 640px) {
  .ob-summary-bar-value {
    font-size: 1rem;
  }
}

.ob-summary-bar-label {
  font-size: 0.48rem;
  margin-top: 2px;
  opacity: 0.4;
}

@media (width >= 640px) {
  .ob-summary-bar-label {
    font-size: 0.55rem;
  }
}

.ob-summary-bar-divider {
  background: rgb(255 255 255 / 10%);
  width: 1px;
}
</style>
