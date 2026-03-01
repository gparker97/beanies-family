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
import BaseInput from '@/components/ui/BaseInput.vue';
import BaseSelect from '@/components/ui/BaseSelect.vue';
import { useAccountsStore } from '@/stores/accountsStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useTranslation } from '@/composables/useTranslation';
import { useFormModal } from '@/composables/useFormModal';
import { useCurrencyOptions } from '@/composables/useCurrencyOptions';
import type {
  Transaction,
  CreateTransactionInput,
  UpdateTransactionInput,
  CreateRecurringItemInput,
  RecurringFrequency,
} from '@/types/models';

const props = defineProps<{
  open: boolean;
  transaction?: Transaction | null;
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
const recurrenceMode = ref<'one-time' | 'recurring'>('one-time');
const recurrenceFrequency = ref('monthly');
const date = ref('');
const startDate = ref('');
const endDate = ref('');
const accountId = ref('');
const activityId = ref<string | undefined>(undefined);
const currency = ref('');
const dayOfMonth = ref(1);

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Reset form when modal opens
const { isEditing, isSubmitting } = useFormModal(
  () => props.transaction,
  () => props.open,
  {
    onEdit: (transaction) => {
      direction.value = transaction.type === 'income' ? 'in' : 'out';
      amount.value = transaction.amount;
      description.value = transaction.description;
      category.value = transaction.category;
      recurrenceMode.value = transaction.recurring ? 'recurring' : 'one-time';
      date.value = transaction.date;
      accountId.value = transaction.accountId;
      activityId.value = transaction.activityId;
      currency.value = transaction.currency;
    },
    onNew: () => {
      direction.value = 'out';
      amount.value = undefined;
      description.value = '';
      category.value = '';
      recurrenceMode.value = 'one-time';
      date.value = todayStr();
      startDate.value = todayStr();
      endDate.value = '';
      accountId.value = accountsStore.accounts[0]?.id ?? '';
      activityId.value = undefined;
      currency.value = settingsStore.displayCurrency;
      dayOfMonth.value = new Date().getDate();
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

const canSave = computed(
  () => description.value.trim().length > 0 && amount.value !== undefined && amount.value > 0
);

const modalTitle = computed(() =>
  isEditing.value ? t('transactions.editTransaction') : t('transactions.addTransaction')
);

const saveLabel = computed(() =>
  isEditing.value ? t('modal.saveTransaction') : t('modal.addTransaction')
);

const effectiveType = computed<'income' | 'expense'>(() =>
  direction.value === 'in' ? 'income' : 'expense'
);

function handleSave() {
  if (!canSave.value) return;
  isSubmitting.value = true;

  try {
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
        startDate: startDate.value,
        endDate: endDate.value || undefined,
        isActive: true,
      };
      emit('save-recurring', recurringData);
      return;
    }

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
  if (props.transaction) {
    emit('delete', props.transaction.id);
  }
}
</script>

<template>
  <BeanieFormModal
    :open="open"
    :title="modalTitle"
    :icon="direction === 'in' ? '💚' : '🧡'"
    :icon-bg="direction === 'in' ? 'var(--tint-green-10)' : 'var(--tint-orange-8)'"
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
          { value: 'in', label: '💚 ' + t('modal.moneyIn'), variant: 'green' },
          { value: 'out', label: '🧡 ' + t('modal.moneyOut'), variant: 'orange' },
        ]"
      />
    </FormFieldGroup>

    <!-- 2. Description -->
    <div>
      <input
        v-model="description"
        type="text"
        class="font-outfit w-full border-none bg-transparent text-[1rem] font-semibold text-[var(--color-text)] outline-none placeholder:text-[var(--color-text-muted)] placeholder:opacity-30 dark:text-gray-100"
        :placeholder="t('form.description')"
      />
    </div>

    <!-- 3. Amount (hero) -->
    <AmountInput
      v-model="amount"
      :currency-symbol="currency || settingsStore.displayCurrency"
      font-size="1.8rem"
    />

    <!-- 4. Category chips (two-level drill-down) -->
    <FormFieldGroup :label="t('form.category')">
      <CategoryChipPicker v-model="category" :type="effectiveCategoryType" />
    </FormFieldGroup>

    <!-- 5. Recurring / One-time toggle -->
    <FormFieldGroup :label="t('modal.schedule')">
      <TogglePillGroup
        v-model="recurrenceMode"
        :options="[
          { value: 'recurring', label: t('modal.recurring') },
          { value: 'one-time', label: t('modal.oneTime') },
        ]"
      />
    </FormFieldGroup>

    <!-- 6. Recurring details -->
    <ConditionalSection :show="recurrenceMode === 'recurring'">
      <div class="space-y-4">
        <FormFieldGroup :label="t('modal.howOften')">
          <FrequencyChips v-model="recurrenceFrequency" :options="frequencyOptions" />
        </FormFieldGroup>
        <FormFieldGroup
          v-if="recurrenceFrequency === 'monthly' || recurrenceFrequency === 'yearly'"
          :label="t('transactions.dayOfMonth')"
        >
          <BaseSelect
            :model-value="String(dayOfMonth)"
            :options="dayOfMonthOptions"
            @update:model-value="dayOfMonth = Number($event)"
          />
        </FormFieldGroup>
        <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <BaseInput v-model="startDate" :label="t('form.startDate')" type="date" />
          <BaseInput v-model="endDate" :label="t('form.endDate')" type="date" />
        </div>
      </div>
    </ConditionalSection>

    <!-- 7. Date (for one-time) -->
    <ConditionalSection :show="recurrenceMode === 'one-time'">
      <FormFieldGroup :label="t('form.date')">
        <BaseInput v-model="date" type="date" />
      </FormFieldGroup>
    </ConditionalSection>

    <!-- 8. Account select -->
    <FormFieldGroup :label="t('form.account')">
      <BaseSelect
        v-model="accountId"
        :options="accountOptions"
        :placeholder="t('form.selectAccount')"
      />
    </FormFieldGroup>

    <!-- 9. Activity link -->
    <FormFieldGroup :label="t('modal.linkToActivity')" optional>
      <ActivityLinkDropdown v-model="activityId" />
    </FormFieldGroup>

    <!-- 10. Currency -->
    <FormFieldGroup :label="t('form.currency')">
      <BaseSelect v-model="currency" :options="currencyOptions" />
    </FormFieldGroup>
  </BeanieFormModal>
</template>
