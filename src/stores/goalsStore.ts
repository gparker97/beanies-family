import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { celebrate } from '@/composables/useCelebration';
import { useMemberFilterStore } from './memberFilterStore';
import { useTombstoneStore } from './tombstoneStore';
import * as goalRepo from '@/services/indexeddb/repositories/goalRepository';
import type { Goal, CreateGoalInput, UpdateGoalInput } from '@/types/models';

export const useGoalsStore = defineStore('goals', () => {
  // State
  const goals = ref<Goal[]>([]);
  const isLoading = ref(false);
  const error = ref<string | null>(null);

  // Getters
  const activeGoals = computed(() => goals.value.filter((g) => !g.isCompleted));

  const completedGoals = computed(() => goals.value.filter((g) => g.isCompleted));

  const familyGoals = computed(() => goals.value.filter((g) => !g.memberId));

  const overdueGoals = computed(() =>
    activeGoals.value.filter((g) => g.deadline && new Date(g.deadline) < new Date())
  );

  const goalsByPriority = computed(() => {
    const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
    return [...activeGoals.value].sort(
      (a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]
    );
  });

  const goalsByMember = computed(() => {
    const grouped = new Map<string, Goal[]>();
    for (const goal of goals.value) {
      if (goal.memberId) {
        const memberGoals = grouped.get(goal.memberId) || [];
        memberGoals.push(goal);
        grouped.set(goal.memberId, memberGoals);
      }
    }
    return grouped;
  });

  // ========== FILTERED GETTERS (by global member filter) ==========

  // Goals filtered by global member filter
  // Family-wide goals (memberId is null/undefined) are always included
  const filteredGoals = computed(() => {
    const memberFilter = useMemberFilterStore();
    if (!memberFilter.isInitialized || memberFilter.isAllSelected) {
      return goals.value;
    }
    return goals.value.filter((g) => {
      // Family-wide goals always show
      if (!g.memberId) return true;
      return memberFilter.isMemberSelected(g.memberId);
    });
  });

  const filteredActiveGoals = computed(() => filteredGoals.value.filter((g) => !g.isCompleted));

  const filteredCompletedGoals = computed(() => filteredGoals.value.filter((g) => g.isCompleted));

  // Actions
  async function loadGoals() {
    isLoading.value = true;
    error.value = null;
    try {
      goals.value = await goalRepo.getAllGoals();
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to load goals';
    } finally {
      isLoading.value = false;
    }
  }

  async function createGoal(input: CreateGoalInput): Promise<Goal | null> {
    isLoading.value = true;
    error.value = null;
    try {
      const goal = await goalRepo.createGoal(input);
      goals.value.push(goal);
      return goal;
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to create goal';
      return null;
    } finally {
      isLoading.value = false;
    }
  }

  async function updateGoal(id: string, input: UpdateGoalInput): Promise<Goal | null> {
    isLoading.value = true;
    error.value = null;
    try {
      const existing = goals.value.find((g) => g.id === id);
      const wasCompleted = existing?.isCompleted ?? false;

      // Auto-complete if currentAmount meets targetAmount
      if (existing && input.currentAmount !== undefined && !input.isCompleted) {
        if (input.currentAmount >= existing.targetAmount) {
          input = { ...input, isCompleted: true };
        }
      }

      const updated = await goalRepo.updateGoal(id, input);
      if (updated) {
        const index = goals.value.findIndex((g) => g.id === id);
        if (index !== -1) {
          goals.value[index] = updated;
        }

        // Fire celebration when goal transitions to completed
        if (updated.isCompleted && !wasCompleted) {
          celebrate(updated.type === 'debt_payoff' ? 'debt-free' : 'goal-reached');
        }
      }
      return updated ?? null;
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to update goal';
      return null;
    } finally {
      isLoading.value = false;
    }
  }

  async function deleteGoal(id: string): Promise<boolean> {
    isLoading.value = true;
    error.value = null;
    try {
      const success = await goalRepo.deleteGoal(id);
      if (success) {
        useTombstoneStore().recordDeletion('goal', id);
        goals.value = goals.value.filter((g) => g.id !== id);
      }
      return success;
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to delete goal';
      return false;
    } finally {
      isLoading.value = false;
    }
  }

  async function updateProgress(id: string, currentAmount: number): Promise<Goal | null> {
    return updateGoal(id, { currentAmount });
  }

  function getGoalById(id: string): Goal | undefined {
    return goals.value.find((g) => g.id === id);
  }

  function getGoalsByMemberId(memberId: string): Goal[] {
    return goals.value.filter((g) => g.memberId === memberId);
  }

  function getGoalProgress(goal: Goal): number {
    if (goal.targetAmount === 0) return 100;
    return Math.min(100, (goal.currentAmount / goal.targetAmount) * 100);
  }

  function resetState() {
    goals.value = [];
    isLoading.value = false;
    error.value = null;
  }

  return {
    // State
    goals,
    isLoading,
    error,
    // Getters
    activeGoals,
    completedGoals,
    familyGoals,
    overdueGoals,
    goalsByPriority,
    goalsByMember,
    // Filtered getters (by global member filter)
    filteredGoals,
    filteredActiveGoals,
    filteredCompletedGoals,
    // Actions
    loadGoals,
    createGoal,
    updateGoal,
    deleteGoal,
    updateProgress,
    getGoalById,
    getGoalsByMemberId,
    getGoalProgress,
    resetState,
  };
});
