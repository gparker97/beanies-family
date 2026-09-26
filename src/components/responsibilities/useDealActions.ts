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
 * A component that shows its own trace of an action (the deal pile's emoji row under a
 * face) passes `onUndone`, called only when the toast's Undo actually landed.
 */
import { dismissToast, hasToastAction, invokeToastAction, showToast } from '@/composables/useToast';
import { useTranslation } from '@/composables/useTranslation';
import { useMemberInfo } from '@/composables/useMemberInfo';
import { useResponsibilityCardLabel } from '@/composables/useResponsibilityCardLabel';
import { useResponsibilityStore, type UndoableResult } from '@/stores/responsibilityStore';
import { fillTemplate } from '@/utils/fillTemplate';
import type { ResolvedCard } from '@/utils/responsibilityDeck';
import type { UndoToken } from '@/utils/responsibilityOps';

export const UNDO_TOAST_MS = 6000;

export interface DealActionOptions {
  /** Called after the toast's Undo landed (never on a refused or failed undo). */
  onUndone?: () => void;
}

/** The one deck toast last shown, shared by every consumer. */
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

  function offer(title: string, token: UndoToken | null, opts?: DealActionOptions): void {
    if (liveUndoToastId !== null) dismissToast(liveUndoToastId);
    liveUndoToastId = token
      ? showToast('success', title, undefined, {
          actionLabel: t('action.undo'),
          actionFn: async () => {
            if (await undo(token)) opts?.onUndone?.();
          },
          durationMs: UNDO_TOAST_MS,
        })
      : showToast('success', title);
  }

  async function deal(
    cardId: string,
    partKey: string,
    memberId: string | null,
    opts?: DealActionOptions
  ): Promise<UndoableResult<ResolvedCard> | null> {
    const res = await store.deal(cardId, partKey, memberId);
    if (!res) return null;
    const card = cardName(res.result);
    offer(
      memberId
        ? fillTemplate(t('whoOwnsWhat.toast.dealt'), { card, name: getMemberName(memberId, '') })
        : fillTemplate(t('whoOwnsWhat.toast.cleared'), { card }),
      res.undo,
      opts
    );
    return res;
  }

  async function keep(
    cardId: string,
    opts?: DealActionOptions
  ): Promise<UndoableResult<ResolvedCard> | null> {
    const res = await store.keep(cardId);
    if (!res) return null;
    offer(
      fillTemplate(t('whoOwnsWhat.toast.kept'), { card: cardName(res.result) }),
      res.undo,
      opts
    );
    return res;
  }

  async function skip(
    cardIds: readonly string[],
    opts?: DealActionOptions
  ): Promise<UndoableResult<string[]> | null> {
    const res = await store.skip(cardIds);
    if (!res) return null;
    const only = cardIds.length === 1 ? store.cardById(cardIds[0]!) : undefined;
    offer(
      only
        ? fillTemplate(t('whoOwnsWhat.toast.skipped.one'), { card: cardName(only) })
        : fillTemplate(t('whoOwnsWhat.toast.skipped.other'), { count: cardIds.length }),
      res.undo,
      opts
    );
    return res;
  }

  async function bringBack(
    cardId: string,
    opts?: DealActionOptions
  ): Promise<UndoableResult<ResolvedCard> | null> {
    const res = await store.bringBack(cardId);
    if (!res) return null;
    offer(
      fillTemplate(t('whoOwnsWhat.toast.broughtBack'), { card: cardName(res.result) }),
      res.undo,
      opts
    );
    return res;
  }

  /**
   * Whether the last deck toast is still on screen with its Undo, so `U` has something to
   * tap. Read from the live toast list: a toast that expired, was dismissed or was used is
   * gone from it, and then the remembered id is cleared too.
   */
  function hasLiveUndo(): boolean {
    if (liveUndoToastId === null) return false;
    const live = hasToastAction(liveUndoToastId);
    if (!live) liveUndoToastId = null;
    return live;
  }

  /**
   * The `U` shortcut: tap the live toast's Undo. `invokeToastAction` runs it, reports a
   * thrown handler with an error toast, and no-ops when the toast has already expired.
   * With no live Undo (none shown yet, or a plain toast) there is nothing to do.
   */
  async function undoLast(): Promise<void> {
    const id = liveUndoToastId;
    if (id === null || !hasLiveUndo()) {
      // eslint-disable-next-line no-console -- an expected no-op (U with nothing to undo), debug only
      console.debug('[useDealActions] undoLast: no live undo toast');
      return;
    }
    liveUndoToastId = null;
    await invokeToastAction(id);
  }

  return { deal, keep, skip, bringBack, undo, undoLast, hasLiveUndo };
}
