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
// Module-level stack of currently-open overlays, in the order they opened.
// Escape closes only the TOP-MOST one, so a stacked overlay (e.g. a list
// drawer opened over the activity drawer) dismisses back to the overlay it
// sits on rather than collapsing every layer at once. A single shared window
// listener drives the whole stack — independent per-instance listeners would
// each fire for the same keypress and close all open overlays together.
type EscapeToken = { onClose: () => void };
const escapeStack: EscapeToken[] = [];
let sharedListening = false;

function handleKeydown(event: KeyboardEvent) {
  if (event.key !== 'Escape') return;
  const top = escapeStack[escapeStack.length - 1];
  if (top) top.onClose();
}

function startSharedListener() {
  if (sharedListening || escapeStack.length === 0) return;
  try {
    window.addEventListener('keydown', handleKeydown);
    sharedListening = true;
  } catch (err) {
    console.warn('[useEscapeClose] could not attach keydown listener:', err);
  }
}

function stopSharedListenerIfIdle() {
  if (!sharedListening || escapeStack.length > 0) return;
  try {
    window.removeEventListener('keydown', handleKeydown);
  } catch (err) {
    console.warn('[useEscapeClose] could not detach keydown listener:', err);
  }
  sharedListening = false;
}

export function useEscapeClose(isOpen: Ref<boolean>, onClose: () => void): void {
  // One token per consumer; its onClose is the close handler invoked when this
  // overlay is the top of the stack. Re-opening pushes the token back on top.
  const token: EscapeToken = { onClose };

  function register() {
    if (escapeStack.includes(token)) return;
    escapeStack.push(token);
    startSharedListener();
  }

  function unregister() {
    const idx = escapeStack.indexOf(token);
    if (idx !== -1) escapeStack.splice(idx, 1);
    stopSharedListenerIfIdle();
  }

  watch(
    isOpen,
    (open) => {
      if (open) register();
      else unregister();
    },
    { immediate: true }
  );

  onScopeDispose(unregister);
}

/**
 * Test-only: clear the module-global stack + detach the shared listener between
 * tests. The stack intentionally persists across consumers (that's the whole
 * point of the shared listener), so a test that leaves an overlay registered
 * would leak into the next; call this in a `beforeEach`. Not for production use.
 */
export function __resetEscapeCloseForTests(): void {
  escapeStack.length = 0;
  stopSharedListenerIfIdle(); // stack is now empty → detaches the shared listener
}
