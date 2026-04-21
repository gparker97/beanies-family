<script setup lang="ts">
/**
 * Read-only drawer view for a Goal. Shows identity + progress in the
 * header and a chronological activity log (automated Transactions
 * contributing to the goal + user-reported manual contributions). No
 * per-entry edit logic lives here: automated rows route to
 * `/transactions?view=<id>`; manual rows are non-clickable.
 *
 * Footer primary action is **Contribute** (opens GoalContributionModal via
 * parent emit); secondary is **Close**. Edit lives as a ✏️ icon in the
 * header, mirroring the MedicationViewModal pattern — contributing is the
 * first-class action, editing is secondary.
 */
import { computed, watch } from 'vue';
import { useRouter } from 'vue-router';
import BeanieFormModal from '@/components/ui/BeanieFormModal.vue';
import CurrencyAmount from '@/components/common/CurrencyAmount.vue';
import EntityActivityLog, { type ActivityEntry } from '@/components/common/EntityActivityLog.vue';
import { useFamilyStore } from '@/stores/familyStore';
import { useGoalsStore } from '@/stores/goalsStore';
import { useTransactionsStore } from '@/stores/transactionsStore';
import { useRecurringStore } from '@/stores/recurringStore';
import { useContributeToGoal } from '@/composables/useContributeToGoal';
import { useMemberInfo } from '@/composables/useMemberInfo';
import { useTranslation } from '@/composables/useTranslation';
import { showToast } from '@/composables/useToast';
import { confirm as showConfirm } from '@/composables/useConfirm';
import { getTransactionSubtitle } from '@/utils/transactionLabel';
import { getPriorityConfig } from '@/constants/goalDisplay';
import type { Goal, GoalManualContribution, Transaction } from '@/types/models';

const props = defineProps<{
  open: boolean;
  goal: Goal | null;
}>();

const emit = defineEmits<{
  close: [];
  'open-edit': [goal: Goal];
  contribute: [goal: Goal];
}>();

const router = useRouter();
const { t } = useTranslation();
const familyStore = useFamilyStore();
const goalsStore = useGoalsStore();
const transactionsStore = useTransactionsStore();
const recurringStore = useRecurringStore();
const { getMemberName } = useMemberInfo();
const { undoContribution } = useContributeToGoal();

const VISIBLE_CAP = 20;

const progressPct = computed(() => (props.goal ? goalsStore.getGoalProgress(props.goal) : 0));

const priorityConfig = computed(() => (props.goal ? getPriorityConfig(props.goal.priority) : null));

const typeEmoji = computed(() => {
  switch (props.goal?.type) {
    case 'savings':
      return '🐷';
    case 'debt_payoff':
      return '💳';
    case 'investment':
      return '📈';
    case 'purchase':
      return '🎁';
    default:
      return '🎯';
  }
});

/**
 * Merge automated transactions + manual contributions into unified entries.
 * Sorted hierarchically: primary key is the logical date (desc, so newest
 * day first, matching `groupByDate` expectations), secondary key is the
 * full-precision creation timestamp (desc, so newest-created appears at
 * the top of each day group — including a just-added contribution).
 */
const entries = computed<ActivityEntry[]>(() => {
  const goal = props.goal;
  if (!goal) return [];

  // Each row carries a `sortKey` (full ISO timestamp) so we can break
  // within-date ties by creation time. The sortKey is stripped before the
  // shared component sees the entry — it's purely an ordering concern.
  type Row = { entry: ActivityEntry; sortKey: string };
  const rows: Row[] = [];

  for (const tx of transactionsStore.transactionsForGoal(goal.id)) {
    rows.push({
      sortKey: tx.createdAt,
      entry: {
        id: tx.id,
        date: tx.date,
        title: tx.description,
        subtitle: subtitleForTx(tx),
        amount: tx.goalAllocApplied ?? tx.amount,
        currency: tx.currency,
        direction: 'income',
        iconEmoji: '🎯',
        onClick: () => {
          router.push({ path: '/transactions', query: { view: tx.id } });
          emit('close');
        },
      },
    });
  }

  for (const c of goal.manualContributions ?? []) {
    rows.push({
      sortKey: c.at,
      entry: manualToEntry(c, goal),
    });
  }

  rows.sort((a, b) => {
    const dateDiff = b.entry.date.localeCompare(a.entry.date);
    if (dateDiff !== 0) return dateDiff;
    return b.sortKey.localeCompare(a.sortKey);
  });

  return rows.map((r) => r.entry);
});

function subtitleForTx(tx: Transaction): string {
  const recurringItemName = tx.recurringItemId
    ? recurringStore.getRecurringItemById?.(tx.recurringItemId)?.description
    : undefined;
  return getTransactionSubtitle(tx, {
    t,
    currentMemberId: familyStore.currentMember?.id,
    recurringItemName,
  });
}

function manualToEntry(c: GoalManualContribution, goal: Goal): ActivityEntry {
  if (!c.updatedBy) {
    console.warn('[GoalViewModal] contribution entry missing updatedBy:', c.id);
  }
  const isYou = !!c.updatedBy && c.updatedBy === familyStore.currentMember?.id;
  // Bold title carries the authorship phrase; optional note sits below as
  // the muted subtitle — mirrors the automated (recurring) row shape
  // ("Netflix" + "Recurring: Netflix" becomes "Your contribution" + note).
  const title = isYou
    ? t('goalView.adjustedByYou')
    : t('goalView.adjustedBy').replace('{name}', getMemberName(c.updatedBy));
  return {
    id: c.id,
    date: c.at.slice(0, 10),
    title,
    subtitle: c.note ?? '',
    amount: Math.abs(c.amount),
    currency: goal.currency,
    direction: c.amount > 0 ? 'income' : c.amount < 0 ? 'expense' : 'neutral',
    iconEmoji: '✋',
    onDelete: () => onDeleteContribution(goal, c),
    // no onClick — manual contributions are non-clickable in v1
  };
}

async function onDeleteContribution(goal: Goal, c: GoalManualContribution): Promise<void> {
  const confirmed = await showConfirm({
    title: 'goalContribute.deleteConfirmTitle',
    message: 'goalContribute.deleteConfirmMessage',
    variant: 'danger',
  });
  if (!confirmed) return;
  await undoContribution(goal.id, c.id, c.amount);
}

function onViewAll() {
  if (!props.goal) return;
  router.push({ path: '/transactions', query: { goal: props.goal.id } });
  emit('close');
}

function onContribute() {
  if (props.goal) emit('contribute', props.goal);
}

function onEdit() {
  if (props.goal) emit('open-edit', props.goal);
}

/**
 * Reactive guard: if the drawer is open and `goal` becomes null (CRDT
 * delete from another device), surface a toast and close. No silent exit.
 */
watch(
  () => props.goal,
  (next, prev) => {
    if (props.open && prev && !next) {
      console.warn('[GoalViewModal] goal disappeared while drawer was open:', prev.id);
      showToast('error', t('goalView.notFound'));
      emit('close');
    }
  }
);
</script>

<template>
  <BeanieFormModal
    :open="open && !!goal"
    variant="drawer"
    size="wide"
    :title="goal?.name ?? ''"
    :icon="typeEmoji"
    :save-label="t('goalContribute.button')"
    save-gradient="orange"
    @close="emit('close')"
    @save="onContribute"
  >
    <template v-if="goal">
      <!-- Header: progress + priority + edit-icon -->
      <div class="space-y-4">
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0 flex-1 space-y-1">
            <p
              class="font-outfit text-xs tracking-[0.08em] text-[#2C3E50]/50 uppercase dark:text-gray-500"
            >
              {{ t('goalView.progressLabel') }}
            </p>
            <div class="font-outfit text-2xl font-extrabold">
              <CurrencyAmount
                :amount="goal.currentAmount"
                :currency="goal.currency"
                type="neutral"
                size="lg"
              />
              <span class="text-secondary-500/50 text-base font-medium"> / </span>
              <CurrencyAmount
                :amount="goal.targetAmount"
                :currency="goal.currency"
                type="neutral"
                size="lg"
              />
            </div>
          </div>
          <button
            type="button"
            :aria-label="t('action.edit')"
            class="flex h-10 w-10 shrink-0 items-center justify-center rounded-[14px] bg-[var(--tint-orange-8)] text-[#F15D22] transition-colors hover:bg-[var(--tint-orange-15)] focus:bg-[var(--tint-orange-15)] focus:outline-none"
            @click="onEdit"
          >
            <svg class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
              <path
                d="M17.414 2.586a2 2 0 00-2.828 0L7 10.172V13h2.828l7.586-7.586a2 2 0 000-2.828zM2 17a1 1 0 001 1h14a1 1 0 100-2H3a1 1 0 00-1 1z"
              />
            </svg>
          </button>
        </div>

        <!-- Progress bar -->
        <div class="space-y-1">
          <div class="h-2 overflow-hidden rounded-full bg-[var(--tint-slate-5)] dark:bg-slate-700">
            <div
              class="from-primary-500 to-terracotta-400 h-full rounded-full bg-gradient-to-r transition-all duration-500"
              :style="{ width: `${Math.min(100, progressPct)}%` }"
            />
          </div>
          <p class="font-outfit text-xs text-[#2C3E50]/60 dark:text-gray-400">
            {{ Math.round(progressPct) }}%
          </p>
        </div>

        <!-- Priority + deadline row -->
        <div class="flex flex-wrap items-center gap-2">
          <span
            v-if="priorityConfig"
            class="font-outfit inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold"
            :class="[priorityConfig.bgClass, priorityConfig.textClass]"
          >
            <span>{{ priorityConfig.icon }}</span>
            <span>{{ t(`goals.priority.${goal.priority}`) }}</span>
          </span>
          <span
            v-if="goal.deadline"
            class="font-outfit inline-flex items-center gap-1 rounded-full bg-[var(--tint-slate-5)] px-2.5 py-0.5 text-xs font-semibold text-[#2C3E50]/70 dark:bg-slate-700 dark:text-gray-300"
          >
            <span>📅</span>
            <span>{{ goal.deadline }}</span>
          </span>
        </div>
      </div>

      <!-- Activity section -->
      <div class="space-y-3">
        <h3
          class="font-outfit text-xs font-semibold tracking-[0.08em] text-[#2C3E50]/50 uppercase dark:text-gray-500"
        >
          {{ t('goalView.activity') }}
        </h3>
        <EntityActivityLog
          :entries="entries"
          :empty-state-text="t('goalView.noActivity')"
          :visible-cap="VISIBLE_CAP"
          :view-all-text="t('goalView.viewAll')"
          show-view-all
          @view-all="onViewAll"
        />
      </div>
    </template>

    <!-- Close paired with the primary Contribute save button. -->
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
