import { computed, ref, type ComputedRef } from 'vue';

/**
 * Which beans the beanie wall is showing.
 *
 * Extracted from `BeanieWallPage` because it carries two rules that are easy to lose and fail
 * QUIETLY when they are lost — a wall showing nobody looks like a wall with nothing on. Both are
 * pinned in `useWallMemberFocus.test.ts`; mounting the whole wall page to reach them is not a
 * test anyone would keep running.
 *
 * ⚠️ DELIBERATELY NOT `memberFilterStore`. That filter is the account holder's, persisted and
 * shared with the planner, and a child poking the wall must not silently re-filter a parent's
 * phone. This one is wall-local and lives only as long as the page.
 */
export interface WallMemberFocus {
  /**
   * The focused bean ids, already intersected with the live roster. EMPTY means everyone.
   *
   * ⚠️ READONLY. It used to be handed out as a writable `Ref<string[]>` and passed straight to
   * `WallFooter` as a prop, so the footer's `props.focused` WAS the live array — and Vue does
   * not warn about mutating a prop's elements in place.
   */
  focusedMemberIds: ComputedRef<readonly string[]>;
  /**
   * What the views consume.
   *
   * `null` means "no filter" and is kept distinct from an empty array so a view can tell it
   * apart from "a filter that matches nobody" without a second flag.
   */
  visibleMemberIds: ComputedRef<readonly string[] | null>;
  /** Add or remove one bean. Removing the last falls back to everyone. */
  toggle: (memberId: string) => void;
  /** Back to everyone. */
  clear: () => void;
}

export function useWallMemberFocus(roster: () => readonly string[]): WallMemberFocus {
  /** What the user actually tapped. Never read directly — see `focusedMemberIds`. */
  const chosen = ref<string[]>([]);

  /**
   * The choice, intersected with the CURRENT roster.
   *
   * ⚠️ RECONCILE ON READ, not on a watcher. A watch was tried and was worse in three ways at
   * once: its source had to hash the roster on every store reload (a 10s poll) even when nobody
   * was filtering; the hash collapsed "nobody focused" and "roster empty" onto the same empty
   * string, so an emptied roster never pruned and the wall stayed filtered to nobody; and it
   * left a window between the roster changing and the callback running. Deriving has none of
   * those: a member who leaves stops counting the instant the roster says so.
   *
   * It is also why a departed member is IGNORED rather than deleted — a transient roster reload
   * does not quietly rewrite what the user chose.
   */
  const focusedMemberIds = computed<readonly string[]>(() => {
    if (chosen.value.length === 0) return [];
    const present = new Set(roster());
    return chosen.value.filter((id) => present.has(id));
  });

  // A computed CACHES, so every view is handed the SAME array — `readonly` in the type is the
  // guard, not a per-consumer copy.
  const visibleMemberIds = computed<readonly string[] | null>(() =>
    focusedMemberIds.value.length === 0 ? null : focusedMemberIds.value
  );

  /**
   * Toggle one bean in or out of the focus.
   *
   * Removing the last one falls back to everyone rather than to an empty filter — which is what
   * an empty `chosen` already means, so it needs no special case. The wall is a glanceable
   * screen: a state where nothing matches and the only explanation is an unlit chip is the
   * failure `WallChoreBoard`'s empty-state describes, and it is worth designing out.
   */
  function toggle(memberId: string): void {
    // Off the RECONCILED list, so a tap cannot resurrect a departed member sitting in `chosen`.
    chosen.value = focusedMemberIds.value.includes(memberId)
      ? focusedMemberIds.value.filter((id) => id !== memberId)
      : [...focusedMemberIds.value, memberId];
  }

  function clear(): void {
    chosen.value = [];
  }

  return { focusedMemberIds, visibleMemberIds, toggle, clear };
}
