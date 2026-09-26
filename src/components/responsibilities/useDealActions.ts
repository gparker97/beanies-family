/**
 * Who Owns What (#109): the four undoable deck actions, and the ONE place their undo
 * toast lives.
 *
 * `deal`, `keep`, `skip` and `bringBack` call the store action and, only when it resolved
 * truthy, show a success toast with **Undo** (6s). The store has already toasted and
 * logged every failure or refusal (a falsy result), so nothing here toasts on failure.
 *
 * Only one deck undo toast is visible at a time, across every consumer (the deal pile,
 * the deal board, the check-in drawer, the deck's "Bring back"): the previous one is
 * dismissed before the next is shown, so an Undo tap can never reverse an action the
 * person has already moved past. The id is module state for exactly that reason.
 *
 * Animation stays in the components (`useFlyTo`); this composable is writes and toasts.
 */
import { dismissToast, showToast } from '@/composables/useToast';
import { useTranslation } from '@/composables/useTranslation';
import { useMemberInfo } from '@/composables/useMemberInfo';
import { useResponsibilityCardLabel } from '@/composables/useResponsibilityCardLabel';
import { useResponsibilityStore, type UndoableResult } from '@/stores/responsibilityStore';
import { fillTemplate } from '@/utils/fillTemplate';
import type { ResolvedCard } from '@/utils/responsibilityDeck';
import type { UndoToken } from '@/utils/responsibilityOps';

export const UNDO_TOAST_MS = 6000;

/** The one live deck undo toast, shared by every consumer. */
let liveUndoToastId: number | null = null;

/** Test seam: forget the live toast between tests. */
export function resetDealActionsForTest(): void {
  liveUndoToastId = null;
}

export function useDealActions() {
  const store = useResponsibilityStore();
  const { t } = useTranslation();
  const { getMemberName } = useMemberInfo();
  const { cardName } = useResponsibilityCardLabel();

  /** Resolves `true` when the undo landed; the store has shown any refusal. */
  async function undo(token: UndoToken): Promise<true | null> {
    const ok = await store.undo(token);
    if (ok) showToast('success', t('whoOwnsWhat.toast.undone'));
    return ok;
  }

  function offer(title: string, token: UndoToken | null): void {
    if (liveUndoToastId !== null) dismissToast(liveUndoToastId);
    liveUndoToastId = token
      ? showToast('success', title, undefined, {
          actionLabel: t('action.undo'),
          actionFn: async () => {
            await undo(token);
          },
          durationMs: UNDO_TOAST_MS,
        })
      : showToast('success', title);
  }

  async function deal(
    cardId: string,
    partKey: string,
    memberId: string | null
  ): Promise<UndoableResult<ResolvedCard> | null> {
    const res = await store.deal(cardId, partKey, memberId);
    if (!res) return null;
    const card = cardName(res.result);
    offer(
      memberId
        ? fillTemplate(t('whoOwnsWhat.toast.dealt'), { card, name: getMemberName(memberId, '') })
        : fillTemplate(t('whoOwnsWhat.toast.cleared'), { card }),
      res.undo
    );
    return res;
  }

  async function keep(cardId: string): Promise<UndoableResult<ResolvedCard> | null> {
    const res = await store.keep(cardId);
    if (!res) return null;
    offer(fillTemplate(t('whoOwnsWhat.toast.kept'), { card: cardName(res.result) }), res.undo);
    return res;
  }

  async function skip(cardIds: readonly string[]): Promise<UndoableResult<string[]> | null> {
    const res = await store.skip(cardIds);
    if (!res) return null;
    const only = cardIds.length === 1 ? store.cardById(cardIds[0]!) : undefined;
    offer(
      only
        ? fillTemplate(t('whoOwnsWhat.toast.skipped.one'), { card: cardName(only) })
        : fillTemplate(t('whoOwnsWhat.toast.skipped.other'), { count: cardIds.length }),
      res.undo
    );
    return res;
  }

  async function bringBack(cardId: string): Promise<UndoableResult<ResolvedCard> | null> {
    const res = await store.bringBack(cardId);
    if (!res) return null;
    offer(
      fillTemplate(t('whoOwnsWhat.toast.broughtBack'), { card: cardName(res.result) }),
      res.undo
    );
    return res;
  }

  return { deal, keep, skip, bringBack, undo };
}
