<script setup lang="ts">
import { ref, computed } from 'vue';
import BeanieFormModal from '@/components/ui/BeanieFormModal.vue';
import TogglePillGroup from '@/components/ui/TogglePillGroup.vue';
import AmountInput from '@/components/ui/AmountInput.vue';
import FrequencyChips from '@/components/ui/FrequencyChips.vue';
import CategoryChipPicker from '@/components/ui/CategoryChipPicker.vue';
import FormFieldGroup from '@/components/ui/FormFieldGroup.vue';
import ToggleSwitch from '@/components/ui/ToggleSwitch.vue';
import BaseInput from '@/components/ui/BaseInput.vue';
import { useAccountsStore } from '@/stores/accountsStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useTranslation } from '@/composables/useTranslation';
import { useFormModal } from '@/composables/useFormModal';
import { useCurrencyOptions } from '@/composables/useCurrencyOptions';
import type { RecurringItem, CreateRecurringItemInput, RecurringFrequency } from '@/types/models';
import { toDateInputValue } from '@/utils/date';

const props = defineProps<{
  open: boolean;
  item?: RecurringItem | null;
}>();

const emit = defineEmits<{
  close: [];
  save: [input: CreateRecurringItemInput];
  delete: [id: string];
}>();

const accountsStore = useAccountsStore();
const settingsStore = useSettingsStore();
const { t } = useTranslation();
const { currencyOptions } = useCurrencyOptions();

// Form state
const direction = ref<'in' | 'out'>('out');
const amount = ref<number | undefined>(undefined);
const description = ref('');
const category = ref('');
const frequency = ref('monthly');
const dayOfMonth = ref(1);
const monthOfYear = ref(1);
const startDate = ref(todayStr());
const endDate = ref('');
const accountId = ref('');
const currency = ref(settingsStore.displayCurrency);
const isActive = ref(true);

function todayStr() {
  return toDateInputValue(new Date());
}

// Reset form when modal opens
const { isEditing, isSubmitting } = useFormModal(
  () => props.item,
  () => props.open,
  {
    onEdit: (item) => {
      direction.value = item.type === 'income' ? 'in' : 'out';
      amount.value = item.amount;
      description.value = item.description;
      category.value = item.category;
      frequency.value = item.frequency;
      dayOfMonth.value = item.dayOfMonth || 1;
      monthOfYear.value = item.monthOfYear || 1;
      startDate.value = item.startDate ? item.startDate.split('T')[0] : todayStr();
      endDate.value = item.endDate ? item.endDate.split('T')[0] : '';
      accountId.value = item.accountId;
      currency.value = item.currency;
      isActive.value = item.isActive;
    },
    onNew: () => {
      direction.value = 'out';
      amount.value = undefined;
      description.value = '';
      category.value = '';
      frequency.value = 'monthly';
      dayOfMonth.value = new Date().getDate();
      monthOfYear.value = new Date().getMonth() + 1;
      startDate.value = todayStr();
      endDate.value = '';
      accountId.value = accountsStore.accounts[0]?.id ?? '';
      currency.value = settingsStore.displayCurrency;
      isActive.value = true;
    },
  }
);

const accountOptions = computed(() =>
  accountsStore.accounts.map((a) => ({ value: a.id, label: a.name }))
);

const effectiveCategoryType = computed(() => (direction.value === 'in' ? 'income' : 'expense'));

const frequencyOptions = [
  { value: 'daily', label: 'Daily' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'yearly', label: 'Yearly' },
];

const dayOfMonthOptions = Array.from({ length: 28 }, (_, i) => ({
  value: String(i + 1),
  label: String(i + 1),
}));

const monthOptions = [
  { value: '1', label: 'January' },
  { value: '2', label: 'February' },
  { value: '3', label: 'March' },
  { value: '4', label: 'April' },
  { value: '5', label: 'May' },
  { value: '6', label: 'June' },
  { value: '7', label: 'July' },
  { value: '8', label: 'August' },
  { value: '9', label: 'September' },
  { value: '10', label: 'October' },
  { value: '11', label: 'November' },
  { value: '12', label: 'December' },
];

const canSave = computed(
  () => description.value.trim().length > 0 && amount.value !== undefined && amount.value > 0
);

const modalTitle = computed(() =>
  isEditing.value ? t('recurring.editItem') : t('recurring.addItem')
);

const effectiveType = computed<'income' | 'expense'>(() =>
  direction.value === 'in' ? 'income' : 'expense'
);

function handleSave() {
  if (!canSave.value) return;
  isSubmitting.value = true;

  try {
    const input: CreateRecurringItemInput = {
      accountId: accountId.value,
      type: effectiveType.value,
      amount: amount.value!,
      currency: currency.value,
      category: category.value,
      description: description.value.trim(),
      frequency: frequency.value as RecurringFrequency,
      dayOfMonth: dayOfMonth.value,
      monthOfYear: frequency.value === 'yearly' ? monthOfYear.value : undefined,
      startDate: new Date(startDate.value || new Date()).toISOString(),
      endDate: endDate.value ? new Date(endDate.value).toISOString() : undefined,
      isActive: isActive.value,
      lastProcessedDate: props.item?.lastProcessedDate,
    };

    emit('save', input);
  } finally {
    isSubmitting.value = false;
  }
}

function handleDelete() {
  if (props.item) {
    emit('delete', props.item.id);
  }
}
</script>

<template>
  <BeanieFormModal
    :open="open"
    :title="modalTitle"
    :icon="direction === 'in' ? '💚' : '🔄'"
    :icon-bg="direction === 'in' ? 'var(--tint-green-10)' : 'var(--tint-orange-8)'"
    :save-label="isEditing ? t('common.save') : t('recurring.addItem')"
    :save-disabled="!canSave"
    :is-submitting="isSubmitting"
    :show-delete="isEditing"
    @close="emit('close')"
    @save="handleSave"
    @delete="handleDelete"
  >
    <!-- 1. Direction toggle -->
    <FormFieldGroup :label="t('modal.direction')">
      <TogglePillGroup
        v-model="direction"
        :options="[
          { value: 'out', label: '🧡 ' + t('modal.moneyOut'), variant: 'orange' },
          { value: 'in', label: '💚 ' + t('modal.moneyIn'), variant: 'green' },
        ]"
      />
    </FormFieldGroup>

    <!-- 2. Account select -->
    <FormFieldGroup :label="t('form.account')" required>
      <div class="relative">
        <select
          v-model="accountId"
          class="focus:border-primary-500 font-outfit w-full cursor-pointer appearance-none rounded-[16px] border-2 border-transparent bg-[var(--tint-slate-5)] px-4 py-3 pr-10 text-[1rem] font-semibold text-[var(--color-text)] transition-all duration-200 focus:shadow-[0_0_0_3px_rgba(241,93,34,0.1)] focus:outline-none dark:bg-slate-700 dark:text-gray-100"
        >
          <option value="" disabled>{{ t('form.selectAccount') }}</option>
          <option v-for="opt in accountOptions" :key="opt.value" :value="opt.value">
            {{ opt.label }}
          </option>
        </select>
        <div class="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-3">
          <svg
            class="h-4 w-4 text-[var(--color-text)] opacity-35"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M19 9l-7 7-7-7"
            />
          </svg>
        </div>
      </div>
    </FormFieldGroup>

    <!-- 3. Description -->
    <FormFieldGroup :label="t('form.description')" required>
      <div
        class="focus-within:border-primary-500 rounded-[16px] border-2 border-transparent bg-[var(--tint-slate-5)] px-4 py-3 transition-all duration-200 focus-within:shadow-[0_0_0_3px_rgba(241,93,34,0.1)] dark:bg-slate-700"
      >
        <input
          v-model="description"
          type="text"
          class="font-outfit w-full border-none bg-transparent text-[1rem] font-semibold text-[var(--color-text)] outline-none placeholder:text-[var(--color-text-muted)] placeholder:opacity-30 dark:text-gray-100"
          :placeholder="t('form.description')"
        />
      </div>
    </FormFieldGroup>

    <!-- 4. Amount + Currency -->
    <FormFieldGroup :label="t('form.amount')" required>
      <div class="flex items-stretch gap-2">
        <div class="relative flex-shrink-0">
          <select
            v-model="currency"
            class="focus:border-primary-500 font-outfit h-full w-[82px] cursor-pointer appearance-none rounded-[16px] border-2 border-transparent bg-[var(--tint-slate-5)] px-3 pr-7 text-center text-[0.85rem] font-bold text-[var(--color-text)] transition-all duration-200 focus:shadow-[0_0_0_3px_rgba(241,93,34,0.1)] focus:outline-none dark:bg-slate-700 dark:text-gray-100"
          >
            <option v-for="opt in currencyOptions" :key="opt.value" :value="opt.value">
              {{ opt.value }}
            </option>
          </select>
          <div class="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-2">
            <svg
              class="h-3 w-3 text-[var(--color-text)] opacity-35"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M19 9l-7 7-7-7"
              />
            </svg>
          </div>
        </div>
        <div class="min-w-0 flex-1">
          <AmountInput
            v-model="amount"
            :currency-symbol="currency || settingsStore.displayCurrency"
            font-size="1.8rem"
          />
        </div>
      </div>
    </FormFieldGroup>

    <!-- 5. Category chips -->
    <FormFieldGroup :label="t('form.category')" required>
      <CategoryChipPicker v-model="category" :type="effectiveCategoryType" />
    </FormFieldGroup>

    <!-- 6. Frequency -->
    <div class="space-y-4">
      <div class="flex items-end gap-4">
        <div class="min-w-0 flex-1">
          <FormFieldGroup :label="t('modal.howOften')">
            <FrequencyChips v-model="frequency" :options="frequencyOptions" />
          </FormFieldGroup>
        </div>
        <div v-if="frequency === 'monthly'" class="flex-shrink-0">
          <FormFieldGroup :label="t('transactions.dayOfMonth')">
            <div class="relative">
              <select
                :value="String(dayOfMonth)"
                class="focus:border-primary-500 font-outfit w-[62px] cursor-pointer appearance-none rounded-full border-2 border-transparent bg-[var(--tint-slate-5)] py-1.5 pr-6 pl-3 text-[0.65rem] font-semibold text-[var(--color-text)] transition-all duration-150 focus:shadow-[0_0_0_3px_rgba(241,93,34,0.1)] focus:outline-none dark:bg-slate-700 dark:text-gray-400"
                @change="dayOfMonth = Number(($event.target as HTMLSelectElement).value)"
              >
                <option v-for="opt in dayOfMonthOptions" :key="opt.value" :value="opt.value">
                  {{ opt.label }}
                </option>
              </select>
              <div class="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-1.5">
                <svg
                  class="h-2.5 w-2.5 text-[var(--color-text)] opacity-35"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M19 9l-7 7-7-7"
                  />
                </svg>
              </div>
            </div>
          </FormFieldGroup>
        </div>
      </div>

      <!-- Month select (yearly only) -->
      <FormFieldGroup v-if="frequency === 'yearly'" :label="t('form.month')">
        <div class="relative">
          <select
            :value="String(monthOfYear)"
            class="focus:border-primary-500 font-outfit w-full cursor-pointer appearance-none rounded-[16px] border-2 border-transparent bg-[var(--tint-slate-5)] px-4 py-3 pr-10 text-[1rem] font-semibold text-[var(--color-text)] transition-all duration-200 focus:shadow-[0_0_0_3px_rgba(241,93,34,0.1)] focus:outline-none dark:bg-slate-700 dark:text-gray-100"
            @change="monthOfYear = Number(($event.target as HTMLSelectElement).value)"
          >
            <option v-for="opt in monthOptions" :key="opt.value" :value="opt.value">
              {{ opt.label }}
            </option>
          </select>
          <div class="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-3">
            <svg
              class="h-4 w-4 text-[var(--color-text)] opacity-35"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M19 9l-7 7-7-7"
              />
            </svg>
          </div>
        </div>
      </FormFieldGroup>

      <!-- Date range -->
      <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <BaseInput v-model="startDate" :label="t('form.startDate')" type="date" required />
        <BaseInput v-model="endDate" :label="`${t('form.endDate')} (optional)`" type="date" />
      </div>
    </div>

    <!-- 7. Active toggle (edit mode only) -->
    <div
      v-if="isEditing"
      class="flex items-center justify-between rounded-[14px] bg-[var(--tint-slate-5)] px-4 py-3 dark:bg-slate-700"
    >
      <span
        class="font-outfit text-[0.8rem] font-semibold text-[var(--color-text)] dark:text-gray-200"
      >
        {{ t('recurring.active') }}
      </span>
      <ToggleSwitch v-model="isActive" size="sm" />
    </div>
  </BeanieFormModal>
</template>
