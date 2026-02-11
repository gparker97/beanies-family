<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { BaseInput, BaseSelect, BaseButton } from '@/components/ui';
import {
  INCOME_CATEGORIES,
  EXPENSE_CATEGORIES,
  getCategoriesGrouped,
} from '@/constants/categories';
import { CURRENCIES } from '@/constants/currencies';
import { useAccountsStore } from '@/stores/accountsStore';
import { useSettingsStore } from '@/stores/settingsStore';
import type { RecurringItem, CreateRecurringItemInput, RecurringFrequency } from '@/types/models';
import { toISODateString } from '@/utils/date';

interface Props {
  item?: RecurringItem;
}

const props = defineProps<Props>();

const emit = defineEmits<{
  submit: [input: CreateRecurringItemInput];
  cancel: [];
}>();

const accountsStore = useAccountsStore();
const settingsStore = useSettingsStore();

const isEditMode = computed(() => !!props.item);

// Form state
const formData = ref({
  accountId: props.item?.accountId || '',
  type: (props.item?.type || 'expense') as 'income' | 'expense',
  amount: props.item?.amount?.toString() || '',
  currency: props.item?.currency || settingsStore.baseCurrency,
  category: props.item?.category || '',
  description: props.item?.description || '',
  frequency: (props.item?.frequency || 'monthly') as RecurringFrequency,
  dayOfMonth: props.item?.dayOfMonth || 1,
  monthOfYear: props.item?.monthOfYear || 1,
  startDate: props.item?.startDate
    ? props.item.startDate.split('T')[0]
    : toISODateString(new Date()).split('T')[0],
  endDate: props.item?.endDate ? props.item.endDate.split('T')[0] : '',
  isActive: props.item?.isActive ?? true,
});

// Type options
const typeOptions = [
  { value: 'expense', label: 'Expense' },
  { value: 'income', label: 'Income' },
];

// Frequency options
const frequencyOptions = [
  { value: 'daily', label: 'Daily' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'yearly', label: 'Yearly' },
];

// Account options
const accountOptions = computed(() =>
  accountsStore.accounts.map((a) => ({ value: a.id, label: a.name }))
);

// Category options based on type (grouped for dropdown)
const categoryOptions = computed(() => {
  const type = formData.value.type === 'income' ? 'income' : 'expense';
  const groups = getCategoriesGrouped(type);
  return groups.map((g) => ({
    label: g.name,
    options: g.categories.map((c) => ({ value: c.id, label: c.name })),
  }));
});

// Flat list of categories for default selection
const flatCategories = computed(() => {
  return formData.value.type === 'income' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;
});

// Currency options
const currencyOptions = CURRENCIES.map((c) => ({
  value: c.code,
  label: `${c.code} - ${c.name}`,
}));

// Day of month options (1-28 to avoid month-end issues)
const dayOfMonthOptions = computed(() =>
  Array.from({ length: 28 }, (_, i) => ({
    value: i + 1,
    label: `${i + 1}${getOrdinalSuffix(i + 1)}`,
  }))
);

// Month options
const monthOptions = [
  { value: 1, label: 'January' },
  { value: 2, label: 'February' },
  { value: 3, label: 'March' },
  { value: 4, label: 'April' },
  { value: 5, label: 'May' },
  { value: 6, label: 'June' },
  { value: 7, label: 'July' },
  { value: 8, label: 'August' },
  { value: 9, label: 'September' },
  { value: 10, label: 'October' },
  { value: 11, label: 'November' },
  { value: 12, label: 'December' },
];

// Reset category when type changes
watch(
  () => formData.value.type,
  () => {
    const firstCategory = flatCategories.value[0];
    if (firstCategory) {
      formData.value.category = firstCategory.id;
    }
  }
);

// Set default category on mount if not set
if (!formData.value.category && flatCategories.value.length > 0) {
  const firstCategory = flatCategories.value[0];
  if (firstCategory) {
    formData.value.category = firstCategory.id;
  }
}

// Set default account on mount if not set
if (!formData.value.accountId && accountOptions.value.length > 0) {
  const firstAccount = accountOptions.value[0];
  if (firstAccount) {
    formData.value.accountId = firstAccount.value;
  }
}

function getOrdinalSuffix(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return s[(v - 20) % 10] || s[v] || s[0] || 'th';
}

function handleSubmit() {
  const input: CreateRecurringItemInput = {
    accountId: formData.value.accountId,
    type: formData.value.type,
    amount: Number(formData.value.amount),
    currency: formData.value.currency,
    category: formData.value.category,
    description: formData.value.description,
    frequency: formData.value.frequency,
    dayOfMonth: formData.value.dayOfMonth,
    monthOfYear: formData.value.frequency === 'yearly' ? formData.value.monthOfYear : undefined,
    startDate: new Date(formData.value.startDate || new Date()).toISOString(),
    endDate: formData.value.endDate ? new Date(formData.value.endDate).toISOString() : undefined,
    isActive: formData.value.isActive,
    lastProcessedDate: props.item?.lastProcessedDate,
  };

  emit('submit', input);
}
</script>

<template>
  <form class="space-y-4" @submit.prevent="handleSubmit">
    <BaseSelect v-model="formData.type" :options="typeOptions" label="Type" />

    <BaseSelect
      v-model="formData.accountId"
      :options="accountOptions"
      label="Account"
      placeholder="Select an account"
      required
    />

    <BaseInput
      v-model="formData.description"
      label="Description"
      placeholder="e.g., Monthly Salary, Netflix Subscription"
      required
    />

    <BaseSelect v-model="formData.category" :grouped-options="categoryOptions" label="Category" />

    <div class="grid grid-cols-2 gap-4">
      <BaseInput
        v-model="formData.amount"
        type="number"
        label="Amount"
        placeholder="0.00"
        required
      />

      <BaseSelect v-model="formData.currency" :options="currencyOptions" label="Currency" />
    </div>

    <BaseSelect v-model="formData.frequency" :options="frequencyOptions" label="Frequency" />

    <!-- Day of Month (for monthly/yearly) -->
    <BaseSelect
      v-if="formData.frequency !== 'daily'"
      v-model="formData.dayOfMonth"
      :options="dayOfMonthOptions"
      label="Day of Month"
    />

    <!-- Month (for yearly only) -->
    <BaseSelect
      v-if="formData.frequency === 'yearly'"
      v-model="formData.monthOfYear"
      :options="monthOptions"
      label="Month"
    />

    <BaseInput v-model="formData.startDate" type="date" label="Start Date" />

    <BaseInput
      v-model="formData.endDate"
      type="date"
      label="End Date (Optional)"
      hint="Leave empty for no end date"
    />

    <div class="flex justify-end gap-3 pt-4">
      <BaseButton variant="secondary" type="button" @click="emit('cancel')"> Cancel </BaseButton>
      <BaseButton type="submit">
        {{ isEditMode ? 'Update' : 'Create' }}
      </BaseButton>
    </div>
  </form>
</template>
