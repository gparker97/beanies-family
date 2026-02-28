<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import BeanieFormModal from '@/components/ui/BeanieFormModal.vue';
import EmojiPicker from '@/components/ui/EmojiPicker.vue';
import TogglePillGroup from '@/components/ui/TogglePillGroup.vue';
import AmountInput from '@/components/ui/AmountInput.vue';
import FrequencyChips from '@/components/ui/FrequencyChips.vue';
import FormFieldGroup from '@/components/ui/FormFieldGroup.vue';
import ConditionalSection from '@/components/ui/ConditionalSection.vue';
import ActivityLinkDropdown from '@/components/ui/ActivityLinkDropdown.vue';
import BaseInput from '@/components/ui/BaseInput.vue';
import BaseSelect from '@/components/ui/BaseSelect.vue';
import { useAccountsStore } from '@/stores/accountsStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useTranslation } from '@/composables/useTranslation';
import { useCurrencyOptions } from '@/composables/useCurrencyOptions';
import { getCategoriesGrouped } from '@/constants/categories';
import type {
  Transaction,
  TransactionType,
  CreateTransactionInput,
  UpdateTransactionInput,
} from '@/types/models';

const props = defineProps<{
  open: boolean;
  transaction?: Transaction | null;
}>();

const emit = defineEmits<{
  close: [];
  save: [data: CreateTransactionInput | { id: string; data: UpdateTransactionInput }];
  delete: [id: string];
}>();

const { t } = useTranslation();
const accountsStore = useAccountsStore();
const settingsStore = useSettingsStore();
const { currencyOptions } = useCurrencyOptions();

const isEditing = computed(() => !!props.transaction);
const isSubmitting = ref(false);

// Category emoji mapping
const CATEGORY_EMOJIS = [
  { emoji: '🏠', label: 'Housing' },
  { emoji: '💸', label: 'General' },
  { emoji: '🎓', label: 'Education' },
  { emoji: '🍽️', label: 'Dining' },
  { emoji: '🚗', label: 'Transport' },
  { emoji: '🏥', label: 'Healthcare' },
  { emoji: '🛒', label: 'Groceries' },
  { emoji: '🎹', label: 'Lessons' },
  { emoji: '💰', label: 'Savings' },
  { emoji: '🔒', label: 'Insurance' },
  { emoji: '📱', label: 'Subscriptions' },
  { emoji: '🎁', label: 'Gifts' },
];

// Form state
const direction = ref<'in' | 'out'>('out');
const amount = ref<number | undefined>(undefined);
const description = ref('');
const categoryEmoji = ref('');
const category = ref('');
const recurrenceMode = ref<'one-time' | 'recurring'>('one-time');
const recurrenceFrequency = ref('monthly');
const date = ref('');
const startDate = ref('');
const endDate = ref('');
const accountId = ref('');
const activityId = ref<string | undefined>(undefined);
const currency = ref('');

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Reset form
watch(
  () => props.open,
  (isOpen) => {
    if (!isOpen) return;
    if (props.transaction) {
      const tx = props.transaction;
      direction.value = tx.type === 'income' ? 'in' : 'out';
      amount.value = tx.amount;
      description.value = tx.description;
      category.value = tx.category;
      categoryEmoji.value = '';
      recurrenceMode.value = tx.recurring ? 'recurring' : 'one-time';
      date.value = tx.date;
      accountId.value = tx.accountId;
      activityId.value = tx.activityId;
      currency.value = tx.currency;
    } else {
      direction.value = 'out';
      amount.value = undefined;
      description.value = '';
      category.value = '';
      categoryEmoji.value = '';
      recurrenceMode.value = 'one-time';
      date.value = todayStr();
      startDate.value = todayStr();
      endDate.value = '';
      accountId.value = accountsStore.accounts[0]?.id ?? '';
      activityId.value = undefined;
      currency.value = settingsStore.displayCurrency;
    }
  }
);

const accountOptions = computed(() =>
  accountsStore.accounts.map((a) => ({ value: a.id, label: a.name }))
);

const categoryOptions = computed(() => {
  const type = direction.value === 'in' ? 'income' : 'expense';
  const groups = getCategoriesGrouped(type);
  return groups.map((g) => ({
    label: g.name,
    options: g.categories.map((c) => ({ value: c.id, label: c.name })),
  }));
});

const frequencyOptions = [
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'yearly', label: 'Yearly' },
];

const canSave = computed(
  () => description.value.trim().length > 0 && amount.value !== undefined && amount.value > 0
);

const modalTitle = computed(() =>
  isEditing.value ? t('transactions.editTransaction') : t('transactions.addTransaction')
);

const saveLabel = computed(() =>
  isEditing.value ? t('modal.saveTransaction') : t('modal.addTransaction')
);

const effectiveType = computed<TransactionType>(() =>
  direction.value === 'in' ? 'income' : 'expense'
);

function handleSave() {
  if (!canSave.value) return;
  isSubmitting.value = true;

  try {
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

    <!-- 2. Amount (hero) -->
    <AmountInput
      v-model="amount"
      :currency-symbol="currency || settingsStore.displayCurrency"
      font-size="1.8rem"
    />

    <!-- 3. Description -->
    <div>
      <input
        v-model="description"
        type="text"
        class="font-outfit w-full border-none bg-transparent text-[1rem] font-semibold text-[var(--color-text)] outline-none placeholder:text-[var(--color-text-muted)] placeholder:opacity-30 dark:text-gray-100"
        :placeholder="t('form.description')"
      />
    </div>

    <!-- 4. Category emoji picker -->
    <FormFieldGroup :label="t('form.category')">
      <EmojiPicker v-model="categoryEmoji" :options="CATEGORY_EMOJIS" />
      <!-- Also keep grouped category dropdown for precise selection -->
      <BaseSelect v-model="category" :grouped-options="categoryOptions" class="mt-2" />
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
