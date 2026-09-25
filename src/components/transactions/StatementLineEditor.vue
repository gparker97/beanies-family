<script setup lang="ts">
/**
 * The inline editor for one statement line (#107), written ONCE and opened from both a plain row
 * and a paired card. It edits the candidate's DRAFT only; nothing is written until the review is
 * confirmed. Built from the same five primitives the quick-add modal uses, so a line reads and
 * edits like any other transaction.
 *
 * A transfer is only ever emitted with its other account in the same patch (the store refuses a
 * half-transfer), so choosing "Transfer" shows the account picker and waits for a pick.
 */
import { computed, ref } from 'vue';
import FormFieldGroup from '@/components/ui/FormFieldGroup.vue';
import TogglePillGroup from '@/components/ui/TogglePillGroup.vue';
import AmountInput from '@/components/ui/AmountInput.vue';
import BeanieDatePicker from '@/components/ui/BeanieDatePicker.vue';
import CategoryChipPicker from '@/components/ui/CategoryChipPicker.vue';
import AccountSelect from '@/components/ui/AccountSelect.vue';
import { useTranslation } from '@/composables/useTranslation';
import { useAccountOptionGroups } from '@/composables/useAccountOptionGroups';
import { useAccountsStore } from '@/stores/accountsStore';
import { getCategoriesByType } from '@/constants/categories';
import { getCurrencyInfo } from '@/constants/currencies';
import type { CreateTransactionInput } from '@/types/models';
import { lineDirection } from '@/utils/statement/lineDirection';

const props = defineProps<{
  draft: CreateTransactionInput;
  /** The import's header account: where the statement's money moved. */
  importAccountId: string;
}>();

const emit = defineEmits<{ update: [patch: Partial<CreateTransactionInput>] }>();

const { t } = useTranslation();
const accountsStore = useAccountsStore();
const { groupsFor } = useAccountOptionGroups();

type Mode = 'in' | 'out' | 'transfer';

/** Which way the money moved on the statement, whatever the draft has become since. */
const direction = computed(() => lineDirection(props.draft, props.importAccountId));

const mode = computed<Mode>(() => (props.draft.type === 'transfer' ? 'transfer' : direction.value));
/** The pill the person tapped, while a transfer still waits for its account. */
const pendingTransfer = ref(false);
const shownMode = computed<Mode>(() => (pendingTransfer.value ? 'transfer' : mode.value));

const modeOptions = computed(() => [
  { value: 'in', label: t('statementImport.editor.in'), variant: 'green' as const },
  { value: 'out', label: t('statementImport.editor.out'), variant: 'orange' as const },
  { value: 'transfer', label: t('statementImport.editor.transfer') },
]);

const categoryType = computed<'income' | 'expense'>(() =>
  direction.value === 'in' ? 'income' : 'expense'
);

/** A category valid for the new direction: keep the current one if it fits, else the fallback. */
function categoryFor(type: 'income' | 'expense'): string {
  const current = props.draft.category;
  if (getCategoriesByType(type).some((c) => c.id === current)) return current;
  return type === 'income' ? 'other_income' : 'other_expense';
}

function setMode(next: string): void {
  if (next === 'transfer') {
    pendingTransfer.value = props.draft.type !== 'transfer';
    return;
  }
  pendingTransfer.value = false;
  const type = next === 'in' ? 'income' : 'expense';
  emit('update', { type, accountId: props.importAccountId, category: categoryFor(type) });
}

/** The account on the OTHER side of a transfer. */
const otherAccountId = computed(() =>
  props.draft.type !== 'transfer'
    ? undefined
    : direction.value === 'in'
      ? props.draft.accountId
      : props.draft.toAccountId
);

function setOtherAccount(id: string): void {
  if (!id) return;
  pendingTransfer.value = false;
  emit(
    'update',
    direction.value === 'in'
      ? { type: 'transfer', accountId: id, toAccountId: props.importAccountId, category: '' }
      : { type: 'transfer', accountId: props.importAccountId, toAccountId: id, category: '' }
  );
}

const otherAccountGroups = computed(() =>
  groupsFor(accountsStore.activeAccounts.filter((a) => a.id !== props.importAccountId))
);
const writeAccountGroups = computed(() => groupsFor(accountsStore.activeAccounts));
const currencySymbol = computed(
  () => getCurrencyInfo(props.draft.currency)?.symbol ?? props.draft.currency
);
</script>

<template>
  <div class="space-y-4">
    <TogglePillGroup
      :model-value="shownMode"
      :options="modeOptions"
      @update:model-value="setMode"
    />

    <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <FormFieldGroup :label="t('form.date')">
        <BeanieDatePicker
          :model-value="draft.date"
          @update:model-value="(date: string) => emit('update', { date })"
        />
      </FormFieldGroup>
      <FormFieldGroup :label="t('form.amount')">
        <AmountInput
          :model-value="draft.amount"
          :currency-symbol="currencySymbol"
          @update:model-value="
            (amount: number | undefined) => amount !== undefined && emit('update', { amount })
          "
        />
      </FormFieldGroup>
    </div>

    <FormFieldGroup
      v-if="shownMode === 'transfer'"
      :label="
        direction === 'in'
          ? t('statementImport.editor.transferFrom')
          : t('statementImport.editor.transferTo')
      "
    >
      <AccountSelect
        :model-value="otherAccountId"
        :groups="otherAccountGroups"
        :aria-label="
          direction === 'in'
            ? t('statementImport.editor.transferFrom')
            : t('statementImport.editor.transferTo')
        "
        @update:model-value="setOtherAccount"
      />
    </FormFieldGroup>

    <template v-else>
      <FormFieldGroup :label="t('form.category')">
        <CategoryChipPicker
          :model-value="draft.category"
          :type="categoryType"
          @update:model-value="(category: string) => emit('update', { category })"
        />
      </FormFieldGroup>
      <FormFieldGroup :label="t('form.account')">
        <AccountSelect
          :model-value="draft.accountId"
          :groups="writeAccountGroups"
          :aria-label="t('form.account')"
          @update:model-value="(accountId: string) => emit('update', { accountId })"
        />
      </FormFieldGroup>
    </template>
  </div>
</template>
