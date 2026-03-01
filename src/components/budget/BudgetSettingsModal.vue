<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import BeanieFormModal from '@/components/ui/BeanieFormModal.vue';
import FormFieldGroup from '@/components/ui/FormFieldGroup.vue';
import TogglePillGroup from '@/components/ui/TogglePillGroup.vue';
import AmountInput from '@/components/ui/AmountInput.vue';
import BaseInput from '@/components/ui/BaseInput.vue';
import BaseSelect from '@/components/ui/BaseSelect.vue';
import FamilyChipPicker from '@/components/ui/FamilyChipPicker.vue';
import { useTranslation } from '@/composables/useTranslation';
import { useCurrencyOptions } from '@/composables/useCurrencyOptions';
import { useFormModal } from '@/composables/useFormModal';
import { useSettingsStore } from '@/stores/settingsStore';
import { useTransactionsStore } from '@/stores/transactionsStore';
import { EXPENSE_CATEGORIES, CATEGORY_EMOJI_MAP } from '@/constants/categories';
import { getCurrencyInfo } from '@/constants/currencies';
import type { Budget, CreateBudgetInput, UpdateBudgetInput, BudgetCategory } from '@/types/models';

const props = defineProps<{
  open: boolean;
  budget?: Budget | null;
}>();

const emit = defineEmits<{
  close: [];
  save: [data: CreateBudgetInput | { id: string; data: UpdateBudgetInput }];
  delete: [id: string];
}>();

const { t } = useTranslation();
const settingsStore = useSettingsStore();
const transactionsStore = useTransactionsStore();
const { currencyOptions } = useCurrencyOptions();

// Form state
const mode = ref<'percentage' | 'fixed'>('percentage');
const percentage = ref(70);
const totalAmount = ref<number | undefined>(undefined);
const currency = ref(settingsStore.baseCurrency);
const memberId = ref('__shared__');
const categoryAllocations = ref<Record<string, number | undefined>>({});
const showCategories = ref(false);

const { isEditing, isSubmitting } = useFormModal(
  () => props.budget,
  () => props.open,
  {
    onEdit: (budget) => {
      mode.value = budget.mode;
      percentage.value = budget.percentage ?? 70;
      totalAmount.value = budget.totalAmount;
      currency.value = budget.currency;
      memberId.value = budget.memberId ?? '__shared__';
      const allocs: Record<string, number | undefined> = {};
      for (const bc of budget.categories) {
        allocs[bc.categoryId] = bc.amount;
      }
      categoryAllocations.value = allocs;
      showCategories.value = budget.categories.length > 0;
    },
    onNew: () => {
      mode.value = 'percentage';
      percentage.value = 70;
      totalAmount.value = undefined;
      currency.value = settingsStore.baseCurrency;
      memberId.value = '__shared__';
      categoryAllocations.value = {};
      showCategories.value = false;
    },
  }
);

const modalTitle = computed(() =>
  isEditing.value ? t('budget.editBudget') : t('budget.addBudget')
);

const saveLabel = computed(() => (isEditing.value ? t('common.save') : t('budget.addBudget')));

const currSymbol = computed(() => getCurrencyInfo(currency.value)?.symbol ?? '$');

// Effective budget preview for percentage mode
const effectiveAmount = computed(() => {
  if (mode.value === 'percentage') {
    return Math.round(transactionsStore.thisMonthIncome * (percentage.value / 100));
  }
  return totalAmount.value ?? 0;
});

const canSave = computed(() => {
  if (mode.value === 'percentage') {
    return percentage.value > 0 && percentage.value <= 100;
  }
  return (totalAmount.value ?? 0) > 0;
});

const modeOptions = [
  { value: 'percentage', label: t('budget.settings.percentageOfIncome') },
  { value: 'fixed', label: t('budget.settings.fixedAmount') },
];

// Group expense categories for the allocation section
const groupedCategories = computed(() => {
  const groups = new Map<string, typeof EXPENSE_CATEGORIES>();
  for (const cat of EXPENSE_CATEGORIES) {
    const group = cat.group ?? 'Other';
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group)!.push(cat);
  }
  return groups;
});

function handleSave() {
  const categories: BudgetCategory[] = [];
  for (const [categoryId, amount] of Object.entries(categoryAllocations.value)) {
    if (amount && amount > 0) {
      categories.push({ categoryId, amount });
    }
  }

  const base = {
    mode: mode.value,
    totalAmount: mode.value === 'fixed' ? (totalAmount.value ?? 0) : effectiveAmount.value,
    percentage: mode.value === 'percentage' ? percentage.value : undefined,
    currency: currency.value,
    categories,
    isActive: true,
    memberId: memberId.value === '__shared__' ? undefined : memberId.value,
  };

  if (isEditing.value && props.budget) {
    emit('save', { id: props.budget.id, data: base });
  } else {
    emit('save', base as CreateBudgetInput);
  }
}

function handleDelete() {
  if (props.budget) {
    emit('delete', props.budget.id);
  }
}

// Reset percentage input when switching modes
watch(mode, () => {
  if (mode.value === 'percentage' && !percentage.value) {
    percentage.value = 70;
  }
});
</script>

<template>
  <BeanieFormModal
    :open="open"
    :title="modalTitle"
    icon="💵"
    icon-bg="var(--tint-green-10)"
    :save-label="saveLabel"
    :save-disabled="!canSave"
    :is-submitting="isSubmitting"
    :show-delete="isEditing"
    @close="emit('close')"
    @save="handleSave"
    @delete="handleDelete"
  >
    <!-- Mode toggle -->
    <FormFieldGroup :label="t('budget.settings.mode')">
      <TogglePillGroup v-model="mode" :options="modeOptions" />
    </FormFieldGroup>

    <!-- Percentage input -->
    <div v-if="mode === 'percentage'">
      <FormFieldGroup :label="t('budget.settings.percentageLabel')">
        <div class="flex items-center gap-3">
          <BaseInput v-model.number="percentage" type="number" min="1" max="100" class="w-24" />
          <span class="text-sm text-slate-500 dark:text-slate-400">%</span>
        </div>
      </FormFieldGroup>
      <p class="mt-2 text-sm text-slate-500 dark:text-slate-400">
        {{ t('budget.settings.effectiveBudget') }}:
        <span class="font-outfit font-bold text-slate-700 dark:text-slate-200">
          {{ currSymbol }}{{ effectiveAmount.toLocaleString() }}
        </span>
      </p>
    </div>

    <!-- Fixed amount input -->
    <div v-else>
      <FormFieldGroup :label="t('budget.settings.fixedLabel')">
        <AmountInput v-model="totalAmount" :currency-symbol="currSymbol" />
      </FormFieldGroup>
    </div>

    <!-- Currency -->
    <FormFieldGroup :label="t('form.currency')">
      <BaseSelect v-model="currency" :options="currencyOptions" />
    </FormFieldGroup>

    <!-- Budget owner -->
    <FormFieldGroup :label="t('budget.settings.owner')">
      <FamilyChipPicker v-model="memberId" mode="single" show-shared />
    </FormFieldGroup>

    <!-- Category allocations (collapsible) -->
    <div>
      <button
        type="button"
        class="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-semibold text-slate-600 transition-colors hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-700/50"
        @click="showCategories = !showCategories"
      >
        <span class="transition-transform" :class="showCategories ? 'rotate-90' : ''">
          &#x25B6;
        </span>
        {{ t('budget.settings.categoryAllocations') }}
      </button>

      <p v-if="!showCategories" class="mt-1 px-3 text-xs text-slate-400 dark:text-slate-500">
        {{ t('budget.settings.categoryHint') }}
      </p>

      <div v-if="showCategories" class="mt-3 space-y-4">
        <div v-for="[groupName, cats] in groupedCategories" :key="groupName">
          <p
            class="mb-2 text-xs font-semibold tracking-wider text-slate-400 uppercase dark:text-slate-500"
          >
            {{ groupName }}
          </p>
          <div class="space-y-2">
            <div
              v-for="cat in cats"
              :key="cat.id"
              class="flex items-center gap-3 rounded-lg bg-slate-50 px-3 py-2 dark:bg-slate-700/30"
            >
              <span class="text-base">{{ CATEGORY_EMOJI_MAP[cat.id] || '' }}</span>
              <span class="min-w-[100px] text-sm text-slate-600 dark:text-slate-300">
                {{ cat.name }}
              </span>
              <div class="ml-auto w-28">
                <AmountInput
                  v-model="categoryAllocations[cat.id]"
                  :currency-symbol="currSymbol"
                  font-size="0.9rem"
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </BeanieFormModal>
</template>
