<script setup lang="ts">
import { ref } from 'vue';
import { useGoalsStore } from '@/stores/goalsStore';
import { useFamilyStore } from '@/stores/familyStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { BaseCard, BaseButton, BaseInput, BaseSelect, BaseModal } from '@/components/ui';
import CurrencyAmount from '@/components/common/CurrencyAmount.vue';
import type { CreateGoalInput, GoalType, GoalPriority } from '@/types/models';

const goalsStore = useGoalsStore();
const familyStore = useFamilyStore();
const settingsStore = useSettingsStore();

const showAddModal = ref(false);
const isSubmitting = ref(false);

const goalTypes: { value: GoalType; label: string }[] = [
  { value: 'savings', label: 'Savings' },
  { value: 'debt_payoff', label: 'Debt Payoff' },
  { value: 'investment', label: 'Investment' },
  { value: 'purchase', label: 'Purchase' },
];

const priorityOptions: { value: GoalPriority; label: string }[] = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'critical', label: 'Critical' },
];

const newGoal = ref<CreateGoalInput>({
  memberId: familyStore.currentMemberId || undefined,
  name: '',
  type: 'savings',
  targetAmount: 0,
  currentAmount: 0,
  currency: settingsStore.baseCurrency,
  priority: 'medium',
  isCompleted: false,
});

function openAddModal() {
  newGoal.value = {
    memberId: familyStore.currentMemberId || undefined,
    name: '',
    type: 'savings',
    targetAmount: 0,
    currentAmount: 0,
    currency: settingsStore.baseCurrency,
    priority: 'medium',
    isCompleted: false,
  };
  showAddModal.value = true;
}

async function createGoal() {
  if (!newGoal.value.name.trim()) return;

  isSubmitting.value = true;
  try {
    await goalsStore.createGoal(newGoal.value);
    showAddModal.value = false;
  } finally {
    isSubmitting.value = false;
  }
}

async function deleteGoal(id: string) {
  if (confirm('Are you sure you want to delete this goal?')) {
    await goalsStore.deleteGoal(id);
  }
}
</script>

<template>
  <div class="space-y-6">
    <div class="flex items-center justify-between">
      <div>
        <h1 class="text-2xl font-bold text-gray-900 dark:text-gray-100">Goals</h1>
        <p class="text-gray-500 dark:text-gray-400">Set and track your financial goals</p>
      </div>
      <BaseButton @click="openAddModal">
        Add Goal
      </BaseButton>
    </div>

    <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
      <BaseCard>
        <p class="text-sm text-gray-500 dark:text-gray-400">Active Goals</p>
        <p class="text-2xl font-bold text-blue-600 dark:text-blue-400 mt-1">
          {{ goalsStore.activeGoals.length }}
        </p>
      </BaseCard>
      <BaseCard>
        <p class="text-sm text-gray-500 dark:text-gray-400">Completed Goals</p>
        <p class="text-2xl font-bold text-green-600 dark:text-green-400 mt-1">
          {{ goalsStore.completedGoals.length }}
        </p>
      </BaseCard>
      <BaseCard>
        <p class="text-sm text-gray-500 dark:text-gray-400">Overdue Goals</p>
        <p class="text-2xl font-bold text-red-600 dark:text-red-400 mt-1">
          {{ goalsStore.overdueGoals.length }}
        </p>
      </BaseCard>
    </div>

    <BaseCard title="All Goals">
      <div v-if="goalsStore.goals.length === 0" class="text-center py-12 text-gray-500 dark:text-gray-400">
        <p>No goals set yet.</p>
        <p class="mt-2">Click "Add Goal" to create your first financial goal.</p>
      </div>
      <div v-else class="space-y-4">
        <div
          v-for="goal in goalsStore.goalsByPriority"
          :key="goal.id"
          class="p-4 border border-gray-200 dark:border-slate-700 rounded-lg"
        >
          <div class="flex items-center justify-between mb-2">
            <div>
              <h3 class="font-medium text-gray-900 dark:text-gray-100">{{ goal.name }}</h3>
              <p class="text-sm text-gray-500 dark:text-gray-400">
                {{ goalTypes.find(t => t.value === goal.type)?.label }} -
                {{ priorityOptions.find(p => p.value === goal.priority)?.label }} priority
              </p>
            </div>
            <button
              class="p-2 text-gray-400 hover:text-red-600 rounded-lg hover:bg-gray-100 dark:hover:bg-slate-700"
              @click="deleteGoal(goal.id)"
            >
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </button>
          </div>
          <div class="flex items-center justify-between text-sm mb-2">
            <span class="text-gray-500 dark:text-gray-400">Progress</span>
            <span class="font-medium text-gray-900 dark:text-gray-100">
              <CurrencyAmount :amount="goal.currentAmount" :currency="goal.currency" size="sm" />
              <span class="mx-1">/</span>
              <CurrencyAmount :amount="goal.targetAmount" :currency="goal.currency" size="sm" />
            </span>
          </div>
          <div class="w-full bg-gray-200 dark:bg-slate-700 rounded-full h-2">
            <div
              class="h-2 rounded-full transition-all"
              :class="goal.isCompleted ? 'bg-green-600' : 'bg-blue-600'"
              :style="{ width: `${goalsStore.getGoalProgress(goal)}%` }"
            />
          </div>
        </div>
      </div>
    </BaseCard>

    <!-- Add Goal Modal -->
    <BaseModal
      :open="showAddModal"
      title="Add Goal"
      @close="showAddModal = false"
    >
      <form class="space-y-4" @submit.prevent="createGoal">
        <BaseInput
          v-model="newGoal.name"
          label="Goal Name"
          placeholder="e.g., Emergency Fund"
          required
        />

        <BaseSelect
          v-model="newGoal.type"
          :options="goalTypes"
          label="Goal Type"
        />

        <BaseInput
          v-model="newGoal.targetAmount"
          type="number"
          label="Target Amount"
          placeholder="0.00"
        />

        <BaseInput
          v-model="newGoal.currentAmount"
          type="number"
          label="Current Amount"
          placeholder="0.00"
        />

        <BaseSelect
          v-model="newGoal.priority"
          :options="priorityOptions"
          label="Priority"
        />
      </form>

      <template #footer>
        <div class="flex justify-end gap-3">
          <BaseButton variant="secondary" @click="showAddModal = false">
            Cancel
          </BaseButton>
          <BaseButton :loading="isSubmitting" @click="createGoal">
            Add Goal
          </BaseButton>
        </div>
      </template>
    </BaseModal>
  </div>
</template>
