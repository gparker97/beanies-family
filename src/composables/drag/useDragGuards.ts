/**
 * Calendar drag and drop (#142): the global side effects of one press-and-drag, each an
 * install/uninstall pair.
 *
 * - **Context menu**: a long-press on Android raises `contextmenu`; while a press is pending
 *   or lifted it is prevented (the touch callout and text selection are handled in CSS on
 *   the chips themselves).
 * - **The click after a drop**: nothing else suppresses the click a pointer gesture ends
 *   with, so a drop would open the drawer, drill into a day or open Add Activity. `disarm`
 *   with `swallowClick` installs a one-shot capture-phase `click` swallow on `window` that
 *   expires after `CLICK_SWALLOW_MS`. A plain tap never reaches `disarm(true)` (the binding
 *   disarms an abandoned press without it), so its click goes through as today.
 *
 * The root `touchmove` preventer is NOT here: it must exist before `touchstart` (Chrome
 * decides then whether a blocking listener covers the touch), so the binding installs it
 * once at bind time.
 */
import { getCurrentScope, onScopeDispose } from 'vue';

export const CLICK_SWALLOW_MS = 500;

export function useDragGuards() {
  let armed = false;
  let swallowTimer: ReturnType<typeof setTimeout> | null = null;

  function onContextMenu(e: Event): void {
    e.preventDefault();
  }

  function onClick(e: Event): void {
    e.preventDefault();
    e.stopImmediatePropagation();
    stopSwallow();
  }

  function stopSwallow(): void {
    if (swallowTimer === null) return;
    clearTimeout(swallowTimer);
    swallowTimer = null;
    window.removeEventListener('click', onClick, true);
  }

  /** A press began: prevent the long-press context menu until `disarm`. Idempotent. */
  function arm(): void {
    if (armed) return;
    armed = true;
    window.addEventListener('contextmenu', onContextMenu, true);
  }

  /** The press or drag ended. `swallowClick` after a pointer drag (drop or cancel). */
  function disarm(swallowClick = false): void {
    if (armed) {
      armed = false;
      window.removeEventListener('contextmenu', onContextMenu, true);
    }
    if (!swallowClick) return;
    stopSwallow();
    window.addEventListener('click', onClick, true);
    swallowTimer = setTimeout(stopSwallow, CLICK_SWALLOW_MS);
  }

  function dispose(): void {
    disarm(false);
    stopSwallow();
  }

  if (getCurrentScope()) onScopeDispose(dispose);

  return { arm, disarm, dispose };
}
