import { createRepository } from '../createRepository';
import { getDatabase } from '../database';
import type { Goal, CreateGoalInput, UpdateGoalInput } from '@/types/models';

const repo = createRepository<'goals', Goal, CreateGoalInput, UpdateGoalInput>('goals');

export const getAllGoals = repo.getAll;
export const getGoalById = repo.getById;
export const createGoal = repo.create;
export const updateGoal = repo.update;
export const deleteGoal = repo.remove;

export async function getGoalsByMemberId(memberId: string): Promise<Goal[]> {
  const db = await getDatabase();
  return db.getAllFromIndex('goals', 'by-memberId', memberId);
}

export async function getFamilyGoals(): Promise<Goal[]> {
  const goals = await getAllGoals();
  return goals.filter((g) => !g.memberId);
}

export async function getActiveGoals(): Promise<Goal[]> {
  const goals = await getAllGoals();
  return goals.filter((g) => !g.isCompleted);
}

export async function updateGoalProgress(
  id: string,
  currentAmount: number
): Promise<Goal | undefined> {
  const goal = await getGoalById(id);
  if (!goal) return undefined;
  const isCompleted = currentAmount >= goal.targetAmount;
  return updateGoal(id, { currentAmount, isCompleted });
}

export function getGoalProgress(goal: Goal): number {
  if (goal.targetAmount === 0) return 100;
  return Math.min(100, (goal.currentAmount / goal.targetAmount) * 100);
}

export function isGoalOverdue(goal: Goal): boolean {
  if (!goal.deadline || goal.isCompleted) return false;
  return new Date(goal.deadline) < new Date();
}
