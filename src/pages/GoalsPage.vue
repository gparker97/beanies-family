<script setup lang="ts">
import { ref, computed } from 'vue';
import CurrencyAmount from '@/components/common/CurrencyAmount.vue';
import { BaseCard, BaseButton, BaseInput, BaseSelect, BaseModal } from '@/components/ui';
import { useTranslation } from '@/composables/useTranslation';
import { CURRENCIES } from '@/constants/currencies';
import { useFamilyStore } from '@/stores/familyStore';
import { useGoalsStore } from '@/stores/goalsStore';
import { useSettingsStore } from '@/stores/settingsStore';
import type {
  Goal,
  CreateGoalInput,
  UpdateGoalInput,
  GoalType,
  GoalPriority,
} from '@/types/models';

const { t } = useTranslation();

const goalsStore = useGoalsStore();
const familyStore = useFamilyStore();
const settingsStore = useSettingsStore();

// Computed for filtered goals sorted by priority
const filteredGoalsByPriority = computed(() => {
  const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 } as const;
  return [...goalsStore.filteredActiveGoals].sort(
    (a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]
  );
});

// Computed for filtered overdue goals
const filteredOverdueGoals = computed(() =>
  goalsStore.filteredActiveGoals.filter((g) => g.deadline && new Date(g.deadline) < new Date())
);

const showAddModal = ref(false);
const showEditModal = ref(false);
const editingGoal = ref<Goal | null>(null);
const isSubmitting = ref(false);

const goalTypes = computed(() => [
  { value: 'savings' as GoalType, label: t('goals.type.savings') },
  { value: 'debt_payoff' as GoalType, label: t('goals.type.debt_payoff') },
  { value: 'investment' as GoalType, label: t('goals.type.investment') },
  { value: 'purchase' as GoalType, label: t('goals.type.purchase') },
]);

const priorityOptions = computed(() => [
  { value: 'low' as GoalPriority, label: t('goals.priority.low') },
  { value: 'medium' as GoalPriority, label: t('goals.priority.medium') },
  { value: 'high' as GoalPriority, label: t('goals.priority.high') },
  { value: 'critical' as GoalPriority, label: t('goals.priority.critical') },
]);

const currencyOptions = CURRENCIES.map((c) => ({
  value: c.code,
  label: `${c.code} - ${c.name}`,
}));

const memberOptions = computed(() => [
  { value: '', label: t('goals.familyWide') },
  ...familyStore.members.map((m) => ({ value: m.id, label: m.name })),
]);

// Form data for adding - use string type for memberId to work with BaseSelect
interface NewGoalForm {
  memberId: string;
  name: string;
  type: GoalType;
  targetAmount: number;
  currentAmount: number;
  currency: string;
  deadline: string;
  priority: GoalPriority;
  isCompleted: boolean;
}

const newGoal = ref<NewGoalForm>({
  memberId: familyStore.currentMemberId || '',
  name: '',
  type: 'savings',
  targetAmount: 0,
  currentAmount: 0,
  currency: settingsStore.baseCurrency,
  deadline: '',
  priority: 'medium',
  isCompleted: false,
});

// Form data for editing - all required fields with defaults
interface EditGoalForm {
  id: string;
  memberId: string;
  name: string;
  type: GoalType;
  targetAmount: number;
  currentAmount: number;
  currency: string;
  deadline: string;
  priority: GoalPriority;
  isCompleted: boolean;
  notes?: string;
}

const editGoal = ref<EditGoalForm>({
  id: '',
  memberId: '',
  name: '',
  type: 'savings',
  targetAmount: 0,
  currentAmount: 0,
  currency: settingsStore.baseCurrency,
  deadline: '',
  priority: 'medium',
  isCompleted: false,
});

function getMemberName(memberId?: string): string {
  if (!memberId) return 'Family';
  const member = familyStore.members.find((m) => m.id === memberId);
  return member?.name || 'Unknown';
}

function getMemberColor(memberId?: string): string {
  if (!memberId) return '#3b82f6'; // Blue for family-wide
  const member = familyStore.members.find((m) => m.id === memberId);
  return member?.color || '#6b7280';
}

function openAddModal() {
  newGoal.value = {
    memberId: familyStore.currentMemberId || '',
    name: '',
    type: 'savings',
    targetAmount: 0,
    currentAmount: 0,
    currency: settingsStore.baseCurrency,
    deadline: '',
    priority: 'medium',
    isCompleted: false,
  };
  showAddModal.value = true;
}

async function createGoal() {
  if (!newGoal.value.name.trim()) return;

  isSubmitting.value = true;
  try {
    // Convert form data to API input
    const input: CreateGoalInput = {
      ...newGoal.value,
      memberId: newGoal.value.memberId === '' ? undefined : newGoal.value.memberId,
      deadline: newGoal.value.deadline === '' ? undefined : newGoal.value.deadline,
    };
    await goalsStore.createGoal(input);
    showAddModal.value = false;
  } finally {
    isSubmitting.value = false;
  }
}

function openEditModal(goal: Goal) {
  editingGoal.value = goal;
  editGoal.value = {
    id: goal.id,
    memberId: goal.memberId || '',
    name: goal.name,
    type: goal.type,
    targetAmount: goal.targetAmount,
    currentAmount: goal.currentAmount,
    currency: goal.currency,
    deadline: goal.deadline?.split('T')[0] || '',
    priority: goal.priority,
    isCompleted: goal.isCompleted,
    notes: goal.notes,
  };
  showEditModal.value = true;
}

function closeEditModal() {
  showEditModal.value = false;
  editingGoal.value = null;
}

async function updateGoal() {
  if (!editGoal.value.name?.trim()) return;

  isSubmitting.value = true;
  try {
    const { id, ...formData } = editGoal.value;
    // Convert empty string memberId to undefined for the API
    const input: UpdateGoalInput = {
      ...formData,
      memberId: formData.memberId === '' ? undefined : formData.memberId,
      deadline: formData.deadline === '' ? undefined : formData.deadline,
    };
    await goalsStore.updateGoal(id, input);
    closeEditModal();
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
        <h1 class="text-2xl font-bold text-gray-900 dark:text-gray-100">{{ t('goals.title') }}</h1>
        <p class="text-gray-500 dark:text-gray-400">{{ t('goals.subtitle') }}</p>
      </div>
      <BaseButton @click="openAddModal">
        {{ t('goals.addGoal') }}
      </BaseButton>
    </div>

    <div class="grid grid-cols-1 gap-4 md:grid-cols-3">
      <BaseCard>
        <p class="text-sm text-gray-500 dark:text-gray-400">{{ t('goals.activeGoals') }}</p>
        <p class="mt-1 text-2xl font-bold text-blue-600 dark:text-blue-400">
          {{ goalsStore.filteredActiveGoals.length }}
        </p>
      </BaseCard>
      <BaseCard>
        <p class="text-sm text-gray-500 dark:text-gray-400">{{ t('goals.completedGoals') }}</p>
        <p class="mt-1 text-2xl font-bold text-green-600 dark:text-green-400">
          {{ goalsStore.filteredCompletedGoals.length }}
        </p>
      </BaseCard>
      <BaseCard>
        <p class="text-sm text-gray-500 dark:text-gray-400">{{ t('goals.overdueGoals') }}</p>
        <p class="mt-1 text-2xl font-bold text-red-600 dark:text-red-400">
          {{ filteredOverdueGoals.length }}
        </p>
      </BaseCard>
    </div>

    <BaseCard :title="t('goals.allGoals')">
      <div
        v-if="goalsStore.filteredGoals.length === 0"
        class="py-12 text-center text-gray-500 dark:text-gray-400"
      >
        <p>{{ t('goals.noGoals') }}</p>
        <p class="mt-2">{{ t('goals.getStarted') }}</p>
      </div>
      <div v-else class="space-y-4">
        <div
          v-for="goal in filteredGoalsByPriority"
          :key="goal.id"
          class="rounded-lg border border-gray-200 p-4 dark:border-slate-700"
        >
          <div class="mb-2 flex items-center justify-between">
            <div>
              <h3 class="font-medium text-gray-900 dark:text-gray-100">{{ goal.name }}</h3>
              <p class="text-sm text-gray-500 dark:text-gray-400">
                {{ goalTypes.find((t) => t.value === goal.type)?.label }} -
                {{ priorityOptions.find((p) => p.value === goal.priority)?.label }} priority
              </p>
              <p class="mt-0.5 flex items-center gap-1 text-xs text-gray-400 dark:text-gray-500">
                <span
                  class="inline-block h-2.5 w-2.5 rounded-full"
                  :style="{ backgroundColor: getMemberColor(goal.memberId) }"
                />
                {{ getMemberName(goal.memberId) }}
              </p>
            </div>
            <div class="flex gap-1">
              <button
                class="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-blue-600 dark:hover:bg-slate-700"
                title="Edit"
                @click="openEditModal(goal)"
              >
                <svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
                  />
                </svg>
              </button>
              <button
                class="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-red-600 dark:hover:bg-slate-700"
                title="Delete"
                @click="deleteGoal(goal.id)"
              >
                <svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                  />
                </svg>
              </button>
            </div>
          </div>
          <div class="mb-2 flex items-center justify-between text-sm">
            <span class="text-gray-500 dark:text-gray-400">{{ t('goals.progress') }}</span>
            <span class="font-medium text-gray-900 dark:text-gray-100">
              <CurrencyAmount :amount="goal.currentAmount" :currency="goal.currency" size="sm" />
              <span class="mx-1">/</span>
              <CurrencyAmount :amount="goal.targetAmount" :currency="goal.currency" size="sm" />
            </span>
          </div>
          <div class="h-2 w-full rounded-full bg-gray-200 dark:bg-slate-700">
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
    <BaseModal :open="showAddModal" :title="t('goals.addGoal')" @close="showAddModal = false">
      <form class="space-y-4" @submit.prevent="createGoal">
        <BaseInput
          v-model="newGoal.name"
          :label="t('goals.goalName')"
          placeholder="e.g., Emergency Fund"
          required
        />

        <BaseSelect v-model="newGoal.type" :options="goalTypes" :label="t('goals.goalType')" />

        <div class="grid grid-cols-2 gap-4">
          <BaseInput
            v-model="newGoal.targetAmount"
            type="number"
            :label="t('form.targetAmount')"
            placeholder="0.00"
          />

          <BaseSelect
            v-model="newGoal.currency"
            :options="currencyOptions"
            :label="t('form.currency')"
          />
        </div>

        <BaseInput
          v-model="newGoal.currentAmount"
          type="number"
          :label="t('form.currentAmount')"
          placeholder="0.00"
        />

        <BaseSelect
          v-model="newGoal.priority"
          :options="priorityOptions"
          :label="t('form.priority')"
        />

        <BaseSelect
          v-model="newGoal.memberId"
          :options="memberOptions"
          :label="t('goals.assignTo')"
        />

        <BaseInput v-model="newGoal.deadline" type="date" :label="t('goals.deadlineOptional')" />
      </form>

      <template #footer>
        <div class="flex justify-end gap-3">
          <BaseButton variant="secondary" @click="showAddModal = false">
            {{ t('action.cancel') }}
          </BaseButton>
          <BaseButton :loading="isSubmitting" @click="createGoal">
            {{ t('goals.addGoal') }}
          </BaseButton>
        </div>
      </template>
    </BaseModal>

    <!-- Edit Goal Modal -->
    <BaseModal :open="showEditModal" :title="t('goals.editGoal')" @close="closeEditModal">
      <form class="space-y-4" @submit.prevent="updateGoal">
        <BaseInput
          v-model="editGoal.name"
          :label="t('goals.goalName')"
          placeholder="e.g., Emergency Fund"
          required
        />

        <BaseSelect v-model="editGoal.type" :options="goalTypes" :label="t('goals.goalType')" />

        <div class="grid grid-cols-2 gap-4">
          <BaseInput
            v-model="editGoal.targetAmount"
            type="number"
            :label="t('form.targetAmount')"
            placeholder="0.00"
          />

          <BaseSelect
            v-model="editGoal.currency"
            :options="currencyOptions"
            :label="t('form.currency')"
          />
        </div>

        <BaseInput
          v-model="editGoal.currentAmount"
          type="number"
          :label="t('form.currentAmount')"
          placeholder="0.00"
        />

        <BaseSelect
          v-model="editGoal.priority"
          :options="priorityOptions"
          :label="t('form.priority')"
        />

        <BaseSelect
          v-model="editGoal.memberId"
          :options="memberOptions"
          :label="t('goals.assignTo')"
        />

        <BaseInput v-model="editGoal.deadline" type="date" :label="t('goals.deadlineOptional')" />

        <div class="flex items-center gap-2">
          <input
            id="isCompleted"
            v-model="editGoal.isCompleted"
            type="checkbox"
            class="rounded border-gray-300 text-blue-600 focus:ring-blue-500 dark:border-slate-600"
          />
          <label for="isCompleted" class="text-sm text-gray-700 dark:text-gray-300">
            {{ t('action.markCompleted') }}
          </label>
        </div>
      </form>

      <template #footer>
        <div class="flex justify-end gap-3">
          <BaseButton variant="secondary" @click="closeEditModal">
            {{ t('action.cancel') }}
          </BaseButton>
          <BaseButton :loading="isSubmitting" @click="updateGoal">
            {{ t('action.saveChanges') }}
          </BaseButton>
        </div>
      </template>
    </BaseModal>
  </div>
</template>
