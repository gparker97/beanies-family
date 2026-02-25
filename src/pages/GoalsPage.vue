<script setup lang="ts">
import { ref, computed, onMounted, nextTick } from 'vue';
import { useCountUp } from '@/composables/useCountUp';
import CurrencyAmount from '@/components/common/CurrencyAmount.vue';

import { BaseCard, BaseButton, BaseInput, BaseSelect, BaseModal } from '@/components/ui';
import BeanieIcon from '@/components/ui/BeanieIcon.vue';
import EmptyStateIllustration from '@/components/ui/EmptyStateIllustration.vue';
import { usePrivacyMode } from '@/composables/usePrivacyMode';
import { useSounds } from '@/composables/useSounds';
import { useTranslation } from '@/composables/useTranslation';
import { confirm as showConfirm } from '@/composables/useConfirm';
import { useCurrencyOptions } from '@/composables/useCurrencyOptions';
import { useFamilyStore } from '@/stores/familyStore';
import { useGoalsStore } from '@/stores/goalsStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { formatDate } from '@/utils/date';
import type {
  Goal,
  CreateGoalInput,
  UpdateGoalInput,
  GoalType,
  GoalPriority,
} from '@/types/models';

const { isUnlocked } = usePrivacyMode();
const { t } = useTranslation();
const { playWhoosh } = useSounds();

const progressMounted = ref(false);
onMounted(() => {
  nextTick(() => {
    progressMounted.value = true;
  });
});

const goalsStore = useGoalsStore();
const familyStore = useFamilyStore();
const settingsStore = useSettingsStore();

// Animated stat card counts
const { displayValue: animatedActiveCount } = useCountUp(
  computed(() => goalsStore.filteredActiveGoals.length)
);
const { displayValue: animatedCompletedCount } = useCountUp(
  computed(() => goalsStore.filteredCompletedGoals.length),
  100
);
const { displayValue: animatedOverdueCount } = useCountUp(
  computed(
    () =>
      goalsStore.filteredActiveGoals.filter((g) => g.deadline && new Date(g.deadline) < new Date())
        .length
  ),
  200
);

// Computed for filtered goals sorted by priority
const filteredGoalsByPriority = computed(() => {
  const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 } as const;
  return [...goalsStore.filteredActiveGoals].sort(
    (a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]
  );
});

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

const { currencyOptions } = useCurrencyOptions();

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
  currency: settingsStore.displayCurrency,
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
  currency: settingsStore.displayCurrency,
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
    currency: settingsStore.displayCurrency,
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
  if (await showConfirm({ title: 'confirm.deleteGoalTitle', message: 'goals.deleteConfirm' })) {
    await goalsStore.deleteGoal(id);
    playWhoosh();
  }
}

// Completed goals section
const showCompletedGoals = ref(false);

const filteredCompletedGoalsSorted = computed(() =>
  [...goalsStore.filteredCompletedGoals].sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  )
);

async function reopenGoal(id: string) {
  await goalsStore.updateGoal(id, { isCompleted: false });
}

async function deleteCompletedGoal(id: string) {
  if (
    await showConfirm({ title: 'confirm.deleteGoalTitle', message: 'goals.deleteCompletedConfirm' })
  ) {
    await goalsStore.deleteGoal(id);
    playWhoosh();
  }
}
</script>

<template>
  <div class="space-y-6">
    <!-- Action bar -->
    <div class="flex justify-end">
      <BaseButton @click="openAddModal">
        <BeanieIcon name="plus" size="md" class="mr-1.5 -ml-1" />
        {{ t('goals.addGoal') }}
      </BaseButton>
    </div>

    <div class="grid grid-cols-1 gap-4 md:grid-cols-3">
      <div class="rounded-[var(--sq)] bg-white p-5 shadow-[var(--card-shadow)] dark:bg-slate-800">
        <p class="nook-section-label text-secondary-500 dark:text-gray-400">
          {{ t('goals.activeGoals') }}
        </p>
        <p class="text-primary-600 dark:text-primary-400 font-outfit mt-1 text-2xl font-extrabold">
          {{ Math.round(animatedActiveCount) }}
        </p>
      </div>
      <div class="rounded-[var(--sq)] bg-white p-5 shadow-[var(--card-shadow)] dark:bg-slate-800">
        <p class="nook-section-label text-secondary-500 dark:text-gray-400">
          {{ t('goals.completedGoals') }}
        </p>
        <p class="font-outfit mt-1 text-2xl font-extrabold text-green-600 dark:text-green-400">
          {{ Math.round(animatedCompletedCount) }}
        </p>
      </div>
      <div class="rounded-[var(--sq)] bg-white p-5 shadow-[var(--card-shadow)] dark:bg-slate-800">
        <p class="nook-section-label text-secondary-500 dark:text-gray-400">
          {{ t('goals.overdueGoals') }}
        </p>
        <p class="font-outfit mt-1 text-2xl font-extrabold text-red-600 dark:text-red-400">
          {{ Math.round(animatedOverdueCount) }}
        </p>
      </div>
    </div>

    <BaseCard :title="t('goals.activeGoals')">
      <div
        v-if="goalsStore.filteredActiveGoals.length === 0"
        class="py-12 text-center text-gray-500 dark:text-gray-400"
      >
        <EmptyStateIllustration variant="goals" class="mb-4" />
        <p>{{ t('goals.noGoals') }}</p>
        <p class="mt-2">{{ t('goals.getStarted') }}</p>
      </div>
      <div v-else class="space-y-4">
        <div
          v-for="goal in filteredGoalsByPriority"
          :key="goal.id"
          class="rounded-[var(--sq)] bg-white p-4 shadow-[var(--card-shadow)] dark:bg-slate-800"
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
                class="hover:text-primary-600 rounded-lg p-2 text-gray-400 hover:bg-gray-100 dark:hover:bg-slate-700"
                title="Edit"
                @click="openEditModal(goal)"
              >
                <BeanieIcon name="edit" size="md" />
              </button>
              <button
                class="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-red-600 dark:hover:bg-slate-700"
                title="Delete"
                @click="deleteGoal(goal.id)"
              >
                <BeanieIcon name="trash" size="md" />
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
          <div
            class="h-2 w-full rounded-full bg-gray-200 transition-all dark:bg-slate-700"
            :class="{ 'blur-sm': !isUnlocked }"
          >
            <div
              class="h-2 rounded-full transition-all duration-700 ease-out"
              :class="goal.isCompleted ? 'bg-green-600' : 'bg-primary-500'"
              :style="{ width: progressMounted ? `${goalsStore.getGoalProgress(goal)}%` : '0%' }"
            />
          </div>
        </div>
      </div>
    </BaseCard>

    <!-- Completed Goals Section -->
    <div v-if="goalsStore.filteredCompletedGoals.length > 0">
      <button
        class="flex w-full items-center gap-2 rounded-lg px-4 py-3 text-left text-gray-600 transition-colors hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-slate-800"
        @click="showCompletedGoals = !showCompletedGoals"
      >
        <BeanieIcon name="check-circle" size="md" class="text-green-500" />
        <span class="font-medium">{{ t('goals.completedGoals') }}</span>
        <span
          class="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700 dark:bg-green-900/30 dark:text-green-400"
        >
          {{ goalsStore.filteredCompletedGoals.length }}
        </span>
        <BeanieIcon
          :name="showCompletedGoals ? 'chevron-up' : 'chevron-down'"
          size="md"
          class="ml-auto"
        />
      </button>

      <div v-if="showCompletedGoals" class="mt-2 space-y-3">
        <div
          v-for="goal in filteredCompletedGoalsSorted"
          :key="goal.id"
          class="rounded-[var(--sq)] bg-gray-50/50 p-4 shadow-[var(--card-shadow)] dark:bg-slate-800/50"
        >
          <div class="mb-2 flex items-center justify-between">
            <div>
              <h3 class="flex items-center gap-2 font-medium text-gray-700 dark:text-gray-300">
                <BeanieIcon name="check-circle" size="md" class="text-green-500" />
                {{ goal.name }}
              </h3>
              <p class="mt-0.5 text-sm text-gray-500 dark:text-gray-400">
                {{ goalTypes.find((t) => t.value === goal.type)?.label }}
              </p>
              <div class="mt-1 flex items-center gap-3 text-xs text-gray-400 dark:text-gray-500">
                <span class="flex items-center gap-1">
                  <span
                    class="inline-block h-2.5 w-2.5 rounded-full"
                    :style="{ backgroundColor: getMemberColor(goal.memberId) }"
                  />
                  {{ getMemberName(goal.memberId) }}
                </span>
                <span> {{ t('goals.completedOn') }}: {{ formatDate(goal.updatedAt) }} </span>
              </div>
            </div>
            <div class="flex gap-1">
              <button
                class="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-green-600 dark:hover:bg-slate-700"
                :title="t('goals.reopenGoal')"
                @click="reopenGoal(goal.id)"
              >
                <BeanieIcon name="refresh" size="md" />
              </button>
              <button
                class="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-red-600 dark:hover:bg-slate-700"
                :title="t('goals.deleteGoal')"
                @click="deleteCompletedGoal(goal.id)"
              >
                <BeanieIcon name="trash" size="md" />
              </button>
            </div>
          </div>
          <div class="flex items-center justify-between text-sm">
            <span class="text-gray-500 dark:text-gray-400">{{ t('goals.progress') }}</span>
            <span
              class="font-medium text-gray-700 dark:text-gray-300"
              :class="{ 'blur-sm': !isUnlocked }"
            >
              <CurrencyAmount :amount="goal.currentAmount" :currency="goal.currency" size="sm" />
              <span class="mx-1">/</span>
              <CurrencyAmount :amount="goal.targetAmount" :currency="goal.currency" size="sm" />
            </span>
          </div>
        </div>
      </div>
    </div>

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

        <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
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

        <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
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
            class="text-primary-600 focus:ring-primary-500 rounded border-gray-300 dark:border-slate-600"
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
