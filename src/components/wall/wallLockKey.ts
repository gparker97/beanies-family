/**
 * The wall's lock channel. `WallJobRow` sits four levels below the page and
 * needs the lock, and drilling it through three purely pass-through components
 * would be worse than one typed provide.
 *
 * Optional at every consumer. The old docblock here claimed the default throws
 * so a wall component mounted outside the wall would fail loudly; that was
 * never true of any call site, all of which have always used
 * `inject(WALL_LOCK, undefined)` and optional-chained. Rendering READ-ONLY is
 * the honest degradation for a row with no lock to consult, and it is what
 * lets the unit tests mount these components without a provider.
 */
import { computed, inject } from 'vue';
import type { ComputedRef, InjectionKey, Ref } from 'vue';

export interface WallLockContext {
  isLocked: Ref<boolean>;
  noteActivity: () => void;
}

export const WALL_LOCK: InjectionKey<WallLockContext> = Symbol('wallLock');

/**
 * The ONE nullish-safe reader of the lock.
 *
 * `canEdit` was previously the same expression written out by hand in
 * `WallChoreBoard` and `WallSheet`, and this change needs it in two more
 * places. Two definitions of "this wall accepts writes" is an invitation to
 * disagree; four would be a certainty.
 */
export function useWallLock(): {
  /** True only when the wall is explicitly unlocked. No lock means read-only. */
  canEdit: ComputedRef<boolean>;
  /**
   * Reset the idle relock timer. MUST be called on every edit interaction,
   * including keystrokes: the timer is 2 minutes, and a slow rename that never
   * awaits would otherwise relock and `v-if` the editor out mid-word.
   */
  noteActivity: () => void;
} {
  const lock = inject(WALL_LOCK, undefined);
  return {
    canEdit: computed(() => lock?.isLocked.value === false),
    noteActivity: () => lock?.noteActivity(),
  };
}
