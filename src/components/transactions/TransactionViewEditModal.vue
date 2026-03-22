<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue';
import { useTranslation } from '@/composables/useTranslation';
import { confirm as showConfirm } from '@/composables/useConfirm';
import { useSounds } from '@/composables/useSounds';
import { useInlineEdit } from '@/composables/useInlineEdit';
import { useMemberInfo } from '@/composables/useMemberInfo';
import { useTransactionsStore } from '@/stores/transactionsStore';
import { useAccountsStore } from '@/stores/accountsStore';
import { useAssetsStore } from '@/stores/assetsStore';
import { useActivityStore } from '@/stores/activityStore';
import { useGoalsStore } from '@/stores/goalsStore';
import { findLoanDetails } from '@/utils/loanPayment';
import { getCategoryById, CATEGORY_EMOJI_MAP } from '@/constants/categories';
import { getCurrencyInfo } from '@/constants/currencies';
import { formatDate } from '@/utils/date';
import { useRecurringStore } from '@/stores/recurringStore';
import { formatFrequency } from '@/services/recurring/recurringProcessor';
import BeanieFormModal from '@/components/ui/BeanieFormModal.vue';
import InlineEditField from '@/components/ui/InlineEditField.vue';
import FormFieldGroup from '@/components/ui/FormFieldGroup.vue';
import CurrencyAmount from '@/components/common/CurrencyAmount.vue';
import AmountInput from '@/components/ui/AmountInput.vue';
import CategoryChipPicker from '@/components/ui/CategoryChipPicker.vue';
import AmortizationBreakdown from '@/components/ui/AmortizationBreakdown.vue';
import InfoHintBadge from '@/components/ui/InfoHintBadge.vue';
import BaseInput from '@/components/ui/BaseInput.vue';
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
const { playWhoosh } = useSounds();
const transactionsStore = useTransactionsStore();
const accountsStore = useAccountsStore();
const assetsStore = useAssetsStore();
const activityStore = useActivityStore();
const goalsStore = useGoalsStore();
const recurringStore = useRecurringStore();
const { getMemberNameByAccountId } = useMemberInfo();

// Live-lookup from store so display stays reactive after inline edits
const transaction = computed(() =>
  props.transaction
    ? (transactionsStore.transactions.find((t) => t.id === props.transaction!.id) ??
      props.transaction)
    : null
);

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
const categoryInfo = computed(() => {
  if (!transaction.value) return null;
  return getCategoryById(transaction.value.category);
});

const categoryEmoji = computed(() => {
  if (!transaction.value) return '';
  return CATEGORY_EMOJI_MAP[transaction.value.category] ?? '';
});

const accountName = computed(() => {
  if (!transaction.value) return '';
  const account = accountsStore.accounts.find((a) => a.id === transaction.value!.accountId);
  return account?.name ?? getMemberNameByAccountId(transaction.value.accountId);
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
      class: 'bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400',
    },
    expense: {
      label: t('transactions.type.expense'),
      class: 'bg-orange-50 text-orange-700 dark:bg-orange-900/20 dark:text-orange-400',
    },
    transfer: {
      label: t('transactions.type.transfer'),
      class: 'bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-400',
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

function handleDateKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter') {
    e.preventDefault();
    saveField('date');
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
    :show-delete="true"
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

      <!-- Description — inline editable -->
      <InlineEditField
        :editing="editingField === 'description'"
        tint-color="orange"
        @start-edit="startEdit('description')"
      >
        <template #view>
          <span class="font-outfit text-lg font-bold text-[var(--color-text)] dark:text-gray-100">
            {{ transaction.description }}
          </span>
        </template>
        <template #edit>
          <div class="flex items-center gap-2">
            <input
              ref="descriptionInputRef"
              v-model="draftDescription"
              type="text"
              class="font-outfit w-full rounded-md border-none bg-transparent px-1 text-lg font-bold text-[var(--color-text)] ring-2 ring-orange-500/30 outline-none dark:text-gray-100"
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
      <FormFieldGroup :label="t('form.amount')">
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

      <!-- Category — inline editable -->
      <FormFieldGroup :label="t('planner.field.category')">
        <InlineEditField
          :editing="editingField === 'category'"
          tint-color="orange"
          @start-edit="startEdit('category')"
        >
          <template #view>
            <span class="font-outfit text-sm font-semibold text-[var(--color-text)]">
              {{ categoryEmoji }} {{ categoryInfo?.name ?? transaction.category }}
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

      <!-- Date — inline editable (locked for recurring transactions) -->
      <FormFieldGroup :label="t('form.date')">
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
                <BaseInput
                  v-model="draftDate"
                  type="date"
                  class="rounded-[14px] ring-2 ring-orange-500/30"
                  @keydown="handleDateKeydown"
                />
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

      <!-- Account — read-only -->
      <FormFieldGroup :label="t('form.account')">
        <span class="text-sm text-[var(--color-text)] dark:text-gray-300">
          {{ accountName }}
        </span>
      </FormFieldGroup>

      <!-- Recurrence schedule — read-only -->
      <FormFieldGroup v-if="linkedRecurringItem" :label="t('transactions.filterRecurring')">
        <span
          class="font-outfit inline-flex items-center gap-1.5 rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-600 dark:bg-blue-900/20 dark:text-blue-400"
        >
          🔁 {{ formatFrequency(linkedRecurringItem) }}
        </span>
      </FormFieldGroup>

      <!-- Linked activity — clickable -->
      <FormFieldGroup v-if="linkedActivity" :label="t('planner.field.title')">
        <button
          type="button"
          class="group hover:text-primary-500 flex items-center gap-2 text-sm text-[var(--color-text)] transition-colors dark:text-gray-300"
          @click="emit('view-activity', linkedActivity.id)"
        >
          <span>{{ linkedActivity.icon }} {{ linkedActivity.title }}</span>
          <span
            class="text-xs text-[var(--color-text-muted)] opacity-0 transition-opacity group-hover:opacity-100"
            >&rarr; view</span
          >
        </button>
      </FormFieldGroup>

      <!-- Linked loan — clickable -->
      <FormFieldGroup v-if="linkedLoan" :label="t('txLink.linkedLoan')">
        <button
          type="button"
          class="group hover:text-primary-500 flex items-center gap-2 text-sm text-[var(--color-text)] transition-colors dark:text-gray-300"
          @click="emit('view-loan', transaction.loanId!)"
        >
          <span>{{ linkedLoan.type === 'asset' ? '🏠' : '🏦' }} {{ linkedLoan.name }}</span>
          <span
            class="text-xs text-[var(--color-text-muted)] opacity-0 transition-opacity group-hover:opacity-100"
            >&rarr; view</span
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
        <span class="text-sm text-[var(--color-text)] dark:text-gray-300">
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
        type="button"
        class="font-outfit flex-1 rounded-[16px] border border-gray-200 py-3.5 text-sm font-bold text-[var(--color-text)] transition-all duration-200 hover:bg-gray-50 dark:border-slate-600 dark:text-gray-200 dark:hover:bg-slate-700"
        @click="handleOpenEdit"
      >
        ✏️ {{ t('action.edit') }}
      </button>
    </template>
  </BeanieFormModal>
</template>
