/**
 * The wall edits ONE row at a time.
 *
 * Each `WallJobRow` used to own a local `renaming` flag, so tapping a second
 * row while the first was open left two inputs live at once, and tapping away
 * from an UNCHANGED row left its input open indefinitely (the commit-on-blur
 * path only fires when the draft is dirty, so nothing closed it).
 *
 * Module-level rather than component state, for the same reason
 * `useCelebrationSeen` is: component state resets with the component, and rows
 * are re-keyed and re-mounted constantly on the wall. It is also the only place
 * that can answer "is any other row editing" without a parent holding the
 * answer, and `WallJobRow` sits under `WallJobList`, which serves the board, the
 * lanes and the sheet.
 *
 * Switching rows is a SAVE, not a discard: the losing row sees `editing` fall
 * to false, and `useInlineRename` commits a dirty draft on that edge. Same
 * behaviour the lists drawer already has through `useInlineEdit`.
 */
import { computed, type ComputedRef } from 'vue';
import { ref } from 'vue';

/** The `WallJob.key` of the row being edited, or null. */
const activeRow = ref<string | null>(null);

export function useWallRowEdit(rowKey: () => string): {
  editing: ComputedRef<boolean>;
  start: () => void;
  stop: () => void;
} {
  return {
    editing: computed(() => activeRow.value === rowKey()),
    start: () => {
      activeRow.value = rowKey();
    },
    /**
     * Guarded on identity: a row closing because ANOTHER row took over must not
     * clear the new row's claim on its way out.
     */
    stop: () => {
      if (activeRow.value === rowKey()) activeRow.value = null;
    },
  };
}

/** Close whatever is open — the wall relocking, or a surface tearing down. */
export function closeWallRowEdit(): void {
  activeRow.value = null;
}

export function __resetWallRowEditForTests(): void {
  activeRow.value = null;
}
