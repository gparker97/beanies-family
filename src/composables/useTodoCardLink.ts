import { useRouter } from 'vue-router';
import { useResponsibilityStore } from '@/stores/responsibilityStore';
import { useResponsibilityCardLabel } from '@/composables/useResponsibilityCardLabel';
import { useMemberInfo } from '@/composables/useMemberInfo';
import type { TodoItem } from '@/types/models';
import { cardRoute } from '@/utils/responsibilityDeck';

/** A card-made to-do's card, resolved for display. */
export interface TodoCardLink {
  cardId: string;
  /** The card's display name ("Trash Night"; a custom card's own text). */
  name: string;
  emoji: string;
  /** "for Leo" / the family's label on a split card's part; '' on a single card. */
  partCaption: string;
  /** Who holds the to-do's part today; '' when nobody does. */
  holderName: string;
}

/**
 * The to-do side's one resolver for the card a to-do came from (#123): `TodoItem.cardId` is a
 * soft reference, so it resolves ONLY through `responsibilityStore.cardById` and returns null
 * on a miss (a deleted custom card, a deck not loaded yet). Every to-do surface that names the
 * card (the chip, the Linked Card row, the Repeats block, the roster icon, the "Made by" meta)
 * reads it here, so they can never disagree. Never logs: a missing card is not an error.
 */
export function useTodoCardLink() {
  const responsibilityStore = useResponsibilityStore();
  const { cardName, cardEmoji, partCaption } = useResponsibilityCardLabel();
  const { getMemberName } = useMemberInfo();
  const router = useRouter();

  function resolveCardLink(todo: Pick<TodoItem, 'cardId' | 'cardPartKey'>): TodoCardLink | null {
    if (!todo.cardId) return null;
    const card = responsibilityStore.cardById(todo.cardId);
    if (!card) return null;
    const split = card.splitMode !== 'single';
    // A single card has one part ('main'); a split part that is gone resolves to the card alone.
    const part = split
      ? card.parts.find((p) => p.key === todo.cardPartKey)
      : (card.parts.find((p) => p.key === todo.cardPartKey) ?? card.parts[0]);
    return {
      cardId: card.id,
      name: cardName(card),
      emoji: cardEmoji(card),
      partCaption: split && part ? partCaption(card, part) : '',
      holderName: part?.holderId ? getMemberName(part.holderId, '') : '',
    };
  }

  /** Open the card in Who Owns What. */
  function openCard(cardId: string): void {
    void router.push(cardRoute(cardId));
  }

  return { resolveCardLink, openCard };
}
