import { useGoalsStore } from '@/stores/goalsStore';
import { useAuthoringMember } from '@/composables/useAuthoringMember';
import { useTranslation } from '@/composables/useTranslation';
import { showToast } from '@/composables/useToast';
import { celebrate } from '@/composables/useCelebration';
import type { Goal, UpdateGoalInput, UUID } from '@/types/models';

export interface ApplyResult {
  success: boolean;
  goal?: Goal;
  contributionId?: string;
  appliedDelta?: number;
}

/**
 * Sole entry point for user-initiated contributions to a goal.
 *
 * Two entry points share an internal `_apply` helper:
 *   - `contribute(goalId, { amount, note? })` — quick-contribute modal flow.
 *     Adds `amount` to `currentAmount`; fires a success toast with an Undo
 *     action button (via `useToast` durationMs + actionFn).
 *   - `saveWithContribution(goalId, input)` — full GoalModal edit flow.
 *     Updates arbitrary fields; if `currentAmount` changed, the store-level
 *     invariant appends a GoalManualContribution. No undo toast here — the
 *     edit flow already confirms via Save.
 *
 * Undo reverses a specific contribution by id + subtracts the amount from
 * the live `currentAmount`, so concurrent contributions from other devices
 * are preserved.
 *
 * Milestones (25/50/75/100% of targetAmount) fire `celebrate('goal-milestone')`
 * when a contribution causes the threshold to be crossed. Wrapped in try/catch
 * so a celebration-layer bug never crashes the save.
 */
export function useContributeToGoal() {
  const goalsStore = useGoalsStore();
  const { resolveOrToast } = useAuthoringMember();
  const { t } = useTranslation();

  async function _apply(
    goalId: UUID,
    newCurrentAmount: number,
    extraInput: Partial<UpdateGoalInput>,
    note: string | undefined,
    fireUndoToast: boolean
  ): Promise<ApplyResult> {
    const goalBefore = goalsStore.goals.find((g) => g.id === goalId);
    if (!goalBefore) {
      console.error('[useContributeToGoal] goal not found:', goalId);
      showToast('error', t('goalView.notFound'));
      return { success: false };
    }

    const author = resolveOrToast({
      callerTag: 'useContributeToGoal',
      toastTitleKey: 'goalContribute.error.noAuthor',
      toastHelpKey: 'goalContribute.error.noAuthorHelp',
    });
    if (!author) return { success: false };

    const updated = await goalsStore.updateGoal(
      goalId,
      { ...extraInput, currentAmount: newCurrentAmount },
      { contribution: { author, note } }
    );
    if (!updated) return { success: false };

    const appliedDelta = updated.currentAmount - goalBefore.currentAmount;
    const contributionId = updated.manualContributions?.at(-1)?.id;

    safeCelebrateMilestone(goalBefore, updated);

    if (fireUndoToast && contributionId && appliedDelta !== 0) {
      showToast('success', t('goalContribute.successToast'), undefined, {
        actionLabel: t('goalContribute.undoLabel'),
        actionFn: () => undoContribution(goalId, contributionId, appliedDelta),
        durationMs: 6000,
      });
    }

    return { success: true, goal: updated, contributionId, appliedDelta };
  }

  /** Quick-contribute: user enters a positive amount + optional note. */
  async function contribute(
    goalId: UUID,
    input: { amount: number; note?: string }
  ): Promise<ApplyResult> {
    if (!(input.amount > 0)) {
      console.warn('[useContributeToGoal] non-positive amount rejected:', input.amount);
      return { success: false };
    }
    const goal = goalsStore.goals.find((g) => g.id === goalId);
    if (!goal) {
      console.error('[useContributeToGoal] goal not found:', goalId);
      showToast('error', t('goalView.notFound'));
      return { success: false };
    }
    return _apply(goalId, goal.currentAmount + input.amount, {}, input.note, true);
  }

  /** Full edit: fields from GoalModal. If currentAmount changed, contribution is recorded. */
  async function saveWithContribution(goalId: UUID, input: UpdateGoalInput): Promise<ApplyResult> {
    if (input.currentAmount === undefined) {
      // Name / priority / deadline-only edit — no contribution context needed.
      const updated = await goalsStore.updateGoal(goalId, input);
      return { success: !!updated, goal: updated ?? undefined };
    }
    return _apply(goalId, input.currentAmount, input, undefined, false);
  }

  /**
   * Reverse a specific contribution: subtract its amount from the live
   * `currentAmount` (preserves concurrent contributions from other devices)
   * + splice the entry by id from `manualContributions`. Single atomic write.
   */
  async function undoContribution(
    goalId: UUID,
    contributionId: string,
    amount: number
  ): Promise<void> {
    const goal = goalsStore.goals.find((g) => g.id === goalId);
    if (!goal) {
      console.warn('[useContributeToGoal] undo failed — goal not found:', goalId);
      showToast('error', t('goalContribute.undoFailed'));
      return;
    }
    const filteredHistory = (goal.manualContributions ?? []).filter((c) => c.id !== contributionId);
    const updated = await goalsStore.updateGoal(goalId, {
      currentAmount: goal.currentAmount - amount,
      manualContributions: filteredHistory,
    });
    if (updated) {
      showToast('success', t('goalContribute.revertedToast'));
    }
  }

  function safeCelebrateMilestone(before: Goal, after: Goal): void {
    try {
      if (before.targetAmount <= 0) return;
      const thresholds = [25, 50, 75, 100];
      const beforePct = (before.currentAmount / before.targetAmount) * 100;
      const afterPct = (after.currentAmount / after.targetAmount) * 100;
      for (const threshold of thresholds) {
        if (beforePct < threshold && afterPct >= threshold) {
          celebrate('goal-milestone');
          return;
        }
      }
    } catch (e) {
      console.warn('[useContributeToGoal] milestone celebration failed:', e);
    }
  }

  return { contribute, saveWithContribution, undoContribution };
}
