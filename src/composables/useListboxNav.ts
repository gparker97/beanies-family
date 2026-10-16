import { computed, ref, watch, type Ref, type WatchSource } from 'vue';

/**
 * The keyboard half of an APG combobox whose popup is a `role="listbox"` of options:
 * which option is highlighted, whether Escape has dismissed the popup, and the ids that
 * wire `aria-controls` / `aria-activedescendant`.
 *
 * It owns ArrowDown / ArrowUp (both wrap) and Escape, and nothing else: Enter, Tab and any
 * key a caller gives a meaning to stay with the caller, because what Enter commits differs
 * per field. `onNavKey` returns whether it consumed the key, so a caller can run its own
 * pre-key logic first and then fall through to its own branches.
 *
 * `count` is how many options the popup would show right now (0 = no popup). `resetOn` is
 * the field's query (or anything that makes the list a new question): when it changes, a
 * previous Escape no longer applies and the highlight is cleared. A change in `count` also
 * clears the highlight, so Enter can never commit an option that is no longer there.
 *
 * `RecipeTagInput.vue` holds the same state by hand; its migration is a recorded follow-up
 * (#134 plan, Follow-ups), and `onNavKey`'s boolean is the shape that migration needs.
 */
export function useListboxNav(count: Ref<number>, resetOn: WatchSource) {
  /** -1 = nothing highlighted. */
  const active = ref(-1);
  /** Escape closes the popup for the current query, until `resetOn` changes. */
  const dismissed = ref(false);
  const listboxId = `listbox-${Math.random().toString(36).slice(2, 9)}`;

  const open = computed(() => count.value > 0 && !dismissed.value);

  /** The id of option `i`, for `aria-activedescendant` and each option's `id`. */
  const optionId = (i: number) => `${listboxId}-${i}`;
  const activeDescendant = computed(() =>
    open.value && active.value >= 0 ? optionId(active.value) : undefined
  );

  watch(count, () => {
    active.value = -1;
  });
  watch(resetOn, () => {
    dismissed.value = false;
    active.value = -1;
  });

  /**
   * Handle a keydown. `wasOpen` lets a caller pass the open state it captured before its
   * own pre-key logic ran (which may itself change what is open); it defaults to now.
   */
  function onNavKey(e: KeyboardEvent, wasOpen: boolean = open.value): boolean {
    if (!wasOpen) return false;
    const n = count.value;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      active.value = (active.value + 1) % n;
      return true;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      active.value = active.value <= 0 ? n - 1 : active.value - 1;
      return true;
    }
    if (e.key === 'Escape') {
      // APG combobox: Escape closes the popup. `stopPropagation` only while it is open, so
      // the press that dismisses the list cannot also close the drawer around the field; a
      // second Escape, with the list closed, propagates normally.
      e.preventDefault();
      e.stopPropagation();
      dismissed.value = true;
      active.value = -1;
      return true;
    }
    return false;
  }

  /** Clear the highlight and any dismissal (after a pick, say). */
  function reset(): void {
    active.value = -1;
    dismissed.value = false;
  }

  return { active, dismissed, open, listboxId, optionId, activeDescendant, onNavKey, reset };
}
