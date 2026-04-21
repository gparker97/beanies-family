import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { celebrate } from '@/composables/useCelebration';
import { createMemberFiltered } from '@/composables/useMemberFiltered';
import { wrapAsync } from '@/composables/useStoreActions';
import { generateUUID } from '@/utils/id';
import * as goalRepo from '@/services/automerge/repositories/goalRepository';
import type {
  Goal,
  GoalManualContribution,
  CreateGoalInput,
  UpdateGoalInput,
  UUID,
} from '@/types/models';

/** Options passed to `updateGoal` for user-initiated edit paths. */
export interface UpdateGoalOptions {
  /**
   * When set AND `input.currentAmount` differs from the stored value, the
   * store atomically appends a GoalManualContribution. Automated callers
   * (transactionsStore.applyGoalAllocation, recurringProcessor) omit this,
   * so their writes never create audit entries.
   */
  contribution?: { author: UUID; note?: string };
}

/**
 * Pure helper: return a new UpdateGoalInput with a GoalManualContribution
 * appended when the contribution context + a non-zero delta are both present.
 * No mutation; returns the input unchanged otherwise.
 */
function appendContributionIfChanged(
  existing: Goal,
  input: UpdateGoalInput,
  contribution: { author: UUID; note?: string }
): UpdateGoalInput {
  if (input.currentAmount === undefined) return input;
  const delta = input.currentAmount - existing.currentAmount;
  if (delta === 0) return input;
  const entry: GoalManualContribution = {
    id: generateUUID(),
    amount: delta,
    at: new Date().toISOString(),
    updatedBy: contribution.author,
    ...(contribution.note ? { note: contribution.note } : {}),
  };
  return {
    ...input,
    manualContributions: [...(existing.manualContributions ?? []), entry],
  };
}

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
  const filteredGoals = createMemberFiltered(goals, (g) => g.memberId);

  const filteredActiveGoals = computed(() => filteredGoals.value.filter((g) => !g.isCompleted));

  const filteredCompletedGoals = computed(() => filteredGoals.value.filter((g) => g.isCompleted));

  // Actions
  async function loadGoals() {
    await wrapAsync(isLoading, error, async () => {
      goals.value = await goalRepo.getAllGoals();
    });
  }

  async function createGoal(input: CreateGoalInput): Promise<Goal | null> {
    const result = await wrapAsync(isLoading, error, async () => {
      const goal = await goalRepo.createGoal(input);
      // Immutable update: assign a new array so downstream computeds re-evaluate
      goals.value = [...goals.value, goal];
      return goal;
    });
    if (result) window.plausible?.('feature_used', { props: { feature: 'goal' } });
    return result ?? null;
  }

  async function updateGoal(
    id: string,
    input: UpdateGoalInput,
    options?: UpdateGoalOptions
  ): Promise<Goal | null> {
    const result = await wrapAsync(isLoading, error, async () => {
      const existing = goals.value.find((g) => g.id === id);
      const wasCompleted = existing?.isCompleted ?? false;

      // Auto-complete if currentAmount meets targetAmount
      if (existing && input.currentAmount !== undefined && !input.isCompleted) {
        if (input.currentAmount >= existing.targetAmount) {
          input = { ...input, isCompleted: true };
        }
      }

      // User-initiated contribution audit (only when the caller passed
      // `options.contribution` — automated paths skip this branch).
      if (options?.contribution && existing) {
        input = appendContributionIfChanged(existing, input, options.contribution);
      }

      const updated = await goalRepo.updateGoal(id, input);
      if (updated) {
        // Immutable update: assign a new array so downstream computeds re-evaluate
        goals.value = goals.value.map((g) => (g.id === id ? updated : g));

        // Fire celebration when goal transitions to completed
        if (updated.isCompleted && !wasCompleted) {
          celebrate(updated.type === 'debt_payoff' ? 'debt-free' : 'goal-reached');
        }
      }
      return updated;
    });
    return result ?? null;
  }

  async function deleteGoal(id: string): Promise<boolean> {
    const result = await wrapAsync(isLoading, error, async () => {
      const success = await goalRepo.deleteGoal(id);
      if (success) {
        goals.value = goals.value.filter((g) => g.id !== id);
      }
      return success;
    });
    return result ?? false;
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
