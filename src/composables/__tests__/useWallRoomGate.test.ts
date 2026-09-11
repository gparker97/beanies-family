/**
 * The bug this composable exists for, stated as tests.
 *
 * On an Android tablet, tapping an add box on the wall opened the keyboard and
 * then immediately closed it again, so edit mode could not be used at all. The
 * cause was not the input, the form or focus handling: Android resizes the web
 * view to make room for the keyboard, that took a 1280x800 tablet under the
 * wall's 600px floor, and the gate unmounted the entire wall — including the
 * focused `<input>`. Android dismisses a keyboard whose element has gone.
 *
 * So the load-bearing assertion is the FIRST one: a shrink while someone is
 * typing must not close the gate.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { effectScope } from 'vue';
import { useWallRoomGate, ROOM_SETTLE_MS } from '../useWallRoomGate';

const { logEventMock } = vi.hoisted(() => ({ logEventMock: vi.fn() }));
vi.mock('@/services/telemetry/logEvent', () => ({ logEvent: logEventMock }));

/** A controllable `matchMedia`, so the "viewport" can be moved by hand. */
let matches = true;
const listeners = new Set<(e: MediaQueryListEvent) => void>();
const originalMatchMedia = window.matchMedia;

function setRoom(next: boolean) {
  matches = next;
  for (const l of listeners) l({ matches: next } as MediaQueryListEvent);
}

/** Focus a real input, the way tapping an add box does. */
function focusAnInput(): HTMLInputElement {
  const input = document.createElement('input');
  document.body.appendChild(input);
  input.focus();
  return input;
}

beforeEach(() => {
  vi.useFakeTimers();
  logEventMock.mockClear();
  matches = true;
  listeners.clear();
  document.body.innerHTML = '';
  window.matchMedia = vi.fn(
    () =>
      ({
        get matches() {
          return matches;
        },
        addEventListener: (_: string, l: (e: MediaQueryListEvent) => void) => listeners.add(l),
        removeEventListener: (_: string, l: (e: MediaQueryListEvent) => void) =>
          listeners.delete(l),
      }) as unknown as MediaQueryList
  ) as unknown as typeof window.matchMedia;
});

afterEach(() => {
  vi.useRealTimers();
  window.matchMedia = originalMatchMedia;
});

/** Run the composable in a scope we can dispose, as a component would. */
function mount() {
  const scope = effectScope();
  const gate = scope.run(() => useWallRoomGate())!;
  return { gate, stop: () => scope.stop() };
}

describe('a soft keyboard is not a smaller screen', () => {
  it('KEEPS the wall while the shrink is a keyboard under a focused input', () => {
    const { gate, stop } = mount();
    focusAnInput();

    setRoom(false); // the keyboard opened and the web view shrank
    vi.advanceTimersByTime(ROOM_SETTLE_MS * 3);

    // 🔴 The whole bug. False here unmounts the wall, the focused input goes
    // with it, and Android closes the keyboard the user just opened.
    expect(gate.value).toBe(true);
    stop();
  });

  it('restores the moment the keyboard closes, without a flash of the gate', () => {
    const { gate, stop } = mount();
    focusAnInput();

    setRoom(false);
    vi.advanceTimersByTime(ROOM_SETTLE_MS * 2);
    setRoom(true); // keyboard dismissed, viewport back
    vi.advanceTimersByTime(ROOM_SETTLE_MS * 2);

    expect(gate.value).toBe(true);
    stop();
  });

  it('reports the hold ONCE per episode, not once per re-arm', () => {
    const { stop } = mount();
    focusAnInput();

    setRoom(false);
    vi.advanceTimersByTime(ROOM_SETTLE_MS * 5);

    const held = logEventMock.mock.calls.filter((c) => c[0].message === 'wall_room_gate_held');
    expect(held).toHaveLength(1);
    stop();
  });
});

describe('a screen that genuinely cannot draw a wall', () => {
  it('closes the gate once the shrink has held and nobody is typing', () => {
    const { gate, stop } = mount();

    setRoom(false);
    expect(gate.value).toBe(true); // not yet — a shrink has to survive the settle
    vi.advanceTimersByTime(ROOM_SETTLE_MS + 1);

    expect(gate.value).toBe(false);
    expect(logEventMock).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'wall_room_gate_closed' })
    );
    stop();
  });

  it('still closes after a rotation that happened MID-TYPING, once typing stops', () => {
    // The wall must never get stuck admitted on a screen that cannot draw it.
    const { gate, stop } = mount();
    const input = focusAnInput();

    setRoom(false);
    vi.advanceTimersByTime(ROOM_SETTLE_MS * 3);
    expect(gate.value).toBe(true);

    input.blur();
    vi.advanceTimersByTime(ROOM_SETTLE_MS + 1);

    expect(gate.value).toBe(false);
    stop();
  });

  it('opens IMMEDIATELY on gaining room — the delay is one-directional', () => {
    matches = false;
    const { gate, stop } = mount();
    expect(gate.value).toBe(false);

    setRoom(true);

    // No timer advance: someone who rotates into a usable size gets the wall now.
    expect(gate.value).toBe(true);
    stop();
  });

  it('abandons a pending close when the room comes back first', () => {
    const { gate, stop } = mount();

    setRoom(false);
    vi.advanceTimersByTime(ROOM_SETTLE_MS - 50);
    setRoom(true);
    vi.advanceTimersByTime(ROOM_SETTLE_MS * 2);

    expect(gate.value).toBe(true);
    stop();
  });
});

describe('cleanup', () => {
  it('drops a pending timer when the wall unmounts', () => {
    const { gate, stop } = mount();
    setRoom(false);
    stop();

    vi.advanceTimersByTime(ROOM_SETTLE_MS * 3);

    // The scope is gone; a timer that still fired would write to a dead ref and
    // log a layout decision for a page nobody is on.
    expect(gate.value).toBe(true);
    expect(logEventMock).not.toHaveBeenCalledWith(
      expect.objectContaining({ message: 'wall_room_gate_closed' })
    );
  });
});
