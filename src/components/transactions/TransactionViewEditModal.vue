<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue';
import { useTranslation } from '@/composables/useTranslation';
import { confirm as showConfirm } from '@/composables/useConfirm';
import { useSounds } from '@/composables/useSounds';
import { useInlineEdit } from '@/composables/useInlineEdit';
import { useMemberInfo } from '@/composables/useMemberInfo';
import { useAccountMemberInfo } from '@/composables/useAccountMemberInfo';
import { useTransactionsStore } from '@/stores/transactionsStore';
import { useAccountsStore } from '@/stores/accountsStore';
import { useAssetsStore } from '@/stores/assetsStore';
import { useActivityStore } from '@/stores/activityStore';
import { useGoalsStore } from '@/stores/goalsStore';
import { findLoanDetails } from '@/utils/loanPayment';
import { CATEGORY_EMOJI_MAP } from '@/constants/categories';
import { useCategoryLabel } from '@/composables/useCategoryLabel';
import { getCurrencyInfo } from '@/constants/currencies';
import { formatDate } from '@/utils/date';
import { useRecurringStore } from '@/stores/recurringStore';
import { useRecurrenceLabel } from '@/composables/useRecurrenceLabel';
import BeanieFormModal from '@/components/ui/BeanieFormModal.vue';
import InlineEditField from '@/components/ui/InlineEditField.vue';
import FormFieldGroup from '@/components/ui/FormFieldGroup.vue';
import CurrencyAmount from '@/components/common/CurrencyAmount.vue';
import AmountInput from '@/components/ui/AmountInput.vue';
import CategoryChipPicker from '@/components/ui/CategoryChipPicker.vue';
import AmortizationBreakdown from '@/components/ui/AmortizationBreakdown.vue';
import InfoHintBadge from '@/components/ui/InfoHintBadge.vue';
import BeanieDatePicker from '@/components/ui/BeanieDatePicker.vue';
import type { Transaction } from '@/types/models';

type EditableField = 'description' | 'amount' | 'category' | 'date';

const props = defineProps<{
  transaction: Transaction | null;
}>();

const emit = defineEmits<{
  close: [];
  deleted: [id: string];
  'open-edit': [transaction: Transaction];
  'view-activity': [activityId: string];
  'view-loan': [loanId: string];
}>();

const { t } = useTranslation();
const { describeRecurringItem } = useRecurrenceLabel();
const { categoryLabel } = useCategoryLabel();
const { playWhoosh } = useSounds();
const transactionsStore = useTransactionsStore();
const accountsStore = useAccountsStore();
const assetsStore = useAssetsStore();
const activityStore = useActivityStore();
const goalsStore = useGoalsStore();
const recurringStore = useRecurringStore();
const { getMemberNameByAccountId } = useAccountMemberInfo();
const { getMemberName } = useMemberInfo();

// Live-lookup from store so display stays reactive after inline edits
const transaction = computed(() =>
  props.transaction
    ? (transactionsStore.transactions.find((t) => t.id === props.transaction!.id) ??
      props.transaction)
    : null
);

/**
 * Whether this transaction exposes the standard view-then-edit affordances
 * (inline edits, Delete, Edit-drawer button). Balance-adjustment rows are an
 * audit-only record: editing them retroactively would introduce inconsistencies
 * with transactions layered on top of the adjusted balance, so all editing
 * affordances are suppressed. Users who want to correct the balance create a
 * new adjustment.
 */
const isEditable = computed(
  () => !!transaction.value && transaction.value.type !== 'balance_adjustment'
);

/** For balance_adjustment rows: pre-resolved author name for the ribbon. */
const adjustmentAuthorLabel = computed(() => {
  const tx = transaction.value;
  if (!tx || tx.type !== 'balance_adjustment' || !tx.adjustment?.updatedBy) return '';
  const name = getMemberName(tx.adjustment.updatedBy);
  return t('accountView.adjustedBy').replace('{name}', name);
});

/** For balance_adjustment rows: signed delta + coloring for CurrencyAmount. */
const adjustmentAmountDisplay = computed<{
  amount: number;
  type: 'income' | 'expense' | 'neutral';
}>(() => {
  const delta = transaction.value?.adjustment?.delta ?? 0;
  return {
    amount: Math.abs(delta),
    type: delta > 0 ? 'income' : delta < 0 ? 'expense' : 'neutral',
  };
});

// Draft refs
const draftDescription = ref('');
const draftAmount = ref<number | undefined>(undefined);
const draftCategory = ref('');
const draftDate = ref('');

// Template refs
const descriptionInputRef = ref<HTMLInputElement | null>(null);

const { editingField, startEdit, saveField, cancelEdit, saveAndClose } =
  useInlineEdit<EditableField>({
    populateDraft(field) {
      if (!transaction.value) return;
      switch (field) {
        case 'description':
          draftDescription.value = transaction.value.description;
          break;
        case 'amount':
          draftAmount.value = transaction.value.amount;
          break;
        case 'category':
          draftCategory.value = transaction.value.category;
          break;
        case 'date':
          draftDate.value = transaction.value.date?.split('T')[0] ?? '';
          break;
      }
      nextTick(() => {
        if (field === 'description') descriptionInputRef.value?.focus();
      });
    },
    async saveDraft(field) {
      if (!transaction.value) return;
      const update: Record<string, string | number | null> = {};
      let changed = false;

      switch (field) {
        case 'description': {
          const trimmed = draftDescription.value.trim();
          if (!trimmed) return;
          if (trimmed !== transaction.value.description) {
            update.description = trimmed;
            changed = true;
          }
          break;
        }
        case 'amount': {
          const val = draftAmount.value ?? 0;
          if (val > 0 && val !== transaction.value.amount) {
            update.amount = val;
            changed = true;
          }
          break;
        }
        case 'category': {
          if (draftCategory.value && draftCategory.value !== transaction.value.category) {
            update.category = draftCategory.value;
            changed = true;
          }
          break;
        }
        case 'date': {
          const val = draftDate.value || null;
          const cur = transaction.value.date?.split('T')[0] ?? null;
          if (val !== cur && val) {
            update.date = val;
            changed = true;
          }
          break;
        }
      }

      if (changed) {
        await transactionsStore.updateTransaction(transaction.value.id, update);
      }
    },
  });

// Reset when transaction changes
watch(
  () => props.transaction,
  () => {
    editingField.value = null;
  }
);

// Computed display values
const categoryEmoji = computed(() => {
  if (!transaction.value) return '';
  return CATEGORY_EMOJI_MAP[transaction.value.category] ?? '';
});

const accountName = computed(() => {
  if (!transaction.value) return '';
  const account = accountsStore.accounts.find((a) => a.id === transaction.value!.accountId);
  return account?.name ?? getMemberNameByAccountId(transaction.value.accountId);
});

// Transfer destination — orphan-safe (falls back if the account was deleted).
const isTransfer = computed(() => transaction.value?.type === 'transfer');
const toAccountName = computed(() => {
  const toId = transaction.value?.toAccountId;
  if (!toId) return '';
  return accountsStore.accounts.find((a) => a.id === toId)?.name ?? t('family.unknownAccount');
});

const linkedRecurringItem = computed(() => {
  if (!transaction.value?.recurringItemId) return null;
  return (
    recurringStore.recurringItems.find((r) => r.id === transaction.value!.recurringItemId) ?? null
  );
});

const linkedActivity = computed(() => {
  if (!transaction.value?.activityId) return null;
  return activityStore.activities.find((a) => a.id === transaction.value!.activityId);
});

const linkedGoal = computed(() => {
  if (!transaction.value?.goalId) return null;
  return goalsStore.goals.find((g) => g.id === transaction.value!.goalId);
});

const linkedLoan = computed(() => {
  if (!transaction.value?.loanId) return null;
  return findLoanDetails(transaction.value.loanId, assetsStore.assets, accountsStore.accounts);
});

const currSymbol = computed(() => {
  if (!transaction.value) return '$';
  return getCurrencyInfo(transaction.value.currency)?.symbol ?? '$';
});

const typeBadge = computed(() => {
  if (!transaction.value) return { label: '', class: '' };
  const map: Record<string, { label: string; class: string }> = {
    income: {
      label: t('transactions.type.income'),
      class: 'bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-success-lift',
    },
    expense: {
      label: t('transactions.type.expense'),
      class: 'bg-orange-50 text-orange-700 dark:bg-orange-900/20 dark:text-accent-lift',
    },
    transfer: {
      label: t('transactions.type.transfer'),
      class: 'bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-400',
    },
    balance_adjustment: {
      label: t('transactions.type.balance_adjustment'),
      class: 'bg-slate-50 text-slate-700 dark:bg-surface-ground/20 dark:text-ink-soft',
    },
  };
  return map[transaction.value.type] ?? { label: transaction.value.type, class: '' };
});

// Keyboard handlers
function handleDescriptionKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter') {
    e.preventDefault();
    saveField('description');
  } else if (e.key === 'Escape') cancelEdit();
}

// Auto-save for category picker
function handleCategoryChange(value: string) {
  draftCategory.value = value;
  saveField('category');
}

function handleClose() {
  saveAndClose();
  emit('close');
}

function handleDone() {
  saveAndClose();
  emit('close');
}

function handleOpenEdit() {
  if (transaction.value) {
    saveAndClose();
    emit('open-edit', transaction.value);
  }
}

async function handleDelete() {
  if (!transaction.value) return;
  const id = transaction.value.id;
  emit('close');
  if (
    await showConfirm({
      title: 'confirm.deleteTransactionTitle',
      message: 'transactions.deleteConfirm',
      variant: 'danger',
    })
  ) {
    if (await transactionsStore.deleteTransaction(id)) {
      playWhoosh();
      emit('deleted', id);
    }
  }
}
</script>

<template>
  <BeanieFormModal
    v-if="transaction"
    variant="drawer"
    :open="true"
    :title="t('transactions.viewTransaction')"
    :icon="categoryEmoji || '💰'"
    icon-bg="var(--tint-slate-5)"
    size="narrow"
    :save-label="t('action.close')"
    save-gradient="orange"
    :show-delete="isEditable"
    @close="handleClose"
    @save="handleDone"
    @delete="handleDelete"
  >
    <div class="space-y-3">
      <!-- Type badge -->
      <span
        class="font-outfit inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold"
        :class="typeBadge.class"
      >
        {{ typeBadge.label }}
      </span>

      <!-- Schedule summary box -->
      <div class="dark:bg-surface-overlay rounded-[14px] bg-[var(--tint-slate-5)] px-4 py-3">
        <div class="space-y-1.5">
          <template v-if="linkedRecurringItem">
            <div class="flex items-center gap-2">
              <span class="text-xs font-medium text-[var(--color-text-muted)] uppercase">
                {{ t('planner.field.recurrence') }}
              </span>
              <span
                class="font-outfit dark:text-ink text-sm font-semibold text-[var(--color-text)]"
              >
                {{ describeRecurringItem(linkedRecurringItem) }}
              </span>
            </div>
            <div v-if="linkedRecurringItem.startDate" class="flex items-center gap-2">
              <span class="text-xs font-medium text-[var(--color-text-muted)] uppercase">
                {{ t('form.startDate') }}
              </span>
              <span
                class="font-outfit dark:text-ink text-sm font-semibold text-[var(--color-text)]"
              >
                {{ formatDate(linkedRecurringItem.startDate) }}
              </span>
            </div>
            <div v-if="linkedRecurringItem.endDate" class="flex items-center gap-2">
              <span class="text-xs font-medium text-[var(--color-text-muted)] uppercase">
                {{ t('planner.field.endDate') }}
              </span>
              <span
                class="font-outfit dark:text-ink text-sm font-semibold text-[var(--color-text)]"
              >
                {{ formatDate(linkedRecurringItem.endDate) }}
              </span>
            </div>
          </template>
          <template v-else>
            <div class="flex items-center gap-2">
              <span class="text-xs font-medium text-[var(--color-text-muted)] uppercase">
                {{ t('form.date') }}
              </span>
              <span
                class="font-outfit dark:text-ink text-sm font-semibold text-[var(--color-text)]"
              >
                {{ formatDate(transaction.date) }}
              </span>
            </div>
          </template>
        </div>
      </div>

      <!-- Balance-adjustment ribbon: signed delta + author line (read-only).
           Shown in place of the inline editable fields below for audit rows. -->
      <div
        v-if="!isEditable"
        class="dark:bg-surface-overlay space-y-1.5 rounded-[14px] bg-[var(--tint-slate-5)] px-4 py-3"
      >
        <div class="font-outfit text-2xl font-extrabold">
          <CurrencyAmount
            :amount="adjustmentAmountDisplay.amount"
            :currency="transaction.currency"
            :type="adjustmentAmountDisplay.type"
            size="xl"
          />
        </div>
        <p class="font-outfit text-sm text-[var(--color-text-muted)]">
          {{ adjustmentAuthorLabel }}
        </p>
      </div>

      <!-- Description — inline editable -->
      <InlineEditField
        v-if="isEditable"
        :editing="editingField === 'description'"
        tint-color="orange"
        @start-edit="startEdit('description')"
      >
        <template #view>
          <span class="font-outfit dark:text-ink text-lg font-bold text-[var(--color-text)]">
            {{ transaction.description }}
          </span>
        </template>
        <template #edit>
          <div class="flex items-center gap-2">
            <input
              ref="descriptionInputRef"
              v-model="draftDescription"
              type="text"
              class="font-outfit dark:text-ink w-full rounded-md border-none bg-transparent px-1 text-lg font-bold text-[var(--color-text)] ring-2 ring-orange-500/30 outline-none"
              @keydown="handleDescriptionKeydown"
            />
            <button
              class="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-orange-600 transition-colors hover:bg-orange-100 dark:hover:bg-orange-900/30"
              @click.stop="saveField('description')"
            >
              <svg
                class="h-4 w-4"
                fill="none"
                stroke="currentColor"
                stroke-width="2.5"
                viewBox="0 0 24 24"
              >
                <path d="M5 13l4 4L19 7" />
              </svg>
            </button>
          </div>
        </template>
      </InlineEditField>

      <!-- Amount — inline editable (locked for linked recurring transactions) -->
      <FormFieldGroup v-if="isEditable" :label="t('form.amount')">
        <InlineEditField
          :editing="editingField === 'amount'"
          :disabled="
            !!(transaction.recurringItemId && (transaction.loanId || transaction.activityId))
          "
          tint-color="orange"
          @start-edit="startEdit('amount')"
        >
          <template #view>
            <CurrencyAmount
              :amount="transaction.amount"
              :currency="transaction.currency"
              :type="
                transaction.type === 'income'
                  ? 'income'
                  : transaction.type === 'expense'
                    ? 'expense'
                    : 'neutral'
              "
              size="lg"
            />
          </template>
          <template #edit>
            <div class="flex items-center gap-2">
              <div class="flex-1">
                <AmountInput
                  v-model="draftAmount"
                  :currency-symbol="currSymbol"
                  font-size="1.2rem"
                />
              </div>
              <button
                class="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-orange-600 transition-colors hover:bg-orange-100 dark:hover:bg-orange-900/30"
                @click.stop="saveField('amount')"
              >
                <svg
                  class="h-4 w-4"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2.5"
                  viewBox="0 0 24 24"
                >
                  <path d="M5 13l4 4L19 7" />
                </svg>
              </button>
            </div>
          </template>
        </InlineEditField>
      </FormFieldGroup>

      <!-- Category — inline editable (transfers have no category) -->
      <FormFieldGroup v-if="isEditable && !isTransfer" :label="t('planner.field.category')">
        <InlineEditField
          :editing="editingField === 'category'"
          tint-color="orange"
          @start-edit="startEdit('category')"
        >
          <template #view>
            <span class="font-outfit text-sm font-semibold text-[var(--color-text)]">
              {{ categoryEmoji }} {{ categoryLabel(transaction.category) }}
            </span>
          </template>
          <template #edit>
            <CategoryChipPicker
              :model-value="draftCategory"
              :type="transaction.type === 'income' ? 'income' : 'expense'"
              @update:model-value="handleCategoryChange"
            />
          </template>
        </InlineEditField>
      </FormFieldGroup>

      <!-- Date — inline editable (locked for recurring transactions).
           For balance_adjustment, the date is displayed read-only in the
           Schedule summary box above; skip the inline editor. -->
      <FormFieldGroup v-if="isEditable" :label="t('form.date')">
        <InlineEditField
          :editing="editingField === 'date'"
          :disabled="!!transaction.recurringItemId"
          tint-color="orange"
          @start-edit="startEdit('date')"
        >
          <template #view>
            <div class="flex items-center gap-2">
              <span class="font-outfit text-sm font-semibold text-[var(--color-text)]">
                {{ formatDate(transaction.date) }}
              </span>
              <span
                v-if="transaction.recurringItemId"
                class="text-xs text-[var(--color-text-muted)]"
                >🔒</span
              >
              <InfoHintBadge v-if="transaction.recurringItemId" :text="t('txLink.hintDateView')" />
            </div>
          </template>
          <template #edit>
            <div class="flex items-center gap-2">
              <div class="flex-1">
                <BeanieDatePicker v-model="draftDate" />
              </div>
              <button
                class="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-orange-600 transition-colors hover:bg-orange-100 dark:hover:bg-orange-900/30"
                @click.stop="saveField('date')"
              >
                <svg
                  class="h-4 w-4"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2.5"
                  viewBox="0 0 24 24"
                >
                  <path d="M5 13l4 4L19 7" />
                </svg>
              </button>
            </div>
          </template>
        </InlineEditField>
      </FormFieldGroup>

      <!-- Account — read-only ("From" + "To" for transfers) -->
      <FormFieldGroup :label="isTransfer ? t('transfer.from') : t('form.account')">
        <span class="dark:text-ink-soft text-sm text-[var(--color-text)]">
          {{ accountName }}
        </span>
      </FormFieldGroup>
      <FormFieldGroup v-if="isTransfer" :label="t('transfer.to')">
        <span class="dark:text-ink-soft text-sm text-[var(--color-text)]">
          {{ toAccountName }}
        </span>
      </FormFieldGroup>

      <!-- Linked activity — clickable -->
      <FormFieldGroup v-if="linkedActivity" :label="t('planner.field.title')">
        <button
          type="button"
          class="group hover:text-primary-500 dark:text-ink-soft flex items-center gap-2 text-sm text-[var(--color-text)] transition-colors"
          @click="emit('view-activity', linkedActivity.id)"
        >
          <span>{{ linkedActivity.icon }} {{ linkedActivity.title }}</span>
          <span
            class="text-xs text-[var(--color-text-muted)] opacity-0 transition-opacity group-hover:opacity-100"
            >&rarr; {{ t('action.view') }}</span
          >
        </button>
      </FormFieldGroup>

      <!-- Linked loan — clickable -->
      <FormFieldGroup v-if="linkedLoan" :label="t('txLink.linkedLoan')">
        <button
          type="button"
          class="group hover:text-primary-500 dark:text-ink-soft flex items-center gap-2 text-sm text-[var(--color-text)] transition-colors"
          @click="emit('view-loan', transaction.loanId!)"
        >
          <span>{{ linkedLoan.type === 'asset' ? '🏠' : '🏦' }} {{ linkedLoan.name }}</span>
          <span
            class="text-xs text-[var(--color-text-muted)] opacity-0 transition-opacity group-hover:opacity-100"
            >&rarr; {{ t('action.view') }}</span
          >
        </button>
      </FormFieldGroup>
      <AmortizationBreakdown
        v-if="linkedLoan && transaction.loanInterestPortion != null"
        :interest="transaction.loanInterestPortion"
        :principal="transaction.loanPrincipalPortion ?? 0"
        :remaining="linkedLoan.outstandingBalance"
        :currency="transaction.currency"
      />

      <!-- Linked goal — read-only -->
      <FormFieldGroup v-if="linkedGoal" :label="t('goals.title')">
        <span class="dark:text-ink-soft text-sm text-[var(--color-text)]">
          {{ linkedGoal.name }}
          <span v-if="transaction.goalAllocApplied" class="text-[var(--color-text-muted)]">
            &middot; {{ currSymbol }}{{ transaction.goalAllocApplied.toLocaleString() }}
          </span>
        </span>
      </FormFieldGroup>

      <!-- Reconciled badge -->
      <FormFieldGroup v-if="transaction.isReconciled" :label="t('transactions.status')">
        <span
          class="font-outfit inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold text-green-700"
          style="background: var(--tint-success-10)"
        >
          ✓ {{ t('transactions.reconciled') }}
        </span>
      </FormFieldGroup>
    </div>

    <template #footer-start>
      <button
        v-if="isEditable"
        type="button"
        class="font-outfit dark:border-line-strong dark:text-ink dark:hover:bg-surface-hover flex-1 rounded-[16px] border border-gray-200 py-3.5 text-sm font-bold text-[var(--color-text)] transition-all duration-200 hover:bg-gray-50"
        @click="handleOpenEdit"
      >
        ✏️ {{ t('action.edit') }}
      </button>
    </template>
  </BeanieFormModal>
</template>
