import { onScopeDispose, watch, type Ref } from 'vue';

/**
 * Closes an open overlay when the user presses the Escape key.
 *
 * Adds a `keydown` listener on the window only while `isOpen` is true; the
 * listener is torn down when `isOpen` flips to false, when the consuming
 * scope is disposed (component unmount), or when both happen.
 *
 * `onScopeDispose` is the safety net — it guarantees that an unexpected
 * teardown (e.g. parent unmounted while still open) cannot leave a leaked
 * listener attached to the window.
 *
 * Failure modes:
 * - `addEventListener` / `removeEventListener` throws (extremely rare;
 *   sandboxed iframes that have lost access to `window`): caught and
 *   logged with `[useEscapeClose]` prefix; degrades silently — Esc no
 *   longer closes the overlay but the rest of the app keeps working.
 *
 * @param isOpen   — reactive flag mirroring the overlay's open state
 * @param onClose  — invoked with no arguments when Escape is pressed
 *                   while the overlay is open
 */
export function useEscapeClose(isOpen: Ref<boolean>, onClose: () => void): void {
  let attached = false;

  function handler(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      onClose();
    }
  }

  function attach() {
    if (attached) return;
    try {
      window.addEventListener('keydown', handler);
      attached = true;
    } catch (err) {
      console.warn('[useEscapeClose] could not attach keydown listener:', err);
    }
  }

  function detach() {
    if (!attached) return;
    try {
      window.removeEventListener('keydown', handler);
    } catch (err) {
      console.warn('[useEscapeClose] could not detach keydown listener:', err);
    }
    attached = false;
  }

  watch(
    isOpen,
    (open) => {
      if (open) attach();
      else detach();
    },
    { immediate: true }
  );

  onScopeDispose(detach);
}
