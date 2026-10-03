import { createAutomergeRepository } from '../automergeRepository';
import { mutate } from '../worker/docClient';
import type {
  Goal,
  CreateGoalInput,
  UpdateGoalInput,
  GoalManualContribution,
} from '@/types/models';

const repo = createAutomergeRepository<'goals', Goal, CreateGoalInput, UpdateGoalInput>('goals');

export const getAllGoals = repo.getAll;
export const getGoalById = repo.getById;
export const createGoal = repo.create;
export const updateGoal = repo.update;
export const deleteGoal = repo.remove;

export async function getGoalsByMemberId(memberId: string): Promise<Goal[]> {
  const goals = await getAllGoals();
  return goals.filter((g) => g.memberId === memberId);
}

export async function getFamilyGoals(): Promise<Goal[]> {
  const goals = await getAllGoals();
  return goals.filter((g) => !g.memberId);
}

export async function getActiveGoals(): Promise<Goal[]> {
  const goals = await getAllGoals();
  return goals.filter((g) => !g.isCompleted);
}

/** Optional history side of a relative contribution; both are applied in the same worker change. */
export interface ApplyContributionOptions {
  /** Appended to `manualContributions` (skipped worker-side when the applied delta is 0). */
  contribution?: GoalManualContribution;
  /** Spliced out of `manualContributions` by id (Undo). */
  undoContributionId?: string;
}

/**
 * Atomically apply a RELATIVE contribution delta (worker `applyGoalContribution` op: clamp at 0,
 * auto-complete and the optional history edit happen in one change). Resolves to the echoed goal.
 */
export async function applyContribution(
  id: string,
  delta: number,
  opts?: ApplyContributionOptions
): Promise<Goal> {
  return mutate<Goal>({
    op: 'named',
    name: 'applyGoalContribution',
    args: { id, delta, ...opts },
  });
}

export function getGoalProgress(goal: Goal): number {
  if (goal.targetAmount === 0) return 100;
  return Math.min(100, (goal.currentAmount / goal.targetAmount) * 100);
}

export function isGoalOverdue(goal: Goal): boolean {
  if (!goal.deadline || goal.isCompleted) return false;
  return new Date(goal.deadline) < new Date();
}
