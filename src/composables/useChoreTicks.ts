import { shallowRef } from 'vue';
import { useChoreStore, type ToggleChoreResult } from '@/stores/choreStore';
import { useStarStore } from '@/stores/starStore';
import { isChoreRefusal } from '@/utils/chores';
import type { ChoreCelebrationAnchor } from '@/utils/choreCelebration';

/**
 * The choreboard PAGE's tick path (#146): one in-flight guard keyed `choreId:memberId`, in front
 * of `choreStore.toggleChore(..., { surface: 'app' })`. The store deliberately has no guard of
 * its own (the wall uses `useWallJobs.pending`), so without this a double-tap on a slow device
 * reads the same "not done" projection twice and writes the tick, then the untick.
 *
 * The key holds the member because a shared chore is ticked separately per bean: Pip's tick
 * must not block Juno's. Two DIFFERENT chores in flight together are independent.
 *
 * Failure handling lives in the store (`wrapAsync` toasts and reports once; a refusal toasts and
 * logs `edit-refused`), so a `null` here (a failure or a refusal, which the page treats alike)
 * has already been shown and is never toasted again.
 * The celebration and the `chore-ticked` / `block-complete` telemetry are the store's too.
 *
 * Stars (#148): once the tick resolves, `starStore.afterTick` gets the outcome (not awaited, so
 * the row's pending state clears exactly as before), with `showsBanner` from the caller: whether
 * the surface that ticked draws the weekly reward's banner for that child (a child's day: yes;
 * the Chores view's home cards: no). It decides by itself whether that was a landed tick, and
 * when the child's week is at or above the bar with the week not yet celebrated, and the surface
 * shows the banner, it waits for the block celebration, checks again, claims the week's
 * once-only mark and plays the banner once. A surface with no banner claims nothing.
 */
export function useChoreTicks() {
  const choreStore = useChoreStore();
  const starStore = useStarStore();
  // Replaced (never mutated) so templates reading `isPending` re-render on every change.
  const pending = shallowRef<ReadonlySet<string>>(new Set());

  const keyOf = (choreId: string, memberId: string) => `${choreId}:${memberId}`;

  function isPending(choreId: string, memberId: string): boolean {
    return pending.value.has(keyOf(choreId, memberId));
  }

  function setPending(key: string, on: boolean): void {
    const next = new Set(pending.value);
    if (on) next.add(key);
    else next.delete(key);
    pending.value = next;
  }

  /**
   * Tick or untick. `null` while the same tick is already in flight, or on a refusal/failure.
   * `where.anchor` is where the all-done celebration plays if this tick finishes its block;
   * `where.showsBanner` says whether this surface draws the weekly reward's banner for
   * `memberId` (required: a surface must say so, never default into claiming it).
   */
  async function toggle(
    choreId: string,
    memberId: string,
    where: { anchor?: ChoreCelebrationAnchor | null; showsBanner: boolean }
  ): Promise<ToggleChoreResult | null> {
    const anchor = where.anchor ?? null;
    const key = keyOf(choreId, memberId);
    if (pending.value.has(key)) return null;
    setPending(key, true);
    try {
      const outcome = await choreStore.toggleChore(choreId, memberId, {
        surface: 'app',
        ...(anchor ? { anchor } : {}),
      });
      void starStore.afterTick({
        memberId,
        outcome,
        surface: 'app',
        showsBanner: where.showsBanner,
      });
      return outcome && !isChoreRefusal(outcome) ? outcome : null;
    } finally {
      setPending(key, false);
    }
  }

  return { isPending, toggle };
}
