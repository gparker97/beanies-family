<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue';
import { useRouter } from 'vue-router';
import BeanieFormModal from '@/components/ui/BeanieFormModal.vue';
import TogglePillGroup from '@/components/ui/TogglePillGroup.vue';
import AmountInput from '@/components/ui/AmountInput.vue';
import CurrencyAmountInput from '@/components/ui/CurrencyAmountInput.vue';
import RecurrencePicker from '@/components/ui/RecurrencePicker.vue';
import { resolveTransactionRule, legacyShadowFromRule } from '@/services/recurrence/adapters';
import { isRuleComplete } from '@/services/recurrence/recurrenceEngine';
import { useRecurrenceLabel } from '@/composables/useRecurrenceLabel';
import type { RecurrenceRule } from '@/types/recurrence';
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
import BeanieDatePicker from '@/components/ui/BeanieDatePicker.vue';
import AccountSelect from '@/components/ui/AccountSelect.vue';
import { useTransferForm } from '@/composables/useTransferForm';
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
  Account,
} from '@/types/models';
import { toDateInputValue, formatNookDate, extractDatePart } from '@/utils/date';
import { computeGoalAllocRaw, isLiabilityType } from '@/utils/finance';
import {
  buildAccountOptionGroups,
  type AccountGroupId,
  type AccountOptionGroup,
} from '@/utils/accountOptions';
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
// Transfer mode is a third transaction kind alongside income/expense. It's
// one-time only and carries no category / goal / loan / activity link.
const isTransfer = ref(false);
const toAccountId = ref<string | undefined>(undefined);
const amount = ref<number | undefined>(undefined);
const description = ref('');
const category = ref('');
const recurrenceMode = ref<'one-time' | 'recurring'>('recurring');
// #70: the canonical recurrence rule drives the shared RecurrencePicker. null →
// the picker shows its default (monthly). Legacy frequency/dayOfMonth/monthOfYear
// are derived as an inert schema shadow at save time (legacyShadowFromRule).
const rule = ref<RecurrenceRule | null>(null);
const date = ref(todayStr());
const startDate = ref(todayStr());
const accountId = ref('');
const activityId = ref<string | undefined>(undefined);
const linkType = ref<'' | 'activity' | 'loan'>('');
const loanId = ref<string | undefined>(undefined);
const goalId = ref<string | undefined>(undefined);
const goalAllocMode = ref<'percentage' | 'fixed'>('percentage');
const goalAllocValue = ref<number | undefined>(undefined);
const currency = ref(settingsStore.displayCurrency);
const isActive = ref(true);

// #70: the RecurrencePicker derives the monthly/yearly anchor from `startDate`
// live, so the old startDate→dayOfMonth sync watch is no longer needed.

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
      if (props.recurringItem) {
        // Editing a recurring item (never a transfer)
        const item = props.recurringItem;
        isTransfer.value = false;
        toAccountId.value = undefined;
        direction.value = item.type === 'income' ? 'in' : 'out';
        amount.value = item.amount;
        description.value = item.description;
        category.value = item.category;
        recurrenceMode.value = 'recurring';
        // #70: use the resolver's rebuilt anchor as the start date — for a legacy
        // yearly item the recurrence date (monthOfYear/dayOfMonth) differs from
        // startDate, and the engine anchors monthly/yearly on this date. Using it
        // keeps the schedule from silently jumping to the raw startDate on edit.
        {
          // Reset UNCONDITIONALLY. This modal is bound `:open`, not `v-if`'d,
          // so its refs survive between opens — leaving them untouched on an
          // unmappable item (resolver returns null) would render the PREVIOUS
          // item's schedule and then persist it onto this one.
          const resolved = resolveTransactionRule(item);
          rule.value = resolved?.rule ?? null;
          startDate.value = resolved?.anchor ?? extractDatePart(item.startDate);
        }
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
        if (transaction.type === 'transfer') {
          isTransfer.value = true;
          toAccountId.value = transaction.toAccountId;
          direction.value = 'out';
        } else {
          isTransfer.value = false;
          toAccountId.value = undefined;
          direction.value = transaction.type === 'income' ? 'in' : 'out';
        }
        amount.value = transaction.amount;
        description.value = transaction.description;
        category.value = transaction.category;
        // #70: a materialized transaction is edited as a one-off; the recurring
        // template lives on its RecurringItem (this preserves the prior behavior,
        // since the removed Transaction.recurring field was never written).
        recurrenceMode.value = 'one-time';
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
        // Recurring picker defaults (monthly) if the user switches to recurring.
        rule.value = null;
        startDate.value = transaction.date.substring(0, 10);
      }
      linkPromptDismissed.value = false;
    },
    onNew: () => {
      const iv = props.initialValues;
      isTransfer.value = iv?.type === 'transfer';
      toAccountId.value = iv?.toAccountId;
      direction.value = iv?.type === 'income' ? 'in' : iv?.type === 'expense' ? 'out' : 'out';
      amount.value = iv?.amount ?? undefined;
      description.value = iv?.description ?? '';
      category.value = iv?.category ?? '';
      recurrenceMode.value = iv ? 'one-time' : 'recurring';
      date.value = iv?.date ?? todayStr();
      startDate.value = todayStr();
      rule.value = null;
      // No pre-selection — the user deliberately picks the account(s).
      accountId.value = iv?.accountId ?? '';
      activityId.value = undefined;
      linkType.value = '';
      loanId.value = undefined;
      goalId.value = undefined;
      goalAllocMode.value = 'percentage';
      goalAllocValue.value = undefined;
      currency.value = iv?.currency ?? settingsStore.displayCurrency;
      isActive.value = true;
      linkPromptDismissed.value = false;
    },
  }
);

// Shared label + group builders for every account picker: alphabetical within a
// group, grouped by kind, with the balance (or amount owed) shown inline.
const groupLabel = (id: AccountGroupId): string => {
  switch (id) {
    case 'cash':
      return t('txn.accountGroup.cash');
    case 'cards':
      return t('txn.accountGroup.cards');
    case 'investments':
      return t('txn.accountGroup.investments');
    case 'loans':
      return t('txn.accountGroup.loans');
    case 'other':
      return t('txn.accountGroup.other');
  }
};
const makeAccountLabel = (a: Account) =>
  isLiabilityType(a.type)
    ? `${a.name} · ${t('txn.owedLabel')} ${formatCurrencyWithCode(a.balance, a.currency)}`
    : `${a.name} · ${formatCurrencyWithCode(a.balance, a.currency)}`;

// Money in/out source: any active account (currency-restricted when linked).
const accountGroups = computed<AccountOptionGroup[]>(() =>
  buildAccountOptionGroups(
    accountsStore.activeAccounts.filter(
      (a) => !hasActiveLink.value || a.currency === currency.value
    ),
    makeAccountLabel,
    groupLabel
  )
);

const effectiveCategoryType = computed(() => (direction.value === 'in' ? 'income' : 'expense'));

// #70: read-only recurrence summary for a locked (activity/loan fee-linked) item.
const { describe } = useRecurrenceLabel();
const lockedRecurrenceSummary = computed(() =>
  rule.value ? describe(rule.value, extractDatePart(startDate.value)) : ''
);

const canSave = computed(() => {
  const hasAmount = amount.value !== undefined && amount.value > 0;
  if (isTransfer.value) {
    // Transfers need source + a distinct destination, a positive amount, and (if
    // cross-currency) an available rate. Description is optional.
    return (
      hasAmount &&
      !!accountId.value &&
      !!toAccountId.value &&
      !transferSameAccount.value &&
      transferHasRate.value
    );
  }
  const base = description.value.trim().length > 0 && hasAmount && !!accountId.value;
  // #70: a recurring save must carry a structurally valid rule (belt-and-braces —
  // the picker can't normally emit an invalid one).
  if (base && (recurrenceMode.value === 'recurring' || isEditingRecurring.value)) {
    return isRuleComplete(buildEffectiveRule(startDate.value || toDateInputValue(new Date())));
  }
  return base;
});

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

// ── Transfer mode ──────────────────────────────────────────────────────────
// The 3-way type selector maps to income / expense / transfer.
const typeChoice = computed<'out' | 'in' | 'transfer'>({
  get: () => (isTransfer.value ? 'transfer' : direction.value),
  set: (v) => {
    if (v === 'transfer') {
      isTransfer.value = true;
    } else {
      isTransfer.value = false;
      direction.value = v;
    }
  },
});

const {
  destCurrency: transferDestCurrency,
  destIsLiability: transferDestIsLiability,
  isCrossCurrency: transferIsCrossCurrency,
  hasRate: transferHasRate,
  convertedAmount: transferConvertedAmount,
  sameAccount: transferSameAccount,
} = useTransferForm({ sourceAccountId: accountId, toAccountId, amount, sourceCurrency: currency });

// Transfer SOURCE is restricted to cash/asset accounts (you can't sensibly
// "send" money out of a card/loan — that would be borrowing). DESTINATION can be
// any other account (paying a card/loan is a transfer to it).
const transferSourceGroups = computed<AccountOptionGroup[]>(() =>
  buildAccountOptionGroups(
    accountsStore.activeAccounts.filter((a) => !isLiabilityType(a.type)),
    makeAccountLabel,
    groupLabel
  )
);
const transferDestGroups = computed<AccountOptionGroup[]>(() =>
  buildAccountOptionGroups(
    accountsStore.activeAccounts.filter((a) => a.id !== accountId.value),
    makeAccountLabel,
    groupLabel
  )
);

// Entering transfer mode: transfers are one-time + unlinked, and the amount is
// denominated in the source account's currency. A liability that was selected as
// the source in income/expense mode is not a valid transfer source — clear it.
watch(isTransfer, (on) => {
  if (on) {
    recurrenceMode.value = 'one-time';
    category.value = '';
    linkType.value = '';
    loanId.value = undefined;
    activityId.value = undefined;
    goalId.value = undefined;
    goalAllocValue.value = undefined;
    const source = accountsStore.accounts.find((a) => a.id === accountId.value);
    if (source && isLiabilityType(source.type)) accountId.value = '';
    else if (source) currency.value = source.currency;
  } else {
    toAccountId.value = undefined;
  }
});

// Keep the transfer amount's currency locked to the source, and clear a
// destination that has become equal to the source.
watch(accountId, (id) => {
  if (!isTransfer.value) return;
  const source = accountsStore.accounts.find((a) => a.id === id);
  if (source) currency.value = source.currency;
  if (toAccountId.value === id) toAccountId.value = undefined;
});

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

/**
 * The rule to persist.
 *
 * #70: this used to RECONSTRUCT the picker's default when the user saved
 * without touching the control, because the picker never emitted on mount. It
 * now does, so `rule` is always populated while the control is shown — and the
 * reconstruction had already drifted from the real default (it kept a `day <= 28
 * ? day : 'last'` cap the picker dropped when month-ends began clamping, so a
 * 30 Jan start displayed "on the 30th" and persisted "last day").
 *
 * The fallback remains only as a defensive floor for a save that somehow races
 * the mount emit; it now matches the picker exactly.
 */
function buildEffectiveRule(startYmd: string): RecurrenceRule {
  if (rule.value) return rule.value;
  return {
    unit: 'month',
    interval: 1,
    monthlyAnchor: 'date',
    monthlyDay: new Date(extractDatePart(startYmd) + 'T00:00:00').getDate(),
    end: { kind: 'never' },
  };
}

function handleSave() {
  if (!canSave.value) return;
  isSubmitting.value = true;

  try {
    // Transfer: a one-time move between two accounts (no category / goal / loan /
    // recurrence). The store is the authority for the converted `toAmount`.
    if (isTransfer.value) {
      const data = {
        accountId: accountId.value,
        toAccountId: toAccountId.value,
        type: 'transfer' as const,
        amount: amount.value!,
        currency: currency.value,
        category: '',
        date: date.value,
        description: description.value.trim(),
        isReconciled: false,
      };
      if (isEditing.value && props.transaction) {
        emit('save', { id: props.transaction.id, data: data as UpdateTransactionInput });
      } else {
        emit('save', data as CreateTransactionInput);
      }
      return;
    }

    // Editing an existing recurring item
    if (isEditingRecurring.value) {
      const start = startDate.value || toDateInputValue(new Date());
      const effRule = buildEffectiveRule(start);
      const shadow = legacyShadowFromRule(effRule, start);
      const recurringData: CreateRecurringItemInput = {
        accountId: accountId.value,
        type: effectiveType.value,
        amount: amount.value!,
        currency: currency.value,
        category: category.value,
        description: description.value.trim(),
        frequency: shadow.frequency,
        dayOfMonth: shadow.dayOfMonth,
        monthOfYear: shadow.monthOfYear,
        rule: effRule,
        startDate: start,
        endDate: effRule.end.kind === 'onDate' ? effRule.end.date : undefined,
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
      const start = startDate.value || toDateInputValue(new Date());
      const effRule = buildEffectiveRule(start);
      const shadow = legacyShadowFromRule(effRule, start);
      const recurringData: CreateRecurringItemInput = {
        accountId: accountId.value,
        type: effectiveType.value,
        amount: amount.value!,
        currency: currency.value,
        category: category.value,
        description: description.value.trim(),
        frequency: shadow.frequency,
        dayOfMonth: shadow.dayOfMonth,
        monthOfYear: shadow.monthOfYear,
        rule: effRule,
        startDate: start,
        endDate: effRule.end.kind === 'onDate' ? effRule.end.date : undefined,
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
      // Clear computed allocation so the store's reversal + reapply cycle
      // starts fresh when goal fields change or goal is unlinked.
      goalAllocApplied: undefined,
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
    !isTransfer.value &&
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
    :icon="isTransfer || isEditingRecurring ? '🔄' : direction === 'in' ? '💚' : '🧡'"
    :icon-bg="
      !isTransfer && !isEditingRecurring && direction === 'in'
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

    <!-- 0. Recurring / One-time tab bar (hidden for recurring-item edits and transfers) -->
    <div
      v-if="!isEditingRecurring && !isTransfer"
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
            class="text-[0.625rem]"
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
          <span aria-hidden="true">{{ '🧡' }}</span> {{ t('modal.moneyOut') }}
        </span>
        <span class="text-xs text-[var(--color-text-muted)]">🔒</span>
        <InfoHintBadge :text="t('txLink.hintDirection')" />
      </div>
      <TogglePillGroup
        v-else
        v-model="typeChoice"
        :options="[
          { value: 'out', label: '🧡 ' + t('modal.moneyOut'), variant: 'orange' },
          { value: 'in', label: '💚 ' + t('modal.moneyIn'), variant: 'green' },
          { value: 'transfer', label: '🔄 ' + t('transfer.type'), variant: 'default' },
        ]"
      />
    </FormFieldGroup>

    <!-- 2. Account select (source; "From" in transfer mode) -->
    <FormFieldGroup :label="isTransfer ? t('transfer.from') : t('form.account')" required>
      <AccountSelect
        v-model="accountId"
        :groups="isTransfer ? transferSourceGroups : accountGroups"
        :placeholder="t('form.selectAccount')"
        :aria-label="isTransfer ? t('transfer.from') : t('form.account')"
      />
    </FormFieldGroup>

    <!-- 2b. Transfer destination + conversion (transfer mode only) -->
    <template v-if="isTransfer">
      <FormFieldGroup :label="t('transfer.to')" required>
        <AccountSelect
          v-model="toAccountId"
          :groups="transferDestGroups"
          :placeholder="t('transfer.selectDestination')"
          :aria-label="t('transfer.to')"
        />
        <!-- Paying a card / loan reduces what you owe -->
        <div
          v-if="transferDestIsLiability"
          class="mt-2 flex items-center gap-2 rounded-[14px] border border-orange-200/50 bg-gradient-to-r from-orange-50/80 to-amber-50/50 px-3 py-2 dark:border-orange-800/30 dark:from-orange-900/10 dark:to-amber-900/10"
        >
          <span aria-hidden="true">💡</span>
          <span class="text-xs text-[var(--color-text-muted)]">{{
            t('transfer.liabilityHint')
          }}</span>
        </div>
      </FormFieldGroup>

      <!-- Converted amount (cross-currency, rate available) -->
      <div
        v-if="transferIsCrossCurrency && transferHasRate && transferConvertedAmount !== undefined"
        class="rounded-[16px] bg-[var(--tint-silk-20)] px-4 py-3"
      >
        <div
          class="font-outfit flex flex-wrap items-center gap-2 text-base font-bold text-[var(--color-text)]"
        >
          <span class="text-[var(--color-text-muted)]"
            >{{ t('transfer.youSend') }} {{ formatCurrencyWithCode(amount ?? 0, currency) }}</span
          >
          <span class="text-primary-500" aria-hidden="true">{{ '→' }}</span>
          <span
            >{{ t('transfer.theyReceive') }}
            {{ formatCurrencyWithCode(transferConvertedAmount, transferDestCurrency!) }}</span
          >
        </div>
        <p class="mt-1 text-xs text-[var(--color-text-muted)]">{{ t('transfer.convertedNote') }}</p>
      </div>

      <!-- No exchange rate — Heritage Orange (routine block), never Alert Red -->
      <div
        v-else-if="transferIsCrossCurrency && !transferHasRate"
        class="flex items-start gap-2.5 rounded-[16px] border border-orange-300/60 bg-[var(--tint-orange-8)] px-4 py-3"
      >
        <span aria-hidden="true">🧡</span>
        <span class="text-sm text-[var(--color-text)]">{{
          t('transfer.noRate')
            .replace('{from}', currency)
            .replace('{to}', transferDestCurrency ?? '')
        }}</span>
      </div>
    </template>

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
          class="font-outfit rounded-lg bg-white px-2.5 py-1 text-[0.6875rem] font-bold text-[var(--color-text)] shadow-sm transition-all hover:shadow-md dark:bg-slate-700 dark:text-gray-200"
          @click="selectQuickLink('activity')"
        >
          📋 {{ t('txLink.activity') }}
        </button>
        <button
          v-if="hasLinkableLoans"
          type="button"
          class="font-outfit rounded-lg bg-white px-2.5 py-1 text-[0.6875rem] font-bold text-[var(--color-text)] shadow-sm transition-all hover:shadow-md dark:bg-slate-700 dark:text-gray-200"
          @click="selectQuickLink('loan')"
        >
          🏦 {{ t('txLink.loan') }}
        </button>
        <button
          type="button"
          class="rounded-lg px-1.5 py-1 text-[0.6875rem] text-[var(--color-text-muted)] transition-colors hover:bg-gray-100 dark:hover:bg-slate-600"
          @click="dismissLinkPrompt"
        >
          ✕
        </button>
      </div>
    </div>

    <!-- 3. Description -->
    <FormFieldGroup :label="t('form.description')" :required="!isTransfer">
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
      <!-- Transfer: amount is in the source account's currency (locked). -->
      <AmountInput v-else-if="isTransfer" v-model="amount" :currency-symbol="currency" />
      <CurrencyAmountInput v-else v-model:amount="amount" v-model:currency="currency" />
    </FormFieldGroup>

    <!-- 5. Category chips (two-level drill-down; not applicable to transfers) -->
    <FormFieldGroup v-if="!isTransfer" :label="t('form.category')" required>
      <CategoryChipPicker v-model="category" :type="effectiveCategoryType" />
    </FormFieldGroup>

    <!-- 7. Recurring details -->
    <ConditionalSection :show="recurrenceMode === 'recurring' || isEditingRecurring">
      <div class="space-y-4">
        <!-- Linked (activity/loan fee) items keep a locked, read-only schedule -->
        <template v-if="hasActiveLink">
          <FormFieldGroup :label="t('modal.howOften')">
            <div
              class="flex items-center gap-2 rounded-[16px] bg-[var(--tint-slate-5)] px-4 py-3 dark:bg-slate-700"
            >
              <span class="font-outfit text-sm font-semibold text-[var(--color-text)]">{{
                lockedRecurrenceSummary
              }}</span>
              <span class="text-xs text-[var(--color-text-muted)]">🔒</span>
              <InfoHintBadge :text="t('txLink.hintFrequency')" />
            </div>
          </FormFieldGroup>
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
        </template>
        <!-- Editable: start date + the unified recurrence picker (#70) -->
        <template v-else>
          <BeanieDatePicker v-model="startDate" :label="t('form.startDate')" required />
          <FormFieldGroup :label="t('modal.howOften')">
            <RecurrencePicker v-model="rule" :start-date="startDate" accent="orange" />
          </FormFieldGroup>
        </template>
      </div>
    </ConditionalSection>

    <!-- 8. Date (for one-time) -->
    <ConditionalSection :show="recurrenceMode === 'one-time' && !isEditingRecurring">
      <div class="space-y-4">
        <FormFieldGroup :label="t('form.date')">
          <BeanieDatePicker v-model="date" required />
        </FormFieldGroup>
      </div>
    </ConditionalSection>

    <!-- 8a. Link Payment (outgoing only; not for transfers) -->
    <ConditionalSection :show="direction === 'out' && !isTransfer">
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

    <!-- 8b. Goal link (income only, after date/schedule section; not for transfers) -->
    <ConditionalSection :show="!isTransfer && direction === 'in' && goalItems.length > 0">
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
              →
              {{
                t('goalLink.allocPreview')
                  .replace(
                    '{amount}',
                    formatCurrencyWithCode(goalAllocPreview.amount, goalAllocPreview.currency)
                  )
                  .replace(
                    '{remaining}',
                    formatCurrencyWithCode(goalAllocPreview.remaining, goalAllocPreview.currency)
                  )
              }}
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
