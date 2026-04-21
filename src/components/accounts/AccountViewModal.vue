<script setup lang="ts">
/**
 * Read-only drawer view for an Account. Shows identity + balance in the
 * header and a filtered, date-grouped activity log derived entirely from
 * `transactionsStore.transactionsForAccount(id)`. No per-transaction edit
 * logic lives here — row clicks navigate to `/transactions?view=<id>`
 * where the existing `TransactionViewEditModal` handles inspection.
 *
 * The activity section is delegated to `<EntityActivityLog>` — a shared
 * renderer also used by `GoalViewModal`. This component owns the filter
 * bucket rule + signed-amount + transfer-perspective logic (all
 * account-specific); the shared component handles grouping, chips, empty
 * state, and rendering.
 *
 * Primary save button is repurposed as "Edit" (emits `open-edit`) so the
 * parent can open the existing `AccountModal` in edit mode.
 */
import { computed, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import BeanieFormModal from '@/components/ui/BeanieFormModal.vue';
import CurrencyAmount from '@/components/common/CurrencyAmount.vue';
import EntityActivityLog, {
  type ActivityEntry,
  type ActivityFilterDef,
} from '@/components/common/EntityActivityLog.vue';
import { useAccountsStore } from '@/stores/accountsStore';
import { useFamilyStore } from '@/stores/familyStore';
import { useTransactionsStore } from '@/stores/transactionsStore';
import { useRecurringStore } from '@/stores/recurringStore';
import { useMemberInfo } from '@/composables/useMemberInfo';
import { useTranslation } from '@/composables/useTranslation';
import { showToast } from '@/composables/useToast';
import { getTransactionSubtitle } from '@/utils/transactionLabel';
import type { Account, Transaction } from '@/types/models';

type ActivityFilter = 'all' | 'manual' | 'recurring' | 'loans' | 'goals' | 'transfers';

const props = defineProps<{
  open: boolean;
  account: Account | null;
}>();

const emit = defineEmits<{
  close: [];
  'open-edit': [account: Account];
}>();

const router = useRouter();
const { t } = useTranslation();
const accountsStore = useAccountsStore();
const familyStore = useFamilyStore();
const transactionsStore = useTransactionsStore();
const recurringStore = useRecurringStore();
const { getMemberName } = useMemberInfo();

const VISIBLE_CAP = 20;
const activeFilter = ref<ActivityFilter>('all');

const FILTERS: ActivityFilterDef<ActivityFilter>[] = [
  { id: 'all', labelKey: 'accountView.filter.all', emoji: '📋' },
  { id: 'manual', labelKey: 'accountView.filter.manual', emoji: '✋' },
  { id: 'recurring', labelKey: 'accountView.filter.recurring', emoji: '🔁' },
  { id: 'loans', labelKey: 'accountView.filter.loans', emoji: '🏦' },
  { id: 'goals', labelKey: 'accountView.filter.goals', emoji: '🎯' },
  { id: 'transfers', labelKey: 'accountView.filter.transfers', emoji: '⇄' },
];

/**
 * Classify a transaction into exactly one filter bucket using
 * most-specific-wins priority. Kept here (rather than in the shared
 * component) because it drives filter visibility, not display.
 */
function bucketFor(tx: Transaction): Exclude<ActivityFilter, 'all'> | 'other' {
  if (tx.type === 'balance_adjustment') return 'manual';
  if (tx.loanId || tx.loanInterestPortion != null || tx.loanPrincipalPortion != null)
    return 'loans';
  if (tx.goalId) return 'goals';
  if (tx.recurringItemId) return 'recurring';
  if (tx.type === 'transfer') return 'transfers';
  return 'other';
}

const allTransactions = computed<Transaction[]>(() => {
  if (!props.account) return [];
  return transactionsStore.transactionsForAccount(props.account.id);
});

const filtered = computed<Transaction[]>(() => {
  if (activeFilter.value === 'all') return allTransactions.value;
  return allTransactions.value.filter((tx) => bucketFor(tx) === activeFilter.value);
});

/** Resolve display names once per row so the pure subtitle helper stays store-free. */
function resolvedFor(tx: Transaction) {
  const authorName = tx.adjustment?.updatedBy ? getMemberName(tx.adjustment.updatedBy) : undefined;
  const recurringItemName = tx.recurringItemId
    ? recurringStore.getRecurringItemById?.(tx.recurringItemId)?.description
    : undefined;
  let transferCounterpartyName: string | undefined;
  if (tx.type === 'transfer' && props.account) {
    const counterId = tx.accountId === props.account.id ? tx.toAccountId : tx.accountId;
    if (counterId) {
      transferCounterpartyName = accountsStore.accounts.find((a) => a.id === counterId)?.name;
    }
  }
  return { authorName, recurringItemName, transferCounterpartyName };
}

function subtitleFor(tx: Transaction): string {
  return getTransactionSubtitle(
    tx,
    {
      t,
      currentMemberId: familyStore.currentMember?.id,
      ...resolvedFor(tx),
    },
    props.account?.id
  );
}

/**
 * For a row rendered in this account's log, compute the signed delta to
 * show. Balance adjustments carry an explicit signed delta. Income credits.
 * Expenses debit. Transfers flip sign by vantage account.
 */
function signedAmountFor(tx: Transaction): {
  amount: number;
  type: 'income' | 'expense' | 'neutral';
} {
  if (tx.type === 'balance_adjustment') {
    const delta = tx.adjustment?.delta ?? 0;
    return {
      amount: Math.abs(delta),
      type: delta > 0 ? 'income' : delta < 0 ? 'expense' : 'neutral',
    };
  }
  if (tx.type === 'income') return { amount: tx.amount, type: 'income' };
  if (tx.type === 'expense') return { amount: tx.amount, type: 'expense' };
  // Transfer — direction depends on perspective
  const isSource = props.account ? tx.accountId === props.account.id : true;
  return { amount: tx.amount, type: isSource ? 'expense' : 'income' };
}

const entries = computed<ActivityEntry[]>(() =>
  filtered.value.map((tx) => {
    const { amount, type } = signedAmountFor(tx);
    return {
      id: tx.id,
      date: tx.date,
      title: tx.description,
      subtitle: subtitleFor(tx),
      amount,
      currency: tx.currency,
      direction: type,
      onClick: () => onRowClick(tx),
    };
  })
);

function onRowClick(tx: Transaction) {
  router.push({ path: '/transactions', query: { view: tx.id } });
  emit('close');
}

function onViewAll() {
  if (!props.account) return;
  router.push({ path: '/transactions', query: { account: props.account.id } });
  emit('close');
}

function onEdit() {
  if (props.account) emit('open-edit', props.account);
}

/**
 * Reactive guard: if the modal is open and the account prop suddenly
 * becomes null (e.g. deleted from another device, merged via CRDT),
 * surface a toast + auto-close. No silent disappearance.
 */
watch(
  () => props.account,
  (next, prev) => {
    if (props.open && prev && !next) {
      console.warn('[AccountViewModal] account disappeared while drawer was open:', prev.id);
      showToast('error', t('accountView.notFound'));
      emit('close');
    }
  }
);
</script>

<template>
  <BeanieFormModal
    :open="open && !!account"
    variant="drawer"
    size="wide"
    :title="account?.name ?? ''"
    icon="💰"
    :save-label="t('action.edit')"
    save-gradient="orange"
    @close="emit('close')"
    @save="onEdit"
  >
    <template v-if="account">
      <!-- Header: institution + balance -->
      <div class="space-y-2">
        <p
          v-if="account.institution"
          class="font-outfit text-sm text-[#2C3E50]/70 dark:text-gray-300"
        >
          {{ account.institution }}
        </p>
        <div>
          <p
            class="font-outfit mb-1 text-xs tracking-[0.08em] text-[#2C3E50]/50 uppercase dark:text-gray-500"
          >
            {{ t('accounts.currentBalance') }}
          </p>
          <div class="font-outfit text-3xl font-extrabold">
            <CurrencyAmount
              :amount="account.balance"
              :currency="account.currency"
              type="neutral"
              size="xl"
            />
          </div>
        </div>
      </div>

      <!-- Activity section (shared renderer) -->
      <div class="space-y-3">
        <h3
          class="font-outfit text-xs font-semibold tracking-[0.08em] text-[#2C3E50]/50 uppercase dark:text-gray-500"
        >
          {{ t('accountView.activity') }}
        </h3>
        <EntityActivityLog
          :entries="entries"
          :empty-state-text="t('accountView.noActivity')"
          :filters="FILTERS"
          :active-filter-id="activeFilter"
          :visible-cap="VISIBLE_CAP"
          :view-all-text="t('accountView.viewAll')"
          show-view-all
          @filter-select="activeFilter = $event"
          @view-all="onViewAll"
        />
      </div>
    </template>

    <!-- Close button paired with the primary Edit save button.
         Mirrors the Cancel/Save pairing convention used by other view-edit
         drawers (MedicationViewModal, ActivityViewEditModal). -->
    <template #footer-start>
      <button
        type="button"
        class="font-outfit flex-1 rounded-[16px] border border-gray-200 py-3.5 text-sm font-bold text-[var(--color-text)] transition-all duration-300 hover:bg-gray-50 dark:border-slate-600 dark:text-gray-200 dark:hover:bg-slate-700"
        @click="emit('close')"
      >
        {{ t('action.close') }}
      </button>
    </template>
  </BeanieFormModal>
</template>
