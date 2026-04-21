<script setup lang="ts">
/**
 * Read-only drawer view for an Account. Shows identity + balance in the
 * header and a filtered, date-grouped activity log derived entirely from
 * `transactionsStore.transactionsForAccount(id)`. No per-transaction edit
 * logic lives here — row clicks navigate to `/transactions?view=<id>`
 * where the existing `TransactionViewEditModal` handles inspection.
 *
 * Primary save button is repurposed as "Edit" (emits `open-edit`) so the
 * parent can open the existing `AccountModal` in edit mode.
 */
import { computed, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import BeanieFormModal from '@/components/ui/BeanieFormModal.vue';
import CurrencyAmount from '@/components/common/CurrencyAmount.vue';
import { useAccountsStore } from '@/stores/accountsStore';
import { useFamilyStore } from '@/stores/familyStore';
import { useTransactionsStore } from '@/stores/transactionsStore';
import { useRecurringStore } from '@/stores/recurringStore';
import { useMemberInfo } from '@/composables/useMemberInfo';
import { useTranslation } from '@/composables/useTranslation';
import type { UIStringKey } from '@/services/translation/uiStrings';
import { showToast } from '@/composables/useToast';
import { getTransactionSubtitle } from '@/utils/transactionLabel';
import { groupByDate } from '@/utils/groupByDate';
import { toDateInputValue, formatNookDate } from '@/utils/date';
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

const FILTERS: ReadonlyArray<{ id: ActivityFilter; labelKey: UIStringKey; emoji: string }> = [
  { id: 'all', labelKey: 'accountView.filter.all', emoji: '📋' },
  { id: 'manual', labelKey: 'accountView.filter.manual', emoji: '✋' },
  { id: 'recurring', labelKey: 'accountView.filter.recurring', emoji: '🔁' },
  { id: 'loans', labelKey: 'accountView.filter.loans', emoji: '🏦' },
  { id: 'goals', labelKey: 'accountView.filter.goals', emoji: '🎯' },
  { id: 'transfers', labelKey: 'accountView.filter.transfers', emoji: '⇄' },
];

/**
 * Classify a transaction into exactly one filter bucket using
 * most-specific-wins priority. Kept here (rather than in the subtitle
 * helper) because it drives filter visibility, not display text.
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

const visible = computed<Transaction[]>(() => filtered.value.slice(0, VISIBLE_CAP));
const hasMore = computed(() => filtered.value.length > VISIBLE_CAP);

/** Friendly date label used in the activity log group headers. */
function dateLabel(dateStr: string): string {
  const today = toDateInputValue(new Date());
  if (dateStr === today) return t('date.today');
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (dateStr === toDateInputValue(tomorrow)) return t('date.tomorrow');
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  if (dateStr === toDateInputValue(yesterday)) return t('date.yesterday');
  return formatNookDate(dateStr);
}

const grouped = computed(() => groupByDate(visible.value, (tx) => tx.date, dateLabel));

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
 * show. Balance adjustments carry an explicit signed delta. Income credits
 * the account. Expenses debit. Transfers: debit the source, credit the
 * destination (perspective flips based on which side of the transfer this
 * account is on).
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
    size="narrow"
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

      <!-- Activity section -->
      <div class="space-y-3">
        <h3
          class="font-outfit text-xs font-semibold tracking-[0.08em] text-[#2C3E50]/50 uppercase dark:text-gray-500"
        >
          {{ t('accountView.activity') }}
        </h3>

        <!-- Filter chips -->
        <div class="flex flex-wrap gap-1.5">
          <button
            v-for="filter in FILTERS"
            :key="filter.id"
            type="button"
            class="font-outfit inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors"
            :class="
              activeFilter === filter.id
                ? 'from-secondary-500 bg-gradient-to-r to-[#3D5368] text-white'
                : 'bg-[var(--tint-slate-5)] text-[var(--color-text)] hover:bg-[var(--tint-slate-8)] dark:bg-slate-700 dark:text-gray-300'
            "
            @click="activeFilter = filter.id"
          >
            <span>{{ filter.emoji }}</span>
            <span>{{ t(filter.labelKey) }}</span>
          </button>
        </div>

        <!-- Empty state -->
        <div
          v-if="filtered.length === 0"
          class="rounded-2xl border border-dashed border-[var(--tint-slate-8)] bg-[var(--tint-slate-5)] px-4 py-6 text-center dark:border-slate-600 dark:bg-slate-700/40"
        >
          <p class="font-outfit text-sm text-[#2C3E50]/50 dark:text-gray-400">
            {{ t('accountView.noActivity') }}
          </p>
        </div>

        <!-- Grouped list -->
        <div v-else class="space-y-3">
          <div v-for="group in grouped" :key="group.date">
            <p
              class="font-outfit mb-1.5 text-xs font-semibold tracking-wide text-[#2C3E50]/50 uppercase dark:text-gray-500"
            >
              {{ group.label }}
            </p>
            <div class="space-y-1.5">
              <button
                v-for="tx in group.items"
                :key="tx.id"
                type="button"
                class="flex w-full items-start gap-3 rounded-2xl bg-white px-3.5 py-2.5 text-left shadow-[var(--card-shadow)] transition-colors hover:bg-[var(--tint-slate-5)] dark:bg-slate-800 dark:hover:bg-slate-700/50"
                @click="onRowClick(tx)"
              >
                <div class="min-w-0 flex-1">
                  <p
                    class="font-outfit truncate text-sm font-semibold text-[#2C3E50] dark:text-gray-100"
                  >
                    {{ tx.description || subtitleFor(tx) }}
                  </p>
                  <p class="truncate text-xs text-[#2C3E50]/60 dark:text-gray-400">
                    {{ subtitleFor(tx) }}
                  </p>
                </div>
                <div class="font-outfit shrink-0 text-right">
                  <CurrencyAmount
                    :amount="signedAmountFor(tx).amount"
                    :currency="tx.currency"
                    :type="signedAmountFor(tx).type"
                    size="sm"
                  />
                </div>
              </button>
            </div>
          </div>

          <!-- View all -->
          <button
            v-if="hasMore"
            type="button"
            class="text-primary-500 hover:bg-primary-500/5 mt-2 w-full cursor-pointer rounded-2xl py-2 text-center text-sm font-semibold transition-colors"
            @click="onViewAll"
          >
            {{ t('accountView.viewAll') }}
          </button>
        </div>
      </div>
    </template>
  </BeanieFormModal>
</template>
