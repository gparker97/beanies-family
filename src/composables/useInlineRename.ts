/**
 * Tap-to-rename in place: the draft, the focus, and the three ways an edit can
 * end without losing the text.
 *
 * Extracted from `ListItemRow`, which already got every edge case right, and
 * consumed by both it and `WallJobRow`. The discipline is subtle enough that a
 * second hand-written copy would drift, and until this extraction the component
 * that owned it had no test coverage at all.
 *
 * THE ENTER / BLUR ASYMMETRY IS THE CONTRACT. Do not "simplify" it into one
 * rule:
 *
 *   - `onEnter` saves UNCONDITIONALLY, including a blank draft. Both stores
 *     no-op an empty or unchanged title, so clearing the field and pressing
 *     Enter reverts cleanly. Making Enter dirty-checked would silently change
 *     that into "nothing happens"; making the STORES delete on empty would turn
 *     it into data loss. Deletion is the remove button's job, never an emptied
 *     edit.
 *   - `onBlur`, the unmount backstop and the falling edge of `editing` save
 *     ONLY when the draft is non-blank AND differs from `current()`.
 *
 * `resolved` makes every path idempotent: whichever terminal action fires first
 * wins and the rest are no-ops. That is what stops the native blur fired by an
 * unmounting input from re-committing an edit the user just cancelled.
 *
 * Escape is owned HERE and only here, through the shared `useEscapeClose`
 * stack, so an editing row sits on top of it and one Escape cancels the rename
 * without dismissing whatever it is nested inside. A consumer must NOT also
 * bind `@keyup.esc` on the input: two cancel paths for one keypress are
 * currently harmless only because `resolved` happens to absorb the second, and
 * that is exactly the sort of accidental safety that stops being true after the
 * next edit.
 */
import { computed, nextTick, onBeforeUnmount, ref, watch, type Ref } from 'vue';
import { useEscapeClose } from '@/composables/useEscapeClose';

export interface InlineRenameOptions {
  /**
   * Owned by the CALLER: a local ref in `WallJobRow`, `toRef(props, 'editing')`
   * in `ListItemRow`, whose parent drives it through `useInlineEdit`. That
   * difference is the only reason the two rows cannot share a component.
   *
   * Optional-typed so an optional `editing` prop can be passed straight in
   * without a cast; absent means not editing.
   */
  editing: Ref<boolean | undefined>;
  /** The committed value, read fresh on each rising edge and each dirty check. */
  current: () => string;
  /** Never called twice for one edit session. */
  save: (next: string) => void;
  cancel: () => void;
}

export function useInlineRename(opts: InlineRenameOptions) {
  const draft = ref('');
  const inputRef = ref<HTMLInputElement | null>(null);
  /** A terminal action already ran this session. Guards the backstops. */
  const resolved = ref(false);

  function commitIfDirty(): void {
    if (resolved.value) return;
    resolved.value = true;
    if (draft.value.trim() && draft.value !== opts.current()) opts.save(draft.value);
  }

  function onEnter(): void {
    if (resolved.value) return;
    resolved.value = true;
    opts.save(draft.value);
  }

  function onEsc(): void {
    if (resolved.value) return;
    resolved.value = true;
    opts.cancel();
  }

  /** Tap-away save, and the native blur an unmounting input fires. */
  function onBlur(): void {
    commitIfDirty();
  }

  watch(opts.editing, (isEditing, was) => {
    if (isEditing && !was) {
      draft.value = opts.current();
      resolved.value = false;
      void nextTick(() => inputRef.value?.focus());
    } else if (!isEditing && was) {
      // The owner ended this edit (a switch to another field, a closing
      // drawer). Commit a dirty draft rather than dropping it.
      commitIfDirty();
    }
  });

  // A focused input removed from the DOM does not reliably fire blur, so this
  // is the last line of defence against losing typed text.
  onBeforeUnmount(() => commitIfDirty());

  // `useEscapeClose` wants a definite boolean; an absent prop is "not editing".
  useEscapeClose(
    computed(() => opts.editing.value === true),
    onEsc
  );

  return { draft, inputRef, onEnter, onEsc, onBlur };
}
