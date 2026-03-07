<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import BaseModal from '@/components/ui/BaseModal.vue';
import BaseInput from '@/components/ui/BaseInput.vue';
import BaseSelect from '@/components/ui/BaseSelect.vue';
import CurrencyAmountInput from '@/components/ui/CurrencyAmountInput.vue';
import FrequencyChips from '@/components/ui/FrequencyChips.vue';
import { useSettingsStore } from '@/stores/settingsStore';
import { useTranslation } from '@/composables/useTranslation';
import type { RecurringPreset } from '@/constants/activityPresets';

const props = defineProps<{
  open: boolean;
  preset: RecurringPreset | null;
  accountName: string;
  accountId: string;
}>();

const emit = defineEmits<{
  close: [];
  save: [
    data: {
      type: 'income' | 'expense';
      name: string;
      amount: number;
      currency: string;
      category: string;
      dayOfMonth: number;
      frequency: 'monthly' | 'yearly';
    },
  ];
}>();

const { t } = useTranslation();
const settingsStore = useSettingsStore();

const direction = ref<'income' | 'expense'>('expense');
const name = ref('');
const amount = ref<number | undefined>(undefined);
const currency = ref(settingsStore.baseCurrency);
const dayOfMonth = ref(1);
const frequency = ref('monthly');

const dayOptions = computed(() =>
  Array.from({ length: 31 }, (_, i) => ({
    value: String(i + 1),
    label: `${i + 1}${['st', 'nd', 'rd'][i] || 'th'}`,
  }))
);

const frequencyOptions = [
  { value: 'monthly', label: 'Monthly', icon: '\u{1F4C5}' },
  { value: 'yearly', label: 'Yearly', icon: '\u{1F4C6}' },
];

const canSave = computed(() => name.value.trim() && amount.value && amount.value > 0);

watch(
  () => props.preset,
  (p) => {
    if (p) {
      direction.value = p.type;
      name.value = p.defaultName;
      amount.value = undefined;
      dayOfMonth.value = 1;
      frequency.value = 'monthly';
    }
  }
);

function handleSave() {
  if (!canSave.value || !amount.value) return;
  emit('save', {
    type: direction.value,
    name: name.value.trim(),
    amount: amount.value,
    currency: currency.value,
    category: props.preset?.category || 'other',
    dayOfMonth: dayOfMonth.value,
    frequency: frequency.value as 'monthly' | 'yearly',
  });
}
</script>

<template>
  <BaseModal :open="open" size="md" @close="emit('close')">
    <div class="px-2 pb-2 sm:px-4 sm:pb-4">
      <!-- Header -->
      <div class="mb-5 flex items-center justify-between">
        <div class="flex items-center gap-2.5">
          <div
            class="flex h-10 w-10 items-center justify-center rounded-[14px] text-xl"
            style="background: rgb(241 93 34 / 8%)"
          >
            {{ preset?.icon || '\u270F\uFE0F' }}
          </div>
          <div>
            <div class="font-heading text-xs font-semibold tracking-wider uppercase opacity-40">
              {{ t('onboarding.addRecurring') }}
            </div>
            <div class="font-heading text-deep-slate text-lg font-extrabold dark:text-gray-100">
              {{ preset?.label || t('onboarding.customTransaction') }}
            </div>
          </div>
        </div>
      </div>

      <!-- Direction toggle -->
      <div class="mb-4">
        <div class="font-heading mb-1.5 text-xs font-semibold tracking-wider uppercase opacity-40">
          {{ t('onboarding.direction') }}
        </div>
        <div class="flex gap-2">
          <button
            class="ob-direction-pill"
            :class="{ 'ob-direction-active': direction === 'expense' }"
            @click="direction = 'expense'"
          >
            {{ t('onboarding.directionExpense') }}
          </button>
          <button
            class="ob-direction-pill"
            :class="{ 'ob-direction-active': direction === 'income' }"
            @click="direction = 'income'"
          >
            {{ t('onboarding.directionIncome') }}
          </button>
        </div>
      </div>

      <!-- Transaction Name -->
      <div class="mb-3.5">
        <BaseInput
          v-model="name"
          :label="t('onboarding.transactionName')"
          :placeholder="preset?.defaultName || t('onboarding.transactionNamePlaceholder')"
        />
      </div>

      <!-- Amount + Day of Month -->
      <div class="mb-3.5 grid grid-cols-2 gap-3">
        <div>
          <div
            class="font-heading mb-1.5 text-xs font-semibold tracking-wider uppercase opacity-40"
          >
            {{ t('onboarding.amount') }}
          </div>
          <CurrencyAmountInput
            :amount="amount"
            :currency="currency"
            @update:amount="amount = $event"
            @update:currency="currency = $event"
          />
        </div>
        <BaseSelect
          :model-value="String(dayOfMonth)"
          :options="dayOptions"
          :label="t('onboarding.dayOfMonth')"
          @update:model-value="dayOfMonth = Number($event)"
        />
      </div>

      <!-- Frequency -->
      <div class="mb-3.5">
        <div class="font-heading mb-1.5 text-xs font-semibold tracking-wider uppercase opacity-40">
          {{ t('onboarding.frequency') }}
        </div>
        <FrequencyChips v-model="frequency" :options="frequencyOptions" />
      </div>

      <!-- Account (pre-selected) -->
      <div class="mb-5">
        <div class="font-heading mb-1.5 text-xs font-semibold tracking-wider uppercase opacity-40">
          {{ t('onboarding.account') }}
        </div>
        <div
          class="flex items-center gap-2 rounded-[14px] border-2 px-4 py-2.5 text-sm"
          style="background: rgb(39 174 96 / 6%); border-color: rgb(39 174 96 / 30%)"
        >
          <span class="text-base">🏦</span>
          <span class="font-heading font-semibold">{{ accountName }}</span>
          <span class="ml-auto text-xs font-semibold" style="color: #27ae60">
            {{ t('onboarding.autoSelected') }}
          </span>
        </div>
      </div>

      <!-- Save CTA -->
      <button
        class="ob-save-btn w-full"
        :disabled="!canSave"
        data-testid="onboarding-save-recurring"
        @click="handleSave"
      >
        {{ t('onboarding.addCategory').replace('{category}', preset?.label || name || '') }}
        {{ preset?.icon || '' }}
      </button>
    </div>
  </BaseModal>
</template>

<style scoped>
.ob-direction-pill {
  background: none;
  border: 2px solid rgb(44 62 80 / 5%);
  border-radius: 14px;
  cursor: pointer;
  flex: 1;
  font-family: Outfit, sans-serif;
  font-size: 0.72rem;
  font-weight: 600;
  opacity: 0.35;
  padding: 10px;
  text-align: center;
  transition: all 0.2s;
}

.ob-direction-active {
  background: rgb(241 93 34 / 8%);
  border-color: var(--heritage-orange, #f15d22);
  color: var(--heritage-orange, #f15d22);
  opacity: 1;
}

.ob-save-btn {
  background: linear-gradient(135deg, var(--heritage-orange, #f15d22), var(--terracotta, #e67e22));
  border: none;
  border-radius: 18px;
  box-shadow: 0 6px 20px rgb(241 93 34 / 20%);
  color: white;
  cursor: pointer;
  font-family: Outfit, sans-serif;
  font-size: 0.85rem;
  font-weight: 700;
  padding: 14px;
  transition:
    transform 0.2s,
    opacity 0.2s;
}

.ob-save-btn:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

.ob-save-btn:hover:not(:disabled) {
  transform: translateY(-2px);
}
</style>
