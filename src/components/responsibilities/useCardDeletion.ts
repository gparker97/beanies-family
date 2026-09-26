/**
 * Who Owns What (#109): delete a family-made card, the ONE path shared by the view and
 * edit drawers. Only custom cards can be deleted (built-ins are skipped instead, and the
 * drawers show the disabled tile with its reason). Always behind a danger confirm that
 * names the card; resolves `true` only when the card is gone, so the caller closes then.
 * The store has already shown and logged any failure or refusal. `onConfirmed` runs after
 * the confirm and right before the store write, so a caller can tell ITS delete apart from
 * one made elsewhere while the confirm was up.
 */
import { confirm } from '@/composables/useConfirm';
import { showToast } from '@/composables/useToast';
import { playWhoosh } from '@/composables/useSounds';
import { useTranslation } from '@/composables/useTranslation';
import { useResponsibilityCardLabel } from '@/composables/useResponsibilityCardLabel';
import { useResponsibilityStore } from '@/stores/responsibilityStore';
import type { ResolvedCard } from '@/utils/responsibilityDeck';

export function useCardDeletion() {
  const store = useResponsibilityStore();
  const { t } = useTranslation();
  const { cardName } = useResponsibilityCardLabel();

  async function confirmAndDeleteCard(
    card: ResolvedCard,
    opts: { onConfirmed?: () => void } = {}
  ): Promise<boolean> {
    if (!card.isCustom) return false;
    const ok = await confirm({
      variant: 'danger',
      title: 'whoOwnsWhat.delete.title',
      message: 'whoOwnsWhat.delete.message',
      detail: cardName(card),
      confirmLabel: 'action.delete',
    });
    if (!ok) return false;
    opts.onConfirmed?.();
    if (!(await store.deleteCustom(card.id))) return false;
    playWhoosh();
    showToast('success', t('whoOwnsWhat.delete.done'));
    return true;
  }

  return { confirmAndDeleteCard };
}
