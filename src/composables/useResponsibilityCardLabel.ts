// Who Owns What (#109) — card → display text, the render-site resolver (mirrors
// `useListCategoryLabel`). A built-in card's name and done line live in the i18n layer
// with authored `en` + `beanie` values, so `t(key)` already covers English, beanie mode
// and other locales. A custom card is the family's own plain text and is never
// translated. The family's done-line override wins over the default for EVERY card.
//
// Never throws and never logs: an unknown card (from a newer client) is detected and
// logged once in `resolveDeck` / the store, not at every render.
import { useTranslation } from '@/composables/useTranslation';
import type { ResponsibilityCardDef } from '@/constants/responsibilityCards';

/** The fields label resolution needs; a `ResolvedCard` satisfies it. */
export interface CardLabelSource {
  id: string;
  def?: ResponsibilityCardDef;
  custom?: { name: string; emoji: string };
  doneOverride?: string;
}

export function useResponsibilityCardLabel() {
  const { t } = useTranslation();

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

  return { cardName, cardDone, cardEmoji };
}
