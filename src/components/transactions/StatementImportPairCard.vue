<script setup lang="ts">
/**
 * A statement line that looks like something already in beanies (#107), as a PAIRED CARD
 * (mockup direction B): the statement line on the left, the existing entry on the right, the
 * amounts side by side, and merge / keep both / skip across the bottom. greg chose this over an
 * inline unfold because the two amounts are read at a glance and the copy stays short, which
 * matters on a list that can run to hundreds of lines.
 *
 * The card's tick IS its decision (skip = not imported), so it renders no tick button. It takes
 * the same candidate and emits the same events as `StatementImportRow`.
 *
 * A `possible` match (a likely duplicate below the familiar bar, or a row from an earlier import)
 * uses the same card with a dashed border and "Possibly already in beanies", and defaults to keep
 * both: it is there so a duplicate charge is seen, not decided for the person.
 */
import { computed, ref } from 'vue';
import TogglePillGroup from '@/components/ui/TogglePillGroup.vue';
import StatementLineEditor from '@/components/transactions/StatementLineEditor.vue';
import { useTranslation } from '@/composables/useTranslation';
import { useRecurrenceLabel } from '@/composables/useRecurrenceLabel';
import { formatCurrencyWithCode } from '@/composables/useCurrencyDisplay';
import { useAccountsStore } from '@/stores/accountsStore';
import { useRecurringStore } from '@/stores/recurringStore';
import { fillTemplate } from '@/utils/fillTemplate';
import { formatDateShort } from '@/utils/date';
import type { CreateTransactionInput } from '@/types/models';
import { lineDirection } from '@/utils/statement/lineDirection';
import type { StatementCandidate, StatementDecision } from '@/utils/statement/planStatementImport';

const props = defineProps<{
  candidate: StatementCandidate;
  importAccountId: string;
}>();

const emit = defineEmits<{
  decide: [decision: StatementDecision];
  edit: [patch: Partial<CreateTransactionInput>];
}>();

const { t } = useTranslation();
const { describeRecurringItem } = useRecurrenceLabel();
const accountsStore = useAccountsStore();
const recurringStore = useRecurringStore();

const editing = ref(false);
const draft = computed(() => props.candidate.draft);
const existing = computed(() => props.candidate.match!.existing);

/** "1 Sep · monthly" for a recurring entry, else the date (and account, for a counterpart). */
const existingMeta = computed(() => {
  const date = formatDateShort(existing.value.date);
  const item = existing.value.recurringItemId
    ? recurringStore.recurringItems.find((r) => r.id === existing.value.recurringItemId)
    : undefined;
  if (item) return `${date} · ${describeRecurringItem(item)}`;
  if (props.candidate.transfer?.kind === 'counterpart') {
    const other = accountsStore.accounts.find((a) => a.id === existing.value.accountId);
    return other ? `${date} · ${other.name}` : date;
  }
  return date;
});

const isIn = computed(() => lineDirection(draft.value, props.importAccountId) === 'in');
const isPossible = computed(() => props.candidate.match?.strength === 'possible');

const options = computed(() => [
  { value: 'merge', label: t('statementImport.pair.merge') },
  { value: 'add', label: t('statementImport.pair.keepBoth') },
  { value: 'skip', label: t('statementImport.pair.skip') },
]);

/** One line under the choices: what a merge does, or why a possible duplicate is shown. */
const why = computed(() => {
  if (props.candidate.decision === 'merge') {
    return props.candidate.transfer?.kind === 'counterpart'
      ? t('statementImport.pair.transferWhy')
      : t('statementImport.pair.mergeWhy');
  }
  if (!isPossible.value) return '';
  if (props.candidate.decision === 'add') return t('statementImport.pair.possibleWhy');
  // A strong match against an earlier import: the same line, read twice.
  return props.candidate.decision === 'skip' && props.candidate.match?.strong
    ? t('statementImport.pair.possibleSkipWhy')
    : '';
});
</script>

<template>
  <li
    class="border-primary-500 dark:border-accent-lift dark:bg-surface-overlay overflow-hidden rounded-2xl border bg-white"
    :class="{ 'border-dashed': isPossible }"
  >
    <div class="grid grid-cols-2 max-[20rem]:grid-cols-1">
      <!-- On your statement -->
      <button
        type="button"
        class="min-w-0 px-3 py-2.5 text-left"
        :aria-expanded="editing"
        :aria-label="fillTemplate(t('statementImport.row.edit'), { name: draft.description })"
        @click="editing = !editing"
      >
        <span
          class="font-outfit text-secondary-400 dark:text-ink-faint block text-xs font-semibold"
        >
          {{ t('statementImport.pair.statement') }}
        </span>
        <span
          class="font-outfit text-secondary-500 dark:text-ink mt-0.5 block truncate text-sm font-semibold"
          >{{ draft.description }}</span
        >
        <span class="text-secondary-400 dark:text-ink-soft block text-xs">{{
          formatDateShort(draft.date)
        }}</span>
        <span
          class="font-outfit mt-1 block text-base font-bold tabular-nums"
          :class="
            isIn
              ? 'dark:text-success-lift text-green-700'
              : 'text-primary-500 dark:text-accent-lift'
          "
          >{{ formatCurrencyWithCode(draft.amount, draft.currency) }}</span
        >
      </button>

      <!-- Already in beanies -->
      <div
        class="border-secondary-50 dark:bg-surface-hover dark:border-line min-w-0 border-l bg-[var(--tint-slate-5)] px-3 py-2.5 max-[20rem]:border-t max-[20rem]:border-l-0"
      >
        <span
          class="font-outfit text-secondary-400 dark:text-ink-faint block text-xs font-semibold"
        >
          {{ isPossible ? t('statementImport.pair.possible') : t('statementImport.pair.existing') }}
        </span>
        <span
          class="font-outfit text-secondary-500 dark:text-ink mt-0.5 block truncate text-sm font-semibold"
          >{{ existing.description }}</span
        >
        <span class="text-secondary-400 dark:text-ink-soft block truncate text-xs">{{
          existingMeta
        }}</span>
        <span
          class="font-outfit text-secondary-500 dark:text-ink mt-1 block text-base font-bold tabular-nums"
        >
          {{ formatCurrencyWithCode(existing.amount, existing.currency) }}
          <span
            v-if="candidate.match?.isProjected"
            class="font-inter text-secondary-400 dark:text-ink-faint text-xs font-normal"
            >{{ t('statementImport.pair.estimated') }}</span
          >
        </span>
      </div>
    </div>

    <div class="border-secondary-50 dark:border-line space-y-1.5 border-t px-2.5 pt-2 pb-2.5">
      <TogglePillGroup
        :model-value="candidate.decision"
        :options="options"
        @update:model-value="(value: string) => emit('decide', value as StatementDecision)"
      />
      <p v-if="why" class="text-secondary-400 dark:text-ink-soft px-0.5 text-xs">
        {{ why }}
      </p>
    </div>

    <div v-if="editing" class="border-secondary-50 dark:border-line border-t px-3 py-3">
      <StatementLineEditor
        :draft="draft"
        :import-account-id="importAccountId"
        @update="(patch) => emit('edit', patch)"
      />
    </div>
  </li>
</template>
