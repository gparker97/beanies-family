import { getDatabase } from '../database';
import type { Goal, CreateGoalInput, UpdateGoalInput } from '@/types/models';
import { toISODateString } from '@/utils/date';
import { generateUUID } from '@/utils/id';

export async function getAllGoals(): Promise<Goal[]> {
  const db = await getDatabase();
  return db.getAll('goals');
}

export async function getGoalById(id: string): Promise<Goal | undefined> {
  const db = await getDatabase();
  return db.get('goals', id);
}

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

export async function createGoal(input: CreateGoalInput): Promise<Goal> {
  const db = await getDatabase();
  const now = toISODateString(new Date());

  const goal: Goal = {
    ...input,
    id: generateUUID(),
    createdAt: now,
    updatedAt: now,
  };

  await db.add('goals', goal);
  return goal;
}

export async function updateGoal(id: string, input: UpdateGoalInput): Promise<Goal | undefined> {
  const db = await getDatabase();
  const existing = await db.get('goals', id);

  if (!existing) {
    return undefined;
  }

  const updated: Goal = {
    ...existing,
    ...input,
    updatedAt: toISODateString(new Date()),
  };

  await db.put('goals', updated);
  return updated;
}

export async function deleteGoal(id: string): Promise<boolean> {
  const db = await getDatabase();
  const existing = await db.get('goals', id);

  if (!existing) {
    return false;
  }

  await db.delete('goals', id);
  return true;
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
