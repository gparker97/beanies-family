/**
 * The category guess in a form (#152): while a NEW activity or transaction is typed, the
 * category its title or description names is picked for the person, shown under the field
 * (`CategoryGuessHint`), and changed with one tap. The words are matched by the caller's
 * `suggest` (`utils/categorySuggest.ts`); this file owns only the rule for when a guess may
 * write the category, and the `category-guess` telemetry surface.
 *
 * The rule, the same in every form:
 *  - a category not written by the guess is a pick (by hand, an AI prefill, a duplicate, a
 *    linked activity) and is never overridden, whatever is typed afterwards;
 *  - while the category is still the guess it follows the words: a different match replaces
 *    it, no match clears it;
 *  - a deferred guess (an occasion in the activity form) is shown but never written, so
 *    occasion mode only starts when the title is committed (`useOccasionForm.onTitleCommit`);
 *  - Change on a deferred guess declines THAT category: the guess goes, and while the words
 *    still name it, it is neither shown nor committed (`declined`); a different occasion typed
 *    afterwards is guessed as usual, and every decline holds until `reset()`;
 *  - a disabled form (editing, a transfer) never guesses and never writes.
 *
 * Picks are detected by VALUE when the guess runs, not by each write path remembering to say
 * so: anything in `category` the guess did not write is a pick. The one write a value cannot
 * reveal (an outside write of the SAME value as the guess: a tap on the guessed chip, a linked
 * activity that maps to it) calls `markPicked()`.
 *
 * Nothing is stored about how a category was chosen. `reset()` must be called from BOTH the
 * form's `onNew` and `onEdit`: a drawer is reused, so a create session's guess would otherwise
 * leak into the next edit. It also makes the guess run again for the new session, after the
 * fill, so a reopen with the same prefilled words still shows its guess.
 *
 * The form's side is small: it binds `hint` onto `CategoryGuessHint` (`v-bind`), sends its
 * picker's choice to `pick`, and holds the template ref `pickerEl` reads. `describe` gives the
 * picture and label for an id, so the one hint shape serves both category tables.
 */
import { computed, ref, watch, type ComputedRef, type Ref } from 'vue';
import type { KeywordHit } from '@/utils/keywordSuggest';
import { logEvent } from '@/services/telemetry/logEvent';
import { useAttentionPulse } from '@/composables/useAttentionPulse';

const SURFACE = 'category-guess';

/** Which form is guessing: the telemetry `kind`. */
export type CategoryGuessKind = 'activity' | 'transaction' | 'quick-add';

/**
 * How a saved new item's category relates to what its words name: the telemetry `action`.
 * `none` when the words name nothing, `kept` when the category is what they name, `changed`
 * otherwise.
 */
export type CategoryGuessOutcome = 'kept' | 'changed' | 'none';

/**
 * The guess state. Whether the category IS the guess is derived, never stored:
 * `written !== null && category === written.value`.
 */
export interface GuessState {
  /** The guess last written into `category`. */
  written: KeywordHit<string> | null;
  /** A guess shown but not written (a deferred occasion). */
  pending: KeywordHit<string> | null;
}

const NO_GUESS: GuessState = { written: null, pending: null };

/**
 * One step of the rule, pure. `category` is the live value (one copy of it, no watcher on it);
 * `hit` is what the words name now; `defer` says the hit must be shown without being written.
 * `write` is present only when `category` must change.
 */
export function nextGuess(
  category: string,
  state: GuessState,
  hit: KeywordHit<string> | undefined,
  defer: boolean
): { state: GuessState; write?: string } {
  const isGuess = state.written !== null && category === state.written.value;
  // A pick: whatever set it, the guess never touches it again.
  if (category && !isGuess) return { state: NO_GUESS };
  if (!hit) return isGuess ? { state: NO_GUESS, write: '' } : { state: NO_GUESS };
  // Deferred: shown, not written. A previous guess comes off so the picker and the chip agree.
  if (defer) {
    const pending: GuessState = { written: null, pending: hit };
    return isGuess ? { state: pending, write: '' } : { state: pending };
  }
  const next: GuessState = { written: hit, pending: null };
  return hit.value === category ? { state: next } : { state: next, write: hit.value };
}

export interface CategoryGuessOptions {
  kind: CategoryGuessKind;
  /** The field the guess reads: the activity title, the transaction description. */
  text: Ref<string>;
  /** The form's category. Written only by the rule above. */
  category: Ref<string>;
  /** The guess for a text. Closes over the direction for transactions, so a flip re-guesses. */
  suggest: (text: string) => KeywordHit<string> | undefined;
  /** True while the guess may run: create mode, and not a transfer. */
  enabled: () => boolean;
  /** A category that is shown but never written (the activity form: `isOccasionCategory`). */
  defer?: (id: string) => boolean;
  /** The Category field group's root element, for Change. */
  pickerEl: () => HTMLElement | null | undefined;
  /** The picture and label the hint shows for a category id. */
  describe: (id: string) => { icon: string; label: string };
  /**
   * How a pick is written into the form. Defaults to setting `category`; the activity form
   * passes its occasion-aware writer, so picking an occasion still applies its defaults.
   */
  write?: (id: string) => void;
}

/** `CategoryGuessHint`'s props, ready for `v-bind`: empty while there is nothing to show. */
export interface CategoryGuessHintProps {
  icon?: string;
  label?: string;
  word?: string;
  /**
   * True while the shown guess is pending (deferred, not yet written). It is written when the
   * field is committed, so a press on the hint must not blur the field: see `CategoryGuessHint`.
   */
  holdFocus?: boolean;
}

export interface CategoryGuess {
  /** The guess to show under the field, or null (no guess, or the category is a pick). */
  shown: ComputedRef<KeywordHit<string> | null>;
  /** `shown`, described for `CategoryGuessHint` (`v-bind`). */
  hint: ComputedRef<CategoryGuessHintProps>;
  /** A pick from the form's picker: never overridden, even when it is the guessed category. */
  pick: (id: string) => void;
  /** The form wrote the category itself with the value the guess holds: it is now a pick. */
  markPicked: () => void;
  /**
   * Forget this form session's guess and declines, then guess again for the new session's text
   * once the form's fill has run. Call FIRST from the form's `onNew` AND `onEdit`.
   */
  reset: () => void;
  /**
   * Change: scroll to the category picker and pulse it once. On a pending guess it also
   * declines it (see `declined`).
   */
  revealPicker: () => void;
  /**
   * True while the words name a category Change declined (by value, every decline held until
   * `reset()`, so declining a second one never brings back the first). A declined category counts
   * as no hit (any other guess still works), and while this is true the
   * form must not commit it from the field either (the activity form skips `onTitleCommit`).
   */
  declined: ComputedRef<boolean>;
  /**
   * True while the category is the guess, not a pick. The transaction forms read it on a
   * direction flip: only a pick is remembered for its direction.
   */
  isGuess: ComputedRef<boolean>;
  /** Log how the saved new item's category relates to the guess. A no-op when disabled. */
  logOutcome: () => void;
}

/** The watcher's value while the guess is off: distinct from "no match" (`null`). */
const DISABLED = Symbol('category-guess-disabled');

export function useCategoryGuess(opts: CategoryGuessOptions): CategoryGuess {
  const { kind, text, category, suggest, enabled, defer, pickerEl, describe } = opts;
  const write = opts.write ?? ((id: string) => (category.value = id));
  const { reveal } = useAttentionPulse();

  const state = ref<GuessState>(NO_GUESS);
  /** Every category Change declined, until `reset()`: only those values are suppressed. */
  const declinedIds = ref(new Set<string>());
  /**
   * A guess was written or shown pending this form session (until `reset()`), for
   * `logOutcome`: with none shown there was no guess to keep or change.
   */
  const guessed = ref(false);
  /**
   * Bumped by `reset()`, so a new form session evaluates the guess even when its text, direction
   * and enabled state are all the same as the last session's (a reopen with the same prefill).
   * The watcher is pre-flush, so it runs after the form's fill and sees a loaded category as a pick.
   */
  const session = ref(0);

  watch([session, () => (enabled() ? (suggest(text.value) ?? null) : DISABLED)], ([, hit]) => {
    // Disabled never means "no match": a no-match step would clear a category the guess
    // wrote earlier, and the drawer reused for an edit would lose its saved category.
    if (hit === DISABLED) {
      state.value = NO_GUESS;
      return;
    }
    const deferred = !!hit && !!defer?.(hit.value);
    // A declined category is no hit: it must neither show again nor stay written.
    const live = hit && declinedIds.value.has(hit.value) ? undefined : (hit ?? undefined);
    const step = nextGuess(category.value, state.value, live, deferred && !!live);
    state.value = step.state;
    if (step.state.written || step.state.pending) guessed.value = true;
    if (step.write !== undefined) category.value = step.write;
  });

  // Derived from the live category, so the chip goes the moment something else writes it (a
  // hand pick, the occasion commit) even though the words, and so the watcher, did not change.
  // A pending guess shows only while nothing is in `category` (it is never written there).
  const isGuess = computed(
    () => state.value.written !== null && category.value === state.value.written.value
  );
  const showsPending = computed(() => !!state.value.pending && category.value === '');
  const shown = computed<KeywordHit<string> | null>(() => {
    if (isGuess.value) return state.value.written;
    return showsPending.value ? state.value.pending : null;
  });
  const declined = computed(() => {
    const id = suggest(text.value)?.value;
    return id !== undefined && declinedIds.value.has(id);
  });

  const hint = computed<CategoryGuessHintProps>(() => {
    const guess = shown.value;
    if (!guess) return {};
    const props: CategoryGuessHintProps = { ...describe(guess.value), word: guess.word };
    if (showsPending.value) props.holdFocus = true;
    return props;
  });

  function markPicked(): void {
    state.value = NO_GUESS;
  }

  /** `markPicked` first: a tap on the chip the guess already holds is a pick too. */
  function pick(id: string): void {
    markPicked();
    write(id);
  }

  function reset(): void {
    state.value = NO_GUESS;
    declinedIds.value = new Set();
    guessed.value = false;
    session.value++;
  }

  /** Change on a pending guess: it goes, and that category stays off until `reset()`. */
  function declinePending(): void {
    const pending = state.value.pending;
    if (!showsPending.value || !pending) return;
    state.value = NO_GUESS;
    declinedIds.value.add(pending.value);
    logEvent({
      level: 'info',
      surface: SURFACE,
      message: 'pending guess declined',
      context: { kind, action: 'declined' },
    });
  }

  function revealPicker(): void {
    declinePending();
    const el = pickerEl();
    if (!el) {
      // `reveal` is silent on a missing element; Change must never do nothing unnoticed.
      console.warn(
        '[category-guess] Change found no category picker; check the template ref on the Category FormFieldGroup',
        { kind }
      );
      logEvent({ level: 'warn', surface: SURFACE, message: 'picker not found', context: { kind } });
      return;
    }
    reveal(el, 'attention-halo');
  }

  /**
   * `none` when no guess was shown this session (a hand pick before typing, a prefill, a linked
   * activity) or the FINAL words name nothing; otherwise measured against the final words, not
   * against a guess shown on the way: "Gas" passed on the way to "Gaston's party" is no guess
   * the person turned down.
   */
  function logOutcome(): void {
    if (!enabled()) return;
    const hit = guessed.value ? suggest(text.value) : undefined;
    const action: CategoryGuessOutcome = !hit
      ? 'none'
      : hit.value === category.value
        ? 'kept'
        : 'changed';
    logEvent({ level: 'info', surface: SURFACE, message: 'submitted', context: { kind, action } });
  }

  return {
    shown,
    hint,
    pick,
    markPicked,
    reset,
    revealPicker,
    declined,
    isGuess,
    logOutcome,
  };
}
