import { type Ref } from 'vue';
import { PIN_LENGTH } from '@/services/auth/deviceUnlock';

/**
 * The digit-append / backspace half of an on-screen PIN pad.
 *
 * ⚠️ EXTRACTED BECAUSE IT WAS ABOUT TO EXIST THREE TIMES. `WallUnlockPad` has carried this
 * for the beanie wall since it shipped; the reauth gate and the login PIN entry now want the
 * same pad on phones, and copying twelve lines of clamp-and-clear into each of them is how a
 * fourth copy quietly becomes the one with the bug.
 *
 * Deliberately NOT inside `PinInput`. That component has sixteen instances across eight
 * files, most of which must not change at all, and absorbing the keypad's rendering into it
 * would also move the wall's error line below its keypad. Keeping the pad a sibling means
 * the three surfaces that want one opt in, and the other thirteen are untouched.
 */
export function usePinPad(
  model: Ref<string>,
  opts?: { onClearError?: () => void }
): { press: (digit: string) => void; backspace: () => void } {
  function press(digit: string): void {
    if (model.value.length >= PIN_LENGTH) return;
    model.value = `${model.value}${digit}`;
    opts?.onClearError?.();
  }

  function backspace(): void {
    // ⚠️ CLEAR FIRST. A wrong PIN empties the boxes and paints them red, so the very next
    // backspace is the one that hits `!model.value` — and returning early there left the
    // red on screen for a gesture whose whole purpose was to dismiss it. The code this
    // replaced cleared unconditionally.
    opts?.onClearError?.();
    if (!model.value) return;
    model.value = model.value.slice(0, -1);
  }

  return { press, backspace };
}
