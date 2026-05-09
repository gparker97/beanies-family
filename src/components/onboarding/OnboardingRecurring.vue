<script setup lang="ts">
import { ref, computed, nextTick, onMounted } from 'vue';
import OnboardingStepHeader from './OnboardingStepHeader.vue';
import OnboardingStepShell from './OnboardingStepShell.vue';
import OnboardingAddedRow from './OnboardingAddedRow.vue';
import FrequencyChips from '@/components/ui/FrequencyChips.vue';
import CurrencyAmountInput from '@/components/ui/CurrencyAmountInput.vue';
import { BaseSelect } from '@/components/ui';
import { showToast } from '@/composables/useToast';
import { useSettingsStore } from '@/stores/settingsStore';
import { useAccountsStore } from '@/stores/accountsStore';
import { useRecurringStore } from '@/stores/recurringStore';
import { useTranslation } from '@/composables/useTranslation';
import {
  RECURRING_INCOME_PRESETS,
  RECURRING_EXPENSE_PRESETS,
  type RecurringPreset,
} from '@/constants/activityPresets';
import { ErrorSurfaces } from './errorSurfaces';
import type { CurrencyCode, RecurringFrequency } from '@/types/models';

defineEmits<{
  next: [];
  back: [];
}>();

const { t, isBeanieMode } = useTranslation();
const settingsStore = useSettingsStore();
const accountsStore = useAccountsStore();
const recurringStore = useRecurringStore();

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

const frequencyOptions = computed(() => [
  { value: 'daily', label: t('onboarding.frequency.daily'), icon: '\u{1F504}' },
  { value: 'monthly', label: t('onboarding.frequency.monthly'), icon: '\u{1F4C5}' },
  { value: 'yearly', label: t('onboarding.frequency.yearly'), icon: '\u{1F4C6}' },
]);

interface AddedRecurring {
  id: string;
  description: string;
  icon: string;
  type: 'income' | 'expense';
  amount: number;
  frequency: RecurringFrequency;
}
const addedRecurrings = ref<AddedRecurring[]>([]);

// Defensive default: pick the most-recently-created account that still
// exists in the store. Defends against "user goes back to Account step,
// deletes account, returns" producing a stale ID binding.
onMounted(() => {
  const candidate = accountsStore.accounts.at(-1);
  if (candidate && accountsStore.accounts.some((a) => a.id === candidate.id)) {
    recurringAccountId.value = candidate.id;
  }
});

function selectRecurringPreset(preset: RecurringPreset) {
  selectedPreset.value = preset;
  recurringDescription.value = preset.defaultName;
  recurringAmount.value = undefined;
  recurringFrequency.value = 'monthly';
  recurringAdded.value = false;
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

  try {
    const item = await recurringStore.createRecurringItem({
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
    if (!item) throw new Error('createRecurringItem returned null');

    addedRecurrings.value.push({
      id: item.id,
      description: recurringDescription.value.trim(),
      icon: selectedPreset.value?.icon || '\u{1F4B8}',
      type: selectedPreset.value?.type || 'expense',
      amount: recurringAmount.value,
      frequency: freq,
    });
    recurringAdded.value = true;
  } catch (e) {
    showToast('error', t('onboarding.errors.addRecurringFailed'), undefined, {
      surface: ErrorSurfaces.onboardingAddRecurring,
      error: e,
      context: {
        type: selectedPreset.value?.type ?? 'expense',
        frequency: freq,
        currency: recurringCurrency.value,
      },
    });
  }
}

function handleAddAnother() {
  selectedPreset.value = null;
  recurringDescription.value = '';
  recurringAmount.value = undefined;
  recurringFrequency.value = 'monthly';
  recurringAdded.value = false;
}

async function handleRemoveRecurring(itemId: string) {
  try {
    await recurringStore.deleteRecurringItem(itemId);
    addedRecurrings.value = addedRecurrings.value.filter((r) => r.id !== itemId);
  } catch (e) {
    showToast('error', t('onboarding.errors.addRecurringFailed'), undefined, {
      surface: ErrorSurfaces.onboardingAddRecurring,
      error: e,
      context: { action: 'remove' },
    });
  }
}

function formatFrequency(freq: RecurringFrequency): string {
  if (freq === 'daily') return '/day';
  if (freq === 'yearly') return '/yr';
  return '/mo';
}
</script>

<template>
  <OnboardingStepShell>
    <template #decorations>
      <div class="ob-float-emoji" style="font-size: 1.5rem; right: 50px; top: 36px">💸</div>
      <div
        class="ob-float-emoji"
        style="animation-delay: 0.8s; font-size: 1.375rem; left: 40px; top: 140px"
      >
        📅
      </div>
      <div
        class="ob-float-emoji"
        style="animation-delay: 0.4s; bottom: 100px; font-size: 1.25rem; right: 60px"
      >
        🛒
      </div>
    </template>

    <OnboardingStepHeader
      icon="💸"
      title-prefix-key="onboarding.recurring.titlePrefix"
      title-highlight-key="onboarding.recurring.titleHighlight"
      :current-step="3"
      :total-steps="6"
    />

    <div class="ob-section">
      <!-- Preset chips: income + expense -->
      <div class="ob-chip-groups">
        <div class="ob-chip-group">
          <div class="ob-chip-group-label ob-chip-label-income">
            {{ t('onboarding.summaryIncome') }}
          </div>
          <div class="flex flex-wrap gap-1.5">
            <button
              v-for="preset in RECURRING_INCOME_PRESETS"
              :key="preset.label"
              class="ob-chip ob-chip-income"
              :class="{ 'ob-chip-active-income': selectedPreset?.label === preset.label }"
              @click="selectRecurringPreset(preset)"
            >
              <span class="text-sm">{{ preset.icon }}</span>
              {{ isBeanieMode ? preset.label.toLowerCase() : preset.label }}
            </button>
          </div>
        </div>
        <div class="ob-chip-group">
          <div class="ob-chip-group-label ob-chip-label-expense">
            {{ t('onboarding.summaryFixedCosts') }}
          </div>
          <div class="flex flex-wrap gap-1.5">
            <button
              v-for="preset in RECURRING_EXPENSE_PRESETS"
              :key="preset.label"
              class="ob-chip ob-chip-expense"
              :class="{ 'ob-chip-active-expense': selectedPreset?.label === preset.label }"
              @click="selectRecurringPreset(preset)"
            >
              <span class="text-sm">{{ preset.icon }}</span>
              {{ isBeanieMode ? preset.label.toLowerCase() : preset.label }}
            </button>
          </div>
        </div>
      </div>

      <!-- Inline expanded card on chip-select -->
      <div
        v-if="selectedPreset && !recurringAdded"
        class="ob-recurring-card"
        data-testid="onboarding-recurring-card"
      >
        <div class="ob-recurring-header">
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
          <div v-if="accountOptions.length > 0" class="ob-recurring-account-col">
            <BaseSelect
              :model-value="recurringAccountId"
              :options="accountOptions"
              :placeholder="t('form.selectAccount')"
              class="ob-account-select"
              @update:model-value="recurringAccountId = String($event)"
            />
          </div>
        </div>

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

      <!-- Added recurring list — visible always (above OR below the entry card)
           with remove buttons per row. -->
      <div v-if="addedRecurrings.length > 0" class="ob-added-list mt-3">
        <OnboardingAddedRow
          v-for="item in addedRecurrings"
          :key="item.id"
          :icon="item.icon"
          :title="item.description"
          :meta="`$${item.amount.toLocaleString()}${formatFrequency(item.frequency)}`"
          :tag="item.type"
          :tag-variant="item.type"
          removable
          @remove="handleRemoveRecurring(item.id)"
        />
        <div v-if="recurringAdded" class="mt-2 flex justify-end">
          <button class="ob-add-pill" @click="handleAddAnother">
            {{ t('onboarding.addAnother') }}
          </button>
        </div>
      </div>
    </div>
  </OnboardingStepShell>
</template>

<style scoped>
/* BaseSelect background overrides — moved here from onboarding-shared.css
 * (global) so Vue's scoped-style [data-v] specificity boost retires the
 * previous !important workaround. Light + dark mode mirror onboarding's
 * other input surfaces. */
.ob-account-select :deep(select) {
  background: white;
  border-color: rgb(44 62 80 / 8%);
  box-shadow: 0 1px 4px rgb(44 62 80 / 4%);
  font-family: Outfit, sans-serif;
  font-size: 0.75rem;
  font-weight: 600;
}

:global(.dark) .ob-account-select :deep(select) {
  background: #243342;
  border-color: rgb(255 255 255 / 8%);
}
</style>
