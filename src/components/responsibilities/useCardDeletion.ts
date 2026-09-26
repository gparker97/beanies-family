/**
 * Who Owns What (#109): delete a family-made card, the ONE path shared by the view and
 * edit drawers. Only custom cards can be deleted (built-ins are skipped instead, and the
 * drawers show the disabled tile with its reason). Always behind a danger confirm that
 * names the card; resolves `true` only when the card is gone, so the caller closes then.
 * The store has already shown and logged any failure or refusal. `onConfirmed` runs after
 * the confirm and right before the store write, so a caller can tell ITS delete apart from
 * one made elsewhere while the confirm was up.
 */
import { watch, type Ref } from 'vue';
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

/**
 * The drawer side of a card's end, shared by the view and edit drawers so neither can be
 * left open over a card that is gone: an empty shell, or (edit) a stale form whose Save
 * would write onto the next card the page opens.
 *  - `onDelete`: the drawer's own delete tile. Closes when the card is gone however the
 *    delete ended (ours succeeded, or the store refused because another device deleted it
 *    first, and has said so).
 *  - A card that disappears while the drawer is open (deleted or restored elsewhere) gets
 *    the card-gone notice and a close, so the page resets its open state. Our own confirmed
 *    delete is not a surprise (it has its own toast), so it is skipped while being written;
 *    a card deleted elsewhere while OUR confirm is up still gets the notice.
 */
export function useCardDrawerEnd(opts: {
  card: Readonly<Ref<ResolvedCard | undefined>>;
  isOpen: () => boolean;
  close: () => void;
  /** Console tag naming the drawer, for a card-gone breadcrumb. */
  source: string;
}) {
  const { t } = useTranslation();
  const { confirmAndDeleteCard } = useCardDeletion();
  /** True only while THIS drawer's confirmed delete is being written. */
  let deleting = false;

  async function onDelete(): Promise<void> {
    const card = opts.card.value;
    if (!card) return;
    let deleted = false;
    try {
      deleted = await confirmAndDeleteCard(card, { onConfirmed: () => (deleting = true) });
    } finally {
      deleting = false;
    }
    if (deleted || (opts.isOpen() && !opts.card.value)) opts.close();
  }

  watch(opts.card, (next, prev) => {
    if (opts.isOpen() && prev && !next && !deleting) {
      console.warn(`[${opts.source}] card disappeared while the drawer was open:`, prev.id);
      showToast('info', t('whoOwnsWhat.error.cardGone'), t('whoOwnsWhat.error.cardGoneHelp'));
      opts.close();
    }
  });

  return { onDelete };
}
