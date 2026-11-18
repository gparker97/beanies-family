/**
 * The category guess for the two transaction forms (#152): the full transaction drawer and
 * quick add. One place owns what they share: the guess from the description in the table for
 * the direction (`useCategoryGuess` with `suggestTransactionCategory`), how a guessed id is
 * described, and what a Money In / Money Out flip does to the category.
 *
 * A flip uses TWO SLOTS, one remembered category per direction:
 *  - the outgoing direction's slot becomes the current category only when it is a PICK (not
 *    the live guess) that fits the outgoing table; otherwise the slot is emptied;
 *  - the category becomes the incoming direction's slot when it has one; otherwise a pick that
 *    BELONGS to the incoming table is carried over as it is (an income saved with Groceries by an
 *    older build, flipped to Money Out to correct it, keeps Groceries); otherwise it becomes '';
 *  - a pick that is neither saved nor carried is dropped (logged `direction-slot-dropped`);
 *  - the guess then runs as usual and may fill an empty category from the description.
 * Nothing else writes the slots. A guess is never remembered, so it can never come back as a
 * pick, and a category from the other table can never be saved on this direction: Groceries
 * picked under Money Out is put away on a flip to Money In and comes back on the flip back.
 *
 * "Fits the table": the category's own type is that direction. An id the table does not know (a
 * legacy or custom id on a saved transaction) cannot be shown wrong, so it fits too: an edit's
 * round trip through the other direction never loses it. "Belongs to the table" is stricter: the
 * id is known and its type is that direction. An unknown id gives no sign of its direction, so
 * it is put away on a flip, never carried.
 *
 * The flip watcher is `flush: 'sync'`, so the swap lands the moment the direction changes and
 * the guess's own (pre-flush) watcher, which re-runs on the same flip, reads the swapped value.
 *
 * `reset()` starts a form session: call it FIRST in the form's `onNew` and `onEdit`, before the
 * direction and category are filled. It empties the category and both slots, so the fill's own
 * direction write meets an empty category (a loaded category is never put away or swapped by
 * its own load) and a reopened form never restores a previous session's slot.
 */
import { watch, type Ref } from 'vue';
import { useCategoryGuess, type CategoryGuess } from '@/composables/useCategoryGuess';
import { useCategoryLabel } from '@/composables/useCategoryLabel';
import { categoryEmoji, getCategoryById, normalizeCategoryId } from '@/constants/categories';
import { logEvent } from '@/services/telemetry/logEvent';
import { suggestTransactionCategory } from '@/utils/categorySuggest';

type Direction = 'income' | 'expense';

export interface TransactionCategoryGuessOptions {
  kind: 'transaction' | 'quick-add';
  /** The description the guess reads. */
  description: Ref<string>;
  category: Ref<string>;
  /** The direction: which category table the guess and the slots use. */
  type: () => Direction;
  /** True while the guess may run: create mode, and not a transfer. */
  enabled: () => boolean;
  /** The Category field group's root element, for Change. */
  pickerEl: () => HTMLElement | null | undefined;
}

/** True when `id` is a known category of the table for `direction`. */
function belongsTo(id: string, direction: Direction): boolean {
  const def = getCategoryById(normalizeCategoryId(id));
  return !!def && (def.type === direction || def.type === 'both');
}

/** True when `id` belongs to the table for `direction`, or is an id no table knows. */
function fitsTable(id: string, direction: Direction): boolean {
  return !getCategoryById(normalizeCategoryId(id)) || belongsTo(id, direction);
}

export function useTransactionCategoryGuess(opts: TransactionCategoryGuessOptions): CategoryGuess {
  const { kind, description, category, type, enabled, pickerEl } = opts;
  const { categoryLabel } = useCategoryLabel();
  const guess = useCategoryGuess({
    kind,
    text: description,
    category,
    suggest: (text) => suggestTransactionCategory(text, type()),
    enabled,
    pickerEl,
    describe: (id) => ({ icon: categoryEmoji(id), label: categoryLabel(id) }),
  });

  /** The pick remembered for each direction. Written only by the flip, emptied by `reset()`. */
  const slots = new Map<Direction, string>();

  const log = (
    action: 'direction-slot-saved' | 'direction-slot-restored' | 'direction-slot-dropped',
    message: string
  ) => logEvent({ level: 'info', surface: 'category-guess', message, context: { kind, action } });

  watch(
    type,
    (incoming, outgoing) => {
      const current = category.value;
      const isPick = !!current && !guess.isGuess.value;
      const keep = isPick && fitsTable(current, outgoing);
      slots.set(outgoing, keep ? current : '');
      if (keep) log('direction-slot-saved', 'category saved for its direction on flip');
      const restored = slots.get(incoming) ?? '';
      const carried = !restored && isPick && belongsTo(current, incoming);
      category.value = restored || (carried ? current : '');
      if (restored) log('direction-slot-restored', 'category restored on direction flip');
      if (isPick && !keep && !carried) {
        log('direction-slot-dropped', 'picked category dropped on direction flip');
      }
    },
    { flush: 'sync' }
  );

  function reset(): void {
    slots.clear();
    category.value = '';
    guess.reset();
  }

  return { ...guess, reset };
}
