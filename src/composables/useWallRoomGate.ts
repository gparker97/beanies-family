/**
 * Is this screen big enough to BE a wall?
 *
 * The wall is a read-from-across-the-room display: bean lanes side by side, a
 * full week of columns, a time axis. It works in BOTH orientations, so this is
 * deliberately not an orientation test. What it needs is room on BOTH axes.
 *
 * A width-only threshold gets it wrong twice, in opposite directions: an iPad
 * mini in portrait is 744px wide and would be refused a wall it renders
 * perfectly well, while a phone held sideways is 844px wide and would be handed
 * one it has only 390px of height to draw. So: a minimum on the smaller side,
 * whichever side that currently is. 600px is Android's own `sw600dp` tablet
 * threshold and the same number `isRotatableFormFactor()` uses, so "big enough
 * to rotate" and "big enough for a wall" stay one idea.
 *
 * ## Why this is a composable with a timer, and not one line of `matchMedia`
 *
 * It WAS one line, and it made edit mode unusable on every Android tablet.
 *
 * A soft keyboard is not a smaller screen — but Android resizes the web view to
 * make room for it (Capacitor ships `adjustResize`, and Chrome's own default
 * does the same to the layout viewport in an installed PWA). So the instant
 * someone tapped an add box on a 1280x800 tablet, the viewport became roughly
 * 1280x420, the `min-height: 600px` query flipped, and `tooNarrow` unmounted the
 * ENTIRE `wall-root` subtree — taking the focused `<input>` with it. Android
 * dismisses the keyboard when the element it belongs to stops existing. The
 * viewport then sprang back, the wall remounted with an empty unfocused box, and
 * the whole cycle repeated on the next tap: "the keyboard pops up and then
 * immediately closes again, so edit mode can't be used."
 *
 * Nothing about the device changed. Only a keyboard was covering part of it.
 *
 * So the gate is now ASYMMETRIC, which matches what the two directions actually
 * mean:
 *
 *  - GAINING room is immediate. Someone who rotates a tablet into a usable size
 *    should get the wall at once, with no deliberate-feeling delay.
 *  - LOSING room must HOLD. A shrink only closes the gate once it has survived
 *    `ROOM_SETTLE_MS` and nothing is being typed into. A keyboard shrink fails
 *    both halves of that test; a genuine rotation or window resize passes it.
 *
 * The typing check re-arms rather than giving up, so a real rotation that
 * happens WHILE someone is typing still closes the gate a moment after they stop
 * — the wall can never get stuck admitted on a screen that cannot draw it.
 */
import { onScopeDispose, readonly, ref, watch, type Ref } from 'vue';
import { useMediaQuery } from '@/composables/useMediaQuery';
import { logEvent } from '@/services/telemetry/logEvent';

/** Android's `sw600dp`, applied to the smaller side whichever side that is. */
export const WALL_MIN_SIDE_PX = 600;

/**
 * How long a loss of room must hold before the wall gives way to the gate.
 *
 * Long enough to outlast a keyboard animation (~250-300ms on Android) plus the
 * resize that follows it, short enough that a genuine rotation does not feel
 * stuck on the old layout.
 */
export const ROOM_SETTLE_MS = 600;

/**
 * Is the person typing right now?
 *
 * The engine-independent signal that a viewport shrink is a keyboard: on every
 * platform, a soft keyboard is only ever open because an editable element has
 * focus. Reading `activeElement` needs no listener, no `visualViewport`, and no
 * per-engine knowledge of whether the layout viewport resizes.
 */
function isTextEntryFocused(): boolean {
  if (typeof document === 'undefined') return false;
  const el = document.activeElement as HTMLElement | null;
  if (!el) return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

export function useWallRoomGate(surface = 'beanie-wall'): Readonly<Ref<boolean>> {
  const hasRoom = useMediaQuery(
    `(min-width: ${WALL_MIN_SIDE_PX}px) and (min-height: ${WALL_MIN_SIDE_PX}px)`,
    true
  );

  /** The latched answer the page renders from. */
  const hasWallRoom = ref(hasRoom.value);
  let settle: ReturnType<typeof setTimeout> | undefined;
  /** One firehose row per episode, not one per re-arm. */
  let heldReported = false;

  function clearSettle(): void {
    if (settle) clearTimeout(settle);
    settle = undefined;
  }

  function check(): void {
    // The keyboard has closed and the query is already true again — the common
    // case, and the whole reason the gate waits.
    if (hasRoom.value) {
      settle = undefined;
      heldReported = false;
      return;
    }
    if (isTextEntryFocused()) {
      // Re-arm rather than give up. Bounded and self-terminating: it only polls
      // while the room is genuinely lacking AND someone is typing, and the first
      // check after they stop closes the gate.
      if (!heldReported) {
        heldReported = true;
        logEvent({
          level: 'info',
          surface,
          message: 'wall_room_gate_held',
          context: { action: 'layout', kind: 'text-entry' },
        });
      }
      settle = setTimeout(check, ROOM_SETTLE_MS);
      return;
    }
    settle = undefined;
    heldReported = false;
    hasWallRoom.value = false;
    logEvent({
      level: 'info',
      surface,
      message: 'wall_room_gate_closed',
      context: { action: 'layout', kind: 'too-small' },
    });
  }

  // `flush: 'sync'`, deliberately. This reacts to a media-query event, not to a
  // render, and all it does is set a ref and arm a timer. The default `'pre'`
  // flush defers the callback to a microtask, which would leave a tick in which
  // the query has already changed and the gate has not — and, on the regaining
  // path, a frame where the wall is still showing the gate on a screen that can
  // now draw it.
  watch(
    hasRoom,
    (room) => {
      clearSettle();
      if (room) {
        heldReported = false;
        hasWallRoom.value = true;
        return;
      }
      settle = setTimeout(check, ROOM_SETTLE_MS);
    },
    { flush: 'sync' }
  );

  onScopeDispose(clearSettle);

  return readonly(hasWallRoom);
}
