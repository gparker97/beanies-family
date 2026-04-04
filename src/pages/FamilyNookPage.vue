<script setup lang="ts">
import { ref, computed } from 'vue';
import { useRouter } from 'vue-router';
import NookGreeting from '@/components/nook/NookGreeting.vue';
import FamilyStatusToast from '@/components/nook/FamilyStatusToast.vue';
import NookYourBeans from '@/components/nook/NookYourBeans.vue';
import ScheduleCards from '@/components/nook/ScheduleCards.vue';
import NookTodoWidget from '@/components/nook/NookTodoWidget.vue';
import NookVacationCard from '@/components/nook/NookVacationCard.vue';
import MilestonesCard from '@/components/nook/MilestonesCard.vue';
import PiggyBankCard from '@/components/nook/PiggyBankCard.vue';
import RecentActivityCard from '@/components/nook/RecentActivityCard.vue';
import TodoViewEditModal from '@/components/todo/TodoViewEditModal.vue';
import ActivityViewEditModal from '@/components/planner/ActivityViewEditModal.vue';
import ActivityModal from '@/components/planner/ActivityModal.vue';
import TransactionViewEditModal from '@/components/transactions/TransactionViewEditModal.vue';
import TransactionModal from '@/components/transactions/TransactionModal.vue';
import OnboardingWizard from '@/components/onboarding/OnboardingWizard.vue';
import BeanTipCard from '@/components/nook/BeanTipCard.vue';
import { usePermissions } from '@/composables/usePermissions';
import { useSettingsStore } from '@/stores/settingsStore';
import { useFamilyStore } from '@/stores/familyStore';
import { useTodoStore } from '@/stores/todoStore';
import { useActivityStore } from '@/stores/activityStore';
import { useTransactionsStore } from '@/stores/transactionsStore';
import { useVacationStore } from '@/stores/vacationStore';
import { confirm } from '@/composables/useConfirm';
import { useSounds } from '@/composables/useSounds';
import { useActivityScopeEdit } from '@/composables/useActivityScopeEdit';
import type {
  FamilyActivity,
  DutyCompletion,
  Transaction,
  CreateFamilyActivityInput,
  UpdateFamilyActivityInput,
  CreateTransactionInput,
  UpdateTransactionInput,
} from '@/types/models';

const router = useRouter();
const settingsStore = useSettingsStore();
const familyStore = useFamilyStore();
const { canViewFinances } = usePermissions();
const todoStore = useTodoStore();
const activityStore = useActivityStore();
const transactionsStore = useTransactionsStore();
const vacationStore = useVacationStore();
const { playWhoosh } = useSounds();

// ── Todo modal (for ScheduleCards / RecentActivityCard clicks) ───────────────
const selectedTodoId = ref<string | null>(null);
const selectedTodo = computed(() =>
  selectedTodoId.value ? (todoStore.todos.find((t) => t.id === selectedTodoId.value) ?? null) : null
);

// ── Activity modal ───────────────────────────────────────────────────────────
const showActivityEditModal = ref(false);
const editingActivity = ref<FamilyActivity | null>(null);
const editingOccurrenceDate = ref<string | undefined>(undefined);
const {
  viewingActivity,
  viewingOccurrenceDate,
  openViewModal: openActivity,
  handleViewOpenEdit: scopedActivityOpenEdit,
  handleScopedSave,
} = useActivityScopeEdit();

// ── Duty completion toggle ──────────────────────────────────────────────────
async function handleDutyComplete(id: string, dutyType: string, occurrenceDate: string) {
  const activity = activityStore.activities.find((a) => a.id === id);
  if (!activity || !occurrenceDate) return;
  const memberId = familyStore.currentMemberId;
  if (!memberId) return;
  const now = new Date().toISOString();
  const updates: Record<string, DutyCompletion[]> = {};
  if (dutyType.includes('dropoff')) {
    const completions = [...(activity.dropoffCompletions ?? [])];
    const idx = completions.findIndex((c) => c.date === occurrenceDate);
    if (idx >= 0) completions.splice(idx, 1);
    else completions.push({ date: occurrenceDate, completedBy: memberId, completedAt: now });
    updates.dropoffCompletions = completions;
  }
  if (dutyType.includes('pickup')) {
    const completions = [...(activity.pickupCompletions ?? [])];
    const idx = completions.findIndex((c) => c.date === occurrenceDate);
    if (idx >= 0) completions.splice(idx, 1);
    else completions.push({ date: occurrenceDate, completedBy: memberId, completedAt: now });
    updates.pickupCompletions = completions;
  }
  await activityStore.updateActivity(id, updates);
}

// ── Todo completion toggle (from critical items) ────────────────────────────
async function handleTodoComplete(id: string) {
  const memberId = familyStore.currentMemberId;
  if (!memberId) return;
  await todoStore.toggleComplete(id, memberId);
}

function scrollToSchedule() {
  document.getElementById('today-schedule')?.scrollIntoView({ behavior: 'smooth' });
}

function handleActivityOpenEdit(activity: FamilyActivity) {
  const { activity: target, occurrenceDate } = scopedActivityOpenEdit(activity);
  editingActivity.value = target;
  editingOccurrenceDate.value = occurrenceDate;
  showActivityEditModal.value = true;
}

async function handleActivitySave(
  data: CreateFamilyActivityInput | { id: string; data: UpdateFamilyActivityInput }
) {
  if ('id' in data && 'data' in data) {
    if (editingOccurrenceDate.value && editingActivity.value?.recurrence !== 'none') {
      const saved = await handleScopedSave(data.id, editingOccurrenceDate.value, data.data);
      if (!saved) return;
    } else {
      await activityStore.updateActivity(data.id, data.data);
    }
  }
  showActivityEditModal.value = false;
  editingActivity.value = null;
  editingOccurrenceDate.value = undefined;
}

async function handleActivityDelete() {
  if (!editingActivity.value) return;
  const activityToDelete = editingActivity.value;
  showActivityEditModal.value = false;
  const confirmed = await confirm({
    title: 'planner.deleteActivity',
    message: 'planner.deleteConfirm',
    variant: 'danger',
  });
  if (confirmed) {
    await activityStore.deleteActivity(activityToDelete.id);
    playWhoosh();
  }
  editingActivity.value = null;
  editingOccurrenceDate.value = undefined;
}

// ── Transaction modal ────────────────────────────────────────────────────────
const viewingTransaction = ref<Transaction | null>(null);
const showTransactionEditModal = ref(false);
const editingTransaction = ref<Transaction | null>(null);

function openTransaction(id: string) {
  const tx = transactionsStore.transactions.find((t) => t.id === id);
  if (tx) {
    viewingTransaction.value = tx;
  }
}

function handleTransactionOpenEdit(transaction: Transaction) {
  viewingTransaction.value = null;
  editingTransaction.value = transaction;
  showTransactionEditModal.value = true;
}

async function handleTransactionSave(
  data: CreateTransactionInput | { id: string; data: UpdateTransactionInput }
) {
  if ('id' in data) {
    await transactionsStore.updateTransaction(data.id, data.data);
  }
  showTransactionEditModal.value = false;
  editingTransaction.value = null;
}

async function handleTransactionDelete(id: string) {
  showTransactionEditModal.value = false;
  editingTransaction.value = null;
  const confirmed = await confirm({
    title: 'confirm.deleteTransactionTitle',
    message: 'transactions.deleteConfirm',
    variant: 'danger',
  });
  if (confirmed) {
    if (await transactionsStore.deleteTransaction(id)) {
      playWhoosh();
    }
  }
}
</script>

<template>
  <div class="space-y-6">
    <!-- Greeting header -->
    <NookGreeting />

    <!-- Status toast -->
    <FamilyStatusToast
      @open-todo="selectedTodoId = $event"
      @open-activity="(id: string, date: string) => openActivity(id, date)"
      @complete-duty="handleDutyComplete"
      @complete-todo="handleTodoComplete"
      @show-full-schedule="scrollToSchedule"
    />

    <!-- Beanie tip of the day -->
    <BeanTipCard />

    <!-- Your Beans row -->
    <NookYourBeans
      @add-member="router.push({ path: '/family', query: { add: 'true' } })"
      @select-member="(id: string) => router.push({ path: '/family', query: { edit: id } })"
    />

    <!-- Today's Schedule + This Week -->
    <ScheduleCards
      id="today-schedule"
      @open-todo="selectedTodoId = $event"
      @open-activity="(id: string, date: string) => openActivity(id, date)"
    />

    <!-- Upcoming vacation -->
    <NookVacationCard v-if="vacationStore.upcomingVacations.length > 0" />

    <!-- Todo widget (full width) -->
    <NookTodoWidget />

    <!-- Milestones + Piggy Bank -->
    <div class="grid grid-cols-1 gap-5 lg:grid-cols-2">
      <MilestonesCard />
      <PiggyBankCard v-if="canViewFinances" />
    </div>

    <!-- Recent Activity (full width) -->
    <RecentActivityCard @open-todo="selectedTodoId = $event" @open-transaction="openTransaction" />

    <!-- Modals -->
    <TodoViewEditModal :todo="selectedTodo" @close="selectedTodoId = null" />

    <ActivityViewEditModal
      :activity="viewingActivity"
      :occurrence-date="viewingOccurrenceDate"
      @close="viewingActivity = null"
      @open-edit="handleActivityOpenEdit"
      @activity-swapped="
        (newId: string) => {
          const a = activityStore.activities.find((act) => act.id === newId);
          if (a) viewingActivity = a;
        }
      "
    />

    <ActivityModal
      :open="showActivityEditModal"
      :activity="editingActivity"
      :occurrence-date="editingOccurrenceDate"
      @close="
        showActivityEditModal = false;
        editingActivity = null;
      "
      @save="handleActivitySave"
      @delete="handleActivityDelete"
    />

    <TransactionViewEditModal
      :transaction="viewingTransaction"
      @close="viewingTransaction = null"
      @open-edit="handleTransactionOpenEdit"
    />

    <TransactionModal
      :open="showTransactionEditModal"
      :transaction="editingTransaction"
      @close="
        showTransactionEditModal = false;
        editingTransaction = null;
      "
      @save="handleTransactionSave"
      @delete="handleTransactionDelete"
    />

    <!-- Onboarding wizard (shown for fresh pods) -->
    <OnboardingWizard v-if="!settingsStore.onboardingCompleted" />
  </div>
</template>
