<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue';
import { useRouter } from 'vue-router';
import BeanieFormModal from '@/components/ui/BeanieFormModal.vue';
import TogglePillGroup from '@/components/ui/TogglePillGroup.vue';
import AmountInput from '@/components/ui/AmountInput.vue';
import CurrencyAmountInput from '@/components/ui/CurrencyAmountInput.vue';
import FrequencyChips from '@/components/ui/FrequencyChips.vue';
import CategoryChipPicker from '@/components/ui/CategoryChipPicker.vue';
import FormFieldGroup from '@/components/ui/FormFieldGroup.vue';
import ConditionalSection from '@/components/ui/ConditionalSection.vue';
import ActivityLinkDropdown from '@/components/ui/ActivityLinkDropdown.vue';
import LoanLinkDropdown from '@/components/ui/LoanLinkDropdown.vue';
import EntityLinkDropdown from '@/components/ui/EntityLinkDropdown.vue';
import AmortizationBreakdown from '@/components/ui/AmortizationBreakdown.vue';
import InfoHintBadge from '@/components/ui/InfoHintBadge.vue';
import ToggleSwitch from '@/components/ui/ToggleSwitch.vue';
import BaseInput from '@/components/ui/BaseInput.vue';
import { useAccountsStore } from '@/stores/accountsStore';
import { useAssetsStore } from '@/stores/assetsStore';
import { useActivityStore } from '@/stores/activityStore';
import { useGoalsStore } from '@/stores/goalsStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useTranslation } from '@/composables/useTranslation';
import { formatCurrencyWithCode } from '@/composables/useCurrencyDisplay';
import { useFormModal } from '@/composables/useFormModal';
import { useAttentionPulse } from '@/composables/useAttentionPulse';

import type {
  Transaction,
  RecurringItem,
  CreateTransactionInput,
  UpdateTransactionInput,
  CreateRecurringItemInput,
  RecurringFrequency,
} from '@/types/models';
import { toDateInputValue, formatNookDate } from '@/utils/date';
import { computeGoalAllocRaw } from '@/utils/finance';
import { calculateAmortization, calculateExtraPayment, findLoanDetails } from '@/utils/loanPayment';
import { activityCategoryToExpenseCategory } from '@/constants/categories';

const props = defineProps<{
  open: boolean;
  transaction?: Transaction | null;
  recurringItem?: RecurringItem | null;
  initialValues?: Partial<CreateTransactionInput> | null;
  projectedDate?: string;
}>();

const emit = defineEmits<{
  close: [];
  save: [data: CreateTransactionInput | { id: string; data: UpdateTransactionInput }];
  'save-recurring': [data: CreateRecurringItemInput];
  delete: [id: string];
}>();

const { t } = useTranslation();
const router = useRouter();
const accountsStore = useAccountsStore();
const assetsStore = useAssetsStore();
const activityStore = useActivityStore();
const goalsStore = useGoalsStore();
const settingsStore = useSettingsStore();

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
const linkType = ref<'' | 'activity' | 'loan'>('');
const loanId = ref<string | undefined>(undefined);
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

// Link is locked when editing an existing item that already has a link
const isLinkLocked = computed(() => {
  if (isEditingRecurring.value && (props.recurringItem?.loanId || props.recurringItem?.activityId))
    return true;
  if (
    isEditing.value &&
    props.transaction &&
    (props.transaction.loanId || props.transaction.activityId)
  )
    return true;
  return false;
});

const linkedLoan = computed(() => {
  if (!loanId.value) return null;
  return findLoanDetails(loanId.value, assetsStore.assets, accountsStore.accounts);
});

const amortizationPreview = computed(() => {
  if (!linkedLoan.value || linkedLoan.value.outstandingBalance <= 0) return null;
  if (recurrenceMode.value === 'recurring') {
    return calculateAmortization(
      linkedLoan.value.outstandingBalance,
      linkedLoan.value.interestRate,
      amount.value ?? linkedLoan.value.monthlyPayment
    );
  }
  return calculateExtraPayment(linkedLoan.value.outstandingBalance, amount.value ?? 0);
});

// Whether the transaction is linked to a loan or activity (new or existing)
const hasActiveLink = computed(() => !!(loanId.value || activityId.value));

const isAmountLocked = computed(() => {
  if (
    linkType.value === 'loan' &&
    linkedLoan.value &&
    linkedLoan.value.monthlyPayment > 0 &&
    recurrenceMode.value === 'recurring'
  )
    return true;
  if (linkType.value === 'activity' && activityId.value) {
    const activity = activityStore?.activities?.find((a: any) => a.id === activityId.value);
    if (activity?.feeAmount) return true;
  }
  return false;
});

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
        if (item.loanId) {
          linkType.value = 'loan';
          loanId.value = item.loanId;
          activityId.value = undefined;
        } else if (item.activityId) {
          linkType.value = 'activity';
          activityId.value = item.activityId;
          loanId.value = undefined;
        } else {
          linkType.value = '';
          loanId.value = undefined;
          activityId.value = undefined;
        }
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
        if (transaction.loanId) {
          linkType.value = 'loan';
          loanId.value = transaction.loanId;
        } else if (transaction.activityId) {
          linkType.value = 'activity';
        } else {
          linkType.value = '';
          loanId.value = undefined;
        }
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
      linkPromptDismissed.value = false;
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
      linkType.value = '';
      loanId.value = undefined;
      goalId.value = undefined;
      goalAllocMode.value = 'percentage';
      goalAllocValue.value = undefined;
      currency.value = iv?.currency ?? settingsStore.displayCurrency;
      dayOfMonth.value = new Date().getDate();
      monthOfYear.value = new Date().getMonth() + 1;
      isActive.value = true;
      linkPromptDismissed.value = false;
      suppressDaySync = false;
    },
  }
);

const accountOptions = computed(() =>
  accountsStore.activeAccounts
    .filter((a) => !hasActiveLink.value || a.currency === currency.value)
    .map((a) => ({ value: a.id, label: a.name }))
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

// Clear goal fields when switching to expense, clear link data when switching to income
watch(direction, (newDir) => {
  if (newDir === 'out') {
    goalId.value = undefined;
    goalAllocMode.value = 'percentage';
    goalAllocValue.value = undefined;
  }
  if (newDir === 'in') {
    linkType.value = '';
    loanId.value = undefined;
    activityId.value = undefined;
  }
});

// Reset allocation when goal is cleared
watch(goalId, (newId) => {
  if (!newId) {
    goalAllocMode.value = 'percentage';
    goalAllocValue.value = undefined;
  }
});

// Mutual exclusivity: activity vs loan link
watch(linkType, (val) => {
  if (val !== 'activity') activityId.value = undefined;
  if (val !== 'loan') loanId.value = undefined;
});

// Set amount, category, and currency from linked entity
watch([loanId, activityId], () => {
  if (
    loanId.value &&
    linkedLoan.value &&
    linkedLoan.value.monthlyPayment > 0 &&
    recurrenceMode.value === 'recurring'
  ) {
    amount.value = linkedLoan.value.monthlyPayment;
    currency.value = linkedLoan.value.currency;
    direction.value = 'out';
  }
  // Auto-set category, amount, and currency when activity is linked
  if (activityId.value) {
    const activity = activityStore?.activities?.find((a: any) => a.id === activityId.value);
    if (activity) {
      const suggestedCategory = activityCategoryToExpenseCategory(activity.category);
      if (suggestedCategory) {
        category.value = suggestedCategory;
      }
      // Also set amount from activity fee
      if (activity.feeAmount) {
        amount.value = activity.feeAmount;
      }
      // Lock currency to activity's currency
      if (activity.feeCurrency) {
        currency.value = activity.feeCurrency;
      }
      direction.value = 'out';
    }
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
        ...(loanId.value ? { loanId: loanId.value } : {}),
        ...(activityId.value ? { activityId: activityId.value } : {}),
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
        ...(loanId.value ? { loanId: loanId.value } : {}),
        ...(activityId.value ? { activityId: activityId.value } : {}),
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
      ...(activityId.value ? { activityId: activityId.value } : {}),
      ...(loanId.value ? { loanId: loanId.value } : {}),
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

// ── Quick-link prompt ─────────────────────────────────────────────────────
const linkPromptDismissed = ref(false);
const linkDropdownRef = ref<any>(null);

const hasLinkableLoans = computed(
  () =>
    assetsStore.assets.some((a) => a.loan?.hasLoan && (a.loan.outstandingBalance ?? 0) > 0) ||
    accountsStore.accounts.some(
      (a) => a.type === 'loan' && a.isActive && a.balance > 0 && !a.linkedAssetId
    )
);

const hasLinkableActivities = computed(() => activityStore.activeActivities.length > 0);

const showLinkPrompt = computed(
  () =>
    direction.value === 'out' &&
    !isLinkLocked.value &&
    !hasActiveLink.value &&
    linkType.value === '' &&
    !linkPromptDismissed.value &&
    (hasLinkableLoans.value || hasLinkableActivities.value)
);

const { pulse } = useAttentionPulse();

async function selectQuickLink(type: 'loan' | 'activity') {
  linkType.value = type;
  linkPromptDismissed.value = true;
  await nextTick();
  const root = (linkDropdownRef.value as any)?.$el as HTMLElement | undefined;
  // Target the clickable button inside the dropdown for a tight pulse
  const target = root?.querySelector('button') ?? root;
  target?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  setTimeout(() => pulse(target as HTMLElement | undefined), 400);
}

function dismissLinkPrompt() {
  linkPromptDismissed.value = true;
}
</script>

<template>
  <BeanieFormModal
    variant="drawer"
    size="wide"
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
    <!-- Projected date banner for recurring transaction occurrence edits -->
    <div
      v-if="projectedDate"
      class="mb-4 rounded-[14px] bg-[var(--tint-silk-20)] px-4 py-3 dark:bg-sky-900/20"
    >
      <div class="flex items-center gap-2">
        <span class="text-base">📅</span>
        <span class="font-outfit text-sm font-semibold text-[var(--color-text)] dark:text-gray-100">
          {{ t('transactions.editingProjected').replace('{date}', formatNookDate(projectedDate)) }}
        </span>
      </div>
    </div>

    <!-- 0. Recurring / One-time tab bar (top of form, hidden when editing a recurring item) -->
    <div
      v-if="!isEditingRecurring"
      class="rounded-2xl bg-[var(--tint-slate-5)] p-1.5 dark:bg-slate-700/50"
    >
      <div class="grid grid-cols-2 gap-1.5">
        <button
          v-for="opt in [
            {
              value: 'recurring',
              icon: '🔁',
              label: t('vacation.scheduleRecurring'),
              desc: t('vacation.scheduleRecurringDesc'),
            },
            {
              value: 'one-time',
              icon: '📌',
              label: t('vacation.scheduleOneTime'),
              desc: t('vacation.scheduleOneTimeDesc'),
            },
          ]"
          :key="opt.value"
          type="button"
          class="relative flex flex-col items-center gap-0.5 rounded-xl px-3 py-2.5 transition-all duration-200"
          :class="
            recurrenceMode === opt.value
              ? 'border-primary-500 border-2 bg-white shadow-sm dark:bg-slate-600'
              : 'border-2 border-transparent hover:bg-white/60 dark:hover:bg-slate-600/40'
          "
          @click="recurrenceMode = opt.value as 'recurring' | 'one-time'"
        >
          <span class="text-lg leading-none">{{ opt.icon }}</span>
          <span
            class="font-outfit text-xs font-bold"
            :class="
              recurrenceMode === opt.value
                ? 'text-[var(--color-text)] dark:text-gray-100'
                : 'text-[var(--color-text)] opacity-35 dark:text-gray-400'
            "
          >
            {{ opt.label }}
          </span>
          <span
            class="text-[10px]"
            :class="
              recurrenceMode === opt.value
                ? 'text-[var(--color-text-muted)]'
                : 'opacity-25 dark:text-gray-500'
            "
          >
            {{ opt.desc }}
          </span>
          <span
            v-if="recurrenceMode === opt.value"
            class="bg-primary-500 absolute bottom-1.5 left-1/2 h-1.5 w-1.5 -translate-x-1/2 rounded-full"
          />
        </button>
      </div>
    </div>

    <!-- 1. Direction toggle (locked to outgoing when linked to activity/loan) -->
    <FormFieldGroup :label="t('modal.direction')">
      <div v-if="hasActiveLink" class="flex items-center gap-2">
        <span
          class="font-outfit from-primary-500 to-terracotta-400 inline-flex items-center rounded-[11px] bg-gradient-to-r px-4 py-2 text-xs font-semibold text-white shadow-sm"
        >
          🧡 {{ t('modal.moneyOut') }}
        </span>
        <span class="text-xs text-[var(--color-text-muted)]">🔒</span>
        <InfoHintBadge :text="t('txLink.hintDirection')" />
      </div>
      <TogglePillGroup
        v-else
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

    <!-- 2a. Quick-link prompt (outgoing only, when linkable items exist) -->
    <div
      v-if="showLinkPrompt"
      class="flex items-center gap-2 rounded-2xl border border-orange-200/50 bg-gradient-to-r from-orange-50/80 to-amber-50/50 px-4 py-2.5 dark:border-orange-800/30 dark:from-orange-900/10 dark:to-amber-900/10"
    >
      <span class="text-sm">🔗</span>
      <span class="min-w-0 flex-1 text-xs text-[var(--color-text-muted)]">
        {{ t('txLink.quickLinkPrompt') }}
      </span>
      <div class="flex shrink-0 items-center gap-1.5">
        <button
          v-if="hasLinkableActivities"
          type="button"
          class="font-outfit rounded-lg bg-white px-2.5 py-1 text-[11px] font-bold text-[var(--color-text)] shadow-sm transition-all hover:shadow-md dark:bg-slate-700 dark:text-gray-200"
          @click="selectQuickLink('activity')"
        >
          📋 {{ t('txLink.activity') }}
        </button>
        <button
          v-if="hasLinkableLoans"
          type="button"
          class="font-outfit rounded-lg bg-white px-2.5 py-1 text-[11px] font-bold text-[var(--color-text)] shadow-sm transition-all hover:shadow-md dark:bg-slate-700 dark:text-gray-200"
          @click="selectQuickLink('loan')"
        >
          🏦 {{ t('txLink.loan') }}
        </button>
        <button
          type="button"
          class="rounded-lg px-1.5 py-1 text-[11px] text-[var(--color-text-muted)] transition-colors hover:bg-gray-100 dark:hover:bg-slate-600"
          @click="dismissLinkPrompt"
        >
          ✕
        </button>
      </div>
    </div>

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
      <!-- Amount field with optional locking -->
      <div v-if="isAmountLocked" class="space-y-1">
        <div
          class="flex items-center gap-2 rounded-[16px] bg-[var(--tint-slate-5)] px-4 py-3 dark:bg-slate-700"
        >
          <span class="font-outfit text-[1.8rem] font-bold text-[var(--color-text)]">
            {{ currency }} {{ amount?.toLocaleString('en-US', { minimumFractionDigits: 2 }) }}
          </span>
          <span class="text-sm text-[var(--color-text-muted)]">🔒</span>
          <InfoHintBadge :text="t('txLink.amountLocked')" />
        </div>
      </div>
      <!-- Linked but amount not locked (one-time extra payment): currency locked, amount editable -->
      <div v-else-if="hasActiveLink" class="flex items-stretch gap-2">
        <div
          class="font-outfit flex h-full w-[82px] flex-shrink-0 items-center justify-center gap-1 rounded-[16px] bg-[var(--tint-slate-5)] px-3 text-center text-sm font-bold text-[var(--color-text)] dark:bg-slate-700"
        >
          {{ currency }} 🔒
        </div>
        <div class="min-w-0 flex-1">
          <AmountInput v-model="amount" :currency-symbol="currency" />
        </div>
        <div class="flex items-center">
          <InfoHintBadge :text="t('txLink.hintCurrency')" />
        </div>
      </div>
      <CurrencyAmountInput v-else v-model:amount="amount" v-model:currency="currency" />
    </FormFieldGroup>

    <!-- 5. Category chips (two-level drill-down) -->
    <FormFieldGroup :label="t('form.category')" required>
      <CategoryChipPicker v-model="category" :type="effectiveCategoryType" />
    </FormFieldGroup>

    <!-- 7. Recurring details -->
    <ConditionalSection :show="recurrenceMode === 'recurring' || isEditingRecurring">
      <div class="space-y-4">
        <FormFieldGroup :label="t('modal.howOften')">
          <div v-if="hasActiveLink" class="flex items-center gap-2">
            <span
              class="font-outfit bg-secondary-500 inline-flex items-center rounded-[11px] px-4 py-2 text-xs font-semibold text-white shadow-sm dark:bg-slate-200 dark:text-slate-900"
            >
              {{
                frequencyOptions.find((o) => o.value === recurrenceFrequency)?.label ??
                recurrenceFrequency
              }}
            </span>
            <span class="text-xs text-[var(--color-text-muted)]">🔒</span>
            <InfoHintBadge :text="t('txLink.hintFrequency')" />
          </div>
          <FrequencyChips v-else v-model="recurrenceFrequency" :options="frequencyOptions" />
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
        <div v-if="hasActiveLink" class="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <FormFieldGroup :label="t('form.startDate')">
            <div
              class="flex items-center gap-2 rounded-[16px] bg-[var(--tint-slate-5)] px-4 py-3 dark:bg-slate-700"
            >
              <span class="font-outfit text-sm font-semibold text-[var(--color-text)]">{{
                startDate
              }}</span>
              <span class="text-xs text-[var(--color-text-muted)]">🔒</span>
              <InfoHintBadge :text="t('txLink.hintSchedule')" />
            </div>
          </FormFieldGroup>
          <FormFieldGroup v-if="endDate" :label="t('form.endDate')">
            <div
              class="flex items-center gap-2 rounded-[16px] bg-[var(--tint-slate-5)] px-4 py-3 dark:bg-slate-700"
            >
              <span class="font-outfit text-sm font-semibold text-[var(--color-text)]">{{
                endDate
              }}</span>
              <span class="text-xs text-[var(--color-text-muted)]">🔒</span>
            </div>
          </FormFieldGroup>
        </div>
        <div v-else class="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_auto_1fr]">
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
      </div>
    </ConditionalSection>

    <!-- 8. Date (for one-time) -->
    <ConditionalSection :show="recurrenceMode === 'one-time' && !isEditingRecurring">
      <div class="space-y-4">
        <FormFieldGroup :label="t('form.date')">
          <BaseInput v-model="date" type="date" required />
        </FormFieldGroup>
      </div>
    </ConditionalSection>

    <!-- 8a. Link Payment (outgoing only) -->
    <ConditionalSection :show="direction === 'out'">
      <div class="space-y-3">
        <!-- Locked link display (editing an already-linked item) -->
        <template v-if="isLinkLocked">
          <FormFieldGroup
            v-if="linkType === 'activity' && activityId"
            :label="t('txLink.linkedActivity')"
          >
            <div
              class="flex items-center gap-2 rounded-2xl bg-[var(--tint-slate-5)] px-4 py-3 text-sm text-[var(--color-text)] dark:bg-slate-700"
            >
              <span>📋</span>
              <span class="font-semibold">{{
                activityStore?.activities?.find((a) => a.id === activityId)?.title ?? activityId
              }}</span>
              <span class="text-xs text-[var(--color-text-muted)]">🔒</span>
              <InfoHintBadge :text="t('txLink.hintLinkedActivity')" />
              <button
                type="button"
                class="hover:text-primary-500 ml-auto text-xs font-semibold text-[var(--color-text-muted)] transition-colors"
                @click="
                  emit('close');
                  router.push({ path: '/activities', query: { activity: activityId } });
                "
              >
                {{ t('action.view') }} &rarr;
              </button>
            </div>
          </FormFieldGroup>
          <FormFieldGroup v-if="linkType === 'loan' && linkedLoan" :label="t('txLink.linkedLoan')">
            <div
              class="flex items-center gap-2 rounded-2xl bg-[var(--tint-slate-5)] px-4 py-3 text-sm text-[var(--color-text)] dark:bg-slate-700"
            >
              <span>{{ linkedLoan.type === 'asset' ? '🏠' : '🏦' }}</span>
              <span class="font-semibold">{{ linkedLoan.name }}</span>
              <span class="text-xs text-[var(--color-text-muted)]">🔒</span>
              <InfoHintBadge :text="t('txLink.hintLinkedLoan')" />
              <button
                type="button"
                class="hover:text-primary-500 ml-auto text-xs font-semibold text-[var(--color-text-muted)] transition-colors"
                @click="
                  emit('close');
                  router.push({
                    path: linkedLoan.type === 'asset' ? '/assets' : '/accounts',
                    query: { [linkedLoan.type === 'asset' ? 'asset' : 'account']: loanId },
                  });
                "
              >
                {{ t('action.view') }} &rarr;
              </button>
            </div>
          </FormFieldGroup>
        </template>

        <!-- Editable link selector (new items or unlinked items) -->
        <template v-else>
          <div>
            <div class="mb-2 flex items-center gap-1.5">
              <label
                class="font-outfit text-xs font-semibold tracking-[0.1em] whitespace-nowrap text-[var(--color-text)] uppercase opacity-35 dark:text-gray-300"
              >
                {{ t('txLink.linkPayment') }}
              </label>
              <InfoHintBadge
                :text="t('txLink.hintLinkPaymentIntro')"
                :items="[t('txLink.hintLinkPaymentActivity'), t('txLink.hintLinkPaymentLoan')]"
              />
            </div>
            <TogglePillGroup
              v-model="linkType"
              :options="[
                { value: 'activity', label: '📋 ' + t('txLink.activity') },
                { value: 'loan', label: '🏦 ' + t('txLink.loan') },
              ]"
              clearable
            />
          </div>

          <FormFieldGroup v-if="linkType === 'activity'" :label="t('txLink.activity')">
            <ActivityLinkDropdown ref="linkDropdownRef" v-model="activityId" />
          </FormFieldGroup>

          <FormFieldGroup v-if="linkType === 'loan'" :label="t('txLink.loan')">
            <LoanLinkDropdown ref="linkDropdownRef" v-model="loanId" />
          </FormFieldGroup>
        </template>

        <AmortizationBreakdown
          v-if="loanId && amortizationPreview"
          :interest="amortizationPreview.interestPortion"
          :principal="amortizationPreview.principalPortion"
          :remaining="amortizationPreview.newBalance"
          :currency="currency"
        >
          <p v-if="recurrenceMode === 'one-time'" class="text-xs text-[var(--color-text-muted)]">
            {{ t('txLink.extraPaymentNote') }}
          </p>
        </AmortizationBreakdown>
      </div>
    </ConditionalSection>

    <!-- 8b. Goal link (income only, after date/schedule section) -->
    <ConditionalSection :show="direction === 'in' && goalItems.length > 0">
      <div class="space-y-3">
        <div>
          <div class="mb-2 flex items-center gap-1.5">
            <label
              class="font-outfit text-xs font-semibold tracking-[0.1em] whitespace-nowrap text-[var(--color-text)] uppercase opacity-35 dark:text-gray-300"
            >
              {{ t('goalLink.title') }}
            </label>
            <InfoHintBadge
              :text="t('goalLink.hintIntro')"
              :items="[t('goalLink.hintPercentage'), t('goalLink.hintFixed')]"
            />
          </div>
          <EntityLinkDropdown
            v-model="goalId"
            :items="goalItems"
            :placeholder="t('goalLink.selectGoal')"
            :empty-text="t('goalLink.noGoals')"
            default-icon="🎯"
          />
        </div>
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
