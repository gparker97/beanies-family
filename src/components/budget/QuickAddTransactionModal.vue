<script setup lang="ts">
import { ref, computed } from 'vue';
import BeanieFormModal from '@/components/ui/BeanieFormModal.vue';
import FormFieldGroup from '@/components/ui/FormFieldGroup.vue';
import TogglePillGroup from '@/components/ui/TogglePillGroup.vue';
import AmountInput from '@/components/ui/AmountInput.vue';
import BaseInput from '@/components/ui/BaseInput.vue';
import BeanieDatePicker from '@/components/ui/BeanieDatePicker.vue';
import BaseSelect from '@/components/ui/BaseSelect.vue';
import CategoryChipPicker from '@/components/ui/CategoryChipPicker.vue';
import CategoryGuessHint from '@/components/ui/CategoryGuessHint.vue';
import { useTranslation } from '@/composables/useTranslation';
import { useFormModal } from '@/composables/useFormModal';
import { useTransactionCategoryGuess } from '@/composables/useTransactionCategoryGuess';
import { useSettingsStore } from '@/stores/settingsStore';
import { useAccountsStore } from '@/stores/accountsStore';
import { getCurrencyInfo } from '@/constants/currencies';
import { toDateInputValue } from '@/utils/date';
import type { CreateTransactionInput } from '@/types/models';

const props = defineProps<{
  open: boolean;
}>();

const emit = defineEmits<{
  close: [];
  save: [data: CreateTransactionInput];
}>();

const { t } = useTranslation();
const settingsStore = useSettingsStore();
const accountsStore = useAccountsStore();

// Form state
const direction = ref<'expense' | 'income'>('expense');
const description = ref('');
const amount = ref<number | undefined>(undefined);
const category = ref('');
const date = ref(toDateInputValue(new Date()));
const accountId = ref('');

const { isSubmitting } = useFormModal(
  () => null,
  () => props.open,
  {
    onEdit: () => {},
    onNew: () => {
      // First: it also empties the category, before the direction is set (#152).
      categoryGuess.reset();
      direction.value = 'expense';
      description.value = '';
      amount.value = undefined;
      date.value = toDateInputValue(new Date());
      // Default to first active account
      const active = accountsStore.activeAccounts;
      accountId.value = active.length > 0 ? active[0]!.id : '';
    },
  }
);

// The category the description names (#152), kept inside the table for the direction. Quick
// add only ever creates, so the guess is always on.
const categoryGroupRef = ref<{ $el?: HTMLElement } | null>(null);
const categoryGuess = useTransactionCategoryGuess({
  kind: 'quick-add',
  description,
  category,
  type: () => direction.value,
  enabled: () => true,
  pickerEl: () => categoryGroupRef.value?.$el,
});

const currSymbol = computed(() => getCurrencyInfo(settingsStore.baseCurrency)?.symbol ?? '$');

const directionOptions = [
  { value: 'expense', label: t('budget.quickAdd.moneyOut'), variant: 'orange' as const },
  { value: 'income', label: t('budget.quickAdd.moneyIn'), variant: 'green' as const },
];

const accountOptions = computed(() =>
  accountsStore.activeAccounts.map((a) => ({
    value: a.id,
    label: `${a.icon ?? ''} ${a.name}`.trim(),
  }))
);

const canSave = computed(() => {
  return (amount.value ?? 0) > 0 && category.value && accountId.value && date.value;
});

function handleSave() {
  if (!canSave.value) return;
  categoryGuess.logOutcome();

  const selectedAccount = accountsStore.getAccountById(accountId.value);

  emit('save', {
    accountId: accountId.value,
    type: direction.value,
    amount: amount.value!,
    currency: selectedAccount?.currency ?? settingsStore.baseCurrency,
    category: category.value,
    date: date.value,
    description: description.value || category.value,
    isReconciled: false,
  });
}
</script>

<template>
  <BeanieFormModal
    variant="drawer"
    :open="open"
    :title="t('budget.quickAdd.title')"
    icon="⚡"
    icon-bg="var(--tint-orange-8)"
    size="narrow"
    :save-label="t('common.save')"
    :save-disabled="!canSave"
    :is-submitting="isSubmitting"
    @close="emit('close')"
    @save="handleSave"
  >
    <!-- Direction toggle -->
    <TogglePillGroup v-model="direction" :options="directionOptions" />

    <!-- Amount (hero size) -->
    <FormFieldGroup :label="t('budget.quickAdd.amount')" required>
      <AmountInput v-model="amount" :currency-symbol="currSymbol" font-size="2rem" />
    </FormFieldGroup>

    <!-- Description, above Category so the category can be guessed from it (#152) -->
    <FormFieldGroup :label="t('budget.quickAdd.description')">
      <BaseInput v-model="description" :placeholder="t('budget.quickAdd.description')" />
      <CategoryGuessHint v-bind="categoryGuess.hint.value" @change="categoryGuess.revealPicker()" />
    </FormFieldGroup>

    <!-- Category -->
    <FormFieldGroup ref="categoryGroupRef" :label="t('budget.quickAdd.category')" required>
      <CategoryChipPicker
        :model-value="category"
        :type="direction"
        @update:model-value="categoryGuess.pick"
      />
    </FormFieldGroup>

    <!-- Date + Account row -->
    <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <FormFieldGroup :label="t('budget.quickAdd.date')" required>
        <BeanieDatePicker v-model="date" />
      </FormFieldGroup>

      <FormFieldGroup :label="t('budget.quickAdd.account')" required>
        <BaseSelect v-model="accountId" :options="accountOptions" />
      </FormFieldGroup>
    </div>
  </BeanieFormModal>
</template>
