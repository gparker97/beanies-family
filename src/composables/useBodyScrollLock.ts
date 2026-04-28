import { onScopeDispose, watch, type Ref } from 'vue';
import { lockBodyScroll, unlockBodyScroll } from '@/utils/overlayStack';

/**
 * Reactively locks the body scroll while an overlay is open.
 *
 * Delegates to the existing ref-counted `lockBodyScroll` / `unlockBodyScroll`
 * primitives in `src/utils/overlayStack.ts`, which cooperate across nested
 * overlays — body scroll is only restored when ALL overlays release their
 * lock.
 *
 * Tracks our own lock-acquired flag so we never call `unlockBodyScroll`
 * without a matching `lockBodyScroll`. `onScopeDispose` is the safety net:
 * if the consuming component unmounts while still locked, we release the
 * lock to keep the global counter accurate.
 *
 * Failure modes:
 * - `document.body.style` mutation throws (sandboxed iframe with denied
 *   access): caught and logged with `[useBodyScrollLock]` prefix;
 *   degrades silently — page may scroll under the overlay (visible to
 *   the user) but the app keeps working.
 *
 * @param isOpen — reactive flag mirroring the overlay's open state
 */
export function useBodyScrollLock(isOpen: Ref<boolean>): void {
  let locked = false;

  function acquire() {
    if (locked) return;
    try {
      lockBodyScroll();
      locked = true;
    } catch (err) {
      console.warn('[useBodyScrollLock] could not lock body scroll:', err);
    }
  }

  function release() {
    if (!locked) return;
    try {
      unlockBodyScroll();
    } catch (err) {
      console.warn('[useBodyScrollLock] could not unlock body scroll:', err);
    }
    locked = false;
  }

  watch(
    isOpen,
    (open) => {
      if (open) acquire();
      else release();
    },
    { immediate: true }
  );

  onScopeDispose(release);
}
