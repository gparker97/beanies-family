// Who Owns What (#109) — card → display text, the render-site resolver (mirrors
// `useListCategoryLabel`). A built-in card's name and done line live in the i18n layer
// with authored `en` + `beanie` values, so `t(key)` already covers English, beanie mode
// and other locales. A custom card is the family's own plain text and is never
// translated. The family's done-line override wins over the default for EVERY card.
//
// Never throws and never logs: an unknown card (from a newer client) is detected and
// logged once in `resolveDeck` / the store, not at every render.
import { useTranslation } from '@/composables/useTranslation';
import { useMemberInfo } from '@/composables/useMemberInfo';
import { fillTemplate } from '@/utils/fillTemplate';
import type { ResponsibilityCardDef } from '@/constants/responsibilityCards';
import type { CardSplitMode } from '@/types/models';

/** The fields label resolution needs; a `ResolvedCard` satisfies it. */
export interface CardLabelSource {
  id: string;
  def?: ResponsibilityCardDef;
  custom?: { name: string; emoji: string };
  doneOverride?: string;
}

export function useResponsibilityCardLabel() {
  const { t } = useTranslation();
  const { getMemberName } = useMemberInfo();

  function cardName(card: CardLabelSource): string {
    if (card.custom) return card.custom.name;
    return card.def ? t(card.def.nameKey) : card.id;
  }

  /** "What done looks like, at a minimum". Empty string when a custom card has none. */
  function cardDone(card: CardLabelSource): string {
    const override = card.doneOverride?.trim();
    if (override) return override;
    return card.def ? t(card.def.doneKey) : '';
  }

  function cardEmoji(card: CardLabelSource): string {
    return card.custom?.emoji ?? card.def?.emoji ?? '🃏';
  }

  /** What a split part is: "for Mia" on a child split, the family's label on a label split. */
  function partCaption(
    card: { splitMode: CardSplitMode },
    part: { key: string; label?: string }
  ): string {
    if (card.splitMode === 'child') {
      return fillTemplate(t('whoOwnsWhat.card.forChild'), { name: getMemberName(part.key, '') });
    }
    return card.splitMode === 'label' ? (part.label ?? '') : '';
  }

  return { cardName, cardDone, cardEmoji, partCaption };
}
