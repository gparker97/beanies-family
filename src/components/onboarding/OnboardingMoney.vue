<script setup lang="ts">
import { ref, computed, nextTick } from 'vue';
import OnboardingStepHeader from './OnboardingStepHeader.vue';
import OnboardingSectionLabel from './OnboardingSectionLabel.vue';
import FrequencyChips from '@/components/ui/FrequencyChips.vue';
import CurrencyAmountInput from '@/components/ui/CurrencyAmountInput.vue';
import TogglePillGroup from '@/components/ui/TogglePillGroup.vue';
import { BaseCombobox, BaseSelect } from '@/components/ui';
import { useSettingsStore } from '@/stores/settingsStore';
import { useFamilyStore } from '@/stores/familyStore';
import { useAccountsStore } from '@/stores/accountsStore';
import { useRecurringStore } from '@/stores/recurringStore';
import { useTranslation } from '@/composables/useTranslation';
import { useInstitutionOptions } from '@/composables/useInstitutionOptions';
import { OTHER_INSTITUTION_VALUE } from '@/constants/institutions';
import {
  RECURRING_INCOME_PRESETS,
  RECURRING_EXPENSE_PRESETS,
  type RecurringPreset,
} from '@/constants/activityPresets';
import type { CurrencyCode, RecurringFrequency } from '@/types/models';

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
  { value: 'investment', label: 'Investment', icon: '\u{1F4C8}' },
];

const accountType = ref('checking');
const bankInstitution = ref<string | undefined>(undefined);
const accountBalance = ref<number | undefined>(undefined);
const accountCurrency = ref<string>(settingsStore.baseCurrency);
const accountAdded = ref(false);
const addedAccountName = ref('');
const addedAccountId = ref('');

const { options: institutionOptions } = useInstitutionOptions();

/** Generate account name: "Dad's OCBC Savings" */
const generatedAccountName = computed(() => {
  const ownerName = familyStore.owner?.name?.split(' ')[0] || '';
  const bank = bankInstitution.value || '';
  const typeLabel = accountTypeOptions.find((o) => o.value === accountType.value)?.label || '';
  const parts = [ownerName ? `${ownerName}'s` : '', bank, typeLabel].filter(Boolean);
  return parts.join(' ') || typeLabel || 'Account';
});

const canAddAccount = computed(() => bankInstitution.value);

async function handleAddAccount() {
  if (!canAddAccount.value) return;
  const memberId = familyStore.owner?.id;
  if (!memberId) return;

  const name = generatedAccountName.value;
  const account = await accountsStore.createAccount({
    memberId,
    name,
    type: accountType.value as any,
    currency: accountCurrency.value as CurrencyCode,
    balance: accountBalance.value || 0,
    institution: bankInstitution.value,
    isActive: true,
    includeInNetWorth: true,
  });

  if (account) {
    addedAccountName.value = name;
    addedAccountId.value = account.id;
    accountAdded.value = true;
  }
}

function handleAddAnotherAccount() {
  accountBalance.value = undefined;
  bankInstitution.value = undefined;
  accountType.value = 'checking';
  accountAdded.value = false;
}

// ── Section B: Recurring Transactions (inline, like Step 3 activities) ─────

const selectedPreset = ref<RecurringPreset | null>(null);
const recurringDescription = ref('');
const recurringAmount = ref<number | undefined>(undefined);
const recurringCurrency = ref<string>(settingsStore.baseCurrency);
const recurringFrequency = ref<RecurringFrequency>('monthly');
const recurringAdded = ref(false);
const recurringAccountId = ref('');
const descriptionInputRef = ref<HTMLInputElement | null>(null);

const accountOptions = computed(() =>
  accountsStore.accounts.map((a) => ({ value: a.id, label: a.name }))
);

const frequencyOptions = [
  { value: 'daily', label: 'Daily', icon: '\u{1F504}' },
  { value: 'monthly', label: 'Monthly', icon: '\u{1F4C5}' },
  { value: 'yearly', label: 'Yearly', icon: '\u{1F4C6}' },
];

interface AddedRecurring {
  description: string;
  icon: string;
  type: 'income' | 'expense';
  amount: number;
  frequency: RecurringFrequency;
}
const addedRecurrings = ref<AddedRecurring[]>([]);

function selectRecurringPreset(preset: RecurringPreset) {
  selectedPreset.value = preset;
  recurringDescription.value = preset.defaultName;
  recurringAmount.value = undefined;
  recurringFrequency.value = 'monthly';
  recurringAdded.value = false;
  // Default to last added account if not already selected
  if (!recurringAccountId.value && addedAccountId.value) {
    recurringAccountId.value = addedAccountId.value;
  }
  nextTick(() => {
    descriptionInputRef.value?.focus();
  });
}

const canAddRecurring = computed(
  () =>
    recurringDescription.value.trim() &&
    recurringAmount.value &&
    recurringAmount.value > 0 &&
    recurringAccountId.value
);

async function handleAddRecurring() {
  if (!canAddRecurring.value || !recurringAmount.value) return;
  const accountId = recurringAccountId.value;
  if (!accountId) return;

  const freq = recurringFrequency.value;
  const dayOfMonth = freq === 'yearly' ? 1 : 1;
  const monthOfYear = freq === 'yearly' ? 1 : undefined;

  const today = new Date().toISOString().split('T')[0] as string;
  await recurringStore.createRecurringItem({
    accountId,
    type: selectedPreset.value?.type || 'expense',
    amount: recurringAmount.value,
    currency: recurringCurrency.value as CurrencyCode,
    category: selectedPreset.value?.category || 'other',
    description: recurringDescription.value.trim(),
    frequency: freq,
    dayOfMonth,
    monthOfYear,
    startDate: today,
    isActive: true,
  });

  addedRecurrings.value.push({
    description: recurringDescription.value.trim(),
    icon: selectedPreset.value?.icon || '\u{1F4B8}',
    type: selectedPreset.value?.type || 'expense',
    amount: recurringAmount.value,
    frequency: freq,
  });
  recurringAdded.value = true;
}

function handleAddAnotherRecurring() {
  selectedPreset.value = null;
  recurringDescription.value = '';
  recurringAmount.value = undefined;
  recurringFrequency.value = 'monthly';
  recurringAdded.value = false;
}

function formatFrequency(freq: RecurringFrequency): string {
  if (freq === 'daily') return '/day';
  if (freq === 'yearly') return '/yr';
  return '/mo';
}

// ── Section C: Savings Slider ───────────────────────────────────────────────

const savingsMode = ref('percent');
const savingsPercent = ref(20);
const fixedSavingsAmount = ref<number | undefined>(undefined);
const fixedSavingsCurrency = ref<string>(settingsStore.baseCurrency);

const totalIncome = computed(() => {
  return addedRecurrings.value
    .filter((r) => r.type === 'income')
    .reduce((sum, r) => sum + r.amount, 0);
});

const savingsAmount = computed(() => {
  if (savingsMode.value === 'fixed') {
    return fixedSavingsAmount.value || 0;
  }
  if (totalIncome.value > 0) {
    return Math.round((totalIncome.value * savingsPercent.value) / 100);
  }
  return 0;
});

const totalExpenses = computed(() => {
  return addedRecurrings.value
    .filter((r) => r.type === 'expense')
    .reduce((sum, r) => sum + r.amount, 0);
});

const flexibleAmount = computed(() => {
  return Math.max(0, totalIncome.value - totalExpenses.value - savingsAmount.value);
});

const savingsModeOptions = [
  { value: 'percent', label: '% of Income' },
  { value: 'fixed', label: 'Fixed $' },
];

const sliderLabels = [5, 10, 15, 20, 25, 30, 35, 40, 45, 50];

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
      icon="🐷"
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
        <!-- Bank + Balance grid -->
        <div class="ob-account-grid">
          <div data-testid="onboarding-bank-select">
            <BaseCombobox
              :model-value="bankInstitution ?? ''"
              :options="institutionOptions"
              :label="t('onboarding.bank')"
              :placeholder="t('onboarding.bankPlaceholder')"
              :search-placeholder="t('form.searchInstitutions')"
              :other-value="OTHER_INSTITUTION_VALUE"
              :other-label="t('form.other')"
              :other-placeholder="t('form.enterCustomName')"
              @update:model-value="bankInstitution = $event || undefined"
            />
          </div>
          <div>
            <div class="ob-label">{{ t('onboarding.balance') }}</div>
            <CurrencyAmountInput
              :amount="accountBalance"
              :currency="accountCurrency"
              font-size="0.85rem"
              @update:amount="accountBalance = $event"
              @update:currency="accountCurrency = $event"
            />
          </div>
        </div>

        <!-- Generated name preview + Add button -->
        <div class="mt-2.5 flex items-center justify-between">
          <div
            v-if="bankInstitution"
            class="font-heading truncate text-xs font-semibold opacity-35"
          >
            {{ generatedAccountName }}
          </div>
          <div v-else />
          <button
            class="ob-add-pill"
            :disabled="!canAddAccount"
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
          <span class="text-xs" style="color: #27ae60">✓</span>
          <span class="font-heading text-xs font-semibold" style="color: #27ae60">
            {{ addedAccountName }} {{ t('onboarding.added') }}
          </span>
        </div>
        <button class="ob-add-pill" @click="handleAddAnotherAccount">
          {{ t('onboarding.addAnother') }}
        </button>
      </div>
    </div>

    <!-- Divider -->
    <div class="ob-divider" />

    <!-- Section B: Regular transactions (inline like Step 3 activities) -->
    <div class="ob-section">
      <OnboardingSectionLabel
        letter="B"
        :label="t('onboarding.sectionRecurring')"
        :subtitle="t('onboarding.sectionRecurringSub')"
        color="var(--heritage-orange, #F15D22)"
        badge-gradient="linear-gradient(135deg, var(--heritage-orange, #F15D22), var(--terracotta, #E67E22))"
      />

      <!-- Preset chips: income + expense -->
      <div class="ob-chip-groups">
        <div class="ob-chip-group">
          <div class="ob-chip-group-label ob-chip-group-label--income">
            {{ t('onboarding.summaryIncome') }}
          </div>
          <div class="flex flex-wrap gap-1.5">
            <button
              v-for="preset in RECURRING_INCOME_PRESETS"
              :key="preset.label"
              class="ob-chip ob-chip-income"
              :class="{
                'ob-chip-selected ob-chip-selected--income': selectedPreset?.label === preset.label,
              }"
              @click="selectRecurringPreset(preset)"
            >
              <span class="text-sm">{{ preset.icon }}</span>
              {{ preset.label }}
            </button>
          </div>
        </div>
        <div class="ob-chip-group">
          <div class="ob-chip-group-label ob-chip-group-label--expense">
            {{ t('onboarding.summaryFixedCosts') }}
          </div>
          <div class="flex flex-wrap gap-1.5">
            <button
              v-for="preset in RECURRING_EXPENSE_PRESETS"
              :key="preset.label"
              class="ob-chip ob-chip-expense"
              :class="{
                'ob-chip-selected ob-chip-selected--expense':
                  selectedPreset?.label === preset.label,
              }"
              @click="selectRecurringPreset(preset)"
            >
              <span class="text-sm">{{ preset.icon }}</span>
              {{ preset.label }}
            </button>
          </div>
        </div>
      </div>

      <!-- Inline form card (when preset selected and not yet added) -->
      <div
        v-if="selectedPreset && !recurringAdded"
        class="ob-recurring-card"
        data-testid="onboarding-recurring-card"
      >
        <!-- Header: icon + description input -->
        <div class="mb-3.5 flex items-center gap-3">
          <div
            class="flex h-10 w-10 shrink-0 items-center justify-center rounded-[14px] text-lg"
            :style="{
              background:
                selectedPreset.type === 'income' ? 'rgb(39 174 96 / 10%)' : 'rgb(241 93 34 / 8%)',
            }"
          >
            {{ selectedPreset.icon }}
          </div>
          <div class="min-w-0 flex-1">
            <input
              ref="descriptionInputRef"
              v-model="recurringDescription"
              type="text"
              class="ob-desc-input"
              :placeholder="t('onboarding.transactionNamePlaceholder')"
              data-testid="onboarding-recurring-description"
            />
          </div>
        </div>

        <!-- Account selector -->
        <div v-if="accountOptions.length > 0" class="mb-3">
          <div class="ob-detail-label">{{ t('onboarding.account') }}</div>
          <BaseSelect
            :model-value="recurringAccountId"
            :options="accountOptions"
            :placeholder="t('form.selectAccount')"
            @update:model-value="recurringAccountId = String($event)"
          />
        </div>

        <!-- Amount + Frequency row -->
        <div class="ob-recurring-fields">
          <div class="ob-recurring-amount-col">
            <div class="ob-detail-label">{{ t('onboarding.amount') }}</div>
            <CurrencyAmountInput
              :amount="recurringAmount"
              :currency="recurringCurrency"
              font-size="0.85rem"
              @update:amount="recurringAmount = $event"
              @update:currency="recurringCurrency = $event"
            />
          </div>
          <div class="ob-recurring-freq-col">
            <div class="ob-detail-label">{{ t('onboarding.frequency') }}</div>
            <FrequencyChips v-model="recurringFrequency" :options="frequencyOptions" />
          </div>
        </div>

        <button
          class="ob-add-pill mt-3 w-full"
          :disabled="!canAddRecurring"
          data-testid="onboarding-add-recurring"
          @click="handleAddRecurring"
        >
          {{ t('onboarding.addRecurring') }}
        </button>
      </div>

      <!-- Added recurring list -->
      <div v-if="addedRecurrings.length > 0" class="ob-added-list">
        <div v-for="(item, idx) in addedRecurrings" :key="idx" class="ob-added-row">
          <span class="text-base">{{ item.icon }}</span>
          <div class="min-w-0 flex-1">
            <div class="font-heading truncate text-xs font-bold">{{ item.description }}</div>
            <div class="truncate text-xs opacity-45">
              ${{ item.amount.toLocaleString() }}{{ formatFrequency(item.frequency) }}
            </div>
          </div>
          <span
            class="ob-added-type"
            :class="item.type === 'income' ? 'ob-type-income' : 'ob-type-expense'"
          >
            {{ item.type }}
          </span>
          <span class="text-xs font-bold" style="color: #27ae60">✓</span>
        </div>

        <div v-if="recurringAdded" class="mt-2 flex justify-end">
          <button class="ob-add-pill" @click="handleAddAnotherRecurring">
            {{ t('onboarding.addAnother') }}
          </button>
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
  </div>
</template>

<style scoped>
.ob-form {
  background: linear-gradient(180deg, var(--cloud-white, #f8f9fa) 0%, #edf6fc 100%);
  min-height: 100%;
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
  z-index: -1;
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
  z-index: -1;
}

@media (width >= 640px) {
  .ob-form {
    padding: 32px 40px;
  }
}

.ob-section {
  margin-bottom: 20px;
  position: relative;
}

.ob-divider {
  background: rgb(44 62 80 / 5%);
  height: 1px;
  margin: 4px 0 20px;
  position: relative;
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
    grid-template-columns: 1fr 1fr;
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
  padding: 8px 16px;
  transition: opacity 0.2s;
  white-space: nowrap;
}

.ob-add-pill:disabled {
  cursor: not-allowed;
  opacity: 0.4;
}

/* ── Bank combobox: solid background override ─────────────────────────── */

:deep([data-testid='combobox-trigger']) {
  background: white !important;
  border-color: rgb(44 62 80 / 8%);
  box-shadow: 0 1px 4px rgb(44 62 80 / 4%);
}

.dark :deep([data-testid='combobox-trigger']) {
  background: #243342 !important;
  border-color: rgb(255 255 255 / 8%);
}

:deep([data-testid='combobox-dropdown']) {
  z-index: 100;
}

/* ── Section B: Recurring chips + inline card ──────────────────────────── */

.ob-chip {
  align-items: center;
  background: white;
  border: 2px solid rgb(44 62 80 / 5%);
  border-radius: 12px;
  color: var(--deep-slate, #2c3e50);
  cursor: pointer;
  display: flex;
  font-family: Outfit, sans-serif;
  font-size: 0.68rem;
  font-weight: 600;
  gap: 5px;
  padding: 6px 12px;
  transition: all 0.2s;
}

.dark .ob-chip {
  background: #243342;
  border-color: rgb(255 255 255 / 6%);
  color: #e2e8f0;
}

.ob-chip:hover {
  background: rgb(174 214 241 / 10%);
  border-color: var(--sky-silk, #aed6f1);
}

.ob-chip-selected {
  background: rgb(241 93 34 / 8%);
  border-color: var(--heritage-orange, #f15d22);
  color: var(--heritage-orange, #f15d22);
}

.ob-recurring-card {
  background: white;
  border: 2px solid rgb(44 62 80 / 5%);
  border-radius: 16px;
  padding: 18px;
}

.dark .ob-recurring-card {
  background: #243342;
  border-color: rgb(255 255 255 / 6%);
}

.ob-inline-input {
  background: transparent;
  border: none;
  color: var(--deep-slate, #2c3e50);
  font-family: Outfit, sans-serif;
  font-size: 0.85rem;
  font-weight: 700;
  outline: none;
  width: 100%;
}

.ob-inline-input::placeholder {
  opacity: 0.3;
}

.dark .ob-inline-input {
  color: #f1f5f9;
}

.ob-desc-input {
  background: rgb(44 62 80 / 4%);
  border: 1.5px solid rgb(44 62 80 / 8%);
  border-radius: 12px;
  color: var(--deep-slate, #2c3e50);
  font-family: Outfit, sans-serif;
  font-size: 0.85rem;
  font-weight: 700;
  outline: none;
  padding: 8px 12px;
  transition: border-color 0.2s;
  width: 100%;
}

.ob-desc-input:focus {
  border-color: var(--heritage-orange, #f15d22);
}

.ob-desc-input::placeholder {
  font-weight: 500;
  opacity: 0.3;
}

.dark .ob-desc-input {
  background: rgb(255 255 255 / 6%);
  border-color: rgb(255 255 255 / 10%);
  color: #f1f5f9;
}

.ob-detail-label {
  font-family: Outfit, sans-serif;
  font-size: 0.52rem;
  font-weight: 600;
  letter-spacing: 0.08em;
  margin-bottom: 6px;
  opacity: 0.4;
  text-transform: uppercase;
}

.ob-recurring-fields {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

@media (width >= 640px) {
  .ob-recurring-fields {
    flex-direction: row;
    gap: 16px;
  }
}

.ob-recurring-amount-col {
  flex: 1;
  min-width: 0;
}

.ob-recurring-freq-col {
  flex-shrink: 0;
}

/* ── Added recurring list ──────────────────────────────────────────────── */

.ob-added-list {
  margin-top: 10px;
}

.ob-added-row {
  align-items: center;
  background: rgb(39 174 96 / 6%);
  border: 1.5px solid rgb(39 174 96 / 20%);
  border-radius: 12px;
  display: flex;
  gap: 10px;
  margin-bottom: 6px;
  padding: 8px 12px;
}

.dark .ob-added-row {
  background: rgb(39 174 96 / 10%);
}

.ob-added-type {
  border-radius: 6px;
  font-family: Outfit, sans-serif;
  font-size: 0.55rem;
  font-weight: 600;
  padding: 2px 6px;
  text-transform: capitalize;
  white-space: nowrap;
}

.ob-type-income {
  background: rgb(39 174 96 / 10%);
  color: #27ae60;
}

.ob-type-expense {
  background: rgb(241 93 34 / 8%);
  color: var(--heritage-orange, #f15d22);
}

.ob-savings-card {
  background: white;
  border-radius: 16px;
  box-shadow: 0 2px 12px rgb(44 62 80 / 4%);
  padding: 14px;
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
