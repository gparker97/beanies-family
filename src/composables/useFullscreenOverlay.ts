import type { Ref } from 'vue';
import { useEscapeClose } from '@/composables/useEscapeClose';
import { useBodyScrollLock } from '@/composables/useBodyScrollLock';

/**
 * Standard behavior bundle for a viewport-blocking overlay (modal, drawer,
 * side panel, full-screen menu): Escape key closes it, body scroll locks
 * while it is open.
 *
 * **Use this for** any UI that takes over the screen and the user expects
 * to dismiss with Escape — `BaseModal`, `BaseSidePanel`,
 * `MobileHamburgerMenu`, `MobileNavBeanStack`.
 *
 * **Do NOT use this for** inline UI that does not take over the viewport —
 * popovers, dropdowns, tooltips, comboboxes. Their keyboard and scroll
 * semantics differ; call the underlying composables (`useEscapeClose`
 * alone, etc.) directly instead.
 *
 * The two underlying composables each carry their own try/catch + logged
 * fallback for sandboxed-iframe edge cases — see their doc-blocks for
 * documented degradation paths. This wrapper adds no new failure surface.
 *
 * Future overlay-universal hardening (focus trap, aria-modal, page inert)
 * should be added here so all consumers pick it up automatically.
 *
 * @param isOpen   reactive flag mirroring the overlay's open state
 * @param onClose  invoked when Escape is pressed while the overlay is open
 */
export function useFullscreenOverlay(isOpen: Ref<boolean>, onClose: () => void): void {
  useEscapeClose(isOpen, onClose);
  useBodyScrollLock(isOpen);
}
