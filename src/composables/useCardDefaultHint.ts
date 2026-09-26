// Who Owns What (#109) — the derived "why" beside a creation-time default.
//
// When beanies puts a card holder on a meal, a list or a hint, the explanation is computed
// at render time from the CURRENT holder (nothing is stored on the meal, list or to-do),
// so it can never drift from the deck. One helper so the meal modal, the new-list sheet
// and the hint chip word it the same way.
import { useTranslation } from '@/composables/useTranslation';
import { useMemberInfo } from '@/composables/useMemberInfo';
import { useResponsibilityCardLabel } from '@/composables/useResponsibilityCardLabel';
import { useResponsibilityStore } from '@/stores/responsibilityStore';
import { fillTemplate } from '@/utils/fillTemplate';
import type { CardDefaultTarget } from '@/constants/responsibilityCards';

export function useCardDefaultHint() {
  const store = useResponsibilityStore();
  const { t } = useTranslation();
  const { getMemberName } = useMemberInfo();
  const { cardName } = useResponsibilityCardLabel();

  /** The target's single card holder, or null (not loaded, split, waiting or unmapped). */
  function holderFor(target: CardDefaultTarget) {
    return store.defaultHolderFor(target);
  }

  /**
   * "Sofia holds Cooking Dinner in Who Owns What." — only when `memberId` (the chosen
   * cook / owner) is that holder, or always when `memberId` is omitted. Empty otherwise.
   */
  function holdsHint(target: CardDefaultTarget, memberId?: string): string {
    const holder = holderFor(target);
    if (!holder || (memberId !== undefined && memberId !== holder.memberId)) return '';
    const card = store.cardById(holder.cardId);
    if (!card) return '';
    return fillTemplate(t('whoOwnsWhat.default.holds'), {
      name: getMemberName(holder.memberId, ''),
      card: cardName(card),
    });
  }

  return { holderFor, holdsHint };
}
