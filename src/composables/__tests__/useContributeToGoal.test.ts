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
  applyContribution: vi.fn<(id: string, delta: number, opts?: unknown) => Promise<Goal | null>>(),
};
vi.mock('@/stores/goalsStore', () => ({
  useGoalsStore: () => goalsState,
  // Same shape as the real helper (its own behaviour is covered by the store tests).
  contributionEntry: (amount: number, c: { id: string; author: string; note?: string }) => ({
    id: c.id,
    amount,
    at: 'now',
    updatedBy: c.author,
    ...(c.note ? { note: c.note } : {}),
  }),
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
    goalsState.applyContribution.mockReset();
  });

  /** Mimic the store: record the caller-minted contribution id on the returned goal. */
  function echoMintedId(currentAmount: number, amount: number, followedBy: string[] = []) {
    goalsState.applyContribution.mockImplementation(async (_id, _delta, opts) => {
      const minted = (opts as { contribution: { id: string } }).contribution.id;
      return goal({
        currentAmount,
        manualContributions: [
          { id: minted, amount, at: '...', updatedBy: 'member-1' },
          ...followedBy.map((id) => ({ id, amount: 5, at: '...', updatedBy: 'member-2' })),
        ],
      });
    });
  }

  it('positive amount → appends contribution + fires success toast with undo action', async () => {
    echoMintedId(600, 100);

    const { contribute } = useContributeToGoal();
    const result = await contribute('g-1', { amount: 100 });

    expect(result.success).toBe(true);
    const minted = goalsState.applyContribution.mock.calls[0]![2] as {
      contribution: { id: string };
    };
    expect(result.contributionId).toBe(minted.contribution.id);
    expect(result.appliedDelta).toBe(100);
    // Relative write: the delta (not a pre-computed absolute) plus the history entry.
    expect(goalsState.applyContribution).toHaveBeenCalledWith('g-1', 100, {
      contribution: expect.objectContaining({
        id: minted.contribution.id,
        amount: 100,
        updatedBy: 'member-1',
      }),
    });
    expect(goalsState.updateGoal).not.toHaveBeenCalled();
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

  it("Undo targets the minted id even when another device's entry follows it", async () => {
    echoMintedId(600, 100, ['c-other-device']);
    const { contribute } = useContributeToGoal();
    const result = await contribute('g-1', { amount: 100 });
    const minted = (
      goalsState.applyContribution.mock.calls[0]![2] as { contribution: { id: string } }
    ).contribution.id;
    expect(result.contributionId).toBe(minted);
    expect(result.contributionId).not.toBe('c-other-device');

    // Fire the toast's Undo against a live goal holding both entries.
    goalsState.goals = [
      goal({
        currentAmount: 605,
        manualContributions: [
          { id: minted, amount: 100, at: '...', updatedBy: 'member-1' },
          { id: 'c-other-device', amount: 5, at: '...', updatedBy: 'member-2' },
        ],
      }),
    ];
    goalsState.applyContribution.mockReset().mockResolvedValue(goal());
    const toastOpts = showToastMock.mock.calls.find(
      (c) => c[1] === 'goalContribute.successToast'
    )![3];
    await toastOpts.actionFn();
    // Undo is relative and names the entry by id; the worker splices it, so the other
    // device's entry is untouched.
    expect(goalsState.applyContribution).toHaveBeenCalledWith('g-1', -100, {
      undoContributionId: minted,
    });
  });

  it('zero / negative amount → warn + returns false (no store call)', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { contribute } = useContributeToGoal();

    expect((await contribute('g-1', { amount: 0 })).success).toBe(false);
    expect((await contribute('g-1', { amount: -50 })).success).toBe(false);

    expect(goalsState.applyContribution).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('missing goal → toast + return false', async () => {
    goalsState.goals = [];
    const { contribute } = useContributeToGoal();
    const result = await contribute('g-missing', { amount: 100 });
    expect(result.success).toBe(false);
    expect(showToastMock).toHaveBeenCalledWith('error', 'goalView.notFound');
    expect(goalsState.applyContribution).not.toHaveBeenCalled();
  });

  it('no author (resolveOrToast returns null) → return false, no store call', async () => {
    resolveOrToastMock.mockReturnValue(null);
    const { contribute } = useContributeToGoal();
    const result = await contribute('g-1', { amount: 100 });
    expect(result.success).toBe(false);
    expect(goalsState.applyContribution).not.toHaveBeenCalled();
  });

  it('contribution with note → note passed through to store options', async () => {
    goalsState.applyContribution.mockResolvedValue(
      goal({
        currentAmount: 600,
        manualContributions: [{ id: 'c-new', amount: 100, at: '...', updatedBy: 'member-1' }],
      })
    );
    const { contribute } = useContributeToGoal();
    await contribute('g-1', { amount: 100, note: "mom's birthday money" });
    expect(goalsState.applyContribution).toHaveBeenCalledWith('g-1', 100, {
      contribution: expect.objectContaining({
        note: "mom's birthday money",
        updatedBy: 'member-1',
      }),
    });
  });

  it('crossing a 25/50/75/100 milestone fires celebrate', async () => {
    // Goal target 1000; current 400 → contribute 150 → new current 550 → crosses 50%
    goalsState.goals = [goal({ currentAmount: 400 })];
    goalsState.applyContribution.mockResolvedValue(goal({ currentAmount: 550 }));
    const { contribute } = useContributeToGoal();
    await contribute('g-1', { amount: 150 });
    expect(celebrateMock).toHaveBeenCalledWith('goal-milestone');
  });

  it('not crossing a milestone does not fire celebrate', async () => {
    goalsState.goals = [goal({ currentAmount: 600 })];
    goalsState.applyContribution.mockResolvedValue(goal({ currentAmount: 650 }));
    const { contribute } = useContributeToGoal();
    await contribute('g-1', { amount: 50 });
    expect(celebrateMock).not.toHaveBeenCalled();
  });

  it('targetAmount of 0 → no milestone check (guard against divide-by-zero)', async () => {
    goalsState.goals = [goal({ targetAmount: 0, currentAmount: 0 })];
    goalsState.applyContribution.mockResolvedValue(goal({ targetAmount: 0, currentAmount: 100 }));
    const { contribute } = useContributeToGoal();
    await contribute('g-1', { amount: 100 });
    expect(celebrateMock).not.toHaveBeenCalled();
  });

  it('store failure → success:false', async () => {
    goalsState.applyContribution.mockResolvedValue(null);
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
      { contribution: { id: expect.any(String), author: 'member-1', note: undefined } }
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
    goalsState.applyContribution.mockReset();
  });

  it('reverses the delta relatively + names the entry to splice + toasts success', async () => {
    goalsState.applyContribution.mockResolvedValue(goal({ currentAmount: 500 }));
    const { undoContribution } = useContributeToGoal();
    await undoContribution('g-1', 'c-undo-me', 100);

    expect(goalsState.applyContribution).toHaveBeenCalledWith('g-1', -100, {
      undoContributionId: 'c-undo-me',
    });
    expect(showToastMock).toHaveBeenCalledWith('success', 'goalContribute.revertedToast');
  });

  it('goal missing → warn + error toast + no store call', async () => {
    goalsState.goals = [];
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { undoContribution } = useContributeToGoal();
    await undoContribution('g-missing', 'c-any', 100);

    expect(goalsState.applyContribution).not.toHaveBeenCalled();
    expect(showToastMock).toHaveBeenCalledWith('error', 'goalContribute.undoFailed');
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
