<script setup lang="ts">
/**
 * One statement line WITHOUT a familiar match (#107): a plain add, or a line already added by
 * an earlier import. A matched line is a `StatementImportPairCard` instead; both take the same
 * candidate and emit the same events, so the list is one `v-for` with a component switch.
 *
 * Terse on purpose: a statement can run to hundreds of lines, so every row is one name, one raw
 * line, a few chips and the amount. The editor opens inline from the name.
 */
import { computed, ref } from 'vue';
import TickButton from '@/components/ui/TickButton.vue';
import AccountSelect from '@/components/ui/AccountSelect.vue';
import StatementLineEditor from '@/components/transactions/StatementLineEditor.vue';
import { useTranslation } from '@/composables/useTranslation';
import { useCategoryLabel } from '@/composables/useCategoryLabel';
import { useAccountOptionGroups } from '@/composables/useAccountOptionGroups';
import { formatCurrencyWithCode } from '@/composables/useCurrencyDisplay';
import { useAccountsStore } from '@/stores/accountsStore';
import { REVIEW_CHIP_TONES } from '@/constants/reviewChipTones';
import { fillTemplate } from '@/utils/fillTemplate';
import { formatDateShort } from '@/utils/date';
import type { CreateTransactionInput } from '@/types/models';
import { lineDirection } from '@/utils/statement/lineDirection';
import type { StatementCandidate, StatementDecision } from '@/utils/statement/planStatementImport';

const props = defineProps<{
  candidate: StatementCandidate;
  importAccountId: string;
  /** The original foreign amount, when the statement printed one (display only). */
  original?: { amount: number; currency: string };
  /** When an already-imported line was first added, for its chip. */
  alreadyOn?: string;
}>();

const emit = defineEmits<{
  decide: [decision: StatementDecision];
  edit: [patch: Partial<CreateTransactionInput>];
}>();

const { t } = useTranslation();
const { categoryLabel } = useCategoryLabel();
const { groupsFor } = useAccountOptionGroups();
const accountsStore = useAccountsStore();

const editing = ref(false);
const pickingPayer = ref(false);

const draft = computed(() => props.candidate.draft);
const selected = computed(() => props.candidate.decision !== 'skip');
/** Money into the family on this line: green, else Heritage Orange. */
const isIn = computed(() => lineDirection(draft.value, props.importAccountId) === 'in');
const name = computed(() => draft.value.description);

const otherAccountName = computed(() => {
  if (draft.value.type !== 'transfer') return '';
  const otherId = isIn.value ? draft.value.accountId : draft.value.toAccountId;
  return accountsStore.accounts.find((a) => a.id === otherId)?.name ?? '';
});

const payerGroups = computed(() =>
  groupsFor(accountsStore.activeAccounts.filter((a) => a.id !== props.importAccountId))
);

/** An already-added line can still be ticked on purpose, one at a time (never in bulk). */
function toggle(): void {
  emit('decide', selected.value ? 'skip' : 'add');
}

/** The "Paid from?" offer on a card payment: choosing the payer makes it one transfer. */
function choosePayer(id: string): void {
  pickingPayer.value = false;
  if (!id) return;
  emit('edit', {
    type: 'transfer',
    accountId: id,
    toAccountId: props.importAccountId,
    category: '',
  });
}
</script>

<template>
  <li
    class="rounded-2xl border px-3 py-2.5"
    :class="
      candidate.alreadyImported
        ? 'border-secondary-100 dark:border-line border-dashed bg-transparent'
        : 'border-secondary-50 dark:bg-surface-overlay dark:border-line bg-white'
    "
  >
    <div class="flex items-start gap-2.5">
      <TickButton
        class="mt-0.5"
        :selected="selected"
        :label="fillTemplate(t('statementImport.row.tick'), { name })"
        @toggle="toggle"
      />
      <div class="min-w-0 flex-1">
        <button
          type="button"
          class="block w-full min-w-0 text-left"
          :aria-expanded="editing"
          :aria-label="fillTemplate(t('statementImport.row.edit'), { name })"
          @click="editing = !editing"
        >
          <span
            class="font-outfit block truncate text-sm font-semibold"
            :class="
              candidate.alreadyImported
                ? 'text-secondary-400 dark:text-ink-faint'
                : 'text-secondary-500 dark:text-ink'
            "
            >{{ name }}</span
          >
          <span
            v-if="draft.statementDescription && draft.statementDescription !== name"
            class="text-secondary-400 dark:text-ink-faint block truncate text-xs"
            >{{ draft.statementDescription }}</span
          >
        </button>

        <div class="mt-1.5 flex flex-wrap items-center gap-1.5">
          <span
            v-if="candidate.alreadyImported"
            class="font-outfit rounded-full px-2 py-0.5 text-xs font-semibold"
            :class="REVIEW_CHIP_TONES.muted"
            >{{
              fillTemplate(t('statementImport.row.already'), {
                date: alreadyOn ? formatDateShort(alreadyOn) : '',
              })
            }}</span
          >
          <template v-else>
            <span
              v-if="draft.type === 'transfer'"
              class="font-outfit rounded-full px-2 py-0.5 text-xs font-semibold"
              :class="REVIEW_CHIP_TONES.silk"
              >{{
                fillTemplate(
                  t(isIn ? 'statementImport.row.transferFrom' : 'statementImport.row.transferTo'),
                  { account: otherAccountName }
                )
              }}</span
            >
            <button
              v-else-if="candidate.transfer?.kind === 'offer'"
              type="button"
              class="font-outfit rounded-full px-2 py-0.5 text-xs font-semibold"
              :class="REVIEW_CHIP_TONES.accent"
              :aria-expanded="pickingPayer"
              @click="pickingPayer = !pickingPayer"
            >
              {{ t('statementImport.row.offer') }} <span aria-hidden="true">▾</span>
            </button>
            <!-- The category chip opens the editor, where the family's own picker lives. -->
            <button
              v-if="draft.type !== 'transfer'"
              type="button"
              class="font-outfit rounded-full px-2 py-0.5 text-xs font-semibold"
              :class="REVIEW_CHIP_TONES.muted"
              @click="editing = true"
            >
              {{ categoryLabel(draft.category) }} <span aria-hidden="true">▾</span>
            </button>
          </template>
          <span
            v-if="original"
            class="font-outfit rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums"
            :class="REVIEW_CHIP_TONES.silk"
            >{{ formatCurrencyWithCode(original.amount, original.currency) }}</span
          >
        </div>

        <div v-if="pickingPayer" class="mt-2">
          <AccountSelect
            :model-value="undefined"
            :groups="payerGroups"
            :placeholder="t('statementImport.row.offer')"
            :aria-label="t('statementImport.row.offer')"
            @update:model-value="choosePayer"
          />
        </div>
      </div>

      <span
        class="font-outfit shrink-0 text-sm font-bold tabular-nums"
        :class="
          candidate.alreadyImported
            ? 'text-secondary-400 dark:text-ink-faint'
            : isIn
              ? 'dark:text-success-lift text-green-700'
              : 'text-primary-500 dark:text-accent-lift'
        "
        >{{ formatCurrencyWithCode(draft.amount, draft.currency) }}</span
      >
    </div>

    <div v-if="editing" class="border-secondary-50 dark:border-line mt-3 border-t pt-3">
      <StatementLineEditor
        :draft="draft"
        :import-account-id="importAccountId"
        @update="(patch) => emit('edit', patch)"
      />
    </div>
  </li>
</template>
