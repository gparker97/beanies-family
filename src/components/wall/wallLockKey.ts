/**
 * The one injection key in this feature. `WallJobRow` sits four levels below
 * the page and needs the lock, and drilling it through three purely
 * pass-through components would be worse than one typed provide.
 *
 * The default THROWS so a wall component mounted outside the wall fails loudly
 * in a test rather than silently rendering an unlocked row at runtime.
 */
import type { InjectionKey, Ref } from 'vue';

export interface WallLockContext {
  isLocked: Ref<boolean>;
  noteActivity: () => void;
}

export const WALL_LOCK: InjectionKey<WallLockContext> = Symbol('wallLock');
