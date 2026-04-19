/**
 * Ref-counted body scroll lock for overlays (modals + drawers).
 *
 * Both BaseModal and BaseSidePanel call lockBodyScroll() on open and
 * unlockBodyScroll() on close. The counter ensures body scroll is only
 * restored when ALL overlays have closed — preventing the bug where
 * closing a stacked ConfirmModal re-enables scroll while a drawer
 * is still open underneath.
 */

let overlayCount = 0;

export function lockBodyScroll() {
  overlayCount++;
  document.body.style.overflow = 'hidden';
}

export function unlockBodyScroll() {
  overlayCount = Math.max(0, overlayCount - 1);
  if (overlayCount === 0) {
    document.body.style.overflow = '';
  }
}

/** True when any modal or drawer is open — used to defer destructive actions like a PWA reload while the user is mid-edit. */
export function hasOpenOverlays(): boolean {
  return overlayCount > 0;
}

/** Reset counter — for test isolation only. */
export function resetOverlayStack() {
  overlayCount = 0;
  document.body.style.overflow = '';
}
