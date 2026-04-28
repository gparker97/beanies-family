import { onScopeDispose, watch, type Ref } from 'vue';

/**
 * Marker key on `history.state` so we can tell our own pushed entry apart
 * from arbitrary navigations in the popstate handler. Each composable
 * instance generates a unique sub-key so multiple concurrent overlays
 * don't collide.
 */
const MARKER_FIELD = '_beanieOverlayMarker';

let markerSeq = 0;
function nextMarkerKey(): string {
  markerSeq += 1;
  // Use crypto.randomUUID when available for uniqueness across module reloads.
  const random =
    typeof globalThis.crypto?.randomUUID === 'function'
      ? globalThis.crypto.randomUUID()
      : Math.random().toString(36).slice(2, 10);
  return `bg-${markerSeq}-${random}`;
}

function readMarker(state: unknown): string | null {
  if (!state || typeof state !== 'object') return null;
  const value = (state as Record<string, unknown>)[MARKER_FIELD];
  return typeof value === 'string' ? value : null;
}

/**
 * Closes an open overlay when the user invokes the platform "back" gesture
 * (Android back button, iOS edge-swipe-back, browser back button).
 *
 * Implementation:
 * 1. On open: push a synthetic `history.pushState` entry stamped with a
 *    per-instance marker key.
 * 2. While open: listen for `popstate` and call `onClose` only if the
 *    state we're popping past carries OUR marker (so we don't mis-fire
 *    on unrelated `router.push` / browser navigation).
 * 3. On programmatic close: if our marker is still on the history stack,
 *    call `history.back()` to pop it. Set a re-entry guard so the
 *    resulting `popstate` doesn't double-fire `onClose`.
 *
 * `onScopeDispose` is the safety net: if the consuming component unmounts
 * while still open, we pop our marker and detach the listener so we don't
 * leave a stale entry on the user's history stack.
 *
 * Failure modes:
 * - `history.pushState` throws (private browsing in some old WebKit;
 *   sandboxed iframe): caught and logged with `[useBackGestureClose]`
 *   prefix; the overlay still opens but the back gesture won't close it
 *   — the consumer's Esc / scrim handlers remain effective.
 * - `addEventListener` / `removeEventListener` throws: caught and logged.
 * - `popstate` fires for non-overlay navigation (router.push, deep link):
 *   marker check rejects it; ignored.
 *
 * @param isOpen   — reactive flag mirroring the overlay's open state
 * @param onClose  — invoked with no arguments when the back gesture is
 *                   detected. Callers should set the bound `isOpen` ref
 *                   to `false` inside this callback (or its caller) so
 *                   the watch tears down the listener.
 */
export function useBackGestureClose(isOpen: Ref<boolean>, onClose: () => void): void {
  const markerKey = nextMarkerKey();
  let pushed = false;
  let attached = false;
  let pendingProgrammaticBack = false;

  function popstateHandler() {
    if (pendingProgrammaticBack) {
      // We just called history.back() ourselves to pop our marker.
      // Swallow this popstate; the close has already happened.
      pendingProgrammaticBack = false;
      pushed = false;
      return;
    }
    // Only react if the state we are now landing on does NOT carry our
    // marker — meaning the user navigated past our pushed entry.
    const currentMarker = readMarker(window.history.state);
    if (currentMarker === markerKey) {
      // We're still on our own entry; some other state change happened.
      return;
    }
    if (pushed) {
      pushed = false;
      onClose();
    }
  }

  function attachListener() {
    if (attached) return;
    try {
      window.addEventListener('popstate', popstateHandler);
      attached = true;
    } catch (err) {
      console.warn('[useBackGestureClose] could not attach popstate listener:', err);
    }
  }

  function detachListener() {
    if (!attached) return;
    try {
      window.removeEventListener('popstate', popstateHandler);
    } catch (err) {
      console.warn('[useBackGestureClose] could not detach popstate listener:', err);
    }
    attached = false;
  }

  function pushMarker() {
    if (pushed) return;
    try {
      const base = (window.history.state as Record<string, unknown> | null) ?? {};
      window.history.pushState({ ...base, [MARKER_FIELD]: markerKey }, '');
      pushed = true;
    } catch (err) {
      console.warn(
        '[useBackGestureClose] could not push history marker; back gesture unavailable:',
        err
      );
    }
  }

  function popMarker() {
    if (!pushed) return;
    // Only pop if our marker is currently on top of the stack — protects
    // against a race where the user already navigated past us.
    if (readMarker(window.history.state) !== markerKey) {
      pushed = false;
      return;
    }
    try {
      pendingProgrammaticBack = true;
      window.history.back();
    } catch (err) {
      console.warn('[useBackGestureClose] could not pop history marker:', err);
      pendingProgrammaticBack = false;
      pushed = false;
    }
  }

  watch(
    isOpen,
    (open) => {
      if (open) {
        pushMarker();
        attachListener();
      } else {
        popMarker();
        detachListener();
      }
    },
    { immediate: true }
  );

  onScopeDispose(() => {
    popMarker();
    detachListener();
  });
}
