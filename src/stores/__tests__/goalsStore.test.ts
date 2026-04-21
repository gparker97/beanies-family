import { setActivePinia, createPinia } from 'pinia';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Goal } from '@/types/models';

vi.mock('@/services/automerge/repositories/goalRepository', () => ({
  getAllGoals: vi.fn().mockResolvedValue([]),
  createGoal: vi.fn(),
  updateGoal: vi.fn(),
  deleteGoal: vi.fn(),
}));

vi.mock('@/utils/id', () => ({
  generateUUID: vi.fn(() => 'contrib-test-id'),
}));

vi.mock('@/composables/useCelebration', () => ({
  celebrate: vi.fn(),
}));

vi.mock('@/stores/memberFilterStore', () => ({
  useMemberFilterStore: () => ({
    getSelectedMemberAccountIds: () => new Set<string>(),
    isAllSelected: true,
  }),
}));

vi.mock('@/composables/useMemberFiltered', () => ({
  createMemberFiltered: <T>(source: { value: T[] }) => ({ value: source.value }),
}));

import { useGoalsStore } from '../goalsStore';
import * as goalRepo from '@/services/automerge/repositories/goalRepository';

function goal(overrides: Partial<Goal> = {}): Goal {
  return {
    id: 'goal-1',
    memberId: 'member-1',
    name: 'College Fund',
    type: 'savings',
    targetAmount: 1000,
    currentAmount: 500,
    currency: 'USD',
    priority: 'medium',
    isCompleted: false,
    createdAt: '2026-04-01',
    updatedAt: '2026-04-01',
    ...overrides,
  };
}

describe('goalsStore.updateGoal — manual contribution invariant', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  it('without options: no manualContributions write', async () => {
    const store = useGoalsStore();
    store.goals.push(goal());
    vi.mocked(goalRepo.updateGoal).mockImplementation(async (_id, input) => ({
      ...goal(),
      ...input,
    }));

    await store.updateGoal('goal-1', { currentAmount: 600 });

    expect(goalRepo.updateGoal).toHaveBeenCalledWith(
      'goal-1',
      expect.not.objectContaining({ manualContributions: expect.anything() })
    );
  });

  it('with contribution + delta===0: no append', async () => {
    const store = useGoalsStore();
    store.goals.push(goal({ currentAmount: 500 }));
    vi.mocked(goalRepo.updateGoal).mockImplementation(async (_id, input) => ({
      ...goal(),
      ...input,
    }));

    await store.updateGoal(
      'goal-1',
      { currentAmount: 500 },
      { contribution: { author: 'member-1' } }
    );

    expect(goalRepo.updateGoal).toHaveBeenCalledWith(
      'goal-1',
      expect.not.objectContaining({ manualContributions: expect.anything() })
    );
  });

  it('with contribution + positive delta: appends signed entry', async () => {
    const store = useGoalsStore();
    store.goals.push(goal({ currentAmount: 500 }));
    vi.mocked(goalRepo.updateGoal).mockImplementation(async (_id, input) => ({
      ...goal(),
      ...input,
    }));

    await store.updateGoal(
      'goal-1',
      { currentAmount: 700 },
      { contribution: { author: 'member-1' } }
    );

    const call = vi.mocked(goalRepo.updateGoal).mock.calls[0]![1]!;
    expect(call.manualContributions).toHaveLength(1);
    expect(call.manualContributions![0]).toMatchObject({
      id: 'contrib-test-id',
      amount: 200,
      updatedBy: 'member-1',
    });
    expect(call.manualContributions![0]!.note).toBeUndefined();
  });

  it('with contribution + negative delta: appends negative entry', async () => {
    const store = useGoalsStore();
    store.goals.push(goal({ currentAmount: 500 }));
    vi.mocked(goalRepo.updateGoal).mockImplementation(async (_id, input) => ({
      ...goal(),
      ...input,
    }));

    await store.updateGoal(
      'goal-1',
      { currentAmount: 450 },
      { contribution: { author: 'member-1' } }
    );

    const call = vi.mocked(goalRepo.updateGoal).mock.calls[0]![1]!;
    expect(call.manualContributions![0]!.amount).toBe(-50);
  });

  it('with contribution + note: note is stored on entry', async () => {
    const store = useGoalsStore();
    store.goals.push(goal({ currentAmount: 500 }));
    vi.mocked(goalRepo.updateGoal).mockImplementation(async (_id, input) => ({
      ...goal(),
      ...input,
    }));

    await store.updateGoal(
      'goal-1',
      { currentAmount: 600 },
      { contribution: { author: 'member-1', note: "mom's birthday money" } }
    );

    const call = vi.mocked(goalRepo.updateGoal).mock.calls[0]![1]!;
    expect(call.manualContributions![0]!.note).toBe("mom's birthday money");
  });

  it('with contribution but no currentAmount in input: no append', async () => {
    const store = useGoalsStore();
    store.goals.push(goal({ currentAmount: 500 }));
    vi.mocked(goalRepo.updateGoal).mockImplementation(async (_id, input) => ({
      ...goal(),
      ...input,
    }));

    await store.updateGoal('goal-1', { name: 'Renamed' }, { contribution: { author: 'member-1' } });

    const call = vi.mocked(goalRepo.updateGoal).mock.calls[0]![1]!;
    expect(call.manualContributions).toBeUndefined();
  });

  it('preserves existing manualContributions + appends new one', async () => {
    const existingContrib = {
      id: 'prev',
      amount: 100,
      at: '2026-04-01T00:00:00.000Z',
      updatedBy: 'member-1',
    };
    const store = useGoalsStore();
    store.goals.push(goal({ currentAmount: 500, manualContributions: [existingContrib] }));
    vi.mocked(goalRepo.updateGoal).mockImplementation(async (_id, input) => ({
      ...goal(),
      ...input,
    }));

    await store.updateGoal(
      'goal-1',
      { currentAmount: 600 },
      { contribution: { author: 'member-1' } }
    );

    const call = vi.mocked(goalRepo.updateGoal).mock.calls[0]![1]!;
    expect(call.manualContributions).toHaveLength(2);
    expect(call.manualContributions![0]!.id).toBe('prev');
    expect(call.manualContributions![1]!.id).toBe('contrib-test-id');
  });

  it('auto-complete still fires when currentAmount crosses targetAmount', async () => {
    const store = useGoalsStore();
    store.goals.push(goal({ currentAmount: 500, targetAmount: 1000 }));
    vi.mocked(goalRepo.updateGoal).mockImplementation(async (_id, input) => ({
      ...goal(),
      ...input,
    }));

    await store.updateGoal(
      'goal-1',
      { currentAmount: 1000 },
      { contribution: { author: 'member-1' } }
    );

    const call = vi.mocked(goalRepo.updateGoal).mock.calls[0]![1]!;
    expect(call.isCompleted).toBe(true);
    expect(call.manualContributions).toHaveLength(1);
  });
});
