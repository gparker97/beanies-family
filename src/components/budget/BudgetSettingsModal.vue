<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import BeanieFormModal from '@/components/ui/BeanieFormModal.vue';
import FormFieldGroup from '@/components/ui/FormFieldGroup.vue';
import TogglePillGroup from '@/components/ui/TogglePillGroup.vue';
import AmountInput from '@/components/ui/AmountInput.vue';
import CurrencyAmountInput from '@/components/ui/CurrencyAmountInput.vue';
import BaseInput from '@/components/ui/BaseInput.vue';
import ConditionalSection from '@/components/ui/ConditionalSection.vue';
import { useTranslation } from '@/composables/useTranslation';
import { useFormModal } from '@/composables/useFormModal';
import { useSettingsStore } from '@/stores/settingsStore';
import { useTransactionsStore } from '@/stores/transactionsStore';
import {
  EXPENSE_CATEGORIES,
  CATEGORY_EMOJI_MAP,
  GROUP_EMOJI_MAP,
  getCategoriesGrouped,
  isGroupBudget,
  getGroupName,
  makeGroupBudgetId,
} from '@/constants/categories';
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

// Form state
const mode = ref<'percentage' | 'fixed'>('percentage');
const percentage = ref(20);
const totalAmount = ref<number | undefined>(undefined);
const currency = ref(settingsStore.baseCurrency);
const showCategories = ref(false);

// Group-level allocations: keyed by group name
const groupAllocations = ref<Record<string, number | undefined>>({});
// Category-level allocations: keyed by category ID
const categoryAllocations = ref<Record<string, number | undefined>>({});
// Which groups are expanded to show per-category inputs
const expandedGroups = ref<Set<string>>(new Set());

const { isEditing, isSubmitting } = useFormModal(
  () => props.budget,
  () => props.open,
  {
    onEdit: (budget) => {
      mode.value = budget.mode;
      percentage.value = budget.percentage ?? 20;
      totalAmount.value = budget.totalAmount;
      currency.value = budget.currency;

      const gAllocs: Record<string, number | undefined> = {};
      const cAllocs: Record<string, number | undefined> = {};
      const expanded = new Set<string>();

      for (const bc of budget.categories) {
        if (isGroupBudget(bc.categoryId)) {
          gAllocs[getGroupName(bc.categoryId)] = bc.amount;
        } else {
          cAllocs[bc.categoryId] = bc.amount;
          // Find group for this category and mark as expanded
          const cat = EXPENSE_CATEGORIES.find((c) => c.id === bc.categoryId);
          if (cat?.group) expanded.add(cat.group);
        }
      }

      groupAllocations.value = gAllocs;
      categoryAllocations.value = cAllocs;
      expandedGroups.value = expanded;
      showCategories.value = budget.categories.length > 0;
    },
    onNew: () => {
      mode.value = 'percentage';
      percentage.value = 20;
      totalAmount.value = undefined;
      currency.value = settingsStore.baseCurrency;
      groupAllocations.value = {};
      categoryAllocations.value = {};
      expandedGroups.value = new Set();
      showCategories.value = false;
    },
  }
);

const modalTitle = computed(() =>
  isEditing.value ? t('budget.editBudget') : t('budget.addBudget')
);

const saveLabel = computed(() => (isEditing.value ? t('common.save') : t('budget.addBudget')));

const currSymbol = computed(() => getCurrencyInfo(currency.value)?.symbol ?? '$');

// Effective spending budget preview for percentage mode
const effectiveAmount = computed(() => {
  if (mode.value === 'percentage') {
    const spendingPercent = 100 - percentage.value;
    return Math.round(transactionsStore.thisMonthIncome * (spendingPercent / 100));
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

const expenseGroups = computed(() => getCategoriesGrouped('expense'));

function toggleGroupExpand(groupName: string) {
  const expanded = new Set(expandedGroups.value);
  if (expanded.has(groupName)) {
    expanded.delete(groupName);
  } else {
    expanded.add(groupName);
  }
  expandedGroups.value = expanded;
}

function isGroupExpanded(groupName: string): boolean {
  return expandedGroups.value.has(groupName);
}

/** Live sum of per-category allocations for a group. */
function groupCategorySum(group: { categories: { id: string }[] }): number {
  return group.categories.reduce((sum, cat) => sum + (categoryAllocations.value[cat.id] ?? 0), 0);
}

/** Whether any category in this group has an amount set. */
function hasCategoryAmounts(group: { categories: { id: string }[] }): boolean {
  return group.categories.some((cat) => (categoryAllocations.value[cat.id] ?? 0) > 0);
}

function handleSave() {
  const categories: BudgetCategory[] = [];

  for (const group of expenseGroups.value) {
    if (hasCategoryAmounts(group)) {
      // Category-level data exists — save per-category entries
      for (const cat of group.categories) {
        const amount = categoryAllocations.value[cat.id];
        if (amount && amount > 0) {
          categories.push({ categoryId: cat.id, amount });
        }
      }
    } else {
      // Group-level entry
      const amount = groupAllocations.value[group.name];
      if (amount && amount > 0) {
        categories.push({ categoryId: makeGroupBudgetId(group.name), amount });
      }
    }
  }

  const base = {
    mode: mode.value,
    totalAmount: mode.value === 'fixed' ? (totalAmount.value ?? 0) : effectiveAmount.value,
    percentage: mode.value === 'percentage' ? percentage.value : undefined,
    currency: currency.value,
    categories,
    isActive: true,
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
    percentage.value = 20;
  }
});
</script>

<template>
  <BeanieFormModal
    variant="drawer"
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
      <FormFieldGroup :label="t('budget.settings.percentageLabel')" required>
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
      <FormFieldGroup :label="t('budget.settings.fixedLabel')" required>
        <CurrencyAmountInput
          :amount="totalAmount"
          :currency="currency"
          @update:amount="totalAmount = $event"
          @update:currency="currency = $event"
        />
      </FormFieldGroup>
    </div>

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

      <div v-if="showCategories" class="mt-3 space-y-3">
        <div v-for="group in expenseGroups" :key="group.name">
          <!-- Group row — tappable to expand/collapse -->
          <div
            class="flex cursor-pointer items-center gap-3 rounded-lg bg-slate-50 px-3 py-2 transition-colors hover:bg-slate-100 dark:bg-slate-700/30 dark:hover:bg-slate-700/50"
            @click="group.categories.length > 1 && toggleGroupExpand(group.name)"
          >
            <span class="text-base">{{ GROUP_EMOJI_MAP[group.name] || '📦' }}</span>
            <span
              class="min-w-[80px] flex-1 text-sm font-semibold text-slate-600 dark:text-slate-300"
            >
              {{ group.name }}
            </span>

            <!-- Category amounts exist: read-only sum (expanded or collapsed) -->
            <span
              v-if="hasCategoryAmounts(group)"
              class="font-outfit text-sm font-bold"
              :class="
                isGroupExpanded(group.name)
                  ? 'text-slate-400 dark:text-slate-500'
                  : 'text-slate-600 dark:text-slate-300'
              "
            >
              {{ currSymbol }}{{ groupCategorySum(group).toLocaleString() }}
            </span>

            <!-- No category amounts: editable group input -->
            <div v-else-if="!isGroupExpanded(group.name)" class="w-28" @click.stop>
              <AmountInput
                v-model="groupAllocations[group.name]"
                :currency-symbol="currSymbol"
                font-size="0.9rem"
              />
            </div>

            <!-- Expanded with no amounts yet: show zero sum -->
            <span v-else class="font-outfit text-sm font-bold text-slate-400 dark:text-slate-500">
              {{ currSymbol }}0
            </span>

            <!-- Expand chevron (only for groups with >1 category) -->
            <span
              v-if="group.categories.length > 1"
              class="text-xs text-slate-400 transition-transform duration-200"
              :class="isGroupExpanded(group.name) ? 'rotate-90' : ''"
            >
              &#x25B6;
            </span>
          </div>

          <!-- Per-category drill-down -->
          <ConditionalSection :show="isGroupExpanded(group.name)">
            <div class="space-y-1.5 pl-4">
              <div
                v-for="cat in group.categories"
                :key="cat.id"
                class="flex items-center gap-3 rounded-lg px-3 py-1.5"
              >
                <span class="text-sm">{{ CATEGORY_EMOJI_MAP[cat.id] || '' }}</span>
                <span class="min-w-[80px] flex-1 text-xs text-slate-500 dark:text-slate-400">
                  {{ cat.name }}
                </span>
                <div class="w-28">
                  <AmountInput
                    v-model="categoryAllocations[cat.id]"
                    :currency-symbol="currSymbol"
                    font-size="0.85rem"
                  />
                </div>
              </div>
            </div>
          </ConditionalSection>
        </div>
      </div>
    </div>
  </BeanieFormModal>
</template>
