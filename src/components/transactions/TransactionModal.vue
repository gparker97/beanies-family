<script setup lang="ts">
import { ref, computed } from 'vue';
import BeanieFormModal from '@/components/ui/BeanieFormModal.vue';
import TogglePillGroup from '@/components/ui/TogglePillGroup.vue';
import AmountInput from '@/components/ui/AmountInput.vue';
import FrequencyChips from '@/components/ui/FrequencyChips.vue';
import CategoryChipPicker from '@/components/ui/CategoryChipPicker.vue';
import FormFieldGroup from '@/components/ui/FormFieldGroup.vue';
import ConditionalSection from '@/components/ui/ConditionalSection.vue';
import ActivityLinkDropdown from '@/components/ui/ActivityLinkDropdown.vue';
import ToggleSwitch from '@/components/ui/ToggleSwitch.vue';
import BaseInput from '@/components/ui/BaseInput.vue';
import { useAccountsStore } from '@/stores/accountsStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useTranslation } from '@/composables/useTranslation';
import { useFormModal } from '@/composables/useFormModal';
import { useCurrencyOptions } from '@/composables/useCurrencyOptions';
import type {
  Transaction,
  RecurringItem,
  CreateTransactionInput,
  UpdateTransactionInput,
  CreateRecurringItemInput,
  RecurringFrequency,
} from '@/types/models';
import { toDateInputValue } from '@/utils/date';

const props = defineProps<{
  open: boolean;
  transaction?: Transaction | null;
  recurringItem?: RecurringItem | null;
}>();

const emit = defineEmits<{
  close: [];
  save: [data: CreateTransactionInput | { id: string; data: UpdateTransactionInput }];
  'save-recurring': [data: CreateRecurringItemInput];
  delete: [id: string];
}>();

const { t } = useTranslation();
const accountsStore = useAccountsStore();
const settingsStore = useSettingsStore();
const { currencyOptions } = useCurrencyOptions();

// Form state
const direction = ref<'in' | 'out'>('out');
const amount = ref<number | undefined>(undefined);
const description = ref('');
const category = ref('');
const recurrenceMode = ref<'one-time' | 'recurring'>('recurring');
const recurrenceFrequency = ref('monthly');
const date = ref(todayStr());
const startDate = ref(todayStr());
const endDate = ref('');
const accountId = ref('');
const activityId = ref<string | undefined>(undefined);
const currency = ref(settingsStore.displayCurrency);
const dayOfMonth = ref(1);
const monthOfYear = ref(1);
const isActive = ref(true);

const LAST_ACCOUNT_KEY = 'beanies_last_transaction_account';

function getLastAccountId(): string {
  const saved = localStorage.getItem(LAST_ACCOUNT_KEY);
  if (saved && accountsStore.accounts.some((a) => a.id === saved)) return saved;
  return accountsStore.accounts[0]?.id ?? '';
}

function todayStr() {
  return toDateInputValue(new Date());
}

const isEditingRecurring = computed(() => !!props.recurringItem);

// Reset form when modal opens
const { isEditing, isSubmitting } = useFormModal(
  () => props.transaction ?? props.recurringItem ?? null,
  () => props.open,
  {
    onEdit: (entity) => {
      if (props.recurringItem) {
        // Editing a recurring item
        const item = props.recurringItem;
        direction.value = item.type === 'income' ? 'in' : 'out';
        amount.value = item.amount;
        description.value = item.description;
        category.value = item.category;
        recurrenceMode.value = 'recurring';
        recurrenceFrequency.value = item.frequency;
        dayOfMonth.value = item.dayOfMonth || 1;
        monthOfYear.value = item.monthOfYear || 1;
        startDate.value = item.startDate ? item.startDate.split('T')[0] : todayStr();
        endDate.value = item.endDate ? item.endDate.split('T')[0] : '';
        accountId.value = item.accountId;
        activityId.value = undefined;
        currency.value = item.currency;
        isActive.value = item.isActive;
      } else {
        // Editing a transaction
        const transaction = entity as Transaction;
        direction.value = transaction.type === 'income' ? 'in' : 'out';
        amount.value = transaction.amount;
        description.value = transaction.description;
        category.value = transaction.category;
        recurrenceMode.value = transaction.recurring ? 'recurring' : 'one-time';
        date.value = transaction.date;
        accountId.value = transaction.accountId;
        activityId.value = transaction.activityId;
        currency.value = transaction.currency;
      }
    },
    onNew: () => {
      direction.value = 'out';
      amount.value = undefined;
      description.value = '';
      category.value = '';
      recurrenceMode.value = 'recurring';
      date.value = todayStr();
      startDate.value = todayStr();
      endDate.value = '';
      accountId.value = getLastAccountId();
      activityId.value = undefined;
      currency.value = settingsStore.displayCurrency;
      dayOfMonth.value = new Date().getDate();
      monthOfYear.value = new Date().getMonth() + 1;
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

const modalTitle = computed(() => {
  if (isEditingRecurring.value)
    return isEditing.value ? t('recurring.editItem') : t('recurring.addItem');
  return isEditing.value ? t('transactions.editTransaction') : t('transactions.addTransaction');
});

const saveLabel = computed(() => {
  if (isEditingRecurring.value) return isEditing.value ? t('common.save') : t('recurring.addItem');
  return isEditing.value ? t('modal.saveTransaction') : t('modal.addTransaction');
});

const effectiveType = computed<'income' | 'expense'>(() =>
  direction.value === 'in' ? 'income' : 'expense'
);

function handleSave() {
  if (!canSave.value) return;
  isSubmitting.value = true;
  localStorage.setItem(LAST_ACCOUNT_KEY, accountId.value);

  try {
    // Editing an existing recurring item
    if (isEditingRecurring.value) {
      const recurringData: CreateRecurringItemInput = {
        accountId: accountId.value,
        type: effectiveType.value,
        amount: amount.value!,
        currency: currency.value,
        category: category.value,
        description: description.value.trim(),
        frequency: recurrenceFrequency.value as RecurringFrequency,
        dayOfMonth: dayOfMonth.value,
        monthOfYear: recurrenceFrequency.value === 'yearly' ? monthOfYear.value : undefined,
        startDate: startDate.value || toDateInputValue(new Date()),
        endDate: endDate.value || undefined,
        isActive: isActive.value,
        lastProcessedDate: props.recurringItem?.lastProcessedDate,
      };
      emit('save-recurring', recurringData);
      return;
    }

    // Creating a new recurring item
    if (recurrenceMode.value === 'recurring' && !isEditing.value) {
      const recurringData: CreateRecurringItemInput = {
        accountId: accountId.value,
        type: effectiveType.value,
        amount: amount.value!,
        currency: currency.value,
        category: category.value,
        description: description.value.trim(),
        frequency: recurrenceFrequency.value as RecurringFrequency,
        dayOfMonth: dayOfMonth.value,
        monthOfYear: recurrenceFrequency.value === 'yearly' ? monthOfYear.value : undefined,
        startDate: startDate.value || toDateInputValue(new Date()),
        endDate: endDate.value || undefined,
        isActive: true,
      };
      emit('save-recurring', recurringData);
      return;
    }

    // One-time transaction (create or edit)
    const data = {
      accountId: accountId.value,
      activityId: activityId.value || undefined,
      type: effectiveType.value,
      amount: amount.value!,
      currency: currency.value,
      category: category.value,
      date: date.value,
      description: description.value.trim(),
      isReconciled: false,
    };

    if (isEditing.value && props.transaction) {
      emit('save', { id: props.transaction.id, data: data as UpdateTransactionInput });
    } else {
      emit('save', data as CreateTransactionInput);
    }
  } finally {
    isSubmitting.value = false;
  }
}

function handleDelete() {
  if (props.recurringItem) {
    emit('delete', props.recurringItem.id);
  } else if (props.transaction) {
    emit('delete', props.transaction.id);
  }
}
</script>

<template>
  <BeanieFormModal
    :open="open"
    :title="modalTitle"
    :icon="isEditingRecurring ? '🔄' : direction === 'in' ? '💚' : '🧡'"
    :icon-bg="
      isEditingRecurring
        ? 'var(--tint-orange-8)'
        : direction === 'in'
          ? 'var(--tint-green-10)'
          : 'var(--tint-orange-8)'
    "
    :save-label="saveLabel"
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

    <!-- 4. Amount + Currency (inline row) -->
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

    <!-- 5. Category chips (two-level drill-down) -->
    <FormFieldGroup :label="t('form.category')" required>
      <CategoryChipPicker v-model="category" :type="effectiveCategoryType" />
    </FormFieldGroup>

    <!-- 6. Recurring / One-time toggle (hidden when editing a recurring item) -->
    <FormFieldGroup v-if="!isEditingRecurring" :label="t('modal.schedule')">
      <TogglePillGroup
        v-model="recurrenceMode"
        :options="[
          { value: 'recurring', label: t('modal.recurring') },
          { value: 'one-time', label: t('modal.oneTime') },
        ]"
      />
    </FormFieldGroup>

    <!-- 7. Recurring details -->
    <ConditionalSection :show="recurrenceMode === 'recurring' || isEditingRecurring">
      <div class="space-y-4">
        <div class="flex items-end gap-4">
          <div class="min-w-0 flex-1">
            <FormFieldGroup :label="t('modal.howOften')">
              <FrequencyChips v-model="recurrenceFrequency" :options="frequencyOptions" />
            </FormFieldGroup>
          </div>
          <div v-if="recurrenceFrequency === 'monthly'" class="flex-shrink-0">
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
                <div
                  class="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-1.5"
                >
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
        <FormFieldGroup v-if="recurrenceFrequency === 'yearly'" :label="t('form.month')">
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
        <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <BaseInput v-model="startDate" :label="t('form.startDate')" type="date" required />
          <BaseInput v-model="endDate" :label="`${t('form.endDate')} (optional)`" type="date" />
        </div>
        <FormFieldGroup v-if="!isEditingRecurring" :label="t('modal.linkToActivity')" optional>
          <ActivityLinkDropdown v-model="activityId" />
        </FormFieldGroup>
      </div>
    </ConditionalSection>

    <!-- 8. Date (for one-time) -->
    <ConditionalSection :show="recurrenceMode === 'one-time' && !isEditingRecurring">
      <div class="space-y-4">
        <FormFieldGroup :label="t('form.date')">
          <BaseInput v-model="date" type="date" required />
        </FormFieldGroup>
        <FormFieldGroup :label="t('modal.linkToActivity')" optional>
          <ActivityLinkDropdown v-model="activityId" />
        </FormFieldGroup>
      </div>
    </ConditionalSection>

    <!-- 9. Active toggle (recurring edit only) -->
    <div
      v-if="isEditingRecurring"
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
