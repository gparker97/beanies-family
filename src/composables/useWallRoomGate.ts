/**
 * Is there room here to BE a wall?
 *
 * The wall is a read-from-across-the-room display: bean lanes side by side, a
 * full week of columns, a time axis. It works in BOTH orientations, so this is
 * deliberately not an orientation test.
 *
 * ## Two questions, not one
 *
 * This used to be a single `(min-width: 600px) and (min-height: 600px)` against
 * the viewport, and that turned away the exact devices the product tells people
 * to mount. A budget 8" Android tablet is 533 or 601 CSS px on its short side
 * depending on the density its OEM shipped, and then loses another 56-130px to
 * the browser toolbar and the Android status and nav bars. An early adopter's
 * Lenovo Tab M8 was refused a wall it renders perfectly well.
 *
 * Admission is really two questions, and `wallRoom.ts` names them:
 *
 *   - `deviceCanBeAWall()` reads `screen`, so chrome and keyboards cannot
 *     change the answer. This is what refuses a phone.
 *   - the box query below reads the viewport, at a LOWER floor. This is what
 *     refuses a desktop window someone dragged small, where they can fix it.
 *
 * The device read is shared with the app's rotation policy, so "big enough to
 * rotate" and "big enough to be a wall" are now one constant rather than two
 * literals and a docblock claiming they agree.
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
import { computed, onScopeDispose, readonly, ref, watch, type Ref } from 'vue';
import { useMediaQuery } from '@/composables/useMediaQuery';
import { logEvent } from '@/services/telemetry/logEvent';
import { isTextEntryFocused } from '@/utils/isTextEntryFocused';
import {
  WALL_MIN_BOX_SIDE_PX,
  deviceCanBeAWall,
  deviceShortSidePx,
} from '@/components/wall/wallRoom';

/**
 * How long a loss of room must hold before the wall gives way to the gate.
 *
 * Long enough to outlast a keyboard animation (~250-300ms on Android) plus the
 * resize that follows it, short enough that a genuine rotation does not feel
 * stuck on the old layout.
 */
export const ROOM_SETTLE_MS = 600;

export function useWallRoomGate(surface = 'beanie-wall'): Readonly<Ref<boolean>> {
  /**
   * Can the BOX draw a wall right now? Reactive, because a desktop window can
   * be resized into and out of it, and a tablet can be rotated.
   *
   * ⚠️ This is no longer the whole gate. It is ANDed with `deviceCanBeAWall()`
   * below, which is what stops a phone, and it is deliberately the lower of the
   * two floors so that a tablet whose browser is drawing a toolbar still gets
   * its wall. See `wallRoom.ts` for why that is two questions and not one.
   */
  const hasBoxRoom = useMediaQuery(
    `(min-width: ${WALL_MIN_BOX_SIDE_PX}px) and (min-height: ${WALL_MIN_BOX_SIDE_PX}px)`,
    true
  );

  /**
   * Read ONCE, not reactively: a device does not change size. Reading it per
   * evaluation would also make the gate depend on `screen` at a moment when a
   * rotation may have updated one axis and not the other.
   */
  const deviceIsWallSized = deviceCanBeAWall();
  const deviceSide = deviceShortSidePx();

  /**
   * A device we could not measure was ADMITTED (see `deviceCanBeAWall`). That
   * is the right default, but it is still a branch taken on missing
   * information, and a silent fallback is how a webview reporting 0 would look
   * identical to a healthy tablet in the firehose.
   */
  if (deviceSide === null) {
    logEvent({
      level: 'warn',
      surface,
      message: 'wall_room_unknown_screen',
      context: { action: 'layout', kind: 'screen-unavailable' },
    });
  }

  const hasRoom = computed(() => deviceIsWallSized && hasBoxRoom.value);

  /**
   * The four numbers that make a refusal diagnosable from CloudWatch alone.
   *
   * This bug needed a research pass precisely because `wall_room_gate_closed`
   * could say only THAT the gate closed, never which floor rejected the device
   * or by how much. Read at emit time so a rotation is reflected.
   */
  function dims(): Record<string, number> {
    const out: Record<string, number> = {};
    if (typeof window !== 'undefined') {
      out.viewport_w = window.innerWidth;
      out.viewport_h = window.innerHeight;
    }
    if (typeof screen !== 'undefined' && screen?.width) {
      out.screen_w = screen.width;
      out.screen_h = screen.height;
    }
    return out;
  }

  function reportClosed(kind: 'device-too-small' | 'box-too-small'): void {
    logEvent({
      level: 'info',
      surface,
      message: 'wall_room_gate_closed',
      context: { action: 'layout', kind, ...dims() },
    });
  }

  /** The latched answer the page renders from. */
  const hasWallRoom = ref(hasRoom.value);

  /**
   * ⭐ Report a refusal that is true from the FIRST evaluation, not just one the
   * wall transitions into.
   *
   * The reported bug produced no telemetry at all, and this is why: someone
   * opening the wall on a too-small device is refused before any media query
   * ever changes, so `check()` never runs and nothing was ever logged. We could
   * count the walls that closed and not the ones that were never opened, which
   * is the shape of blindness that let a whole device class go unnoticed.
   */
  if (!hasWallRoom.value) {
    reportClosed(deviceIsWallSized ? 'box-too-small' : 'device-too-small');
  }

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
    // Reaching here means the box shrank: a device-sized refusal is decided at
    // setup and never transitions, because a device does not change size.
    reportClosed('box-too-small');
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
