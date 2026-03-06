<script setup lang="ts">
import { ref, computed } from 'vue';
import { useRouter } from 'vue-router';
import NookGreeting from '@/components/nook/NookGreeting.vue';
import FamilyStatusToast from '@/components/nook/FamilyStatusToast.vue';
import NookYourBeans from '@/components/nook/NookYourBeans.vue';
import ScheduleCards from '@/components/nook/ScheduleCards.vue';
import NookTodoWidget from '@/components/nook/NookTodoWidget.vue';
import MilestonesCard from '@/components/nook/MilestonesCard.vue';
import PiggyBankCard from '@/components/nook/PiggyBankCard.vue';
import RecentActivityCard from '@/components/nook/RecentActivityCard.vue';
import TodoViewEditModal from '@/components/todo/TodoViewEditModal.vue';
import ActivityViewEditModal from '@/components/planner/ActivityViewEditModal.vue';
import ActivityModal from '@/components/planner/ActivityModal.vue';
import TransactionViewEditModal from '@/components/transactions/TransactionViewEditModal.vue';
import TransactionModal from '@/components/transactions/TransactionModal.vue';
import { usePermissions } from '@/composables/usePermissions';
import { useTodoStore } from '@/stores/todoStore';
import { useActivityStore } from '@/stores/activityStore';
import { useTransactionsStore } from '@/stores/transactionsStore';
import { confirm } from '@/composables/useConfirm';
import { useSounds } from '@/composables/useSounds';
import type {
  FamilyActivity,
  Transaction,
  CreateFamilyActivityInput,
  UpdateFamilyActivityInput,
  CreateTransactionInput,
  UpdateTransactionInput,
} from '@/types/models';

const router = useRouter();
const { canViewFinances } = usePermissions();
const todoStore = useTodoStore();
const activityStore = useActivityStore();
const transactionsStore = useTransactionsStore();
const { playWhoosh } = useSounds();

// ── Todo modal (for ScheduleCards / RecentActivityCard clicks) ───────────────
const selectedTodoId = ref<string | null>(null);
const selectedTodo = computed(() =>
  selectedTodoId.value ? (todoStore.todos.find((t) => t.id === selectedTodoId.value) ?? null) : null
);

// ── Activity modal ───────────────────────────────────────────────────────────
const viewingActivity = ref<FamilyActivity | null>(null);
const showActivityEditModal = ref(false);
const editingActivity = ref<FamilyActivity | null>(null);

function openActivity(id: string) {
  const activity = activityStore.activities.find((a) => a.id === id);
  if (activity) {
    viewingActivity.value = activity;
  }
}

function handleActivityOpenEdit(activity: FamilyActivity) {
  viewingActivity.value = null;
  editingActivity.value = activity;
  showActivityEditModal.value = true;
}

async function handleActivitySave(
  data: CreateFamilyActivityInput | { id: string; data: UpdateFamilyActivityInput }
) {
  if ('id' in data && 'data' in data) {
    await activityStore.updateActivity(data.id, data.data);
  }
  showActivityEditModal.value = false;
  editingActivity.value = null;
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
    <FamilyStatusToast />

    <!-- Your Beans row -->
    <NookYourBeans
      @add-member="router.push({ path: '/family', query: { add: 'true' } })"
      @select-member="(id: string) => router.push({ path: '/family', query: { edit: id } })"
    />

    <!-- Today's Schedule + This Week -->
    <ScheduleCards @open-todo="selectedTodoId = $event" @open-activity="openActivity" />

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
      @close="viewingActivity = null"
      @open-edit="handleActivityOpenEdit"
    />

    <ActivityModal
      :open="showActivityEditModal"
      :activity="editingActivity"
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
  </div>
</template>
