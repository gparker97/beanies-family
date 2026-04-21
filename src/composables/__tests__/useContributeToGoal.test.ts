import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Goal } from '@/types/models';

const showToastMock = vi.fn();
vi.mock('@/composables/useToast', () => ({
  showToast: (...args: unknown[]) => showToastMock(...args),
}));

vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

const celebrateMock = vi.fn();
vi.mock('@/composables/useCelebration', () => ({
  celebrate: (...args: unknown[]) => celebrateMock(...args),
}));

const resolveOrToastMock = vi.fn(() => 'member-1' as string | null);
vi.mock('@/composables/useAuthoringMember', () => ({
  useAuthoringMember: () => ({ resolveOrToast: resolveOrToastMock }),
}));

const goalsState = {
  goals: [] as Goal[],
  updateGoal:
    vi.fn<(id: string, input: Partial<Goal>, options?: unknown) => Promise<Goal | null>>(),
};
vi.mock('@/stores/goalsStore', () => ({
  useGoalsStore: () => goalsState,
}));

import { useContributeToGoal } from '../useContributeToGoal';

function goal(overrides: Partial<Goal> = {}): Goal {
  return {
    id: 'g-1',
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

describe('useContributeToGoal.contribute', () => {
  beforeEach(() => {
    showToastMock.mockClear();
    celebrateMock.mockClear();
    resolveOrToastMock.mockReset().mockReturnValue('member-1');
    goalsState.goals = [goal()];
    goalsState.updateGoal.mockReset();
  });

  it('positive amount → appends contribution + fires success toast with undo action', async () => {
    goalsState.updateGoal.mockResolvedValue(
      goal({
        currentAmount: 600,
        manualContributions: [{ id: 'c-new', amount: 100, at: '...', updatedBy: 'member-1' }],
      })
    );

    const { contribute } = useContributeToGoal();
    const result = await contribute('g-1', { amount: 100 });

    expect(result.success).toBe(true);
    expect(result.contributionId).toBe('c-new');
    expect(result.appliedDelta).toBe(100);
    expect(goalsState.updateGoal).toHaveBeenCalledWith(
      'g-1',
      expect.objectContaining({ currentAmount: 600 }),
      { contribution: { author: 'member-1', note: undefined } }
    );
    // Toast with action button
    expect(showToastMock).toHaveBeenCalledWith(
      'success',
      'goalContribute.successToast',
      undefined,
      expect.objectContaining({
        actionLabel: 'goalContribute.undoLabel',
        actionFn: expect.any(Function),
        durationMs: 6000,
      })
    );
  });

  it('zero / negative amount → warn + returns false (no store call)', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { contribute } = useContributeToGoal();

    expect((await contribute('g-1', { amount: 0 })).success).toBe(false);
    expect((await contribute('g-1', { amount: -50 })).success).toBe(false);

    expect(goalsState.updateGoal).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('missing goal → toast + return false', async () => {
    goalsState.goals = [];
    const { contribute } = useContributeToGoal();
    const result = await contribute('g-missing', { amount: 100 });
    expect(result.success).toBe(false);
    expect(showToastMock).toHaveBeenCalledWith('error', 'goalView.notFound');
    expect(goalsState.updateGoal).not.toHaveBeenCalled();
  });

  it('no author (resolveOrToast returns null) → return false, no store call', async () => {
    resolveOrToastMock.mockReturnValue(null);
    const { contribute } = useContributeToGoal();
    const result = await contribute('g-1', { amount: 100 });
    expect(result.success).toBe(false);
    expect(goalsState.updateGoal).not.toHaveBeenCalled();
  });

  it('contribution with note → note passed through to store options', async () => {
    goalsState.updateGoal.mockResolvedValue(
      goal({
        currentAmount: 600,
        manualContributions: [{ id: 'c-new', amount: 100, at: '...', updatedBy: 'member-1' }],
      })
    );
    const { contribute } = useContributeToGoal();
    await contribute('g-1', { amount: 100, note: "mom's birthday money" });
    expect(goalsState.updateGoal).toHaveBeenCalledWith('g-1', expect.any(Object), {
      contribution: { author: 'member-1', note: "mom's birthday money" },
    });
  });

  it('crossing a 25/50/75/100 milestone fires celebrate', async () => {
    // Goal target 1000; current 400 → contribute 150 → new current 550 → crosses 50%
    goalsState.goals = [goal({ currentAmount: 400 })];
    goalsState.updateGoal.mockResolvedValue(goal({ currentAmount: 550 }));
    const { contribute } = useContributeToGoal();
    await contribute('g-1', { amount: 150 });
    expect(celebrateMock).toHaveBeenCalledWith('goal-milestone');
  });

  it('not crossing a milestone does not fire celebrate', async () => {
    goalsState.goals = [goal({ currentAmount: 600 })];
    goalsState.updateGoal.mockResolvedValue(goal({ currentAmount: 650 }));
    const { contribute } = useContributeToGoal();
    await contribute('g-1', { amount: 50 });
    expect(celebrateMock).not.toHaveBeenCalled();
  });

  it('targetAmount of 0 → no milestone check (guard against divide-by-zero)', async () => {
    goalsState.goals = [goal({ targetAmount: 0, currentAmount: 0 })];
    goalsState.updateGoal.mockResolvedValue(goal({ targetAmount: 0, currentAmount: 100 }));
    const { contribute } = useContributeToGoal();
    await contribute('g-1', { amount: 100 });
    expect(celebrateMock).not.toHaveBeenCalled();
  });

  it('store failure → success:false', async () => {
    goalsState.updateGoal.mockResolvedValue(null);
    const { contribute } = useContributeToGoal();
    const result = await contribute('g-1', { amount: 100 });
    expect(result.success).toBe(false);
  });
});

describe('useContributeToGoal.saveWithContribution', () => {
  beforeEach(() => {
    showToastMock.mockClear();
    celebrateMock.mockClear();
    resolveOrToastMock.mockReset().mockReturnValue('member-1');
    goalsState.goals = [goal()];
    goalsState.updateGoal.mockReset();
  });

  it('currentAmount undefined → plain update, no contribution options', async () => {
    goalsState.updateGoal.mockResolvedValue(goal({ name: 'Renamed' }));
    const { saveWithContribution } = useContributeToGoal();
    await saveWithContribution('g-1', { name: 'Renamed' });
    expect(goalsState.updateGoal).toHaveBeenCalledWith('g-1', { name: 'Renamed' });
  });

  it('currentAmount changed → calls _apply with contribution (no undo toast)', async () => {
    goalsState.updateGoal.mockResolvedValue(
      goal({
        currentAmount: 800,
        manualContributions: [{ id: 'c-new', amount: 300, at: '...', updatedBy: 'member-1' }],
      })
    );
    const { saveWithContribution } = useContributeToGoal();
    await saveWithContribution('g-1', { currentAmount: 800 });

    expect(goalsState.updateGoal).toHaveBeenCalledWith(
      'g-1',
      expect.objectContaining({ currentAmount: 800 }),
      { contribution: { author: 'member-1', note: undefined } }
    );
    // No undo toast for the edit flow
    const undoCalls = showToastMock.mock.calls.filter(
      (c) => c[1] === 'goalContribute.successToast'
    );
    expect(undoCalls).toHaveLength(0);
  });
});

describe('useContributeToGoal.undoContribution', () => {
  beforeEach(() => {
    showToastMock.mockClear();
    celebrateMock.mockClear();
    goalsState.goals = [
      goal({
        currentAmount: 600,
        manualContributions: [
          { id: 'c-prev', amount: 50, at: '...', updatedBy: 'member-1' },
          { id: 'c-undo-me', amount: 100, at: '...', updatedBy: 'member-1' },
        ],
      }),
    ];
    goalsState.updateGoal.mockReset();
  });

  it('reverses the delta + splices by id + toasts success', async () => {
    goalsState.updateGoal.mockResolvedValue(goal({ currentAmount: 500 }));
    const { undoContribution } = useContributeToGoal();
    await undoContribution('g-1', 'c-undo-me', 100);

    expect(goalsState.updateGoal).toHaveBeenCalledWith(
      'g-1',
      expect.objectContaining({
        currentAmount: 500,
        manualContributions: [expect.objectContaining({ id: 'c-prev' })],
      })
    );
    expect(showToastMock).toHaveBeenCalledWith('success', 'goalContribute.revertedToast');
  });

  it('goal missing → warn + error toast + no store call', async () => {
    goalsState.goals = [];
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { undoContribution } = useContributeToGoal();
    await undoContribution('g-missing', 'c-any', 100);

    expect(goalsState.updateGoal).not.toHaveBeenCalled();
    expect(showToastMock).toHaveBeenCalledWith('error', 'goalContribute.undoFailed');
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
