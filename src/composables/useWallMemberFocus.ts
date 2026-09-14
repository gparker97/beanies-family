import { computed, ref, watch, type ComputedRef, type Ref } from 'vue';

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
  /** The focused bean ids. EMPTY means everyone. */
  focusedMemberIds: Ref<string[]>;
  /**
   * What the views consume.
   *
   * `null` means "no filter" and is kept distinct from an empty array so a view can tell it
   * apart from "a filter that matches nobody" without a second flag.
   */
  visibleMemberIds: ComputedRef<string[] | null>;
  /** Add or remove one bean. Removing the last falls back to everyone. */
  toggle: (memberId: string) => void;
  /** Back to everyone. */
  clear: () => void;
}

export function useWallMemberFocus(roster: () => string[]): WallMemberFocus {
  const focusedMemberIds = ref<string[]>([]);

  const visibleMemberIds = computed(() =>
    focusedMemberIds.value.length === 0 ? null : [...focusedMemberIds.value]
  );

  function toggle(memberId: string): void {
    focusedMemberIds.value = focusedMemberIds.value.includes(memberId)
      ? focusedMemberIds.value.filter((id) => id !== memberId)
      : [...focusedMemberIds.value, memberId];
  }

  function clear(): void {
    focusedMemberIds.value = [];
  }

  /**
   * Drop anyone the roster no longer has.
   *
   * ⚠️ A live bug BEFORE the filter went multi-select, and multi-select only widens it: a
   * cross-device merge that removes a member — or re-tags a human as a pet — left the filter
   * pointing at somebody who is gone, so every view matched nobody with no chip lit to explain
   * it. `WallChoreBoard` carries an empty state for exactly that; reconciling here keeps that
   * empty state a backstop rather than the thing a family actually sees.
   *
   * Watches the JOINED ids rather than the array: the roster is recomputed on every store touch,
   * so an identity watch would fire constantly and a deep watch would walk every member object.
   */
  watch(
    () => roster().join(','),
    (joined) => {
      if (focusedMemberIds.value.length === 0) return;
      const present = new Set(joined ? joined.split(',') : []);
      const kept = focusedMemberIds.value.filter((id) => present.has(id));
      // Assign only on a real change, or this writes a new array on every roster touch and
      // re-renders every view with the same ids.
      if (kept.length !== focusedMemberIds.value.length) focusedMemberIds.value = kept;
    }
  );

  return { focusedMemberIds, visibleMemberIds, toggle, clear };
}
