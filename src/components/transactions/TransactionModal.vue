<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import BeanieFormModal from '@/components/ui/BeanieFormModal.vue';
import TogglePillGroup from '@/components/ui/TogglePillGroup.vue';
import AmountInput from '@/components/ui/AmountInput.vue';
import FrequencyChips from '@/components/ui/FrequencyChips.vue';
import CategoryChipPicker from '@/components/ui/CategoryChipPicker.vue';
import FormFieldGroup from '@/components/ui/FormFieldGroup.vue';
import ConditionalSection from '@/components/ui/ConditionalSection.vue';
import ActivityLinkDropdown from '@/components/ui/ActivityLinkDropdown.vue';
import EntityLinkDropdown from '@/components/ui/EntityLinkDropdown.vue';
import ToggleSwitch from '@/components/ui/ToggleSwitch.vue';
import BaseInput from '@/components/ui/BaseInput.vue';
import { useAccountsStore } from '@/stores/accountsStore';
import { useGoalsStore } from '@/stores/goalsStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useTranslation } from '@/composables/useTranslation';
import { formatCurrencyWithCode } from '@/composables/useCurrencyDisplay';
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
import { computeGoalAllocRaw } from '@/utils/finance';

const props = defineProps<{
  open: boolean;
  transaction?: Transaction | null;
  recurringItem?: RecurringItem | null;
  initialValues?: Partial<CreateTransactionInput> | null;
}>();

const emit = defineEmits<{
  close: [];
  save: [data: CreateTransactionInput | { id: string; data: UpdateTransactionInput }];
  'save-recurring': [data: CreateRecurringItemInput];
  delete: [id: string];
}>();

const { t } = useTranslation();
const accountsStore = useAccountsStore();
const goalsStore = useGoalsStore();
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
const goalId = ref<string | undefined>(undefined);
const goalAllocMode = ref<'percentage' | 'fixed'>('percentage');
const goalAllocValue = ref<number | undefined>(undefined);
const currency = ref(settingsStore.displayCurrency);
const dayOfMonth = ref(1);
const monthOfYear = ref(1);
const isActive = ref(true);

// When the user edits startDate, auto-sync dayOfMonth so that
// syncLinkedTransactions picks up the new day. Without this, changing
// startDate alone leaves dayOfMonth (and thus materialized transaction
// dates) unchanged — the root cause of the "date doesn't update" bug.
let suppressDaySync = false;
watch(
  startDate,
  (newVal) => {
    if (suppressDaySync || !newVal) return;
    const day = new Date(newVal + 'T00:00:00').getDate();
    if (recurrenceFrequency.value === 'monthly') {
      dayOfMonth.value = Math.min(day, 28);
    } else if (recurrenceFrequency.value === 'yearly') {
      dayOfMonth.value = Math.min(day, 28);
      monthOfYear.value = new Date(newVal + 'T00:00:00').getMonth() + 1;
    }
  },
  { flush: 'sync' }
);

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
      suppressDaySync = true;
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
        startDate.value = item.startDate ? item.startDate.substring(0, 10) : todayStr();
        endDate.value = item.endDate ? item.endDate.substring(0, 10) : '';
        accountId.value = item.accountId;
        activityId.value = undefined;
        goalId.value = item.goalId;
        goalAllocMode.value = item.goalAllocMode || 'percentage';
        goalAllocValue.value = item.goalAllocValue;
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
        goalId.value = transaction.goalId;
        goalAllocMode.value = transaction.goalAllocMode || 'percentage';
        goalAllocValue.value = transaction.goalAllocValue;
        currency.value = transaction.currency;
        // Initialize recurring fields from the transaction date so that
        // switching to recurring mode pre-fills sensible defaults
        const txDate = new Date(transaction.date + 'T00:00:00');
        dayOfMonth.value = txDate.getDate();
        monthOfYear.value = txDate.getMonth() + 1;
        startDate.value = transaction.date.substring(0, 10);
        endDate.value = '';
        recurrenceFrequency.value = 'monthly';
      }
      suppressDaySync = false;
    },
    onNew: () => {
      suppressDaySync = true;
      const iv = props.initialValues;
      direction.value = iv?.type === 'income' ? 'in' : iv?.type === 'expense' ? 'out' : 'out';
      amount.value = iv?.amount ?? undefined;
      description.value = iv?.description ?? '';
      category.value = iv?.category ?? '';
      recurrenceMode.value = iv ? 'one-time' : 'recurring';
      date.value = iv?.date ?? todayStr();
      startDate.value = todayStr();
      endDate.value = '';
      accountId.value = iv?.accountId ?? getLastAccountId();
      activityId.value = undefined;
      goalId.value = undefined;
      goalAllocMode.value = 'percentage';
      goalAllocValue.value = undefined;
      currency.value = iv?.currency ?? settingsStore.displayCurrency;
      dayOfMonth.value = new Date().getDate();
      monthOfYear.value = new Date().getMonth() + 1;
      isActive.value = true;
      suppressDaySync = false;
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

// Goal linking
const goalItems = computed(() =>
  goalsStore.activeGoals
    .filter((g) => g.currency === currency.value)
    .map((g) => ({
      id: g.id,
      icon: '🎯',
      label: g.name,
      secondary: `${formatCurrencyWithCode(g.currentAmount, g.currency)} / ${formatCurrencyWithCode(g.targetAmount, g.currency)}`,
    }))
);

const allocModeOptions = computed(() => [
  { value: 'percentage', label: t('goalLink.percentage') },
  { value: 'fixed', label: t('goalLink.fixedAmount') },
]);

const goalAllocPreview = computed(() => {
  if (!goalId.value || !goalAllocValue.value || !amount.value) return null;
  const goal = goalsStore.goals.find((g) => g.id === goalId.value);
  if (!goal) return null;
  const raw = computeGoalAllocRaw(goalAllocMode.value, goalAllocValue.value, amount.value);
  const remaining = Math.max(0, goal.targetAmount - goal.currentAmount);
  return {
    amount: Math.min(raw, remaining),
    remaining,
    capped: raw > remaining,
    currency: goal.currency,
  };
});

// Clear goal fields when switching to expense
// Reset allocation when goal is cleared
watch(goalId, (newId) => {
  if (!newId) {
    goalAllocMode.value = 'percentage';
    goalAllocValue.value = undefined;
  }
});

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
        goalId: goalId.value || undefined,
        goalAllocMode: goalId.value ? goalAllocMode.value : undefined,
        goalAllocValue: goalId.value ? goalAllocValue.value : undefined,
      };
      emit('save-recurring', recurringData);
      return;
    }

    // Editing a one-time transaction → user switched to recurring (conversion)
    // OR creating a brand new recurring item
    if (recurrenceMode.value === 'recurring' && (!isEditing.value || !isEditingRecurring.value)) {
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
        goalId: goalId.value || undefined,
        goalAllocMode: goalId.value ? goalAllocMode.value : undefined,
        goalAllocValue: goalId.value ? goalAllocValue.value : undefined,
      };
      emit('save-recurring', recurringData);
      return;
    }

    // One-time transaction (create or edit)
    const data = {
      accountId: accountId.value,
      activityId: activityId.value || undefined,
      goalId: goalId.value || undefined,
      goalAllocMode: goalId.value ? goalAllocMode.value : undefined,
      goalAllocValue: goalId.value ? goalAllocValue.value : undefined,
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
          class="focus:border-primary-500 font-outfit w-full cursor-pointer appearance-none rounded-[16px] border-2 border-transparent bg-[var(--tint-slate-5)] px-4 py-3 pr-10 text-base font-semibold text-[var(--color-text)] transition-all duration-200 focus:shadow-[0_0_0_3px_rgba(241,93,34,0.1)] focus:outline-none dark:bg-slate-700 dark:text-gray-100"
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
          class="font-outfit w-full border-none bg-transparent text-base font-semibold text-[var(--color-text)] outline-none placeholder:text-[var(--color-text-muted)] placeholder:opacity-30 dark:text-gray-100"
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
            class="focus:border-primary-500 font-outfit h-full w-[82px] cursor-pointer appearance-none rounded-[16px] border-2 border-transparent bg-[var(--tint-slate-5)] px-3 pr-7 text-center text-sm font-bold text-[var(--color-text)] transition-all duration-200 focus:shadow-[0_0_0_3px_rgba(241,93,34,0.1)] focus:outline-none dark:bg-slate-700 dark:text-gray-100"
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
        <FormFieldGroup :label="t('modal.howOften')">
          <FrequencyChips v-model="recurrenceFrequency" :options="frequencyOptions" />
        </FormFieldGroup>
        <!-- Month select (yearly only) -->
        <FormFieldGroup v-if="recurrenceFrequency === 'yearly'" :label="t('form.month')">
          <div class="relative">
            <select
              :value="String(monthOfYear)"
              class="focus:border-primary-500 font-outfit w-full cursor-pointer appearance-none rounded-[16px] border-2 border-transparent bg-[var(--tint-slate-5)] px-4 py-3 pr-10 text-base font-semibold text-[var(--color-text)] transition-all duration-200 focus:shadow-[0_0_0_3px_rgba(241,93,34,0.1)] focus:outline-none dark:bg-slate-700 dark:text-gray-100"
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
        <!-- Start date, day-of-month, end date in a row -->
        <div class="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_auto_1fr]">
          <BaseInput v-model="startDate" :label="t('form.startDate')" type="date" required />
          <div v-if="recurrenceFrequency === 'monthly'" class="flex items-end">
            <FormFieldGroup :label="t('transactions.dayOfMonth')">
              <div class="relative">
                <select
                  :value="String(dayOfMonth)"
                  class="focus:border-primary-500 font-outfit w-[62px] cursor-pointer appearance-none rounded-full border-2 border-transparent bg-[var(--tint-slate-5)] py-2 pr-6 pl-3 text-sm font-semibold text-[var(--color-text)] transition-all duration-150 focus:shadow-[0_0_0_3px_rgba(241,93,34,0.1)] focus:outline-none dark:bg-slate-700 dark:text-gray-400"
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
          <BaseInput v-model="endDate" :label="`${t('form.endDate')} (optional)`" type="date" />
        </div>
        <FormFieldGroup
          v-if="!isEditingRecurring && direction === 'out'"
          :label="t('modal.linkToActivity')"
          optional
        >
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
        <FormFieldGroup v-if="direction === 'out'" :label="t('modal.linkToActivity')" optional>
          <ActivityLinkDropdown v-model="activityId" />
        </FormFieldGroup>
      </div>
    </ConditionalSection>

    <!-- 8b. Goal link (after date/schedule section) -->
    <ConditionalSection :show="goalItems.length > 0">
      <div class="space-y-3">
        <FormFieldGroup :label="t('goalLink.title')" optional>
          <EntityLinkDropdown
            v-model="goalId"
            :items="goalItems"
            :placeholder="t('goalLink.selectGoal')"
            :empty-text="t('goalLink.noGoals')"
            default-icon="🎯"
          />
        </FormFieldGroup>
        <ConditionalSection :show="!!goalId">
          <div class="space-y-3">
            <FormFieldGroup :label="t('goalLink.allocMode')">
              <TogglePillGroup v-model="goalAllocMode" :options="allocModeOptions" />
            </FormFieldGroup>
            <FormFieldGroup
              :label="
                goalAllocMode === 'percentage'
                  ? t('goalLink.percentage')
                  : t('goalLink.fixedAmount')
              "
              required
            >
              <div v-if="goalAllocMode === 'percentage'" class="flex items-center gap-3">
                <BaseInput
                  v-model.number="goalAllocValue"
                  type="number"
                  :min="1"
                  :max="100"
                  placeholder="20"
                  class="w-24"
                />
                <span class="font-outfit text-sm font-semibold text-[var(--color-text-muted)]"
                  >%</span
                >
              </div>
              <AmountInput
                v-else
                v-model="goalAllocValue"
                :currency-symbol="currency || settingsStore.displayCurrency"
              />
            </FormFieldGroup>
            <p v-if="goalAllocPreview" class="font-outfit text-xs text-[var(--color-text-muted)]">
              → {{ formatCurrencyWithCode(goalAllocPreview.amount, goalAllocPreview.currency) }} of
              {{ formatCurrencyWithCode(goalAllocPreview.remaining, goalAllocPreview.currency) }}
              remaining
              <span v-if="goalAllocPreview.capped" class="text-orange-500">
                ({{ t('goalLink.capped') }})
              </span>
            </p>
          </div>
        </ConditionalSection>
      </div>
    </ConditionalSection>

    <!-- 9. Active toggle (recurring edit only) -->
    <div
      v-if="isEditingRecurring"
      class="flex items-center justify-between rounded-[14px] bg-[var(--tint-slate-5)] px-4 py-3 dark:bg-slate-700"
    >
      <span class="font-outfit text-sm font-semibold text-[var(--color-text)] dark:text-gray-200">
        {{ t('recurring.active') }}
      </span>
      <ToggleSwitch v-model="isActive" size="sm" />
    </div>
  </BeanieFormModal>
</template>
